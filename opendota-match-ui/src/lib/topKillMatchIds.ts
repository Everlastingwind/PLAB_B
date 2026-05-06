import type { ReplayPlayerSummary, ReplaySummary } from "../types/replaysIndex";

function pickTopKillPlayer(
  players: ReplayPlayerSummary[]
): ReplayPlayerSummary | null {
  if (!players.length) return null;
  return players.reduce((a, b) =>
    (b.kills ?? 0) > (a.kills ?? 0) ? b : a
  );
}

/**
 * 与 {@link MetaTopKillGamesSection} 中「单人击杀 Top N」相同规则，供父页批量拉取 plan_b/slim 时去重 id。
 */
export function topKillMatchIdsForSlim(
  replays: readonly ReplaySummary[],
  limit = 5
): number[] {
  const scored: { matchId: number; maxK: number }[] = [];
  for (const r of replays) {
    const p = pickTopKillPlayer(r.players || []);
    if (!p) continue;
    scored.push({
      matchId: r.match_id,
      maxK: p.kills ?? 0,
    });
  }
  scored.sort(
    (a, b) =>
      b.maxK - a.maxK || b.matchId - a.matchId
  );
  const out: number[] = [];
  const seen = new Set<number>();
  for (const row of scored) {
    if (seen.has(row.matchId)) continue;
    seen.add(row.matchId);
    const mid = Number(row.matchId);
    if (Number.isFinite(mid) && mid > 0) out.push(mid);
    if (out.length >= limit) break;
  }
  return out;
}
