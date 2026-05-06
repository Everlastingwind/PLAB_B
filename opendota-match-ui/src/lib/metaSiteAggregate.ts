import type { ReplaySummary } from "../types/replaysIndex";
import type { MetaGlobalItemAggRow } from "./metaGlobalItemStats";
import type { TopSectionSnapshotPayload } from "./homeTopSnapshot";
import { isRadiantFromPlayer } from "./matchGrouping";
import { slotToRoleEarlyFallbackMap } from "./metaRoleFallback";

export const META_ROLE_KEYS = [
  "carry",
  "mid",
  "offlane",
  "support(4)",
  "support(5)",
] as const;

export type MetaRoleTab = (typeof META_ROLE_KEYS)[number];

export function normalizeMetaRole(
  raw: unknown
): "carry" | "mid" | "offlane" | "support(4)" | "support(5)" | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "carry") return "carry";
  if (s === "mid") return "mid";
  if (s === "offlane") return "offlane";
  if (s === "support4" || s === "support 4" || s === "support(4)")
    return "support(4)";
  if (s === "support5" || s === "support 5" || s === "support(5)")
    return "support(5)";
  return null;
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
  roleWinRate: Partial<
    Record<MetaRoleTab, { games: number; winRate: number }>
  >;
};

/** 分路 Top：出场 ≥ minGames */
export function buildTopHeroByRole(
  analyticsReplays: readonly ReplaySummary[],
  roleTab: MetaRoleTab,
  minGames = 50
): TopHeroRoleRow[] {
  const agg = new Map<number, { games: number; wins: number }>();
  for (const r of analyticsReplays) {
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

/** 全英雄表：去重后 ≥ minUniqueMatches */
export function buildTopHeroOverall(
  analyticsReplays: readonly ReplaySummary[],
  minUniqueMatches = 100
): HeroOverallAggRow[] {
  const agg = new Map<
    number,
    {
      games: number;
      wins: number;
      role: Record<MetaRoleTab, { games: number; wins: number }>;
    }
  >();
  const heroMatchBest = new Map<
    number,
    Map<number, { t: number; won: boolean }>
  >();

  for (const r of analyticsReplays) {
    const t = Date.parse(String(r.uploaded_at ?? "")) || 0;
    const rw = Boolean(r.radiant_win);
    const mid = Number(r.match_id) || 0;
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

      let mm = heroMatchBest.get(hid);
      if (!mm) {
        mm = new Map();
        heroMatchBest.set(hid, mm);
      }
      const prev = mm.get(mid);
      if (!prev || t >= prev.t) {
        mm.set(mid, { t, won });
      }
    }
  }

  return Array.from(agg.entries())
    .map(([heroId, s]) => {
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
      const mm = heroMatchBest.get(heroId);
      const cumulativeWinRateSeries: number[] = [];
      if (mm && mm.size > 0) {
        const events = Array.from(mm.entries())
          .map(([matchId, ev]) => ({
            matchId,
            t: ev.t,
            won: ev.won,
          }))
          .sort((a, b) => a.t - b.t || a.matchId - b.matchId);
        let winsRun = 0;
        for (let i = 0; i < events.length; i++) {
          if (events[i].won) winsRun += 1;
          cumulativeWinRateSeries.push((winsRun / (i + 1)) * 100);
        }
      }

      const uniqueG = cumulativeWinRateSeries.length;
      const winRateFinal =
        uniqueG > 0
          ? cumulativeWinRateSeries[uniqueG - 1]
          : s.games > 0
            ? (s.wins / s.games) * 100
            : 0;

      return {
        heroId,
        games: uniqueG > 0 ? uniqueG : s.games,
        winRate: winRateFinal,
        cumulativeWinRateSeries,
        roleWinRate,
      };
    })
    .filter((x) => x.cumulativeWinRateSeries.length >= minUniqueMatches);
}

export type MetaSiteSnapshotCloudAgg = {
  decidedMatches: number;
  radiantWins: number;
  direWins: number;
  durationSamples: number;
  avgDurationSec: number;
};

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
  extras?: {
    itemsMeta: NonNullable<MetaSiteSnapshotPayload["itemsMeta"]>;
    topSection: TopSectionSnapshotPayload;
  }
): MetaSiteSnapshotPayload {
  const topHeroByRole = {} as Record<MetaRoleTab, TopHeroRoleRow[]>;
  for (const rk of META_ROLE_KEYS) {
    topHeroByRole[rk] = buildTopHeroByRole(analyticsReplays, rk);
  }
  return {
    version: extras ? 2 : 1,
    generatedAt: new Date().toISOString(),
    cloudAgg,
    topHeroByRole,
    heroOverall: buildTopHeroOverall(analyticsReplays),
    ...(extras
      ? { itemsMeta: extras.itemsMeta, topSection: extras.topSection }
      : {}),
  };
}
