import { supabase } from "./supabaseClient.js";

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

const PLAN_B_INDEX_LIMIT = 2500;

/** 首页 / 英雄 / 选手索引用：轻量列 + 按入库时间倒序 */
export async function fetchPlanBReplayIndexRows(): Promise<{
  rows: Record<string, unknown>[];
  error: string | null;
}> {
  const client = supabase;
  if (!client) return { rows: [], error: null };
  const { data, error } = await client
    .from("plan_b")
    .select(
      "match_id, created_at, duration, radiant_win, radiant_score, dire_score, league_name, players"
    )
    .order("created_at", { ascending: false })
    .limit(PLAN_B_INDEX_LIMIT);
  if (error) {
    console.warn("[plan_b] 索引拉取失败:", error.message);
    return { rows: [], error: error.message };
  }
  return {
    rows: Array.isArray(data) ? (data as Record<string, unknown>[]) : [],
    error: null,
  };
}
