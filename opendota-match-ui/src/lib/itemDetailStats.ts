import type { ReplaySummary } from "../types/replaysIndex";
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import {
  collectPurchaseEvents,
  LATE_GAME_PURCHASE_MIN_SEC,
  normalizeMetaItemKey,
  playerIsRadiant,
} from "./metaGlobalItemStats";

/**
 * 装备详情页最多参与聚合的录像局数（按 `uploaded_at` 新→旧截断）。
 * 全量 PUB+PRO 常达数千场，逐局拉 slim 会极慢；截断后明显缩短首屏可交互时间。
 */
export const ITEM_DETAIL_MAX_MATCHES = 500;

/** 取最近上传的若干场用于装备统计，避免对全量索引逐局请求 slim。 */
export function sampleReplaysForItemDetail(
  replays: readonly ReplaySummary[]
): ReplaySummary[] {
  const max = ITEM_DETAIL_MAX_MATCHES;
  if (replays.length <= max) return [...replays];
  return [...replays]
    .sort((a, b) => {
      const ta = Date.parse(String(a.uploaded_at ?? "")) || 0;
      const tb = Date.parse(String(b.uploaded_at ?? "")) || 0;
      if (tb !== ta) return tb - ta;
      return Number(b.match_id) - Number(a.match_id);
    })
    .slice(0, max);
}

export type ItemDetailRoleKey =
  | "carry"
  | "mid"
  | "offlane"
  | "support(4)"
  | "support(5)";

export const ITEM_DETAIL_ROLE_ORDER: ItemDetailRoleKey[] = [
  "carry",
  "mid",
  "offlane",
  "support(4)",
  "support(5)",
];

/** 列表与分路表仅展示「出装场次」≥ 此值的英雄 */
export const ITEM_DETAIL_MIN_GAMES_WITH_ITEM = 10;

export const ITEM_DETAIL_ROLE_LABEL: Record<ItemDetailRoleKey, string> = {
  carry: "Carry",
  mid: "Mid",
  offlane: "Offlane",
  "support(4)": "POS4",
  "support(5)": "POS5",
};

export function normalizeItemDetailRole(raw: unknown): ItemDetailRoleKey | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "carry") return "carry";
  if (s === "mid") return "mid";
  if (s === "offlane") return "offlane";
  if (s === "support4" || s === "support 4" || s === "support(4)") {
    return "support(4)";
  }
  if (s === "support5" || s === "support 5" || s === "support(5)") {
    return "support(5)";
  }
  return null;
}

type HeroAgg = {
  games: number;
  wins: number;
  gamesWithItem: number;
  winsWithItem: number;
  sumPurchaseSec: number;
  purchaseEventCount: number;
  gamesWithItemAfter45: number;
};

function emptyHeroAgg(): HeroAgg {
  return {
    games: 0,
    wins: 0,
    gamesWithItem: 0,
    winsWithItem: 0,
    sumPurchaseSec: 0,
    purchaseEventCount: 0,
    gamesWithItemAfter45: 0,
  };
}

function buildHeroRow(
  heroId: number,
  a: HeroAgg
): {
  heroId: number;
  games: number;
  wins: number;
  gamesWithItem: number;
  winsWithItem: number;
  pickRatePct: number;
  wrWithItemPct: number | null;
  liftPct: number | null;
  avgPurchaseSec: number | null;
  purchaseRateAfter45Pct: number | null;
} {
  const pickRatePct =
    a.games > 0 ? (a.gamesWithItem / a.games) * 100 : 0;
  const wrWithItemPct =
    a.gamesWithItem > 0 ? (a.winsWithItem / a.gamesWithItem) * 100 : null;
  const overallWr = a.games > 0 ? (a.wins / a.games) * 100 : null;
  const liftPct =
    wrWithItemPct != null && overallWr != null
      ? wrWithItemPct - overallWr
      : null;
  const avgPurchaseSec =
    a.purchaseEventCount > 0
      ? a.sumPurchaseSec / a.purchaseEventCount
      : null;
  const purchaseRateAfter45Pct =
    a.gamesWithItem > 0
      ? (a.gamesWithItemAfter45 / a.gamesWithItem) * 100
      : null;

  return {
    heroId,
    games: a.games,
    wins: a.wins,
    gamesWithItem: a.gamesWithItem,
    winsWithItem: a.winsWithItem,
    pickRatePct,
    wrWithItemPct,
    liftPct,
    avgPurchaseSec,
    purchaseRateAfter45Pct,
  };
}

export type ItemDetailHeroRow = ReturnType<typeof buildHeroRow>;

export type ItemDetailRoleBlock = {
  role: ItemDetailRoleKey;
  label: string;
  roleHeroSlots: number;
  heroSlotsWithItem: number;
  pickRatePct: number;
  wrWithItemPct: number | null;
  roleSharePct: number;
  heroes: ItemDetailHeroRow[];
};

