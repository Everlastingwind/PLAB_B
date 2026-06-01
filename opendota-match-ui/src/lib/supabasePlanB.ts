import type { SupabaseClient } from "@supabase/supabase-js";
import { forEachConcurrent } from "./fetchConcurrent";
import { supabase } from "./supabaseClient.js";
import { ensureSitePatchLoaded } from "./sitePatchStore";

/** plan_b 列表 / 聚合：仅当前补丁；选手跨版本历史见 site_settings 衍生列表 */
export type PlanBPatchScope = "latest" | "player";

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

function planBPlayersFieldLen(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? p.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

/** 列可能为 jsonb 对象，也可能误存为 JSON 字符串 */
function parsePlanBJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * `plan_b` 行即 translate_match_data 后的 slim 平铺（upsert 整对象），`players` 在顶层。
 * 若历史库仍有嵌套 jsonb 列，unwrap 会尝试读取；**查询勿 select 不存在的 slim/payload 列**。
 */
function planBPlayersRichness(obj: Record<string, unknown>): number {
  const pl = obj["players"];
  if (!Array.isArray(pl)) return 0;
  let score = 0;
  for (const p of pl) {
    if (!p || typeof p !== "object") continue;
    const pr = p as Record<string, unknown>;
    const ph = pr["purchase_history"];
    if (Array.isArray(ph) && ph.length > 0) {
      score += 400 + Math.min(ph.length, 400);
    }
    const plog = pr["purchase_log"];
    if (Array.isArray(plog) && plog.length > 0) {
      score += 350 + Math.min(plog.length, 400);
    }
    const tt = pr["talent_tree"];
    if (tt && typeof tt === "object") {
      const tiers = (tt as { tiers?: unknown }).tiers;
      if (Array.isArray(tiers) && tiers.length > 0) score += 120;
    }
    if (Array.isArray(pr["talent_picks"]) && pr["talent_picks"].length > 0) {
      score += 100;
    }
    const sb = pr["skill_build"];
    const au = pr["ability_upgrades_arr"];
    if (Array.isArray(sb) && sb.length > 0) score += 40;
    if (Array.isArray(au) && au.length > 0) score += 40;
  }
  return score;
}

/** Supabase 行可能是整局 slim 平铺，或包在 data / payload 等 jsonb 列里 */
export function unwrapPlanBRow(row: unknown): unknown | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  type Cand = { obj: Record<string, unknown>; len: number };
  const cands: Cand[] = [];

  const pushCand = (obj: Record<string, unknown>) => {
    const len = planBPlayersFieldLen(obj["players"]);
    if (len > 0) cands.push({ obj, len });
  };

  const consider = (obj: Record<string, unknown>) => {
    pushCand(obj);
    const m = parsePlanBJsonObject(obj.match);
    if (m) pushCand(m);
  };

  consider(r);
  for (const k of ["data", "payload", "slim", "match_json", "body"]) {
    const inner = parsePlanBJsonObject(r[k]);
    if (inner) consider(inner);
  }

  if (cands.length === 0) return r;

  cands.sort((a, b) => {
    const ld = b.len - a.len;
    if (ld !== 0) return ld;
    return planBPlayersRichness(b.obj) - planBPlayersRichness(a.obj);
  });
  const best = cands[0];
  if (best.obj === r) return r;

  return { ...r, ...best.obj };
}

/**
 * 列表摘要：从 plan_b 行取出选手数组（顶层或 slim/data/match 内），用于 {@link planBRowToReplaySummary}。
 */
export function extractPlanBPlayersArray(
  row: Record<string, unknown>
): unknown[] | null {
  const lengths: { arr: unknown[]; len: number }[] = [];

  const pushArr = (raw: unknown) => {
    let v = raw;
    if (typeof v === "string" && v.trim()) {
      try {
        v = JSON.parse(v) as unknown;
      } catch {
        return;
      }
    }
    if (Array.isArray(v) && v.length) {
      lengths.push({ arr: v, len: v.length });
    }
  };

  pushArr(row.players);

  for (const col of ["slim", "data", "payload", "match_json", "body"]) {
    const obj = parsePlanBJsonObject(row[col]);
    if (!obj) continue;
    pushArr(obj.players);
    const m = parsePlanBJsonObject(obj.match);
    if (m) pushArr(m.players);
  }

  if (!lengths.length) return null;
  lengths.sort((a, b) => b.len - a.len);
  return lengths[0].arr;
}

/**
 * 列表 `select` 可能未带 `patch_version` 列，或补丁号仅在 slim / payload 内。
 * 供 replay 摘要合并（replaysApi）补全，避免 `replayMatchesLatestPatch` 因缺字段永远为 false。
 */
