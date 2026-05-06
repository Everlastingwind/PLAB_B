import type { ReplayPlayerSummary, ReplaySummary } from "../types/replaysIndex";
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import { normalizeMetaItemKey } from "./metaGlobalItemStats";
import type { EntityMapsPayload } from "../types/entityMaps";

/** 与 MetaTopKillGamesSection 一致 */
export const TOP_SNAPSHOT_FORCE_PRO_MATCH_IDS = new Set<number>([
  8763984403, 8776094912,
]);

export type TopSectionSnapshotPayload = {
  proIndexMatchIds: number[];
  singleKillTop: Array<{ replay: ReplaySummary; itemIconKeys: string[] }>;
  totalKillsTop: ReplaySummary[];
  pubMostProsTop: Array<{ replay: ReplaySummary; proCount: number }>;
};

function pickTopKillPlayer(
  players: ReplayPlayerSummary[]
): ReplayPlayerSummary | null {
  if (!players.length) return null;
  return players.reduce((a, b) =>
    (b.kills ?? 0) > (a.kills ?? 0) ? b : a
  );
}

function pickSlimPlayer(
  slim: SlimMatchJson | null,
  sum: ReplayPlayerSummary
): SlimPlayer | null {
  const players = slim?.players;
  if (!Array.isArray(players) || !players.length) return null;
  const hid = sum.hero_id;
  const aid = sum.account_id;
  const slot = sum.player_slot;
  const byHero = players.filter((p) => Number(p.hero_id) === hid);
  if (byHero.length === 1) return byHero[0];
  if (aid > 0) {
    const m = byHero.find((p) => Number(p.account_id) === aid);
    if (m) return m;
  }
  const m = byHero.find((p) => Number(p.player_slot) === slot);
  return m ?? byHero[0] ?? null;
}

export function itemIconKeysForTopKillDisplay(
  sp: SlimPlayer,
  maps: EntityMapsPayload
): string[] {
  const out: string[] = [];
  const slots = sp.items_slot;
  if (Array.isArray(slots)) {
    for (let i = 0; i < 6; i++) {
      const s = slots[i];
      if (!s || s.empty) continue;
      const key = String(s.item_key || "").replace(/^item_/i, "").trim();
      if (key) out.push(normalizeMetaItemKey(key));
    }
    if (out.length) return out;
  }
  for (let i = 0; i < 6; i++) {
    const id = sp[`item_${i}` as keyof SlimPlayer];
    if (id == null) continue;
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) continue;
    const meta = maps.items[String(n)];
    const key = String(meta?.key || "").trim();
    if (key) out.push(normalizeMetaItemKey(key));
  }
  return out;
}

function totalKillsByReplay(replay: ReplaySummary): number {
  let sum = 0;
  for (const p of replay.players || []) {
    const k = Number(p.kills);
    if (Number.isFinite(k) && k >= 0) sum += k;
  }
  if (sum > 0) return sum;
  const radiant = Number(replay.radiant_score);
  const dire = Number(replay.dire_score);
  const hasValidIndexedScore =
    (Number.isFinite(radiant) && radiant > 0) ||
    (Number.isFinite(dire) && dire > 0);
  if (hasValidIndexedScore) return radiant + dire;
  return 0;
}

export function buildTopSectionSnapshotPayload(
  replays: readonly ReplaySummary[],
  proIndexMatchIds: readonly number[],
  slimByMatchId: ReadonlyMap<number, SlimMatchJson | null>,
  maps: EntityMapsPayload
): TopSectionSnapshotPayload {
  const proSet = new Set(proIndexMatchIds);

  const scoredKill: {
    replay: ReplaySummary;
    player: ReplayPlayerSummary;
    maxK: number;
  }[] = [];
  for (const r of replays) {
    const p = pickTopKillPlayer(r.players || []);
    if (!p) continue;
    scoredKill.push({
      replay: r,
      player: p,
      maxK: p.kills ?? 0,
    });
  }
  scoredKill.sort(
    (a, b) =>
      b.maxK - a.maxK ||
      b.replay.match_id - a.replay.match_id
  );
  const singleKillTop: TopSectionSnapshotPayload["singleKillTop"] = [];
  const seenKill = new Set<number>();
  for (const row of scoredKill) {
    if (seenKill.has(row.replay.match_id)) continue;
    seenKill.add(row.replay.match_id);
    const slim = slimByMatchId.get(row.replay.match_id) ?? null;
    const sp = slim ? pickSlimPlayer(slim, row.player) : null;
    const itemIconKeys =
      sp && maps ? itemIconKeysForTopKillDisplay(sp, maps) : [];
    singleKillTop.push({
      replay: row.replay,
      itemIconKeys,
    });
    if (singleKillTop.length >= 5) break;
  }

  const scoredTotal = replays.map((replay) => ({
    replay,
    totalKills: totalKillsByReplay(replay),
  }));
  scoredTotal.sort(
    (a, b) =>
      b.totalKills - a.totalKills ||
      b.replay.match_id - a.replay.match_id
  );
  const totalKillsTop = scoredTotal.slice(0, 5).map((x) => x.replay);

  const pubMostCandidates = replays
    .filter((r) => {
      if (TOP_SNAPSHOT_FORCE_PRO_MATCH_IDS.has(r.match_id)) return false;
      const isPub = (r.source ?? "pub") === "pub";
      if (!isPub) return false;
      if (proSet.has(r.match_id)) return false;
      return true;
    })
    .map((replay) => {
      const proCount = (replay.players || []).reduce((acc, p) => {
        const name = String(p.pro_name || "").trim();
        return name ? acc + 1 : acc;
      }, 0);
      return { replay, proCount };
    });
  pubMostCandidates.sort(
    (a, b) =>
      b.proCount - a.proCount ||
      totalKillsByReplay(b.replay) - totalKillsByReplay(a.replay) ||
      b.replay.match_id - a.replay.match_id
  );
  const pubMostProsTop = pubMostCandidates.slice(0, 5);

  return {
    proIndexMatchIds: [...proSet],
    singleKillTop,
    totalKillsTop,
    pubMostProsTop,
  };
}
