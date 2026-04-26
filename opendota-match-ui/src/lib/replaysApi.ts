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

/** 多处在同一时刻拉云索引时共用一次 in-flight，减轻海外链路重复请求 */
let cloudPubReplayInflight: Promise<{
  replays: ReplaySummary[];
  error: string | null;
}> | null = null;

/** Supabase plan_b → 与 replays_index 同形的摘要行（标记为 pub） */
export async function fetchCloudPubReplaySummaries(): Promise<{
  replays: ReplaySummary[];
  error: string | null;
}> {
  if (cloudPubReplayInflight) return cloudPubReplayInflight;
  const p = (async () => {
    const { rows, error } = await fetchPlanBReplayIndexRows();
    const out: ReplaySummary[] = [];
    for (const row of rows) {
      const r = planBRowToReplaySummary(row);
      if (r) out.push(r);
    }
    return { replays: out, error };
  })();
  cloudPubReplayInflight = p;
  void p.finally(() => {
    if (cloudPubReplayInflight === p) cloudPubReplayInflight = null;
  });
  return p;
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

function cloudPackToIndexError(pack: {
  replays: ReplaySummary[];
  error: string | null;
}): string | null {
  if (!pack.error) return null;
  const timeout = /statement timeout|57014|timeout/i.test(pack.error);
  return timeout
    ? `云索引（Supabase）不可用：${pack.error}。已对单次拉取条数自动降级；若仍出现请在数据库为 plan_b.created_at 建索引（见 src/lib/supabasePlanB.ts 顶部注释）。`
    : `云索引（Supabase）不可用：${pack.error}。${CLOUD_INDEX_FAIL_HINT}`;
}

/** 仅静态索引（与云合并前的快照） */
export type StaticFeedSnapshot =
  | { kind: "pro"; replays: ReplaySummary[] }
  | { kind: "pub"; replays: ReplaySummary[]; pubRows: ReplaySummary[] }
  | {
      kind: "pub+pro";
      replays: ReplaySummary[];
      pubRows: ReplaySummary[];
      proRows: ReplaySummary[];
    };

export async function fetchStaticFeedOnly(
  sel: FeedSelection
): Promise<StaticFeedSnapshot> {
  if (sel.pub && sel.pro) {
    const [pubIdx, proIdx] = await Promise.all([
      fetchReplaysIndex(),
      fetchProReplaysIndex(),
    ]);
    const pubRows = pubIdx.replays;
    const proRows = proIdx.replays;
    return {
      kind: "pub+pro",
      replays: mergePubProReplays(pubRows, proRows),
      pubRows,
      proRows,
    };
  }
  if (sel.pub) {
    const pubIdx = await fetchReplaysIndex();
    const pubRows = pubIdx.replays;
    return { kind: "pub", replays: pubRows, pubRows };
  }
  const proIdx = await fetchProReplaysIndex();
  return { kind: "pro", replays: proIdx.replays };
}

export function mergeCloudIntoStaticFeed(
  snap: StaticFeedSnapshot,
  cloudPack: { replays: ReplaySummary[]; error: string | null }
): FeedReplayIndexResult {
  if (snap.kind === "pro") {
    return { replays: snap.replays, cloudIndexError: null };
  }
  if (snap.kind === "pub") {
    return {
      replays: mergeReplaySummariesByMatchId(snap.pubRows, cloudPack.replays),
      cloudIndexError: cloudPackToIndexError(cloudPack),
    };
  }
  const mergedPub = mergeReplaySummariesByMatchId(
    snap.pubRows,
    cloudPack.replays
  );
  return {
    replays: mergePubProReplays(mergedPub, snap.proRows),
    cloudIndexError: cloudPackToIndexError(cloudPack),
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 与 {@link loadFeedReplaysProgressive} 搭配使用 */
export type LoadFeedProgressiveCallbacks = {
  /**
   * 云在 grace 内仍未返回时调用一次，用于静态保底（弱网）。
   * 若云在 grace 内已返回，则不会调用，避免「旧静态 → 再跳最新」的闪动。
   */
  onStalePreview?: (replays: ReplaySummary[]) => void;
  /** 合并完成（或仅静态）时必调 */
  onMerged: (result: FeedReplayIndexResult) => void;
};

/**
 * 静态与云并行；云若在 graceMs 内返回则只触发 {@link LoadFeedProgressiveCallbacks.onMerged} 一次，
 * 否则先 {@link LoadFeedProgressiveCallbacks.onStalePreview} 再 onMerged（弱网保底）。
 */
export async function loadFeedReplaysProgressive(
  sel: FeedSelection,
  callbacks: LoadFeedProgressiveCallbacks,
  options?: { graceMs?: number }
): Promise<void> {
  const graceMs = options?.graceMs ?? 520;
  const cloudP = sel.pub ? fetchCloudPubReplaySummaries() : null;
  const snap = await fetchStaticFeedOnly(sel);

  if (!sel.pub) {
    callbacks.onMerged({ replays: snap.replays, cloudIndexError: null });
    return;
  }

  const raced = await Promise.race([
    cloudP!.then((pack) => ({ kind: "cloud" as const, pack })),
    sleepMs(graceMs).then(() => ({ kind: "grace" as const })),
  ]);

  if (raced.kind === "cloud") {
    callbacks.onMerged(mergeCloudIntoStaticFeed(snap, raced.pack));
    return;
  }

  callbacks.onStalePreview?.(snap.replays);
  const pack = await cloudP!;
  callbacks.onMerged(mergeCloudIntoStaticFeed(snap, pack));
}

/** 单次拉全量（静态与云并行）；首屏请优先用 {@link loadFeedReplaysProgressive} */
export async function fetchReplaysForFeedSelection(
  sel: FeedSelection
): Promise<FeedReplayIndexResult> {
  if (!sel.pub) {
    const snap = await fetchStaticFeedOnly(sel);
    return { replays: snap.replays, cloudIndexError: null };
  }
  const [snap, cloudPack] = await Promise.all([
    fetchStaticFeedOnly(sel),
    fetchCloudPubReplaySummaries(),
  ]);
  return mergeCloudIntoStaticFeed(snap, cloudPack);
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
