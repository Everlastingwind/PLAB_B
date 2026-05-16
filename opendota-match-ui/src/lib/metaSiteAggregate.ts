import type { ReplaySummary } from "../types/replaysIndex";
import type { MetaGlobalItemAggRow } from "./metaGlobalItemStats";
import type { TopSectionSnapshotPayload } from "./homeTopSnapshot";
import { isRadiantFromPlayer } from "./matchGrouping";
import { slotToRoleEarlyFallbackMap } from "./metaRoleFallback";
import {
  normalizeReplaySource,
  patchVersionsEqualCaseInsensitive,
  replayMatchesLatestPatch,
} from "./replaysApi";
import { stitchHeroTrendCumulativeSeries } from "./heroTrendSeries";

export const META_ROLE_KEYS = [
  "carry",
  "mid",
  "offlane",
  "support(4)",
  "support(5)",
] as const;

export type MetaRoleTab = (typeof META_ROLE_KEYS)[number];

/** Meta 页 UI：分路 Top 出场下限 */
export const META_DISPLAY_MIN_ROLE_GAMES = 50;
/** Meta 页 UI：全英雄表 match_id 去重后场次下限（含上一版本封盘 orphan 行） */
export const META_DISPLAY_MIN_HERO_UNIQUE_MATCHES = 100;

export function normalizeMetaRole(
  raw: unknown
): "carry" | "mid" | "offlane" | "support(4)" | "support(5)" | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "carry") return "carry";
  if (s === "mid") return "mid";
  if (s === "offlane") return "offlane";
  if (
    s === "support4" ||
    s === "support 4" ||
    s === "support(4)" ||
    s === "pos4"
  )
    return "support(4)";
  if (
    s === "support5" ||
    s === "support 5" ||
    s === "support(5)" ||
    s === "pos5"
  )
    return "support(5)";
  return null;
}

function heroOverallMeetsDisplayThreshold(
  row: HeroOverallAggRow,
  minUniqueMatches: number
): boolean {
  const orphanOnly =
    row.games === 0 &&
    row.cumulativeSeriesIsBaseline?.length === 1 &&
    row.cumulativeSeriesIsBaseline[0] === true;
  if (orphanOnly) return true;
  const nLatest =
    row.cumulativeWinRateSeries.length -
    (row.cumulativeSeriesIsBaseline?.[0] === true ? 1 : 0);
  return (
    row.games >= minUniqueMatches || nLatest >= minUniqueMatches
  );
}

/** 分路 Top 5：快照可能按 min=1 预聚合，展示前再筛 ≥50 并重排 */
export function filterTopHeroByRoleForDisplay(
  rows: readonly TopHeroRoleRow[],
  minGames = META_DISPLAY_MIN_ROLE_GAMES
): TopHeroRoleRow[] {
  return [...rows]
    .filter((x) => x.games >= minGames)
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
    .slice(0, 5);
}

/** 全英雄表：快照写入 min=1，展示前筛去重场次 ≥100 */
export function filterHeroOverallForDisplay(
  rows: readonly HeroOverallAggRow[],
  minUniqueMatches = META_DISPLAY_MIN_HERO_UNIQUE_MATCHES
): HeroOverallAggRow[] {
  return rows.filter((x) =>
    heroOverallMeetsDisplayThreshold(x, minUniqueMatches)
  );
}

/**
 * 实时聚合优先；仅当实时为空时回退每日快照（并套用 UI 阈值）。
 * 避免「cloudAgg 有数、heroOverall/topHeroByRole 为空」的快照半成品盖住已加载的全站索引。
 */
export function pickMetaTopHeroByRole(
  live: readonly TopHeroRoleRow[],
  snapshotRows: readonly TopHeroRoleRow[] | undefined,
  minGames = META_DISPLAY_MIN_ROLE_GAMES
): TopHeroRoleRow[] {
  if (live.length > 0) return [...live];
  return filterTopHeroByRoleForDisplay(snapshotRows ?? [], minGames);
}

export function pickMetaHeroOverall(
  live: readonly HeroOverallAggRow[],
  snapshotRows: readonly HeroOverallAggRow[] | undefined,
  minUniqueMatches = META_DISPLAY_MIN_HERO_UNIQUE_MATCHES
): HeroOverallAggRow[] {
  if (live.length > 0) return [...live];
  return filterHeroOverallForDisplay(snapshotRows ?? [], minUniqueMatches);
}

export type TopHeroRoleRow = {
  heroId: number;
  games: number;
  winRate: number;
};