export function extractPatchVersionFromPlanBRow(
  row: Record<string, unknown>
): string | undefined {
  const top = row.patch_version;
  if (top != null && String(top).trim()) return String(top).trim();
  for (const col of ["slim", "data", "payload", "match_json", "body"] as const) {
    const obj = parsePlanBJsonObject(row[col]);
    if (!obj) continue;
    const pv = obj.patch_version ?? obj.patchVersion;
    if (pv != null && String(pv).trim()) return String(pv).trim();
    const m = parsePlanBJsonObject(obj.match);
    if (m) {
      const pv2 = m.patch_version ?? m.patchVersion;
      if (pv2 != null && String(pv2).trim()) return String(pv2).trim();
    }
  }
  return undefined;
}

/** 与 {@link summaryPlayerFromRawObject} 对齐：从选手对象解析 npc hero_id */
function playerObjectHeroNpcId(o: Record<string, unknown>): number {
  let heroId = Math.floor(Number(o.hero_id ?? o.heroId ?? 0) || 0);
  const heroRaw = o.hero;
  if (!heroId && heroRaw != null) {
    if (typeof heroRaw === "number" || typeof heroRaw === "string") {
      heroId = Math.floor(Number(heroRaw) || 0);
    } else if (typeof heroRaw === "object" && !Array.isArray(heroRaw)) {
      const ho = heroRaw as Record<string, unknown>;
      heroId = Math.floor(
        Number(ho.hero_id ?? ho.id ?? ho.heroid ?? 0) || 0
      );
    }
  }
  return heroId;
}

function playerObjectAccountId(o: Record<string, unknown>): number {
  return Math.floor(
    Number(
      o.account_id ??
        o.accountid ??
        o.accountId ??
        o.steamid ??
        o.steam_id ??
        o.player_id ??
        0
    ) || 0
  );
}

/** 行内是否含该英雄（读顶层/slim/payload 内 players，与列表摘要逻辑一致） */
export function planBRowIncludesHeroNpc(
  row: Record<string, unknown>,
  heroNpcId: number
): boolean {
  const players = extractPlanBPlayersArray(row);
  if (!players?.length) return false;
  for (const p of players) {
    if (!p || typeof p !== "object") continue;
    if (playerObjectHeroNpcId(p as Record<string, unknown>) === heroNpcId) {
      return true;
    }
  }
  return false;
}

export function planBRowIncludesAccountId(
  row: Record<string, unknown>,
  accountId: number
): boolean {
  const players = extractPlanBPlayersArray(row);
  if (!players?.length) return false;
  for (const p of players) {
    if (!p || typeof p !== "object") continue;
    if (playerObjectAccountId(p as Record<string, unknown>) === accountId) {
      return true;
    }
  }
  return false;
}

/** 列表 / 分页 / 搜索：严禁 select `*` 或 `players`（jsonb 过大易 OOM） */
const PLAN_B_INDEX_SELECT =
  "match_id, created_at, patch_version, duration, radiant_win, radiant_score, dire_score, league_name";
const PLAN_B_INDEX_LIGHT_SELECT = PLAN_B_INDEX_SELECT;

/**
 * 详情 / 批量 slim / 英雄·选手页：需 `players` 时用此列集（**不用 `*`**）。
 * 若库表缺某列，下方会按链依次尝试更窄的显式列集合。
 */
const PLAN_B_DETAIL_SELECT =
  "match_id, created_at, patch_version, duration, radiant_win, radiant_score, dire_score, league_name, players";

const PLAN_B_DETAIL_SELECT_FALLBACKS = [
  PLAN_B_DETAIL_SELECT,
  "match_id, players",
] as const;

/**
 * 批量 `.in()`：优先详情列；勿 select 不存在的 slim/payload（每 chunk 失败会刷爆库）。
 */
const PLAN_B_BATCH_IN_SELECT_FALLBACKS: readonly string[] = [
  PLAN_B_DETAIL_SELECT,
  "match_id, players",
];

/** 列表页第二段：仅按 match_id 补拉 `players`（比分/英雄），避免排序扫描大 jsonb */
const PLAN_B_LIST_PLAYERS_OVERLAY_SELECT = "match_id, players";

function planBPatchVersionForFilter(
  currentPatch: string | null | undefined
): string {
  return String(currentPatch ?? "").trim();
}

/** 分页列表：轻列 + 当前页 match_id 批量 overlay players */
export async function overlayPlanBListRowsWithPlayersWithClient(
  client: SupabaseClient,
  lightRows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  return overlayPlanBListRowsWithPlayers(
    client as NonNullable<typeof supabase>,
    lightRows
  );
}

