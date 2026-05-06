import type { SlimMatchJson } from "../types/slimMatch";

export type HeroItemTimelineEntry = {
  minute: number;
  item_id: number;
  item_name: string;
  count: number;
};

export type HeroItemTimelinePayload = {
  hero_id: number;
  hero_name: string;
  total_matches_for_hero: number;
  purchase_data: HeroItemTimelineEntry[];
};

/**
 * 由父页面批量拉取的 slim 同步聚合购买时间线（禁止在子组件内逐场请求 plan_b）。
 */
export function buildHeroPurchaseTimelineFromSlims(
  heroId: number,
  heroDisplayName: string,
  slimByMatchId: Readonly<Record<number, SlimMatchJson | null | undefined>>,
  fallbackMatchIds: readonly number[]
): HeroItemTimelinePayload | null {
  const countByMinuteItem = new Map<string, number>();
  let totalMatchesForHero = 0;
  for (const matchId of fallbackMatchIds) {
    const mid = Number(matchId);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    const slim = slimByMatchId[mid];
    if (!slim?.players?.length) continue;
    const heroPlayers = (slim.players || []).filter(
      (p) => Number(p?.hero_id || 0) === heroId
    );
    if (!heroPlayers.length) continue;
    totalMatchesForHero += 1;
    const inMatch = new Set<string>();
    for (const p of heroPlayers) {
      const hist = (
        p as {
          purchase_history?: Array<{
            time?: number;
            item?: string;
            item_key?: string;
          }>;
        }
      ).purchase_history;
      if (!Array.isArray(hist)) continue;
      for (const row of hist) {
        const sec = Number(row?.time ?? -1);
        if (!Number.isFinite(sec) || sec < 0) continue;
        const minute = Math.floor(sec / 60);
        const itemNameRaw = String(row?.item || "").trim();
        const itemKeyRaw = String(row?.item_key || "").trim();
        const itemName =
          itemNameRaw || (itemKeyRaw ? `item_${itemKeyRaw}` : "");
        if (!itemName) continue;
        inMatch.add(`${minute}|${itemName}`);
      }
    }
    for (const k of inMatch) {
      countByMinuteItem.set(k, (countByMinuteItem.get(k) || 0) + 1);
    }
  }
  if (totalMatchesForHero <= 0 || countByMinuteItem.size === 0) return null;
  const rows: HeroItemTimelineEntry[] = [];
  for (const [k, count] of countByMinuteItem.entries()) {
    const [mRaw, itemName] = k.split("|");
    const minute = Number(mRaw) || 0;
    rows.push({
      minute,
      item_id: 0,
      item_name: itemName || "item_unknown",
      count,
    });
  }
  rows.sort(
    (a, b) =>
      a.minute - b.minute ||
      b.count - a.count ||
      a.item_name.localeCompare(b.item_name)
  );
  return {
    hero_id: heroId,
    hero_name: heroDisplayName,
    total_matches_for_hero: totalMatchesForHero,
    purchase_data: rows,
  };
}
