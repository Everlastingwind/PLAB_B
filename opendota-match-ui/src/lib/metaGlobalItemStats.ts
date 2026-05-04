import type { ReplaySummary } from "../types/replaysIndex";
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";

/** 游戏内 45:00 及之后（秒），用于「后期购买」统计 */
export const LATE_GAME_PURCHASE_MIN_SEC = 45 * 60;

/** 与出装条一致：内部名小写、去 item_ 前缀 */
export function normalizeMetaItemKey(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^item_/i, "")
    .toLowerCase();
}

export function playerIsRadiant(p: SlimPlayer): boolean {
  if (typeof p.isRadiant === "boolean") return p.isRadiant;
  const slot = Number(p.player_slot ?? -1);
  if (slot >= 0 && slot <= 4) return true;
  if (slot >= 5 && slot <= 9) return false;
  if (slot >= 128 && slot <= 132) return false;
  return slot >= 0 && slot <= 4;
}

export function collectPurchaseEvents(
  p: SlimPlayer
): Array<{ time: number; itemKey: string; slot: number }> {
  const slot = Number(p.player_slot ?? 999);
  const out: Array<{ time: number; itemKey: string; slot: number }> = [];

  const hist = p.purchase_history;
  if (Array.isArray(hist)) {
    for (const row of hist) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const t = Number(o.time);
      const raw = String(o.item ?? o.item_key ?? "").trim();
      const itemKey = normalizeMetaItemKey(raw);
      if (!Number.isFinite(t) || t < 0 || !itemKey) continue;
      out.push({ time: Math.floor(t), itemKey, slot });
    }
  }

  const starts = p.starting_items;
  if (Array.isArray(starts)) {
    for (const it of starts) {
      if (!it || typeof it !== "object") continue;
      const ik = String(
        (it as { item_key?: unknown }).item_key ??
          (it as { item_name_en?: unknown }).item_name_en ??
          ""
      ).trim();
      const itemKey = normalizeMetaItemKey(ik.replace(/^item_/i, ""));
      if (!itemKey) continue;
      const fp = Number((it as { first_purchase_time?: unknown }).first_purchase_time);
      const t =
        Number.isFinite(fp) && fp >= 0 ? Math.floor(fp) : 0;
      const ct = Math.max(1, Math.floor(Number((it as { count?: unknown }).count ?? 1) || 1));
      for (let i = 0; i < ct; i++) {
        out.push({ time: t, itemKey, slot });
      }
    }
  }

  return out;
}

/** 仅保留「需合成」成装：白皮书 keys 命中，且排除单独购买的 recipe 卷轴 */
function collectSynthPurchaseEvents(
  p: SlimPlayer,
  craftableKeys: ReadonlySet<string>
): Array<{ time: number; itemKey: string; slot: number }> {
  const out: Array<{ time: number; itemKey: string; slot: number }> = [];
  for (const ev of collectPurchaseEvents(p)) {
    const k = normalizeMetaItemKey(ev.itemKey);
    if (k.startsWith("recipe_")) continue;
    if (!craftableKeys.has(k)) continue;
    out.push(ev);
  }
  return out;
}

export type MetaGlobalItemAggRow = {
  itemKey: string;
  /** 至少买过该装备 1 次的「英雄·场次」条数 */
  heroPurchaseRows: number;
  /** 已解析对局内全部玩家条数之和（每场 × 人数） */
  totalHeroPlayerSlots: number;
  matchesAnalyzed: number;
  /** heroPurchaseRows / totalHeroPlayerSlots */
  purchaseRatePct: number;
  /** 至少有一次购买发生在游戏时间 ≥45:00 的英雄条数 / totalHeroPlayerSlots */
  purchaseRateAfter45Pct: number;
  /** 全部购买流水记录（purchase_history + starting_items）的时间算术平均，秒 */
  averagePurchaseSec: number | null;
  /** 有胜负样本时：首场购买者所在阵营胜率 */
  winRatePct: number | null;
};