async function overlayPlanBListRowsWithPlayers(
  client: NonNullable<typeof supabase>,
  lightRows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const ids: (number | string)[] = [];
  for (const row of lightRows) {
    const id = row.match_id;
    if (id !== undefined && id !== null) ids.push(id as number | string);
  }
  if (!ids.length) return lightRows;

  const { data, error } = await client
    .from("plan_b")
    .select(PLAN_B_LIST_PLAYERS_OVERLAY_SELECT)
    .in("match_id", ids);
  if (error || !Array.isArray(data)) return lightRows;

  const byId = new Map<string, Record<string, unknown>>();
  for (const row of data) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      byId.set(String((row as Record<string, unknown>).match_id), row as Record<
        string,
        unknown
      >);
    }
  }
  return lightRows.map((row) => {
    const ov = byId.get(String(row.match_id));
    if (!ov) return row;
    return { ...row, ...ov };
  });
}

export async function fetchPlanBSlimPayloadWithClient(
  client: SupabaseClient,
  matchId: number
): Promise<unknown | null> {
  if (!Number.isFinite(matchId) || matchId <= 0) return null;

  const run = async (id: number | string, sel: string) =>
    client.from("plan_b").select(sel).eq("match_id", id).limit(1);

  const fetchRow = async (id: number | string) => {
    let lastErr: { message?: string } | null = null;
    for (const sel of PLAN_B_DETAIL_SELECT_FALLBACKS) {
      const { data, error } = await run(id, sel);
      if (!error) {
        return Array.isArray(data) && data.length > 0 ? data[0] : null;
      }
      lastErr = error;
      const msg = error.message || "";
      if (!/column|42703|does not exist|schema cache/i.test(msg)) {
        throw new Error(msg || "Supabase 查询失败");
      }
    }
    console.warn(
      "[plan_b] 详情列链均失败:",
      lastErr?.message?.slice(0, 200)
    );
    throw new Error(lastErr?.message || "Supabase 查询失败");
  };

  let row = await fetchRow(matchId);
  if (!row) {
    row = await fetchRow(String(matchId));
  }
  return unwrapPlanBRow(row);
}

/** 按 match_id 取整局数据（供详情页 / 选手页详情等） */
export async function fetchPlanBSlimPayload(
  matchId: number
): Promise<unknown | null> {
  const client = supabase;
  if (!client) return null;
  return fetchPlanBSlimPayloadWithClient(client, matchId);
}

/**
 * 单次 `.in(match_id, …)` 上限：PostgREST GET 查询串过长时易 400，继而触发切片递归，
 * 在最坏情况下会退化成「每场一次 eq」（表现为几百次 plan_b）。保持较小 chunk。
 */
const PLAN_B_DETAIL_CHUNK = 16;
/** 批量仍失败时先拆成更细的 `.in()`，最后再逐 id（上限避免一场一页打爆请求） */
const PLAN_B_DETAIL_MICRO_CHUNK = 8;

/**
 * 对一批 match_id 尝试列链 + `.in()`；仅在整块失败时二分递归或单条 eq，
 * **禁止**对整块内每个 id 各发一次请求（ former N+1 源头）。
 */
async function fetchPlanBSlimPayloadBatchSlice(
  client: SupabaseClient,
  chunkIn: readonly number[]
): Promise<Map<number, unknown>> {
  const out = new Map<number, unknown>();
  const uniq = [
    ...new Set(
      chunkIn.filter((id) => Number.isFinite(id) && (id as number) > 0)
    ),
  ] as number[];
  if (uniq.length === 0) return out;

  for (const sel of PLAN_B_BATCH_IN_SELECT_FALLBACKS) {
    const { data, error } = await client
      .from("plan_b")
      .select(sel)
      .in("match_id", uniq);
    if (!error) {
      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        const mid = Number(rec.match_id);
        if (!Number.isFinite(mid) || mid <= 0) continue;
        const unwrapped = unwrapPlanBRow(row);
        if (unwrapped) out.set(mid, unwrapped);
      }
      return out;
    }
    const msg = error.message || "";
    // 勿在「非缺列」时中断整条链：宽列 400/414 后窄列仍可能成功
    if (!/column|42703|does not exist|schema cache/i.test(msg)) {
      console.warn(
        "[plan_b] batch in(match_id) 本组 select 失败，尝试下一窄列:",
        msg.slice(0, 140)
      );
    }
  }

  if (uniq.length === 1) {
    try {
      const one = await fetchPlanBSlimPayloadWithClient(client, uniq[0]);
      if (one) out.set(uniq[0], one);
    } catch {
      /* skip */
    }
    return out;
  }

  // 线性拆成更小的 `.in()`，避免深度二分在失败链路上退化成「每场一次请求」
  if (uniq.length <= PLAN_B_DETAIL_MICRO_CHUNK) {
    for (const id of uniq) {
      try {
        const one = await fetchPlanBSlimPayloadWithClient(client, id);
        if (one) out.set(id, one);
      } catch {
        /* skip */
      }
    }
    return out;
  }

  for (let i = 0; i < uniq.length; i += PLAN_B_DETAIL_MICRO_CHUNK) {
    const part = await fetchPlanBSlimPayloadBatchSlice(
      client,
      uniq.slice(i, i + PLAN_B_DETAIL_MICRO_CHUNK)
    );
    for (const [k, v] of part) out.set(k, v);
  }
  return out;
}

