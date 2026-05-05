import type { EntityMapsPayload } from "../types/entityMaps";
import type {
  ReplayPlayerSummary,
  ReplaySummary,
  ReplaysIndexPayload,
} from "../types/replaysIndex";
import { fetchDeployedDataJson } from "./fetchStaticJson";
import { applyProDisplayOverridesToReplaySummaries } from "./proAccountDisplayOverrides";
import { fetchPlanBReplayIndexPage, unwrapPlanBRow } from "./supabasePlanB";

const PAGE_SIZE = 10;

/** 英雄页 / 选手页 / 首页对局列表：首屏与「加载更多」步长 */
export const MATCH_LIST_LOAD_STEP = 15;

function normalizeReplaySource(
  row: ReplaySummary,
  fallback: "pub" | "pro"
): "pub" | "pro" {
  const src = String(row.source ?? "").trim().toLowerCase();
  if (src === "pro" || src === "pub") return src;
  const tier = String(row.match_tier ?? "").trim().toLowerCase();
  if (tier === "pro" || tier === "pub") return tier;
  return fallback;
}

function isProReplaySummary(row: ReplaySummary): boolean {
  return normalizeReplaySource(row, "pub") === "pro";
}

export async function fetchReplaysIndex(): Promise<ReplaysIndexPayload> {
  const raw = await fetchDeployedDataJson<ReplaysIndexPayload>(
    "/data/replays_index.json"
  );
  return {
    ...raw,
    replays: (raw.replays || []).map((r) => ({
      ...r,
      source: normalizeReplaySource(r, "pub"),
    })),
  };
}

/** 职业比赛索引：由 scripts/fetch_pro_replays_index.py 生成（OpenDota proMatches + 战队过滤） */
export async function fetchProReplaysIndex(): Promise<ReplaysIndexPayload> {
  const raw = await fetchDeployedDataJson<ReplaysIndexPayload>(
    "/data/pro_replays_index.json"
  );
  return {
    ...raw,
    replays: (raw.replays || []).map((r) => ({
      ...r,
      source: normalizeReplaySource(r, "pro"),
    })),
  };
}

/** 合并 PUB + PRO 索引：同 match_id 保留 uploaded_at 较新的一条 */
export function mergePubProReplays(
  pubRows: ReplaySummary[],
  proRows: ReplaySummary[]
): ReplaySummary[] {
  const byId = new Map<number, ReplaySummary>();
  const upsert = (r: ReplaySummary, defaultSource: "pub" | "pro") => {
    const row = { ...r, source: normalizeReplaySource(r, defaultSource) };
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

type CloudPubReplayPack = {
  replays: ReplaySummary[];
  error: string | null;
};
type CloudPubReplayPagePack = {
  replays: ReplaySummary[];
  totalRows: number;
  error: string | null;
};

const CLOUD_PUB_PAGE_CACHE_TTL_MS = 60_000;
const cloudPubPageCache = new Map<
  string,
  { pack: CloudPubReplayPagePack; expiresAt: number }
>();

/**
 * 与云库合并时仅取 plan_b **第一页**（每行已含 `players` jsonb，无需再按场 N+1）。
 * 禁止再全表两阶段拉取，避免 100+ 次 Supabase 往返。
 */
export async function fetchCloudPubReplaySummaries(): Promise<CloudPubReplayPack> {
  const pack = await fetchCloudPubReplaySummariesPage(1, MATCH_LIST_LOAD_STEP);
  return { replays: [...pack.replays], error: pack.error };
}

export async function fetchCloudPubReplaySummariesPage(
  page: number,
  pageSize: number
): Promise<CloudPubReplayPagePack> {
  const safePage = Math.max(1, Math.floor(page || 1));
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize || 10)));
  const cacheKey = `${safePage}:${safePageSize}`;
  const now = Date.now();
  const hit = cloudPubPageCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return { ...hit.pack, replays: [...hit.pack.replays] };
  }

  const { rows, totalRows, error } = await fetchPlanBReplayIndexPage(
    safePage,
    safePageSize
  );
  const out: ReplaySummary[] = [];
  for (const row of rows) {
    const unwrapped = unwrapPlanBRow(row);
    const raw =
      unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
        ? (unwrapped as Record<string, unknown>)
        : row;
    const mergedRow: Record<string, unknown> = {
      ...row,
      ...raw,
      created_at: row.created_at ?? raw.created_at,
    };
    const r = planBRowToReplaySummary(mergedRow);
    if (r) out.push(r);
  }
  const pack: CloudPubReplayPagePack = { replays: out, totalRows, error };
  cloudPubPageCache.set(cacheKey, {
    pack,
    expiresAt: now + CLOUD_PUB_PAGE_CACHE_TTL_MS,
  });
  return { ...pack, replays: [...pack.replays] };
}

/** 搜索栏：静态索引 + 职业索引 + Supabase 云录像（去重） */
export async function fetchAllReplaySummariesForSearch(): Promise<
  ReplaySummary[]