export type ItemDetailModel = {
  itemKey: string;
  matchesAnalyzed: number;
  totalHeroSlots: number;
  purchaseRatePct: number;
  purchaseRateAfter45Pct: number;
  avgPurchaseSec: number | null;
  wrFirstBuyerPct: number | null;
  liftVs50Pct: number | null;
  goldCost: number | null;
  mostPicked: ItemDetailHeroRow[];
  bestLift: ItemDetailHeroRow[];
  worstLift: ItemDetailHeroRow[];
  roles: ItemDetailRoleBlock[];
};

function eventsForItem(
  p: SlimPlayer,
  target: string
): Array<{ time: number }> {
  const t = normalizeMetaItemKey(target);
  const out: Array<{ time: number }> = [];
  for (const ev of collectPurchaseEvents(p)) {
    if (normalizeMetaItemKey(ev.itemKey) !== t) continue;
    out.push({ time: ev.time });
  }
  return out;
}

export function computeItemDetailModel(
  itemKeyRaw: string,
  replays: readonly ReplaySummary[],
  slimByMatchId: Readonly<Record<number, SlimMatchJson | null>>
): ItemDetailModel | null {
  const itemKey = normalizeMetaItemKey(itemKeyRaw);
  if (!itemKey) return null;

  let matchesAnalyzed = 0;
  let totalHeroSlots = 0;

  let heroSlotsWithItem = 0;
  let sumPurchaseSecAll = 0;
  let purchaseEventsAll = 0;
  let heroSlotsWithItemAfter45 = 0;

  let firstBuyerWins = 0;
  let firstBuyerGames = 0;

  const globalHero = new Map<number, HeroAgg>();
  const roleHeroSlots: Record<ItemDetailRoleKey, number> = {
    carry: 0,
    mid: 0,
    offlane: 0,
    "support(4)": 0,
    "support(5)": 0,
  };
  const roleWithItemSlots: Record<ItemDetailRoleKey, number> = {
    carry: 0,
    mid: 0,
    offlane: 0,
    "support(4)": 0,
    "support(5)": 0,
  };
  const roleHeroAgg = new Map<
    ItemDetailRoleKey,
    Map<number, HeroAgg>
  >();

  function getHeroAgg(m: Map<number, HeroAgg>, hid: number): HeroAgg {
    let a = m.get(hid);
    if (!a) {
      a = emptyHeroAgg();
      m.set(hid, a);
    }
    return a;
  }

  for (const rk of ITEM_DETAIL_ROLE_ORDER) {
    roleHeroAgg.set(rk, new Map());
  }

  for (const rep of replays) {
    const mid = Number(rep.match_id);
    const slim = slimByMatchId[mid];
    if (!slim?.players?.length) continue;

    matchesAnalyzed += 1;
    totalHeroSlots += slim.players.length;

    const radiantWin =
      typeof slim.radiant_win === "boolean"
        ? slim.radiant_win
        : typeof rep.radiant_win === "boolean"
          ? rep.radiant_win
          : null;
    const decided = typeof radiantWin === "boolean";

    type EvRow = {
      time: number;
      isRadiant: boolean;
      slot: number;
      heroId: number;
    };
    const flat: EvRow[] = [];

    for (const pl of slim.players) {
      const hid = Number(pl.hero_id || 0);
      if (!Number.isFinite(hid) || hid <= 0) continue;

      const isR = playerIsRadiant(pl);
      const slot = Number(pl.player_slot ?? 999);
      const won =
        decided &&
        typeof radiantWin === "boolean" &&
        isR === radiantWin;

      let ha = globalHero.get(hid);
      if (!ha) {
        ha = emptyHeroAgg();
        globalHero.set(hid, ha);
      }
      ha.games += 1;
      if (won) ha.wins += 1;

      const evs = eventsForItem(pl, itemKey);
      const uniqHas =
        evs.length > 0
          ? true
          : false;
      const uniqAfter45 = evs.some(
        (e) => e.time >= LATE_GAME_PURCHASE_MIN_SEC
      );

      if (uniqHas) {
        heroSlotsWithItem += 1;
        if (uniqAfter45) heroSlotsWithItemAfter45 += 1;
        ha.gamesWithItem += 1;
        if (won) ha.winsWithItem += 1;
        for (const e of evs) {
          ha.sumPurchaseSec += e.time;
          ha.purchaseEventCount += 1;
          sumPurchaseSecAll += e.time;
          purchaseEventsAll += 1;
        }
        if (uniqAfter45) ha.gamesWithItemAfter45 += 1;
      }

      const role = normalizeItemDetailRole(pl.role_early);
      if (role) {
        roleHeroSlots[role] += 1;
        if (uniqHas) roleWithItemSlots[role] += 1;

        const rm = roleHeroAgg.get(role)!;
        const ra = getHeroAgg(rm, hid);
        ra.games += 1;
        if (won) ra.wins += 1;
        if (uniqHas) {
          ra.gamesWithItem += 1;
          if (won) ra.winsWithItem += 1;
          for (const e of evs) {
            ra.sumPurchaseSec += e.time;
            ra.purchaseEventCount += 1;
          }
          if (uniqAfter45) ra.gamesWithItemAfter45 += 1;
        }
      }

      for (const e of evs) {
        flat.push({
          time: e.time,
          isRadiant: isR,
          slot,
          heroId: hid,
        });
      }
    }

    if (flat.length > 0 && decided) {
      flat.sort((a, b) => a.time - b.time || a.slot - b.slot);
      const first = flat[0]!;
      firstBuyerGames += 1;
      if (first.isRadiant === radiantWin) firstBuyerWins += 1;
    }
  }

  const denom = Math.max(totalHeroSlots, 1);
  const purchaseRatePct = (heroSlotsWithItem / denom) * 100;
  const purchaseRateAfter45Pct =
    (heroSlotsWithItemAfter45 / denom) * 100;
  const avgPurchaseSec =
    purchaseEventsAll > 0
      ? sumPurchaseSecAll / purchaseEventsAll
      : null;
  const wrFirstBuyerPct =
    firstBuyerGames > 0 ? (firstBuyerWins / firstBuyerGames) * 100 : null;
  const liftVs50Pct =
    wrFirstBuyerPct != null ? wrFirstBuyerPct - 50 : null;

  const globalRows: ItemDetailHeroRow[] = [];
  for (const [hid, agg] of globalHero) {
    if (agg.gamesWithItem > 0) {
      globalRows.push(buildHeroRow(hid, agg));
    }
  }

  const minGamesLift = ITEM_DETAIL_MIN_GAMES_WITH_ITEM;
  const mostPicked = [...globalRows]
    .filter((r) => r.gamesWithItem >= ITEM_DETAIL_MIN_GAMES_WITH_ITEM)
    .sort((a, b) => b.gamesWithItem - a.gamesWithItem)
    .slice(0, 6);

  const liftCandidates = globalRows.filter((r) => r.gamesWithItem >= minGamesLift);
  const bestLift = [...liftCandidates]
    .filter((r) => r.liftPct != null)
    .sort((a, b) => (b.liftPct ?? 0) - (a.liftPct ?? 0))
    .slice(0, 6);
  const worstLift = [...liftCandidates]
    .filter((r) => r.liftPct != null)
    .sort((a, b) => (a.liftPct ?? 0) - (b.liftPct ?? 0))
    .slice(0, 6);

  const totalRoleItem = ITEM_DETAIL_ROLE_ORDER.reduce(
    (s, r) => s + roleWithItemSlots[r],
    0
  );

  const roles: ItemDetailRoleBlock[] = ITEM_DETAIL_ROLE_ORDER.map((rk) => {
    const rh = roleHeroSlots[rk];
    const wi = roleWithItemSlots[rk];
    const pickRatePct = rh > 0 ? (wi / rh) * 100 : 0;

    let winsW = 0;
    let gamesW = 0;
    const rm = roleHeroAgg.get(rk)!;
    for (const [, a] of rm) {
      if (a.gamesWithItem > 0) {
        gamesW += a.gamesWithItem;
        winsW += a.winsWithItem;
      }
    }
    const wrWithItemPct =
      gamesW > 0 ? (winsW / gamesW) * 100 : null;

    const roleSharePct =
      totalRoleItem > 0 ? (wi / totalRoleItem) * 100 : 0;

    const heroRows: ItemDetailHeroRow[] = [];
    for (const [hid, agg] of rm) {
      if (agg.gamesWithItem > 0) {
        heroRows.push(buildHeroRow(hid, agg));
      }
    }
    heroRows.sort((a, b) => b.gamesWithItem - a.gamesWithItem);
    const heroesFiltered = heroRows.filter(
      (r) => r.gamesWithItem >= ITEM_DETAIL_MIN_GAMES_WITH_ITEM
    );

    return {
      role: rk,
      label: ITEM_DETAIL_ROLE_LABEL[rk],
      roleHeroSlots: rh,
      heroSlotsWithItem: wi,
      pickRatePct,
      wrWithItemPct,
      roleSharePct,
      heroes: heroesFiltered.slice(0, 80),
    };
  });

  return {
    itemKey,
    matchesAnalyzed,
    totalHeroSlots,
    purchaseRatePct,
    purchaseRateAfter45Pct,
    avgPurchaseSec,
    wrFirstBuyerPct,
    liftVs50Pct,
    goldCost: null,
    mostPicked,
    bestLift,
    worstLift,
    roles,
  };
}
