import type { ReplayPlayerSummary, ReplaySummary } from "../types/replaysIndex";
import {
  isCanonicalDotaLobbyPlayerSlot,
  isRadiantFromPlayer,
} from "./matchGrouping";

/** 与同仓库 scripts/backfill_role_early_in_public_data.py 一致：队内按 networth→gpm→slot 近似 1～5 号位 */
export type MetaRoleKey =
  | "carry"
  | "mid"
  | "offlane"
  | "support(4)"
  | "support(5)";

const ROLE_ORDER: readonly MetaRoleKey[] = [
  "carry",
  "mid",
  "offlane",
  "support(4)",
  "support(5)",
];

function floatOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function assignRolesForTeam(team: ReplayPlayerSummary[]): Map<number, MetaRoleKey> {
  const ranked = [...team].sort((a, b) => {
    const nw = floatOrZero(b.net_worth) - floatOrZero(a.net_worth);
    if (nw !== 0) return nw;
    const g = floatOrZero(b.gold_per_min) - floatOrZero(a.gold_per_min);
    if (g !== 0) return g;
    return a.player_slot - b.player_slot;
  });
  const out = new Map<number, MetaRoleKey>();
  for (let i = 0; i < ranked.length; i++) {
    const p = ranked[i]!;
    const role: MetaRoleKey =
      i < ROLE_ORDER.length ? ROLE_ORDER[i]! : "support(4)";
    out.set(p.player_slot, role);
  }
  return out;
}

/**
 * 单场索引内：player_slot → 兜底分路（仅在缺失 role_early 时使用）。
 */
export function slotToRoleEarlyFallbackMap(
  replay: ReplaySummary
): Map<number, MetaRoleKey> {
  const players = replay.players || [];
  const rad: ReplayPlayerSummary[] = [];
  const dire: ReplayPlayerSummary[] = [];
  for (const p of players) {
    if (!isCanonicalDotaLobbyPlayerSlot(p.player_slot)) continue;
    if (isRadiantFromPlayer(p as unknown as Record<string, unknown>)) {
      rad.push(p);
    } else {
      dire.push(p);
    }
  }
  const m = new Map<number, MetaRoleKey>();
  for (const [slot, role] of assignRolesForTeam(rad)) m.set(slot, role);
  for (const [slot, role] of assignRolesForTeam(dire)) m.set(slot, role);
  return m;
}
