import { supabase } from "./supabaseClient.js";

/**
 * 列表查询易触发 `statement timeout`（`order by created_at` + 每行 `players` json 很大时，
 * 即使用 created_at 索引，一次取几百行仍要堆表读大量 json）。
 *
 * 1) 建议索引（已建可略过）：
 *    create index if not exists plan_b_created_at_idx on public.plan_b (created_at desc);
 * 2) 更利于「只拉 id 排序」的覆盖索引（可选，需重建时先 drop 旧名）：
 *    create index if not exists plan_b_created_at_match_id_idx
 *      on public.plan_b (created_at desc) include (match_id);
 * 3) 建索引后执行：analyze public.plan_b;
 */

/** Supabase 行可能是整局 slim 平铺，或包在 data / payload 等 jsonb 列里 */
export function unwrapPlanBRow(row: unknown): unknown | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const topPlayers = r["players"];
  if (Array.isArray(topPlayers) && topPlayers.length > 0) return r;
  for (const k of ["data", "payload", "slim", "match_json", "body"]) {
    const inner = r[k];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const o = inner as Record<string, unknown>;
      if (Array.isArray(o.players) && o.players.length > 0) return o;
    }
  }
  return r;
}

/** 按 match_id 取整局数据（供详情页 / 选手页详情等） */
export async function fetchPlanBSlimPayload(
  matchId: number
): Promise<unknown | null> {
  if (!Number.isFinite(matchId) || matchId <= 0) return null;
  const client = supabase;
  if (!client) return null;

  const run = async (id: number | string) =>
    client.from("plan_b").select("*").eq("match_id", id).limit(1);

  let { data, error } = await run(matchId);
  if (error) throw new Error(error.message || "Supabase 查询失败");
  let row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) {
    ({ data, error } = await run(String(matchId)));
    if (error) throw new Error(error.message || "Supabase 查询失败");
    row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  }
  return unwrapPlanBRow(row);
}

const PLAN_B_INDEX_SELECT =
  "match_id, created_at, duration, radiant_win, radiant_score, dire_score, league_name, players";

/** 两阶段：先轻列排序取 id，再 in(match_id) 拉完整行，避免「排序 + 大 json」同一条 SQL 爆超时 */
const PLAN_B_TWO_PHASE_ID_LIMIT = 120;
const PLAN_B_IN_CHUNK = 40;

/** 单查询兜底：仍失败时递减 limit */
const PLAN_B_SINGLE_QUERY_LIMITS: readonly number[] = [80, 50, 30];

function looksLikeStatementTimeout(message: string): boolean {
  return /statement timeout|query.*timeout|57014|canceling statement/i.test(
    message
  );
}

function orderFullRowsByIdList(
  rows: Record<string, unknown>[],
  idOrder: readonly (string | number)[]
): Record<string, unknown>[] {
  const rank = new Map<string, number>();
  idOrder.forEach((id, i) => {
    rank.set(String(id), i);
  });
  return [...rows].sort(
    (a, b) =>
      (rank.get(String(a.match_id)) ?? 9999) -
      (rank.get(String(b.match_id)) ?? 9999)
  );
}

/**
 * 两阶段拉取 plan_b 列表行；失败返回 error 供上层回退单查询。
 */
async function fetchPlanBReplayIndexRowsTwoPhase(
  client: NonNullable<typeof supabase>
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const { data: thin, error: e1 } = await client
    .from("plan_b")
    .select("match_id, created_at")
    .order("created_at", { ascending: false })
    .limit(PLAN_B_TWO_PHASE_ID_LIMIT);

  if (e1) {
    return { rows: [], error: e1.message };
  }

  const idOrder = (Array.isArray(thin) ? thin : [])
    .map((r) => (r as { match_id?: unknown }).match_id)
    .filter((id) => id !== undefined && id !== null) as (string | number)[];

  if (idOrder.length === 0) {
    return { rows: [], error: null };
  }

  const full: Record<string, unknown>[] = [];
  for (let i = 0; i < idOrder.length; i += PLAN_B_IN_CHUNK) {
    const chunk = idOrder.slice(i, i + PLAN_B_IN_CHUNK);
    const { data: part, error: e2 } = await client
      .from("plan_b")
      .select(PLAN_B_INDEX_SELECT)
      .in("match_id", chunk);

    if (e2) {
      return { rows: [], error: e2.message };
    }
    if (Array.isArray(part)) {
      for (const row of part) {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          full.push(row as Record<string, unknown>);
        }
      }
    }
  }

  return {
    rows: orderFullRowsByIdList(full, idOrder),
    error: null,
  };
}

/** 首页 / 英雄 / 选手索引用：轻量列 + 按入库时间倒序 */
export async function fetchPlanBReplayIndexRows(): Promise<{
  rows: Record<string, unknown>[];
  error: string | null;
}> {
  const client = supabase;
  if (!client) return { rows: [], error: null };

  const two = await fetchPlanBReplayIndexRowsTwoPhase(client);
  if (!two.error) {
    return two;
  }

  if (!looksLikeStatementTimeout(two.error)) {
    return two;
  }

  console.warn("[plan_b] 两阶段拉取超时/失败，回退单条 SQL:", two.error);

  let lastError: string | null = two.error;
  for (let i = 0; i < PLAN_B_SINGLE_QUERY_LIMITS.length; i++) {
    const lim = PLAN_B_SINGLE_QUERY_LIMITS[i];
    const { data, error } = await client
      .from("plan_b")
      .select(PLAN_B_INDEX_SELECT)
      .order("created_at", { ascending: false })
      .limit(lim);

    if (!error) {
      return {
        rows: Array.isArray(data) ? (data as Record<string, unknown>[]) : [],
        error: null,
      };
    }

    lastError = error.message;
    console.warn(`[plan_b] 单查询兜底失败 (limit=${lim}):`, error.message);

    const retry =
      i + 1 < PLAN_B_SINGLE_QUERY_LIMITS.length &&
      looksLikeStatementTimeout(error.message);
    if (!retry) {
      return { rows: [], error: lastError };
    }
  }

  return { rows: [], error: lastError };
}