export type HeroOverallAggRow = {
  heroId: number;
  games: number;
  winRate: number;
  cumulativeWinRateSeries: number[];
  /** 与 cumulativeWinRateSeries 等长；首点可为上一版本末期基线（用于 Tooltip） */
  cumulativeSeriesIsBaseline?: boolean[];
  roleWinRate: Partial<
    Record<MetaRoleTab, { games: number; winRate: number }>
  >;
};

function matchesPatchKey(r: ReplaySummary, patch: string): boolean {
  return patchVersionsEqualCaseInsensitive(r.patch_version, patch);
}

/** 按补丁筛选后的各英雄各场胜负时间线（match_id 去重保留最新时间） */
function collectHeroMatchMaps(
  replays: readonly ReplaySummary[],
  patchPredicate: (r: ReplaySummary) => boolean
): Map<number, Map<number, { t: number; won: boolean }>> {
  const out = new Map<number, Map<number, { t: number; won: boolean }>>();
  for (const r of replays) {
    if (!patchPredicate(r)) continue;
    const t = Date.parse(String(r.uploaded_at ?? "")) || 0;
    const rw = Boolean(r.radiant_win);
    const mid = Number(r.match_id) || 0;
    for (const p of r.players || []) {
      const hid = Number(p.hero_id || 0);
      if (!Number.isFinite(hid) || hid <= 0) continue;
      let mm = out.get(hid);
      if (!mm) {
        mm = new Map();
        out.set(hid, mm);
      }
      const won =
        isRadiantFromPlayer(p as unknown as Record<string, unknown>) === rw;
      const prev = mm.get(mid);
      if (!prev || t >= prev.t) {
        mm.set(mid, { t, won });
      }
    }
  }
  return out;
}

function cumulativeWinRateSeriesFromMatchMap(
  mm: Map<number, { t: number; won: boolean }> | undefined
): number[] {
  if (!mm || mm.size === 0) return [];
  const events = Array.from(mm.entries())
    .map(([matchId, ev]) => ({
      matchId,
      t: ev.t,
      won: ev.won,
    }))
    .sort((a, b) => a.t - b.t || a.matchId - b.matchId);
  let winsRun = 0;
  const series: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].won) winsRun += 1;
    series.push((winsRun / (i + 1)) * 100);
  }
  return series;
}

/** 分路 Top：出场 ≥ minGames */
export function buildTopHeroByRole(
  analyticsReplays: readonly ReplaySummary[],
  roleTab: MetaRoleTab,
  minGames = 50,
  currentPatch: string
): TopHeroRoleRow[] {
  const agg = new Map<number, { games: number; wins: number }>();
  for (const r of analyticsReplays) {
    if (!replayMatchesLatestPatch(r, currentPatch)) continue;
    const slotRole = slotToRoleEarlyFallbackMap(r);
    for (const p of r.players || []) {
      const role =
        normalizeMetaRole(p.role_early) ?? slotRole.get(p.player_slot) ?? null;
      if (role !== roleTab) continue;
      const hid = Number(p.hero_id || 0);
      if (!Number.isFinite(hid) || hid <= 0) continue;
      const row = agg.get(hid) || { games: 0, wins: 0 };
      row.games += 1;
      const won =
        isRadiantFromPlayer(p as unknown as Record<string, unknown>) ===
        Boolean(r.radiant_win);
      if (won) row.wins += 1;
      agg.set(hid, row);
    }
  }
  return Array.from(agg.entries())
    .map(([heroId, s]) => ({
      heroId,
      games: s.games,
      winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
    }))
    .filter((x) => x.games >= minGames)
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
    .slice(0, 5);
}

