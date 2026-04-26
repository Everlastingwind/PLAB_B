import type { EntityMapsPayload } from "../types/entityMaps";
import type {
  ReplayPlayerSummary,
  ReplaySummary,
  ReplaysIndexPayload,
} from "../types/replaysIndex";
import { fetchDeployedDataJson } from "./fetchStaticJson";
import { fetchPlanBReplayIndexRows } from "./supabasePlanB";

const PAGE_SIZE = 20;

export async function fetchReplaysIndex(): Promise<ReplaysIndexPayload> {
  const raw = await fetchDeployedDataJson<ReplaysIndexPayload>(
    "/data/replays_index.json"
  );
  return {
    ...raw,
    replays: (raw.replays || []).map((r) => ({ ...r, source: "pub" })),
  };
}

/** 职业比赛索引：由 scripts/fetch_pro_replays_index.py 生成（OpenDota proMatches + 战队过滤） */
export async function fetchProReplaysIndex(): Promise<ReplaysIndexPayload> {
  const raw = await fetchDeployedDataJson<ReplaysIndexPayload>(
    "/data/pro_replays_index.json"
  );
  return {
    ...raw,
    replays: (raw.replays || []).map((r) => ({ ...r, source: "pro" })),
  };
}

/** 合并 PUB + PRO 索引：同 match_id 保留 uploaded_at 较新的一条 */
export function mergePubProReplays(
  pubRows: ReplaySummary[],
  proRows: ReplaySummary[]
): ReplaySummary[] {
  const byId = new Map<number, ReplaySummary>();
  const upsert = (r: ReplaySummary, defaultSource: "pub" | "pro") => {
    const row = { ...r, source: r.source ?? defaultSource };
    const ex = byId.get(row.match_id);
    if (!ex) {
      byId.set(row.match_id, row);
      return;
    }
    const t1 = new Date(ex.uploaded_at).getTime();
    const t2 = new Date(row.uploaded_at).getTime();
    if (t2 >= t1) byId.set(row.match_id, row);
  };
  for (const r of pubRows) upsert(r, "pub");
  for (const r of proRows) upsert(r, "pro");
  return Array.from(byId.values()).sort(
    (a, b) =>
      new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
  );
}

/** 同 match_id 合并：保留 uploaded_at 较新的一条（用于静态 pub 与 Supabase plan_b） */
export function mergeReplaySummariesByMatchId(
  primary: ReplaySummary[],
  secondary: ReplaySummary[]
): ReplaySummary[] {
  const byId = new Map<number, ReplaySummary>();
  const upsert = (r: ReplaySummary) => {
    const ex = byId.get(r.match_id);
    if (!ex) {
      byId.set(r.match_id, r);
      return;
    }
    const t1 = new Date(ex.uploaded_at).getTime();
    const t2 = new Date(r.uploaded_at).getTime();
    if (t2 >= t1) byId.set(r.match_id, r);
  };
  for (const r of primary) upsert(r);
  for (const r of secondary) upsert(r);
  return Array.from(byId.values()).sort(
    (a, b) =>
      new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
  );
}

function planBRowToReplaySummary(row: Record<string, unknown>): ReplaySummary | null {
  const matchId = Number(row.match_id);
  if (!Number.isFinite(matchId) || matchId <= 0) return null;
  const createdRaw = row.created_at;
  let uploadedAt =
    typeof createdRaw === "string" && createdRaw.trim()
      ? createdRaw.trim()
      : new Date().toISOString();
  if (!uploadedAt.includes("T")) {
    const d = new Date(uploadedAt);
    uploadedAt = Number.isFinite(d.getTime())
      ? d.toISOString()
      : new Date().toISOString();
  }
  const durationSec = Math.max(
    0,
    Math.floor(Number(row.duration ?? row.duration_sec ?? 0) || 0)
  );
  const radiantWin = Boolean(row.radiant_win);
  const leagueName =
    String(row.league_name ?? "本地录像").trim() || "本地录像";
  const rsRaw = row.radiant_score;
  const dsRaw = row.dire_score;
  const rs =
    rsRaw !== undefined && rsRaw !== null
      ? Math.floor(Number(rsRaw) || 0)
      : undefined;
  const ds =
    dsRaw !== undefined && dsRaw !== null
      ? Math.floor(Number(dsRaw) || 0)
      : undefined;
  const playersRaw = row.players;
  if (!Array.isArray(playersRaw)) return null;
  const players: ReplayPlayerSummary[] = [];
  for (const p of playersRaw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const slot = Math.floor(Number(o.player_slot ?? 0) || 0);
    const accountId = Math.floor(Number(o.account_id ?? 0) || 0);
    const heroId = Math.floor(Number(o.hero_id ?? 0) || 0);
    const kills = Math.floor(Number(o.kills ?? o.k ?? 0) || 0);
    const deaths = Math.floor(Number(o.deaths ?? o.d ?? 0) || 0);
    const assists = Math.floor(Number(o.assists ?? o.a ?? 0) || 0);
    const proRaw = o.pro_name;
    const proName =
      proRaw != null && String(proRaw).trim()
        ? String(proRaw).trim()
        : null;
    const pnRaw = o.personaname ?? o.name;
    const personaname =
      pnRaw != null && String(pnRaw).trim() ? String(pnRaw).trim() : null;
    const roleRaw = o.role_early;
    const roleEarly =
      roleRaw != null && String(roleRaw).trim()
        ? String(roleRaw).trim()
        : null;
    players.push({
      player_slot: slot,
      account_id: accountId,
      hero_id: heroId,
      pro_name: proName,
      personaname,
      role_early: roleEarly || undefined,
      is_radiant: slot < 128,
      kills,
      deaths,
      assists,
    });
  }
  if (players.length === 0) return null;
  return {
    match_id: matchId,
    uploaded_at: uploadedAt,
    source: "pub",
    match_tier: "pub",
    duration_sec: durationSec,
    radiant_win: radiantWin,
    league_name: leagueName,
    radiant_score: rs !== undefined && Number.isFinite(rs) ? rs : undefined,
    dire_score: ds !== undefined && Number.isFinite(ds) ? ds : undefined,
    players,
  };
}

