/**
 * 从 odota/parser 等产出的「巨型事件数组」中提纯为 SlimMatchJson 形状。
 * 与 Python ``utils/raw_odota_purify.py`` 行为对齐。
 *
 * - 仅保留 ``type === "player_match"`` 的条目作为 ``players``（通常 10 条），按 ``player_slot`` 升序。
 * - 提取 ``type === "match"`` 合并到根级。
 * - 若 ``players`` 被误设为整条事件流，在同一数组内过滤。
 */

import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";

const EVENT_TYPES_HINT = new Set([
  "interval",
  "player_slot",
  "epilogue",
  "DOTA_COMBATLOG",
  "DOTA_COMBATLOG_DAMAGE",
  "DOTA_COMBATLOG_HEAL",
  "DOTA_COMBATLOG_DEATH",
  "chat",
  "cosmetics",
  "dotaplus",
]);

function numSlot(row: Record<string, unknown>): number {
  const v = row["player_slot"];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stripType(row: Record<string, unknown>): SlimPlayer {
  const { type: _t, ...rest } = row;
  return rest as SlimPlayer;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function rowsFromStream(raw: unknown[]): Record<string, unknown>[] {
  return raw.filter(isRecord);
}

function isEventStreamPollutedPlayers(players: unknown[]): boolean {
  if (players.length > 24) return true;
  const first = players[0];
  if (!isRecord(first)) return false;
  const t = first["type"];
  if (typeof t === "string") {
    if (EVENT_TYPES_HINT.has(t)) return true;
    if (t !== "player_match" && first["hero_id"] == null && first["heroId"] == null) {
      return players.length > 12;
    }
  }
  return false;
}

function looksLikeSlimPlayerRow(p: unknown): boolean {
  if (!isRecord(p)) return false;
  if (p["type"] === "interval" || p["type"] === "player_slot") return false;
  const hid = p["hero_id"];
  const ps = p["player_slot"];
  const heroOk =
    typeof hid === "number" ||
    (typeof hid === "string" &&
      hid.trim() !== "" &&
      Number.isFinite(Number(hid)));
  const slotOk =
    typeof ps === "number" ||
    (typeof ps === "string" &&
      ps.trim() !== "" &&
      Number.isFinite(Number(ps)));
  return heroOk || slotOk;
}

function extractPlayerMatchAndMatch(rows: Record<string, unknown>[]) {
  const matchPlayers = rows.filter((r) => r["type"] === "player_match");
  matchPlayers.sort((a, b) => numSlot(a) - numSlot(b));
  const matchInfo =
    rows.find((r) => r["type"] === "match") ?? null;
  return { matchPlayers, matchInfo };
}

function mergeMatchRowIntoRoot(
  out: Record<string, unknown>,
  matchInfo: Record<string, unknown> | null
): void {
  if (!matchInfo) return;
  const pairs: [string, keyof SlimMatchJson][] = [
    ["match_id", "match_id"],
    ["matchId", "match_id"],
    ["duration", "duration"],
    ["radiant_win", "radiant_win"],
    ["radiantWin", "radiant_win"],
    ["radiant_score", "radiant_score"],
    ["dire_score", "dire_score"],
    ["league_name", "league_name"],
    ["leagueid", "league_id"],
    ["league_id", "league_id"],
  ];
  for (const [a, b] of pairs) {
    const v = matchInfo[a];
    if (v !== undefined && v !== null && !(b in out)) {
      (out as Record<string, unknown>)[b] = v;
    }
  }
}

/**
 * 将 fetch 得到的任意 JSON 规范为可供 ``buildUiFromSlim`` 使用的 SlimMatchJson。
 */
export function purifyMatchJsonForSlim(input: unknown): SlimMatchJson {
  if (input === null || input === undefined) {
    return { players: [] };
  }

  if (Array.isArray(input)) {
    const rows = rowsFromStream(input);
    const { matchPlayers, matchInfo } = extractPlayerMatchAndMatch(rows);
    const out: Record<string, unknown> = {
      players: matchPlayers.map((p) => stripType(p)),
    };
    mergeMatchRowIntoRoot(out, matchInfo);
    if (!matchPlayers.length) {
      out._purification_note = "root array: no type=player_match rows found";
    } else {
      out._purification = "odota_raw_player_match";
    }
    return out as SlimMatchJson;
  }

  if (!isRecord(input)) {
    return { players: [] };
  }

  const raw = { ...input };
  const players = raw["players"];

  if (Array.isArray(players) && isEventStreamPollutedPlayers(players)) {
    const rows = rowsFromStream(players);
    const { matchPlayers, matchInfo } = extractPlayerMatchAndMatch(rows);
    raw["players"] = matchPlayers.map((p) => stripType(p));
    mergeMatchRowIntoRoot(raw, matchInfo);
    if (!matchPlayers.length) {
      raw._purification_note =
        "players field was event stream; no player_match rows";
    } else {
      raw._purification = "odota_raw_player_match";
    }
    return raw as SlimMatchJson;
  }

  // 已是正常 slim：10～15 名玩家且首行像结算对象
  if (
    Array.isArray(players) &&
    players.length > 0 &&
    players.length <= 15 &&
    looksLikeSlimPlayerRow(players[0])
  ) {
    return raw as SlimMatchJson;
  }

  const events = raw["events"];
  const pl = raw["players"];
  if (Array.isArray(events) && events.length > 100) {
    const needFromEvents =
      !Array.isArray(pl) ||
      pl.length === 0 ||
      (Array.isArray(pl) && isEventStreamPollutedPlayers(pl));
    if (needFromEvents) {
      const rows = rowsFromStream(events);
      const { matchPlayers, matchInfo } = extractPlayerMatchAndMatch(rows);
      if (matchPlayers.length > 0) {
        raw["players"] = matchPlayers.map((p) => stripType(p));
        mergeMatchRowIntoRoot(raw, matchInfo);
        raw._purification = "odota_events_to_player_match";
      }
    }
  }

  return raw as SlimMatchJson;
}