/** 全英雄表：去重后 ≥ minUniqueMatches（快照脚本用 1；首页实时仍可传 100） */
export function buildTopHeroOverall(
  analyticsReplays: readonly ReplaySummary[],
  minUniqueMatches = 100,
  currentPatch: string,
  previousPatch: string
): HeroOverallAggRow[] {
  const headlineReplays = analyticsReplays.filter((r) =>
    replayMatchesLatestPatch(r, currentPatch)
  );
  const heroLatestMaps = collectHeroMatchMaps(analyticsReplays, (r) =>
    replayMatchesLatestPatch(r, currentPatch)
  );
  const heroPrevMaps = collectHeroMatchMaps(analyticsReplays, (r) =>
    matchesPatchKey(r, previousPatch)
  );

  const agg = new Map<
    number,
    {
      games: number;
      wins: number;
      role: Record<MetaRoleTab, { games: number; wins: number }>;
    }
  >();

  for (const r of headlineReplays) {
    const rw = Boolean(r.radiant_win);
    const slotRole = slotToRoleEarlyFallbackMap(r);
    for (const p of r.players || []) {
      const hid = Number(p.hero_id || 0);
      if (!Number.isFinite(hid) || hid <= 0) continue;
      const row = agg.get(hid) || {
        games: 0,
        wins: 0,
        role: {
          carry: { games: 0, wins: 0 },
          mid: { games: 0, wins: 0 },
          offlane: { games: 0, wins: 0 },
          "support(4)": { games: 0, wins: 0 },
          "support(5)": { games: 0, wins: 0 },
        },
      };
      row.games += 1;
      const won =
        isRadiantFromPlayer(p as unknown as Record<string, unknown>) === rw;
      if (won) row.wins += 1;
      const role =
        normalizeMetaRole(p.role_early) ?? slotRole.get(p.player_slot) ?? null;
      if (role) {
        row.role[role].games += 1;
        if (won) row.role[role].wins += 1;
      }
      agg.set(hid, row);
    }
  }

  const primaryRows: HeroOverallAggRow[] = Array.from(agg.entries()).map(
    ([heroId, s]) => {
      const roleWinRate = META_ROLE_KEYS.reduce(
        (acc, rk) => {
          const g = s.role[rk].games;
          if (g <= 0) return acc;
          acc[rk] = {
            games: g,
            winRate: (s.role[rk].wins / g) * 100,
          };
          return acc;
        },
        {} as Partial<Record<MetaRoleTab, { games: number; winRate: number }>>
      );

      const currSeries = cumulativeWinRateSeriesFromMatchMap(
        heroLatestMaps.get(heroId)
      );
      const prevSeries = cumulativeWinRateSeriesFromMatchMap(
        heroPrevMaps.get(heroId)
      );

      const stitched = stitchHeroTrendCumulativeSeries(currSeries, prevSeries);

      const cumulativeWinRateSeries = stitched.rates;
      const cumulativeSeriesIsBaseline = stitched.isBaseline.some((b) => b)
        ? stitched.isBaseline
        : undefined;

      const uniqueG = currSeries.length;
      const winRateFinal =
        uniqueG > 0
          ? currSeries[uniqueG - 1]
          : s.games > 0
            ? (s.wins / s.games) * 100
            : 0;

      const row: HeroOverallAggRow = {
        heroId,
        games: uniqueG > 0 ? uniqueG : s.games,
        winRate: winRateFinal,
        cumulativeWinRateSeries,
        roleWinRate,
      };
      if (cumulativeSeriesIsBaseline) {
        row.cumulativeSeriesIsBaseline = cumulativeSeriesIsBaseline;
      }
      return row;
    }
  );

  const seenHero = new Set(primaryRows.map((r) => r.heroId));
  const orphanRows: HeroOverallAggRow[] = [];
  for (const hid of heroPrevMaps.keys()) {
    if (seenHero.has(hid)) continue;
    const currSeries = cumulativeWinRateSeriesFromMatchMap(
      heroLatestMaps.get(hid)
    );
    if (currSeries.length > 0) continue;
    const prevSeries = cumulativeWinRateSeriesFromMatchMap(
      heroPrevMaps.get(hid)
    );
    if (prevSeries.length < minUniqueMatches) continue;
    const stitched = stitchHeroTrendCumulativeSeries([], prevSeries);
    if (stitched.rates.length !== 1 || !stitched.isBaseline[0]) continue;
    orphanRows.push({
      heroId: hid,
      games: 0,
      winRate: stitched.rates[0],
      cumulativeWinRateSeries: stitched.rates,
      cumulativeSeriesIsBaseline: stitched.isBaseline,
      roleWinRate: {},
    });
  }

  return [...primaryRows, ...orphanRows].filter((x) => {
    const orphanOnly =
      x.games === 0 &&
      x.cumulativeSeriesIsBaseline?.length === 1 &&
      x.cumulativeSeriesIsBaseline[0] === true;
    if (orphanOnly) return true;
    const nLatest =
      x.cumulativeWinRateSeries.length -
      (x.cumulativeSeriesIsBaseline?.[0] === true ? 1 : 0);
    return nLatest >= minUniqueMatches;
  });
}

export type MetaSiteSnapshotCloudAgg = {
  decidedMatches: number;
  radiantWins: number;
  direWins: number;
  durationSamples: number;
  avgDurationSec: number;
};

