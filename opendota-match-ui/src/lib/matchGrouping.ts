/**
 * 战绩页分队与排序。
 *
 * **player_slot 优先于 is_radiant**：避免错误布尔导致 10 人挤在一边。
 * 标准编码：天辉 0–4；夜魇 128–132（或 5–9）。
 * 对 10–127 等非典型槽位**不**再用 `slot < 64` 猜天辉（易误判），仅信布尔字段，缺省按夜魇处理。
 *
 * 标准 5v5  Lobby：天辉 0–4，夜魇 128–132（或 5–9）。133–137 等常为教练/旁观者，DEM 偶发写入为第 11 条玩家，须剔除以免一侧出现 6 人。
 */
import type { ReplayPlayerSummary } from "../types/replaysIndex";
import type { SlimPlayer } from "../types/slimMatch";

function slotNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 是否属于标准 5v5 对阵表应展示的 player_slot（排除 133+ 等噪声槽） */
export function isCanonicalDotaLobbyPlayerSlot(player_slot: unknown): boolean {
  if (player_slot === null || player_slot === undefined) return false;
  const raw = Number(player_slot);
  if (!Number.isFinite(raw)) return false;
  const ps = Math.floor(raw);
  if (ps >= 0 && ps <= 4) return true;
  if (ps >= 5 && ps <= 9) return true;
  if (ps >= 128 && ps <= 132) return true;
  return false;
}

/** DEM 偶发把真实选手写在 133–137；有英雄 id 时供补位，不当作「已有 10 人」的教练位 */
function isOverflowLobbyPlayerSlot(player_slot: unknown): boolean {
  if (player_slot === null || player_slot === undefined) return false;
  const raw = Number(player_slot);
  if (!Number.isFinite(raw)) return false;
  const ps = Math.floor(raw);
  return ps >= 133 && ps <= 137;
}

/**
 * 队内顺序：与 OpenDota / 客户端一致，按 **player_slot 数值升序**（0–4、5–9、128–132 均为自然递增）。
 * 次要键 hero_id，避免异常重复 slot 时顺序抖动。
 */
export function compareByPlayerSlot(
  a: { player_slot?: unknown; hero_id?: unknown },
  b: { player_slot?: unknown; hero_id?: unknown }
): number {
  const d = slotNum(a.player_slot) - slotNum(b.player_slot);
  if (d !== 0) return d;
  return slotNum(a.hero_id) - slotNum(b.hero_id);
}

function boolTeamOrDefault(
  p: Record<string, unknown>,
  defaultRadiant: boolean
): boolean {
  const sr = p["is_radiant"];
  if (typeof sr === "boolean") return sr;
  const cr = p["isRadiant"];
  if (typeof cr === "boolean") return cr;
  return defaultRadiant;
}

export function isRadiantFromPlayer<T extends Record<string, unknown>>(p: T): boolean {
  const raw = p["player_slot"];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return boolTeamOrDefault(p, true);
  }
  const ps = Number(raw);
  if (!Number.isFinite(ps)) {
    return boolTeamOrDefault(p, true);
  }
  if (ps >= 128 && ps <= 137) return false;
  if (ps >= 5 && ps <= 9) return false;
  if (ps >= 0 && ps <= 4) return true;
  if (ps > 9 && ps < 128) {
    return boolTeamOrDefault(p, false);
  }
  return boolTeamOrDefault(p, false);
}

export function splitRadiantDirePlayers(players: SlimPlayer[]): {
  radiantPlayers: SlimPlayer[];
  direPlayers: SlimPlayer[];
} {
  const radiantPlayers: SlimPlayer[] = [];
  const direPlayers: SlimPlayer[] = [];
  for (const p of players) {
    if (!isCanonicalDotaLobbyPlayerSlot(p.player_slot)) continue;
    if (isRadiantFromPlayer(p as Record<string, unknown>)) radiantPlayers.push(p);
    else direPlayers.push(p);
  }
  const hid = (p: SlimPlayer) => {
    const n = Number(p.hero_id ?? 0);
    return Number.isFinite(n) && n > 0;
  };
  if (radiantPlayers.length + direPlayers.length < 10) {
    const overflow = players.filter(
      (p) =>
        !isCanonicalDotaLobbyPlayerSlot(p.player_slot) &&
        isOverflowLobbyPlayerSlot(p.player_slot) &&
        hid(p)
    );
    overflow.sort(compareByPlayerSlot);
    for (const p of overflow) {
      if (radiantPlayers.length >= 5 && direPlayers.length >= 5) break;
      if (
        radiantPlayers.length < 5 &&
        radiantPlayers.length <= direPlayers.length
      ) {
        radiantPlayers.push(p);
      } else if (
        direPlayers.length < 5 &&
        direPlayers.length <= radiantPlayers.length
      ) {
        direPlayers.push(p);
      } else if (radiantPlayers.length < 5) {
        radiantPlayers.push(p);
      } else if (direPlayers.length < 5) {
        direPlayers.push(p);
      } else {
        break;
      }
    }
  }
  return { radiantPlayers, direPlayers };
}

/** 首页 `replays_index` 行：与 {@link splitRadiantDirePlayers} 相同的 133–137 补位逻辑 */
export function partitionReplayRowPlayers(
  players: readonly ReplayPlayerSummary[]
): {
  radiantPlayers: ReplayPlayerSummary[];
  direPlayers: ReplayPlayerSummary[];
} {
  const radiantPlayers: ReplayPlayerSummary[] = [];
  const direPlayers: ReplayPlayerSummary[] = [];
  for (const p of players) {
    if (!isCanonicalDotaLobbyPlayerSlot(p.player_slot)) continue;
    if (isRadiantFromPlayer(p as unknown as Record<string, unknown>))
      radiantPlayers.push(p);
    else direPlayers.push(p);
  }
  const hid = (p: ReplayPlayerSummary) => {
    const n = Number(p.hero_id ?? 0);
    return Number.isFinite(n) && n > 0;
  };
  if (radiantPlayers.length + direPlayers.length < 10) {
    const overflow = players.filter(
      (p) =>
        !isCanonicalDotaLobbyPlayerSlot(p.player_slot) &&
        isOverflowLobbyPlayerSlot(p.player_slot) &&
        hid(p)
    );
    overflow.sort(compareByPlayerSlot);
    for (const p of overflow) {
      if (radiantPlayers.length >= 5 && direPlayers.length >= 5) break;
      if (
        radiantPlayers.length < 5 &&
        radiantPlayers.length <= direPlayers.length
      ) {
        radiantPlayers.push(p);
      } else if (
        direPlayers.length < 5 &&
        direPlayers.length <= radiantPlayers.length
      ) {
        direPlayers.push(p);
      } else if (radiantPlayers.length < 5) {
        radiantPlayers.push(p);
      } else if (direPlayers.length < 5) {
        direPlayers.push(p);
      } else {
        break;
      }
    }
  }
  return { radiantPlayers, direPlayers };
}

/**
 * @deprecated 详情页已统一使用 {@link splitRadiantDirePlayers} / {@link isRadiantFromPlayer}，
 * 避免 `player_slot < 128` 将 5–9 槽误判为天辉。
 */
export function splitRadiantDireForMatchDetailPage(players: SlimPlayer[]): {
  radiantPlayers: SlimPlayer[];
  direPlayers: SlimPlayer[];
} {
  return splitRadiantDirePlayers(players);
}