> {
  const [pubRes, proRes, cloudRes] = await Promise.allSettled([
    fetchReplaysIndex(),
    fetchProReplaysIndex(),
    fetchCloudPubReplaySummariesPage(1, 50),
  ]);
  const pubIdx =
    pubRes.status === "fulfilled"
      ? pubRes.value
      : ({ replays: [] as ReplaySummary[] } as ReplaysIndexPayload);
  const proIdx =
    proRes.status === "fulfilled"
      ? proRes.value
      : ({ replays: [] as ReplaySummary[] } as ReplaysIndexPayload);
  const cloudPack =
    cloudRes.status === "fulfilled"
      ? cloudRes.value
      : ({
          replays: [] as ReplaySummary[],
          totalRows: 0,
          error: "cloud-fetch-failed",
        } as const);
  const cloud = cloudPack.replays;
  if (cloudPack.error || cloudRes.status === "rejected") {
    const msg =
      cloudPack.error ||
      (cloudRes.status === "rejected" ? String(cloudRes.reason || "") : "");
    console.warn("[plan_b] 搜索合并：云索引未拉取", msg);
  }
  const mergedPub = mergeReplaySummariesByMatchId(pubIdx.replays, cloud);
  const merged = mergePubProReplays(mergedPub, proIdx.replays);
  return applyProDisplayOverridesToReplaySummaries(merged);
}

/** 录像索引来源（首页 / 英雄页 / 选手页共用）：PUB / PRO 可多选 */
export type FeedSelection = { pub: boolean; pro: boolean };

/** 拉取录像列表；云索引失败时仍可能返回静态 PUB，{@link cloudIndexError} 说明原因 */
export type FeedReplayIndexResult = {
  replays: ReplaySummary[];
  cloudIndexError: string | null;
};
type FeedReplayIndexCacheEntry = {
  value: FeedReplayIndexResult;
  expiresAt: number;
};
const FEED_INDEX_CACHE_TTL_MS = 60_000;
const feedIndexResultCache = new Map<string, FeedReplayIndexCacheEntry>();
const feedIndexInflight = new Map<string, Promise<FeedReplayIndexResult>>();

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
  const [mainIdx, proIdx] = await Promise.all([
    fetchReplaysIndex(),
    fetchProReplaysIndex(),
  ]);
  const proFromMain = mainIdx.replays.filter(isProReplaySummary);
  const mergedPro = mergeReplaySummariesByMatchId(proFromMain, proIdx.replays);
  return { kind: "pro", replays: mergedPro };
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

/** 静态与云并行，一次返回合并后的列表（无「先静态预览再等云」的中间态） */
export async function fetchReplaysForFeedSelection(
  sel: FeedSelection
): Promise<FeedReplayIndexResult> {
  const cacheKey = `${sel.pub ? 1 : 0}${sel.pro ? 1 : 0}`;
  const now = Date.now();
  const cached = feedIndexResultCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      ...cached.value,
      replays: [...cached.value.replays],
    };
  }
  const hitInflight = feedIndexInflight.get(cacheKey);
  if (hitInflight) {
    const got = await hitInflight;
    return { ...got, replays: [...got.replays] };
  }

  const task = (async () => {
  let base: FeedReplayIndexResult;
  if (!sel.pub) {
    const snap = await fetchStaticFeedOnly(sel);
    base = { replays: snap.replays, cloudIndexError: null };
  } else {
    const [snap, cloudPack] = await Promise.all([
      fetchStaticFeedOnly(sel),
      fetchCloudPubReplaySummaries(),
    ]);
    base = mergeCloudIntoStaticFeed(snap, cloudPack);
  }
  const replays = await applyProDisplayOverridesToReplaySummaries(
    base.replays
  );
    const value: FeedReplayIndexResult = { ...base, replays };
    feedIndexResultCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + FEED_INDEX_CACHE_TTL_MS,
    });
    return value;
  })();
  feedIndexInflight.set(cacheKey, task);
  try {
    const got = await task;
    return { ...got, replays: [...got.replays] };
  } finally {
    if (feedIndexInflight.get(cacheKey) === task) {
      feedIndexInflight.delete(cacheKey);
    }
  }
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

/**
 * 在「已包含本页英雄」的录像集合上，按队友 / 对手英雄再筛一层。
 * - withHeroId：同队存在另一名使用该 hero_id 的玩家（不含自己所在槽位）。
 * - vsHeroId：敌队存在使用该 hero_id 的玩家。
 */
export function filterReplaysByTeammateOpponentHero(
  replays: ReplaySummary[],
  maps: EntityMapsPayload,
  pageHeroKey: string,
  opts: { withHeroId?: number | null; vsHeroId?: number | null }
): ReplaySummary[] {
  const withId =
    opts.withHeroId != null && opts.withHeroId > 0 ? opts.withHeroId : null;
  const vsId =
    opts.vsHeroId != null && opts.vsHeroId > 0 ? opts.vsHeroId : null;
  if (!withId && !vsId) return replays;

  const k = pageHeroKey.toLowerCase();

  return replays.filter((r) => {
    const players = r.players ?? [];
    const self = players.find((p) => {
      const e = maps.heroes[String(p.hero_id)];
      return e?.key?.toLowerCase() === k;
    });
    if (!self) return false;

    const selfRadiant = Boolean(self.is_radiant);
    const selfSlot = self.player_slot;

    if (withId) {
      const hasMate = players.some(
        (p) =>
          p.hero_id === withId &&
          Boolean(p.is_radiant) === selfRadiant &&
          p.player_slot !== selfSlot
      );
      if (!hasMate) return false;
    }

    if (vsId) {
      const hasOpp = players.some(
        (p) =>
          p.hero_id === vsId && Boolean(p.is_radiant) !== selfRadiant
      );
      if (!hasOpp) return false;
    }

    return true;
  });
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