function cloudAggHasSamples(agg: MetaSiteSnapshotCloudAgg): boolean {
  return agg.decidedMatches > 0 || agg.durationSamples > 0;
}

/**
 * 从已合并的索引行估算全站对局（仅当前补丁、pub），match_id 去重。
 * 与 Supabase `fetchPlanBAggregateMatchStats` 口径一致，供无云或 API 失败时回退。
 */
export function buildCloudAggFromReplays(
  replays: readonly ReplaySummary[],
  currentPatch: string
): MetaSiteSnapshotCloudAgg {
  const seen = new Set<number>();
  let radiantWins = 0;
  let direWins = 0;
  let durationSum = 0;
  let durationSamples = 0;

  for (const r of replays) {
    if (normalizeReplaySource(r, "pub") !== "pub") continue;
    if (!replayMatchesLatestPatch(r, currentPatch)) continue;

    const mid = Number(r.match_id);
    if (!Number.isFinite(mid) || mid <= 0 || seen.has(mid)) continue;
    seen.add(mid);

    if (r.radiant_win === true) radiantWins += 1;
    else if (r.radiant_win === false) direWins += 1;

    const dur = Math.floor(Number(r.duration_sec ?? 0) || 0);
    if (dur > 0) {
      durationSum += dur;
      durationSamples += 1;
    }
  }

  return {
    decidedMatches: radiantWins + direWins,
    radiantWins,
    direWins,
    durationSamples,
    avgDurationSec: durationSamples > 0 ? durationSum / durationSamples : 0,
  };
}

/**
 * 全站对局卡片：优先云库按 patch 聚合，其次索引回退；不用未标注补丁的快照 cloudAgg。
 */
export function pickMetaCloudAgg(
  fromApi: MetaSiteSnapshotCloudAgg | null,
  apiError: string | null,
  fromReplays: MetaSiteSnapshotCloudAgg
): { agg: MetaSiteSnapshotCloudAgg | null; error: string | null } {
  if (fromApi && !apiError) {
    return { agg: fromApi, error: null };
  }
  if (cloudAggHasSamples(fromReplays)) {
    return { agg: fromReplays, error: apiError };
  }
  if (fromApi) {
    return { agg: fromApi, error: apiError };
  }
  return { agg: null, error: apiError };
}

export type MetaSiteSnapshotPayload = {
  /** 1：仅 Meta；2：含 Items / TOP 预聚合（每日脚本生成） */
  version: 1 | 2;
  generatedAt: string;
  cloudAgg: MetaSiteSnapshotCloudAgg;
  topHeroByRole: Record<MetaRoleTab, TopHeroRoleRow[]>;
  heroOverall: HeroOverallAggRow[];
  itemsMeta?: {
    rows: MetaGlobalItemAggRow[];
    matchesAnalyzed: number;
    totalHeroPlayerSlots: number;
    totalListed: number;
  };
  topSection?: TopSectionSnapshotPayload;
};

export function buildMetaSiteSnapshotPayload(
  analyticsReplays: readonly ReplaySummary[],
  cloudAgg: MetaSiteSnapshotCloudAgg,
  patchKeys: { currentPatch: string; previousPatch: string },
  extras?: {
    itemsMeta: NonNullable<MetaSiteSnapshotPayload["itemsMeta"]>;
    topSection: TopSectionSnapshotPayload;
  }
): MetaSiteSnapshotPayload {
  const { currentPatch, previousPatch } = patchKeys;
  /** 每日快照：允许极小样本也写入 heroOverall / 分路 Top，避免线上「有列表无汇总」 */
  const snapshotMinUniqueMatches = 1;
  const snapshotMinRoleGames = 1;
  const topHeroByRole = {} as Record<MetaRoleTab, TopHeroRoleRow[]>;
  for (const rk of META_ROLE_KEYS) {
    topHeroByRole[rk] = buildTopHeroByRole(
      analyticsReplays,
      rk,
      snapshotMinRoleGames,
      currentPatch
    );
  }
  return {
    version: extras ? 2 : 1,
    generatedAt: new Date().toISOString(),
    cloudAgg,
    topHeroByRole,
    heroOverall: buildTopHeroOverall(
      analyticsReplays,
      snapshotMinUniqueMatches,
      currentPatch,
      previousPatch
    ),
    ...(extras
      ? { itemsMeta: extras.itemsMeta, topSection: extras.topSection }
      : {}),
  };
}