export function aggregateMetaGlobalItemStats(
  replays: readonly ReplaySummary[],
  slimByMatchId: Readonly<Record<number, SlimMatchJson | null>>,
  craftableKeys: ReadonlySet<string>
): {
  matchesAnalyzed: number;
  totalHeroPlayerSlots: number;
  rows: MetaGlobalItemAggRow[];
} {
  if (replays.length === 0) {
    return { matchesAnalyzed: 0, totalHeroPlayerSlots: 0, rows: [] };
  }

  type Acc = {
    heroPurchaseRows: number;
    heroPurchaseRowsAfter45: number;
    totalPurchaseTimeSec: number;
    purchaseEventCount: number;
    wins: number;
    gamesDecided: number;
  };
  const map = new Map<string, Acc>();

  function ensureAcc(key: string): Acc {
    let a = map.get(key);
    if (!a) {
      a = {
        heroPurchaseRows: 0,
        heroPurchaseRowsAfter45: 0,
        totalPurchaseTimeSec: 0,
        purchaseEventCount: 0,
        wins: 0,
        gamesDecided: 0,
      };
      map.set(key, a);
    }
    return a;
  }

  let matchesAnalyzed = 0;
  let totalHeroPlayerSlots = 0;

  for (const rep of replays) {
    const mid = Number(rep.match_id);
    const slim = slimByMatchId[mid];
    if (!slim?.players?.length) continue;

    matchesAnalyzed += 1;
    totalHeroPlayerSlots += slim.players.length;

    const radiantWin =
      typeof slim.radiant_win === "boolean"
        ? slim.radiant_win
        : typeof rep.radiant_win === "boolean"
          ? rep.radiant_win
          : null;
    const decided = typeof radiantWin === "boolean";

    const byItem = new Map<
      string,
      Array<{ time: number; isRadiant: boolean; slot: number }>
    >();

    for (const pl of slim.players) {
      const isR = playerIsRadiant(pl);
      const slot = Number(pl.player_slot ?? 999);
      for (const ev of collectSynthPurchaseEvents(pl, craftableKeys)) {
        const arr = byItem.get(ev.itemKey);
        const row = { time: ev.time, isRadiant: isR, slot };
        if (arr) arr.push(row);
        else byItem.set(ev.itemKey, [row]);
      }
    }

    for (const [itemKey, events] of byItem) {
      if (events.length === 0) continue;
      events.sort((a, b) => a.time - b.time || a.slot - b.slot);
      const first = events[0]!;

      const acc = ensureAcc(itemKey);

      if (decided) {
        acc.gamesDecided += 1;
        const won = first.isRadiant === radiantWin;
        if (won) acc.wins += 1;
      }
    }

    for (const pl of slim.players) {
      const events = collectSynthPurchaseEvents(pl, craftableKeys);
      const uniq = new Set<string>();
      const uniqAfter45 = new Set<string>();
      for (const ev of events) {
        uniq.add(ev.itemKey);
        if (ev.time >= LATE_GAME_PURCHASE_MIN_SEC) {
          uniqAfter45.add(ev.itemKey);
        }
        const acc = ensureAcc(ev.itemKey);
        acc.totalPurchaseTimeSec += ev.time;
        acc.purchaseEventCount += 1;
      }
      for (const ik of uniq) {
        ensureAcc(ik).heroPurchaseRows += 1;
      }
      for (const ik of uniqAfter45) {
        ensureAcc(ik).heroPurchaseRowsAfter45 += 1;
      }
    }
  }

  const denom = Math.max(totalHeroPlayerSlots, 1);
  const rows: MetaGlobalItemAggRow[] = [];

  for (const [itemKey, acc] of map) {
    const purchaseRatePct = (acc.heroPurchaseRows / denom) * 100;
    const purchaseRateAfter45Pct =
      (acc.heroPurchaseRowsAfter45 / denom) * 100;
    const winRatePct =
      acc.gamesDecided > 0 ? (acc.wins / acc.gamesDecided) * 100 : null;
    const averagePurchaseSec =
      acc.purchaseEventCount > 0
        ? acc.totalPurchaseTimeSec / acc.purchaseEventCount
        : null;

    rows.push({
      itemKey,
      heroPurchaseRows: acc.heroPurchaseRows,
      totalHeroPlayerSlots,
      matchesAnalyzed,
      purchaseRatePct,
      purchaseRateAfter45Pct,
      averagePurchaseSec,
      winRatePct,
    });
  }

  rows.sort(
    (a, b) =>
      b.purchaseRatePct - a.purchaseRatePct ||
      b.heroPurchaseRows - a.heroPurchaseRows ||
      a.itemKey.localeCompare(b.itemKey)
  );

  return { matchesAnalyzed, totalHeroPlayerSlots, rows };
}

export function formatGameClockMmSs(sec: number): string {
  const s = Math.max(0, sec);
  const whole = Math.floor(s);
  const m = Math.floor(whole / 60);
  const r = whole % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