/**
 * 按多 match_id 批量取 slim（英雄/选手列表页用），显著减少 Supabase 往返与 OPTIONS 预检次数。
 */
export async function fetchPlanBSlimPayloadBatchWithClient(
  client: SupabaseClient,
  matchIds: readonly number[]
): Promise<Map<number, unknown>> {
  const out = new Map<number, unknown>();
  const ids = [
    ...new Set(
      matchIds.filter((id) => Number.isFinite(id) && (id as number) > 0)
    ),
  ] as number[];
  if (ids.length === 0) return out;

  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += PLAN_B_DETAIL_CHUNK) {
    chunks.push(ids.slice(i, i + PLAN_B_DETAIL_CHUNK));
  }
  const parts: Map<number, unknown>[] = new Array(chunks.length);
  await forEachConcurrent(
    chunks.map((chunk, i) => ({ chunk, i })),
    4,
    async ({ chunk, i }) => {
      parts[i] = await fetchPlanBSlimPayloadBatchSlice(client, chunk);
    }
  );
  for (const part of parts) {
    for (const [k, v] of part) out.set(k, v);
  }

  return out;
}

export async function fetchPlanBSlimPayloadBatch(
  matchIds: readonly number[]
): Promise<Map<number, unknown>> {
  const client = supabase;
  if (!client) return new Map();
  return fetchPlanBSlimPayloadBatchWithClient(client, matchIds);
}