/** Supabase plan_b → 与 replays_index 同形的摘要行（标记为 pub） */
export async function fetchCloudPubReplaySummaries(): Promise<{
  replays: ReplaySummary[];
  error: string | null;
}> {
  const { rows, error } = await fetchPlanBReplayIndexRows();
  const out: ReplaySummary[] = [];
  for (const row of rows) {
    const r = planBRowToReplaySummary(row);
    if (r) out.push(r);
  }
  return { replays: out, error };
}

/** 搜索栏：静态索引 + 职业索引 + Supabase 云录像（去重） */
export async function fetchAllReplaySummariesForSearch(): Promise<
  ReplaySummary[]
> {
  const [pubIdx, proIdx, cloudPack] = await Promise.all([
    fetchReplaysIndex().catch(() => ({ replays: [] as ReplaySummary[] })),
    fetchProReplaysIndex().catch(() => ({ replays: [] as ReplaySummary[] })),
    fetchCloudPubReplaySummaries(),
  ]);
  const cloud = cloudPack.replays;
  if (cloudPack.error) {
    console.warn("[plan_b] 搜索合并：云索引未拉取", cloudPack.error);
  }
  const mergedPub = mergeReplaySummariesByMatchId(pubIdx.replays, cloud);
  return mergePubProReplays(mergedPub, proIdx.replays);
}

/** 录像索引来源（首页 / 英雄页 / 选手页共用）：PUB / PRO 可多选 */
export type FeedSelection = { pub: boolean; pro: boolean };

/** 拉取录像列表；云索引失败时仍可能返回静态 PUB，{@link cloudIndexError} 说明原因 */
export type FeedReplayIndexResult = {
  replays: ReplaySummary[];
  cloudIndexError: string | null;
};

const CLOUD_INDEX_FAIL_HINT =
  "仅显示已部署的静态列表，与桌面不一致时请检查：① Supabase 控制台是否允许当前站点域名（须同时包含 dota2planb.com 与 www.dota2planb.com）；② 手机是否使用 https://www.dota2planb.com 打开。";

export async function fetchReplaysForFeedSelection(
  sel: FeedSelection
): Promise<FeedReplayIndexResult> {
  let cloud: ReplaySummary[] = [];
  let cloudIndexError: string | null = null;
  if (sel.pub) {
    const pack = await fetchCloudPubReplaySummaries();
    cloud = pack.replays;
    if (pack.error) {
      cloudIndexError = `云索引（Supabase）不可用：${pack.error}。${CLOUD_INDEX_FAIL_HINT}`;
    }
  }
  if (sel.pub && sel.pro) {
    const [pubIdx, proIdx] = await Promise.all([
      fetchReplaysIndex(),
      fetchProReplaysIndex(),
    ]);
    const mergedPub = mergeReplaySummariesByMatchId(pubIdx.replays, cloud);
    return {
      replays: mergePubProReplays(mergedPub, proIdx.replays),
      cloudIndexError,
    };
  }
  if (sel.pub) {
    const idx = await fetchReplaysIndex();
    return {
      replays: mergeReplaySummariesByMatchId(idx.replays, cloud),
      cloudIndexError,
    };
  }
  const idx = await fetchProReplaysIndex();
  return { replays: idx.replays, cloudIndexError: null };
}

export function slicePage(replays: ReplaySummary[], page: number): ReplaySummary[] {
  const end = page * PAGE_SIZE;
  return replays.slice(0, end);
}

export function hasMore(total: number, page: number): boolean {
  return page * PAGE_SIZE < total;
}

export { PAGE_SIZE };

export function filterByHeroKey(
  replays: ReplaySummary[],
  heroKey: string,
  maps: EntityMapsPayload
): ReplaySummary[] {
  const k = heroKey.toLowerCase();
  return replays.filter((r) =>
    (r.players ?? []).some((p) => {
      const e = maps.heroes[String(p.hero_id)];
      return e?.key?.toLowerCase() === k;
    })
  );
}

export function filterByAccountId(
  replays: ReplaySummary[],
  accountId: number
): ReplaySummary[] {
  return replays.filter((r) =>
    (r.players ?? []).some((p) => p.account_id === accountId)
  );
}

export function heroKeyFromId(
  heroId: number,
  maps: EntityMapsPayload
): string {
  return maps.heroes[String(heroId)]?.key ?? "unknown";
}
