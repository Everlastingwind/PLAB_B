"""
从 odota/parser 等产出的「巨型事件数组」中提纯比赛数据。

- 仅保留 ``type == "player_match"`` 的条目作为 ``players``（通常 10 条），按 ``player_slot`` 升序。
- 提取 ``type == "match"`` 的全局信息合并到根级（时长、胜负、比分、match_id 等）。
- 若 ``players`` 字段被误填成整条事件流（几十万条 interval 等），从该数组内做同样过滤。

与前端 ``purifyRawMatchJson.ts`` 逻辑保持一致。
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, MutableMapping, Optional, Tuple, Union

# 明显属于「事件流」而非 OpenDota 玩家结算对象的 type 样例
_EVENT_TYPES_HINT = frozenset(
    {
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
    }
)

PLAYER_MATCH = "player_match"
MATCH = "match"


def _num_slot(row: Mapping[str, Any]) -> int:
    try:
        return int(row.get("player_slot") or 0)
    except (TypeError, ValueError):
        return 0


def _strip_type(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    out.pop("type", None)
    return out


def _rows_from_stream(raw: Union[List[Any], Tuple[Any, ...]]) -> List[Dict[str, Any]]:
    return [x for x in raw if isinstance(x, dict)]


def is_event_stream_polluted_players(players: List[Any]) -> bool:
    """判断 ``players`` 是否被误设为整条 replay 事件数组。"""
    if len(players) > 24:
        return True
    if not players:
        return False
    first = players[0]
    if not isinstance(first, dict):
        return False
    t = first.get("type")
    if isinstance(t, str):
        if t in _EVENT_TYPES_HINT:
            return True
        if t != PLAYER_MATCH and (
            "hero_id" not in first and "heroId" not in first
        ):
            # 非玩家结算行且不像英雄数据
            return len(players) > 12
    return False


def extract_player_match_and_match(
    rows: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    match_players = [r for r in rows if r.get("type") == PLAYER_MATCH]
    match_players.sort(key=_num_slot)
    match_info: Optional[Dict[str, Any]] = None
    for r in rows:
        if r.get("type") == MATCH:
            match_info = r
            break
    return match_players, match_info


def merge_match_row_into_root(out: MutableMapping[str, Any], match_info: Optional[Mapping[str, Any]]) -> None:
    if not match_info:
        return
    mapping = [
        ("match_id", "match_id"),
        ("matchId", "match_id"),
        ("duration", "duration"),
        ("radiant_win", "radiant_win"),
        ("radiantWin", "radiant_win"),
        ("radiant_score", "radiant_score"),
        ("dire_score", "dire_score"),
        ("league_name", "league_name"),
    ]
    for a, b in mapping:
        if a in match_info and match_info.get(a) is not None and b not in out:
            out[b] = match_info[a]


def purify_raw_odota_payload(data: Any) -> Dict[str, Any]:
    """
    将根级数组、或 ``players``/``events`` 误填为事件流的结构，规范为单场比赛 dict。

    若无法提取 ``player_match``，则 ``players`` 置为空列表并写入 ``_purification_note``。
    """
    if isinstance(data, list):
        rows = _rows_from_stream(data)
        match_players, match_info = extract_player_match_and_match(rows)
        out: Dict[str, Any] = {
            "players": [_strip_type(dict(p)) for p in match_players],
        }
        merge_match_row_into_root(out, match_info)
        if not match_players:
            out["_purification_note"] = "root array: no type=player_match rows found"
        else:
            out["_purification"] = "odota_raw_player_match"
        return out

    if not isinstance(data, dict):
        return {}

    raw = dict(data)
    players = raw.get("players")

    # 误把事件流塞进 players
    if isinstance(players, list) and is_event_stream_polluted_players(players):
        rows = _rows_from_stream(players)
        match_players, match_info = extract_player_match_and_match(rows)
        raw["players"] = [_strip_type(dict(p)) for p in match_players]
        merge_match_row_into_root(raw, match_info)
        if not match_players:
            raw["_purification_note"] = "players field was event stream; no player_match rows"
        else:
            raw["_purification"] = "odota_raw_player_match"
        return raw

    # 仅有 events、players 缺失或为事件流时，从 events 提纯
    events = raw.get("events")
    pl = raw.get("players")
    if isinstance(events, list) and len(events) > 100:
        need_from_events = not isinstance(pl, list) or len(pl) == 0
        if not need_from_events and isinstance(pl, list):
            need_from_events = is_event_stream_polluted_players(pl)
        if need_from_events:
            rows = _rows_from_stream(events)
            match_players, match_info = extract_player_match_and_match(rows)
            if match_players:
                raw["players"] = [_strip_type(dict(p)) for p in match_players]
                merge_match_row_into_root(raw, match_info)
                raw["_purification"] = "odota_events_to_player_match"

    return raw


def normalize_match_input_for_translate(data: Any) -> Dict[str, Any]:
    """供 ``translate_match_data`` 入口调用：统一为 dict 并提纯玩家列表。"""
    if isinstance(data, list):
        return purify_raw_odota_payload(data)
    if isinstance(data, dict):
        return purify_raw_odota_payload(data)
    return {}