/** 两阶段：分页轻列取 id，再 in(match_id) 拉完整行，避免「排序 + 大 json」同一条 SQL 爆超时 */
const PLAN_B_TWO_PHASE_PAGE_SIZE = 120;
/** 大表上多页轻扫仍会拖垮库；仅保留少量页作遗留兜底 */
const PLAN_B_TWO_PHASE_MAX_PAGES = 8;
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
  const { currentPatch } = await ensureSitePatchLoaded();
  const patchVersion = planBPatchVersionForFilter(currentPatch);
  const idOrder: (string | number)[] = [];
  for (let page = 0; page < PLAN_B_TWO_PHASE_MAX_PAGES; page++) {
    const from = page * PLAN_B_TWO_PHASE_PAGE_SIZE;
    const to = from + PLAN_B_TWO_PHASE_PAGE_SIZE - 1;
    const { data: thin, error: e1 } = await client
      .from("plan_b")
      .select("match_id, created_at")
      .eq("patch_version", patchVersion)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (e1) {
      return { rows: [], error: e1.message };
    }
    const batch = Array.isArray(thin) ? thin : [];
    for (const row of batch) {
      const id = (row as { match_id?: unknown }).match_id;
      if (id !== undefined && id !== null) idOrder.push(id as string | number);
    }
    if (batch.length < PLAN_B_TWO_PHASE_PAGE_SIZE) break;
  }

  if (idOrder.length === 0) {
    return { rows: [], error: null };
  }

  const uniqueIdOrder: (string | number)[] = [];
  const seen = new Set<string>();
  for (const id of idOrder) {
    const k = String(id);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueIdOrder.push(id);
  }

  const full: Record<string, unknown>[] = [];
  for (let i = 0; i < uniqueIdOrder.length; i += PLAN_B_IN_CHUNK) {
    const chunk = uniqueIdOrder.slice(i, i + PLAN_B_IN_CHUNK);
    let part: unknown;
    let e2: { message?: string } | null = null;
    const selectFallbacks = [PLAN_B_INDEX_SELECT] as readonly string[];
    for (const sel of selectFallbacks) {
      const r = await client
        .from("plan_b")
        .select(sel)
        .eq("patch_version", patchVersion)
        .in("match_id", chunk);
      if (!r.error) {
        part = r.data;
        e2 = null;
        break;
      }
      e2 = r.error;
      const msg = r.error.message || "";
      if (!/column|42703|does not exist|schema cache/i.test(msg)) break;
    }

    if (e2) {
      return { rows: [], error: e2.message ?? "plan_b in-chunk select failed" };
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
    rows: orderFullRowsByIdList(full, uniqueIdOrder),
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
  const { currentPatch } = await ensureSitePatchLoaded();

  const two = await fetchPlanBReplayIndexRowsTwoPhase(client);
  if (!two.error) {
    return two;
  }

  if (!looksLikeStatementTimeout(two.error)) {
    return two;
  }

  console.warn("[plan_b] 两阶段拉取超时/失败，回退单条 SQL:", two.error);

  const patchVersion = planBPatchVersionForFilter(currentPatch);

  let lastError: string | null = two.error;
  for (let i = 0; i < PLAN_B_SINGLE_QUERY_LIMITS.length; i++) {
    const lim = PLAN_B_SINGLE_QUERY_LIMITS[i];
    let { data, error } = await client
      .from("plan_b")
      .select(PLAN_B_INDEX_SELECT)
      .eq("patch_version", patchVersion)
      .order("created_at", { ascending: false })
      .limit(lim);

    if (error) {
      const msg = error.message || "";
      if (/column|42703|does not exist|schema cache/i.test(msg)) {
        const split = await fetchPlanBReplayIndexPageSplit(client, 1, lim);
        if (!split.error) {
          return { rows: split.rows, error: null };
        }
        lastError = split.error;
        console.warn(
          `[plan_b] 列兼容 split 兜底失败 (limit=${lim}):`,
          split.error
        );
        const retry =
          i + 1 < PLAN_B_SINGLE_QUERY_LIMITS.length &&
          looksLikeStatementTimeout(split.error);
        if (!retry) {
          return { rows: [], error: lastError };
        }
        continue;
      }
    }

    if (!error) {
      return {
        rows: Array.isArray(data)
          ? (data as unknown as Record<string, unknown>[])
          : [],
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

/**
 * 列表分页（兜底）：count + 轻列 range + 当前页 players overlay。
 */
async function fetchPlanBReplayIndexPageSplit(
  client: NonNullable<typeof supabase>,
  safePage: number,
  safePageSize: number
): Promise<{
  rows: Record<string, unknown>[];
  totalRows: number;
  error: string | null;
}> {
  const { currentPatch } = await ensureSitePatchLoaded();
  const patchVersion = planBPatchVersionForFilter(currentPatch);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  /** `exact` 全表 COUNT 在大表上极易超时；分页总数用统计估算即可 */
  const countReq = await client
    .from("plan_b")
    .select("match_id", { count: "estimated", head: true })
    .eq("patch_version", patchVersion);
  if (countReq.error) {
    return { rows: [], totalRows: 0, error: countReq.error.message };
  }
  const totalRows = Math.max(0, Number(countReq.count || 0));

  const pageReq = await client
    .from("plan_b")
    .select(PLAN_B_INDEX_LIGHT_SELECT)
    .eq("patch_version", patchVersion)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (pageReq.error) {
    return { rows: [], totalRows, error: pageReq.error.message };
  }
  const lightRows = (Array.isArray(pageReq.data) ? pageReq.data : []) as Record<
    string,
    unknown
  >[];
  const rows = await overlayPlanBListRowsWithPlayers(client, lightRows);
  return { rows, totalRows, error: null };
}

/**
 * plan_b 列表分页：单次 `select(轻量列) + count + range`，失败或超时时回退 split。
 * 列表严禁 select `*` 或 `players`（jsonb 过大易 OOM / statement timeout）。
 */
export async function fetchPlanBReplayIndexPage(
  page: number,
  pageSize: number
): Promise<{
  rows: Record<string, unknown>[];
  totalRows: number;
  error: string | null;
}> {
  const client = supabase;
  if (!client) return { rows: [], totalRows: 0, error: null };
  const { currentPatch } = await ensureSitePatchLoaded();
  const patchVersion = planBPatchVersionForFilter(currentPatch);
  console.log("用于过滤的版本号:", patchVersion);
  const safePage = Math.max(1, Math.floor(page || 1));
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize || 10)));
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  /** `exact` count 与 range 同请求时会多做昂贵 COUNT(*)；列表总条数用 estimated 即可 */
  const runSelect = async (sel: string) =>
    client
      .from("plan_b")
      .select(sel, { count: "estimated" })
      .eq("patch_version", patchVersion)
      .order("created_at", { ascending: false })
      .range(from, to);

  let { data, error, count } = await runSelect(PLAN_B_INDEX_SELECT);
  if (error) {
    const msg = error.message || "";
    if (/column|42703|does not exist|schema cache/i.test(msg)) {
      return fetchPlanBReplayIndexPageSplit(client, safePage, safePageSize);
    }
  }

  if (
    error &&
    (looksLikeStatementTimeout(error.message || "") ||
      /timeout|57014|canceling/i.test(error.message || ""))
  ) {
    return fetchPlanBReplayIndexPageSplit(client, safePage, safePageSize);
  }

  if (error) {
    return { rows: [], totalRows: 0, error: error.message };
  }

  const lightRows = Array.isArray(data)
    ? (data as unknown as Record<string, unknown>[])
    : [];
  const rows = await overlayPlanBListRowsWithPlayers(client, lightRows);
  const totalRows = Math.max(0, Number(count ?? 0));
  return { rows, totalRows, error: null };
}

/** 英雄/选手页：合并结果上限（单次扫描过大仍可能触发超时） */
export const PLAN_B_PROFILE_QUERY_LIMIT = 2500;

const PLAN_B_INDEX_SELECT_NO_LEAGUE =
  "match_id, created_at, patch_version, duration, radiant_win, radiant_score, dire_score, players";

/** 英雄/选手页：需 `players` 做 contains / 阵容展示 */
const PLAN_B_PROFILE_WIDE_SELECT = PLAN_B_DETAIL_SELECT;

function isPlanBProfileSchemaError(message: string): boolean {
  return /column|42703|does not exist|schema cache/i.test(message);
}

type PlanBJsonColumn = "players";

async function planBContainsRows(
  client: NonNullable<typeof supabase>,
  column: PlanBJsonColumn,
  /** PostgREST `.contains`：players 为 jsonb 数组探测 */
  operand: unknown,
  patchScope: PlanBPatchScope,
  currentPatch: string,
  historyPatches: readonly string[]
): Promise<Record<string, unknown>[]> {
  const selectors = [
    PLAN_B_INDEX_SELECT_NO_LEAGUE,
    PLAN_B_DETAIL_SELECT,
    PLAN_B_PROFILE_WIDE_SELECT,
  ] as const;

  for (const sel of selectors) {
    const scoped =
      patchScope === "latest"
        ? client.from("plan_b").select(sel).eq("patch_version", planBPatchVersionForFilter(currentPatch))
        : client
            .from("plan_b")
            .select(sel)
            .in("patch_version", [...historyPatches]);
    const { data, error } = await scoped
      .contains(column, operand as never)
      .order("created_at", { ascending: false })
      .limit(PLAN_B_PROFILE_QUERY_LIMIT);

    if (!error) {
      return Array.isArray(data)
        ? (data as unknown as Record<string, unknown>[])
        : [];
    }
    if (!isPlanBProfileSchemaError(error.message || "")) {
      console.warn(
        `[plan_b] profile contains ${column}:`,
        error.message?.slice(0, 180)
      );
      return [];
    }
  }
  return [];
}

async function fetchPlanBWideReplayIndexPage(
  page: number,
  pageSize: number,
  patchScope: PlanBPatchScope,
  currentPatch: string,
  historyPatches: readonly string[]
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const client = supabase;
  if (!client) return { rows: [], error: null };
  const safePage = Math.max(1, Math.floor(page || 1));
  const safeSize = Math.max(1, Math.min(80, Math.floor(pageSize || 40)));
  const from = (safePage - 1) * safeSize;
  const to = from + safeSize - 1;

  const selectors = [
    PLAN_B_INDEX_SELECT_NO_LEAGUE,
    PLAN_B_DETAIL_SELECT,
    PLAN_B_PROFILE_WIDE_SELECT,
  ] as const;

  for (const sel of selectors) {
    const base = client.from("plan_b").select(sel);
    const scoped =
      patchScope === "latest"
        ? base.eq("patch_version", planBPatchVersionForFilter(currentPatch))
        : base.in("patch_version", [...historyPatches]);
    const { data, error } = await scoped
      .order("created_at", { ascending: false })
      .range(from, to);

    if (!error) {
      return {
        rows: Array.isArray(data)
          ? (data as unknown as Record<string, unknown>[])
          : [],
        error: null,
      };
    }
    if (!isPlanBProfileSchemaError(error.message || "")) {
      return { rows: [], error: error.message };
    }
  }
  return { rows: [], error: null };
}

function mergeProfileRowsByMatchId(
  rows: Record<string, unknown>[],
  byMid: Map<number, Record<string, unknown>>
): void {
  for (const r of rows) {
    const mid = Number(r.match_id);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    if (!byMid.has(mid)) byMid.set(mid, r);
  }
}

/**
 * 英雄页云库：阵容在顶层 `players`（plan_b 为 slim 平铺）。
 * 先 `.contains(players)`，再无结果时用宽列分页 + 客户端 {@link planBRowIncludesHeroNpc} 兜底。
 */
export async function fetchPlanBReplayIndexRowsForHero(
  heroNpcId: number
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const client = supabase;
  if (!client) return { rows: [], error: null };
  if (!Number.isFinite(heroNpcId) || heroNpcId <= 0) {
    return { rows: [], error: null };
  }

  const { currentPatch, playerHistoryPatchVersions } =
    await ensureSitePatchLoaded();

  const byMid = new Map<number, Record<string, unknown>>();
  let wideFallbackError: string | null = null;

  const absorbVerified = (
    batch: Record<string, unknown>[],
    verify: (row: Record<string, unknown>) => boolean
  ) => {
    for (const r of batch) {
      if (!verify(r)) continue;
      const mid = Number(r.match_id);
      if (!Number.isFinite(mid) || mid <= 0) continue;
      if (!byMid.has(mid)) byMid.set(mid, r);
    }
  };

  const probeBatches = await Promise.all([
    planBContainsRows(
      client,
      "players",
      [{ hero_id: heroNpcId }],
      "latest",
      currentPatch,
      playerHistoryPatchVersions
    ),
    planBContainsRows(
      client,
      "players",
      [{ hero_id: String(heroNpcId) }],
      "latest",
      currentPatch,
      playerHistoryPatchVersions
    ),
  ]);
  for (const batch of probeBatches) {
    absorbVerified(batch, () => true);
  }

  // C) 校验 contains 命中（避免 JSON 形态差异）；并剔除伪命中
  const verified = new Map<number, Record<string, unknown>>();
  for (const [mid, r] of byMid) {
    if (planBRowIncludesHeroNpc(r, heroNpcId)) verified.set(mid, r);
  }
  byMid.clear();
  for (const [mid, r] of verified) byMid.set(mid, r);

  // D) 仍为空或不完整时：按时间分页扫宽列，用 extractPlanBPlayersArray 识别英雄
  const runWideFallback = byMid.size === 0;
  const PROFILE_FALLBACK_PAGE_SIZE = 45;
  /** contains 全空时按时间扫表：页数过多会刷爆 plan_b；仅保留少量页作兜底 */
  const PROFILE_FALLBACK_MAX_PAGES = runWideFallback ? 4 : 0;

  for (let page = 1; page <= PROFILE_FALLBACK_MAX_PAGES; page++) {
    const pack = await fetchPlanBWideReplayIndexPage(
      page,
      PROFILE_FALLBACK_PAGE_SIZE,
      "latest",
      currentPatch,
      playerHistoryPatchVersions
    );
    if (pack.error) {
      wideFallbackError = pack.error;
      break;
    }
    for (const r of pack.rows) {
      if (!planBRowIncludesHeroNpc(r, heroNpcId)) continue;
      const mid = Number(r.match_id);
      if (!Number.isFinite(mid) || mid <= 0) continue;
      if (!byMid.has(mid)) byMid.set(mid, r);
    }
    if (byMid.size >= PLAN_B_PROFILE_QUERY_LIMIT) break;
    if (pack.rows.length < PROFILE_FALLBACK_PAGE_SIZE) break;
  }

  const rows = [...byMid.values()].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
  return {
    rows: rows.slice(0, PLAN_B_PROFILE_QUERY_LIMIT),
    error:
      rows.length === 0 && wideFallbackError ? wideFallbackError : null,
  };
}

/** 选手页云库：account_id 在顶层 players（plan_b 为 slim 平铺）。 */
export async function fetchPlanBReplayIndexRowsForAccount(
  accountId: number
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const client = supabase;
  if (!client) return { rows: [], error: null };
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return { rows: [], error: null };
  }

  const { currentPatch, playerHistoryPatchVersions } =
    await ensureSitePatchLoaded();

  const byMid = new Map<number, Record<string, unknown>>();
  let wideFallbackError: string | null = null;

  const probeBatches = await Promise.all([
    planBContainsRows(
      client,
      "players",
      [{ account_id: accountId }],
      "player",
      currentPatch,
      playerHistoryPatchVersions
    ),
    planBContainsRows(
      client,
      "players",
      [{ account_id: String(accountId) }],
      "player",
      currentPatch,
      playerHistoryPatchVersions
    ),
  ]);
  for (const batch of probeBatches) {
    mergeProfileRowsByMatchId(batch, byMid);
  }

  const verified = new Map<number, Record<string, unknown>>();
  for (const [mid, r] of byMid) {
    if (planBRowIncludesAccountId(r, accountId)) verified.set(mid, r);
  }
  byMid.clear();
  for (const [mid, r] of verified) byMid.set(mid, r);

  const runWideFallback = byMid.size === 0;
  const PROFILE_FALLBACK_PAGE_SIZE = 45;
  const PROFILE_FALLBACK_MAX_PAGES = runWideFallback ? 4 : 0;

  for (let page = 1; page <= PROFILE_FALLBACK_MAX_PAGES; page++) {
    const pack = await fetchPlanBWideReplayIndexPage(
      page,
      PROFILE_FALLBACK_PAGE_SIZE,
      "player",
      currentPatch,
      playerHistoryPatchVersions
    );
    if (pack.error) {
      wideFallbackError = pack.error;
      break;
    }
    for (const r of pack.rows) {
      if (!planBRowIncludesAccountId(r, accountId)) continue;
      const mid = Number(r.match_id);
      if (!Number.isFinite(mid) || mid <= 0) continue;
      if (!byMid.has(mid)) byMid.set(mid, r);
    }
    if (byMid.size >= PLAN_B_PROFILE_QUERY_LIMIT) break;
    if (pack.rows.length < PROFILE_FALLBACK_PAGE_SIZE) break;
  }

  const rows = [...byMid.values()].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
  return {
    rows: rows.slice(0, PLAN_B_PROFILE_QUERY_LIMIT),
    error:
      rows.length === 0 && wideFallbackError ? wideFallbackError : null,
  };
}

/** 平均时长：按 match_id 分批拉取 duration */
const PLAN_B_DURATION_BATCH = 500;

function parsePlanBDurationSec(raw: unknown): number | null {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * 当前补丁（site_settings.current_patch）全库聚合：
 * 胜场用 PostgREST exact count（`.eq('patch_version', currentPatch)`）；
 * 平均时长为同补丁有效 duration 的算术平均。
 */
export async function fetchPlanBAggregateMatchStats(): Promise<{
  /** 有明确胜负（radiant_win 非空）的场数 */
  decidedMatches: number;
  radiantWins: number;
  direWins: number;
  /** 含有效 duration 的场数 */
  durationSamples: number;
  avgDurationSec: number;
  error: string | null;
}> {
  const client = supabase;
  if (!client) {
    return {
      decidedMatches: 0,
      radiantWins: 0,
      direWins: 0,
      durationSamples: 0,
      avgDurationSec: 0,
      error: "未配置 Supabase",
    };
  }

  const { currentPatch } = await ensureSitePatchLoaded();

  const patchVersion = planBPatchVersionForFilter(currentPatch);

  const [rwRes, dwRes] = await Promise.all([
    client
      .from("plan_b")
      .select("match_id", { count: "exact", head: true })
      .eq("patch_version", patchVersion)
      .eq("radiant_win", true),
    client
      .from("plan_b")
      .select("match_id", { count: "exact", head: true })
      .eq("patch_version", patchVersion)
      .eq("radiant_win", false),
  ]);

  const countErr = rwRes.error?.message || dwRes.error?.message;
  if (countErr) {
    return {
      decidedMatches: 0,
      radiantWins: 0,
      direWins: 0,
      durationSamples: 0,
      avgDurationSec: 0,
      error: countErr,
    };
  }

  const radiantWins = rwRes.count ?? 0;
  const direWins = dwRes.count ?? 0;
  const decidedMatches = radiantWins + direWins;

  let durationSum = 0;
  let durationSamples = 0;

  for (let from = 0; ; from += PLAN_B_DURATION_BATCH) {
    const to = from + PLAN_B_DURATION_BATCH - 1;
    const { data, error } = await client
      .from("plan_b")
      .select("duration")
      .eq("patch_version", patchVersion)
      .order("match_id", { ascending: true })
      .range(from, to);

    if (error) {
      return {
        decidedMatches,
        radiantWins,
        direWins,
        durationSamples: 0,
        avgDurationSec: 0,
        error: error.message,
      };
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const dur = parsePlanBDurationSec(r.duration ?? r.duration_sec);
      if (dur !== null) {
        durationSum += dur;
        durationSamples += 1;
      }
    }

    if (rows.length < PLAN_B_DURATION_BATCH) break;
  }

  const avgDurationSec =
    durationSamples > 0 ? durationSum / durationSamples : 0;

  return {
    decidedMatches,
    radiantWins,
    direWins,
    durationSamples,
    avgDurationSec,
    error: null,
  };
}
