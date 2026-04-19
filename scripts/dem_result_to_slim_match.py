"""
将 dota_parser_test 本地解析器输出的 result.json 转为 latest_match.json。
使用 dotaconstants（items/heroes/abilities/ability_ids/item_ids/hero_abilities）做 ID→CDN/文案映射；
中立物品 neutral_img、25 步 skill_build、职业选手 pro_name（可选联网拉取 pro 名单缓存）。

**方式 A**：根对象为事件列表 + 每名玩家 ability_upgrades_arr（与 slot 0..9 对齐）：
  {
    "events": [ ... ],
    "players": [
      { "ability_upgrades_arr": [ 5372, 5375, ... ] },
      ... 共 10 个元素，可与 slot / player_slot 字段匹配 ...
    ],
    "player_resource": [
      {
        "player_id": 0,
        "team": 2,
        "hero_id": 39,
        "player_name": "Yatoro",
        "steam_id": 765611980...,
        "account_id": 321580662,
        "player_slot": 128,
        "is_radiant": false
      },
      ...
    ]
  }

``player_resource``（或 ``player_resource_snapshot``）来自 Go ``replayparser`` 对
``CDOTA_PlayerResource`` 的快照（``m_vecPlayerData.*.m_iPlayerTeam`` / ``m_iszPlayerName`` /
``m_iPlayerSteamID`` + ``m_vecPlayerTeamData.*.m_nSelectedHeroID``）。存在时**优先**据此
校正 ``player_slot`` / 阵营 / 昵称 / Steam，不再用「interval 下标 <5 即天辉」推断。

**方式 B（原始事件流）**：无 ability_upgrades_arr 时，从 events 中扫描加点事件
（type / msg 含 ability_upgrade、DotaAbilityUpgrade 等，见 utils.dota_pipeline.try_parse_ability_upgrade_event），
按玩家与时间拼装 ability_id 列表，再经 dotaconstants 生成 25 步 skill_build；仍无匹配时回退为战斗日志近似。

可选 talent_picks（解析器直接给出的天赋树选择，与客户端 10/15/20/25 四档左右一致）：
  { "talent_id": 24, "level": 10, "direction": "left", "talent_name": "+8.00 力量" }
  每名玩家可含数组： "talent_picks": [ { ... }, ... ]

仅事件数组时，可用 --players 从另一 JSON 合并加点 ID（见下方）。

用法（项目根 PLAB_B）:
  python scripts/dem_result_to_slim_match.py e:\\dota_parser_test\\result.json
  python scripts/dem_result_to_slim_match.py events_only.json --players players_addon.json

从 OpenDota 合并本局加点与天赋（需网络；match_id 须与录像一致，通常来自 epilogue）:
  python scripts/dem_result_to_slim_match.py result.json --merge-opendota
  python scripts/dem_result_to_slim_match.py result.json --merge-opendota --opendota-match-id 8764477088

本地装备补丁（无 OpenDota）：从 parser JSON 导出可手改的 item_0..5，再合并
  python scripts/build_local_inventory_overlay.py parser_result.json -o overlay.json
  python scripts/dem_result_to_slim_match.py parser_result.json --inventory-overlay overlay.json -o slim.json
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Mapping, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.dota_mapping import (  # noqa: E402
    get_constants,
    logical_player_slot,
    merge_ability_upgrade_step_lists,
    translate_match_data,
)
from utils.dota_two_step import apply_two_step_to_player  # noqa: E402
from utils.dota_pipeline import (  # noqa: E402
    ability_upgrade_merged_steps_from_raw_events,
    build_talent_tree,
    filter_merged_steps_for_client_skill_bar,
    get_cdn_neutral_img,
    infer_talent_picks_from_hero_abilities_indices,
    load_hero_abilities_map,
    load_or_fetch_pro_players,
    match_pro_player,
    merge_talent_pick_lists,
    merge_talent_tree_from_parser_picks,
    normalize_dem_neutral_key,
    raw_ability_upgrades_arr_to_merged_steps,
    skill_build_from_dem_ability_combat,
    skill_build_v2_from_merged_upgrades,
    steam64_to_account_id,
    talent_keys_guessed_from_combat_log,
    talent_signal_steps_from_interval_networth,
)

OUT_DEFAULT = ROOT / "opendota-match-ui" / "public" / "data" / "latest_match.json"


def _parse_players_addon(data: Any) -> List[Dict[str, Any]]:
    """支持 { \"players\": [...] } 或直接为非空对象数组。"""
    if isinstance(data, list):
        return [p for p in data if isinstance(p, dict)]
    if isinstance(data, dict):
        pl = data.get("players")
        if isinstance(pl, list):
            return [p for p in pl if isinstance(p, dict)]
    return []


def _fetch_opendota_match_json(match_id: int) -> Tuple[Optional[Dict[str, Any]], str]:
    """OpenDota /matches/{id} 原始 JSON（含 ability_upgrades / ability_upgrades_arr）。"""
    url = f"https://api.opendota.com/api/matches/{int(match_id)}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "plab-dota/dem_result_to_slim_match (+OpenDota)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8")), "ok"
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return None, str(e)[:200]


def _merge_opendota_damage_stats_into_player(dest: Dict[str, Any], src: Dict[str, Any]) -> None:
    """
    用 OpenDota（Steam Web API / GC 汇总）写入与客户端计分板一致的数值。

    DEM 里对 ``DOTA_COMBATLOG_DAMAGE`` 按 attacker/target 名含 ``npc_dota_hero_`` 累加，
    常与客户端「对英雄伤害」不一致（幻象、多段结算、单位名边界等），故在能拉到 OpenDota
    本场数据时以 ``players[].hero_damage`` 等字段为准覆盖。
    """
    for key in ("hero_damage", "tower_damage", "hero_healing"):
        if key not in src:
            continue
        val = src.get(key)
        if val is None:
            continue
        try:
            dest[key] = int(val)
        except (TypeError, ValueError):
            continue


def merge_skill_and_talent_from_opendota(
    slim: Dict[str, Any],
    match_id: int,
) -> Tuple[bool, str]:
    """
    用 OpenDota 同场对局数据覆盖每名玩家的 skill_build、talent_tree、ability_timeline、talents_taken，
    以及「身上 6 格 + 中立」装备（items_slot / neutral_img / neutral_item_key，不读背包），
    并写入与客户端计分板同源的 hero_damage / tower_damage / hero_healing。
    以补全录像里缺失的 ability_upgrades（天赋高亮依赖此项）。
    """
    raw, fetch_err = _fetch_opendota_match_json(match_id)
    if not raw:
        return False, fetch_err or "empty response"
    if not isinstance(raw.get("players"), list):
        return False, "no players in API response"
    od_slim = translate_match_data(raw)
    od_players = od_slim.get("players") or []
    by_slot: Dict[int, Dict[str, Any]] = {}
    for p in od_players:
        if not isinstance(p, dict):
            continue
        ps = p.get("player_slot")
        if ps is None:
            continue
        try:
            by_slot[int(ps)] = p
        except (TypeError, ValueError):
            continue
    n = 0
    for p in slim.get("players") or []:
        if not isinstance(p, dict):
            continue
        ps = p.get("player_slot")
        if ps is None:
            continue
        try:
            src = by_slot.get(int(ps))
        except (TypeError, ValueError):
            continue
        if not src:
            continue
        for key in (
            "skill_build",
            "talent_tree",
            "talent_picks",
            "ability_timeline",
            "talents_taken",
            "items_slot",
            "neutral_img",
            "neutral_item_key",
            # OpenDota 原生：神杖/魔晶（消耗后不在物品栏，依赖 API + permanent_buffs）
            "aghanims_scepter",
            "aghanims_shard",
            "permanent_buffs",
        ):
            if key in src:
                p[key] = src[key]
        _merge_opendota_damage_stats_into_player(p, src)
        n += 1
    meta = slim.setdefault("_meta", {})
    meta["skill_talent_source"] = f"opendota_api_match_{match_id}"
    meta["skill_talent_merged_players"] = n
    return (n > 0, "ok" if n else "no slot matched")


def merge_endgame_inventory_from_api_players(
    slim: Dict[str, Any],
    api_players: List[Dict[str, Any]],
    *,
    duration: Optional[int] = None,
    source_meta: str = "opendota_api_players",
) -> Tuple[bool, str]:
    """
    用 OpenDota 风格的 ``players[]``（含 item_0..item_5、item_neutral 等）经 translate_match_data
    后，把**结算装备相关字段**以及 **hero_damage / tower_damage / hero_healing**（与客户端计分板
    同源）合并进已生成的 slim（不动 skill_build / talent）。
    """
    if not api_players:
        return False, "empty api_players"
    try:
        di = int(duration) if duration is not None else int(slim.get("duration") or 0)
    except (TypeError, ValueError):
        di = 0
    od_slim = translate_match_data({"players": api_players, "duration": di})
    od_players = od_slim.get("players") or []
    by_slot: Dict[int, Dict[str, Any]] = {}
    for p in od_players:
        if not isinstance(p, dict):
            continue
        ps = p.get("player_slot")
        if ps is None:
            continue
        try:
            by_slot[int(ps)] = p
        except (TypeError, ValueError):
            continue
    n = 0
    for p in slim.get("players") or []:
        if not isinstance(p, dict):
            continue
        ps = p.get("player_slot")
        if ps is None:
            continue
        try:
            src = by_slot.get(int(ps))
        except (TypeError, ValueError):
            continue
        if not src:
            continue
        for key in (
            "items_slot",
            "neutral_img",
            "neutral_item_key",
            "aghanims_scepter",
            "aghanims_shard",
            "permanent_buffs",
        ):
            if key in src:
                p[key] = src[key]
        _merge_opendota_damage_stats_into_player(p, src)
        n += 1
    meta = slim.setdefault("_meta", {})
    meta["endgame_items_source"] = source_meta
    meta["endgame_items_merged_players"] = n
    return (n > 0, "ok" if n else "no slot matched")


def merge_endgame_inventory_from_opendota(
    slim: Dict[str, Any],
    match_id: int,
) -> Tuple[bool, str]:
    """
    仅从 OpenDota 同场对局合并**结算栏装备**（与客户端终局 HUD 一致，含空槽与中立项）及
    **对英雄/建筑伤害、治疗**（与客户端计分板同源），不覆盖 skill_build / talent_tree /
    ability 时间线（仍用本地 DEM 推断）。
    """
    raw, fetch_err = _fetch_opendota_match_json(match_id)
    if not raw:
        return False, fetch_err or "empty response"
    if not isinstance(raw.get("players"), list):
        return False, "no players in API response"
    return merge_endgame_inventory_from_api_players(
        slim,
        raw["players"],
        duration=raw.get("duration"),
        source_meta=f"opendota_api_match_{match_id}",
    )


def merge_endgame_inventory_from_overlay_file(
    slim: Dict[str, Any],
    overlay_path: Path,
) -> Tuple[bool, str]:
    """
    读取 ``export_endgame_inventory_overlay.py`` 生成的小 JSON，合并终局装备。
    """
    try:
        data = json.loads(overlay_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return False, str(e)[:200]
    pl = data.get("players")
    if not isinstance(pl, list) or not pl:
        return False, "overlay JSON 缺少非空 players 数组"
    src = str(data.get("source") or "inventory_overlay_file")
    mid = data.get("match_id")
    label = f"{src}:{overlay_path.name}"
    if mid is not None:
        label = f"{src}:match_{mid}"
    return merge_endgame_inventory_from_api_players(
        slim,
        pl,
        duration=data.get("duration"),
        source_meta=label,
    )


def _merge_player_blobs(
    base: Optional[List[Dict[str, Any]]],
    addon: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """同一下标合并字段；addon 覆盖同名键（用于用 --players 覆盖 ability_upgrades_arr）。"""
    if not base:
        return list(addon)
    n = max(len(base), len(addon))
    out: List[Dict[str, Any]] = []
    for i in range(n):
        left = dict(base[i]) if i < len(base) else {}
        right = dict(addon[i]) if i < len(addon) else {}
        merged = {**left, **right}
        out.append(merged)
    return out


def _decode_byte_array(m: str) -> str:
    try:
        parts = []
        for x in m.split(","):
            x = x.strip()
            if not x or not x.lstrip("-").isdigit():
                continue
            v = int(x)
            parts.append(v if v >= 0 else (v + 256) % 256)
        return bytes(parts).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _epilogue_player_names(events: List[dict]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for e in reversed(events):
        if e.get("type") != "epilogue":
            continue
        k = e.get("key") or ""
        for hm, pm in re.findall(
            r'heroName_\":\{\"bytes\":\[([^\]]+)\].*?playerName_\":\{\"bytes\":\[([^\]]+)\]',
            k,
            flags=re.DOTALL,
        ):
            hn = _decode_byte_array(hm)
            pn = _decode_byte_array(pm)
            if hn and pn:
                out[hn] = pn
        break
    return out


def _epilogue_steam_account_by_hero(events: List[dict]) -> Dict[str, int]:
    """npc_dota_hero_* -> 32 位 account_id"""
    out: Dict[str, int] = {}
    for e in reversed(events):
        if e.get("type") != "epilogue":
            continue
        k = e.get("key") or ""
        for hm, sm in re.findall(
            r'heroName_\":\{\"bytes\":\[([^\]]+)\].*?steamid_\":(\d+)',
            k,
            flags=re.DOTALL,
        ):
            hn = _decode_byte_array(hm)
            try:
                sid = int(sm)
            except ValueError:
                continue
            if hn.startswith("npc_dota_hero_"):
                out[hn] = steam64_to_account_id(sid)
        break
    return out


def _epilogue_meta(events: List[dict]) -> Tuple[Optional[int], Optional[int], Optional[str]]:
    for e in reversed(events):
        if e.get("type") != "epilogue":
            continue
        k = e.get("key") or ""
        mid = re.search(r'matchId_\":(\d+)', k)
        gw = re.search(r'gameWinner_\":(\d+)', k)
        return (
            int(mid.group(1)) if mid else None,
            int(gw.group(1)) if gw else None,
            k[:200] if k else None,
        )
    return None, None, None


def _match_end_time_sec(events: List[dict]) -> int:
    """
    以比赛结算时刻作为终局时间：
    - 优先取带时间戳事件里的最大非负 time（战斗阶段）；
    - 忽略 epilogue/cosmetics/dotaplus 等赛后块（常见负时间占位）。
    """
    end_t = 0
    for e in events:
        t = e.get("time")
        if not isinstance(t, (int, float)):
            continue
        ti = int(t)
        if ti < 0:
            continue
        tp = str(e.get("type") or "")
        if tp in {"epilogue", "cosmetics", "dotaplus"}:
            continue
        if ti > end_t:
            end_t = ti
    return end_t


def _dig_player_info_array(obj: Any) -> Optional[List[Any]]:
    """从 epilogue JSON 中递归找到 playerInfo_ / playerInfo 数组。"""
    if isinstance(obj, dict):
        for k in ("playerInfo_", "playerInfo"):
            v = obj.get(k)
            if isinstance(v, list) and len(v) >= 1:
                return v
        for vv in obj.values():
            r = _dig_player_info_array(vv)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for item in obj:
            r = _dig_player_info_array(item)
            if r is not None:
                return r
    return None


def _hero_npc_from_epilogue_name_field(hn_field: Any) -> str:
    """protobuf JSON heroName_：{\"bytes\":[...]} → npc_dota_hero_xxx 字符串"""
    if hn_field is None:
        return ""
    if isinstance(hn_field, str):
        s = hn_field.strip()
        if s.startswith("npc_dota_hero_"):
            return s
        return f"npc_dota_hero_{s}" if s else ""
    if isinstance(hn_field, dict):
        b = hn_field.get("bytes")
        if isinstance(b, list):
            try:
                bb = bytes(int(x) % 256 for x in b)
                return bb.decode("utf-8", errors="replace").strip()
            except (ValueError, OverflowError):
                return ""
    return ""


def _parse_epilogue_team_by_hero(events: List[dict]) -> Optional[Dict[str, bool]]:
    """
    epilogue.playerInfo[]：每名英雄 npc 全名 -> 是否天辉。
    gameTeam_ 与 gameWinner_ 一致：2=Radiant，3=Dire。
    """
    for e in reversed(events):
        if e.get("type") != "epilogue":
            continue
        raw = e.get("key")
        if not isinstance(raw, str):
            continue
        try:
            root = json.loads(raw)
        except json.JSONDecodeError:
            continue
        plist = _dig_player_info_array(root)
        if not plist:
            continue
        out: Dict[str, bool] = {}
        for pi in plist:
            if not isinstance(pi, dict):
                continue
            hn_field = pi.get("heroName_") or pi.get("heroName")
            name_s = _hero_npc_from_epilogue_name_field(hn_field)
            gt = pi.get("gameTeam_")
            if gt is None:
                gt = pi.get("gameTeam")
            if not name_s or gt is None:
                continue
            try:
                gti = int(gt)
            except (TypeError, ValueError):
                continue
            out[name_s] = gti == 2
        if len(out) >= 8:
            return out
    return None


def _assign_player_slots_from_epilogue_teams(
    interval_players: Dict[int, Dict[str, Any]],
    slot_hero: Dict[int, Tuple[int, str]],
    team_by_hero: Optional[Dict[str, bool]],
    events: Optional[List[dict]] = None,
) -> List[Dict[str, Any]]:
    """
    interval 下标 0..9 与真实阵营无关；用 epilogue 的阵营将 10 人重排为
    player_slot 0-4（天辉）与 128-132（夜魇），顺序按原 interval 下标稳定排序。

    若无足够 epilogue 阵营信息，优先使用 events 里的 ``player_slot`` 映射（replay 原生
    player_slot），**不再**用「interval 下标 <5 即天辉」推断（易与真实阵营错位）。
    """
    if not interval_players:
        return []
    if not team_by_hero or len(team_by_hero) < 8:
        slot_to_ps = _slot_to_player_slot_from_events(events or [])
        out: List[Dict[str, Any]] = []
        for slot in sorted(interval_players.keys()):
            row = interval_players[slot]
            ps = slot_to_ps.get(slot)
            if ps is not None:
                row["player_slot"] = int(ps)
                row["isRadiant"] = _is_radiant_player_slot(int(ps))
            elif slot_to_ps:
                # 有映射表但本槽位缺项：不再用 interval 下标冒充阵营
                row["player_slot"] = int(slot)
                row["isRadiant"] = False
            else:
                # 无任何 player_slot 事件时的最后回退（旧行为）
                row["player_slot"] = 128 + (slot - 5) if slot >= 5 else slot
                row["isRadiant"] = slot < 5
            out.append(row)
        return out

    slot_to_ps_ep = _slot_to_player_slot_from_events(events or [])
    radiant: List[Tuple[int, Dict[str, Any]]] = []
    dire: List[Tuple[int, Dict[str, Any]]] = []
    for slot in sorted(interval_players.keys()):
        row = interval_players[slot]
        _, unit = slot_hero[slot]
        hi = _hero_internal_from_unit(unit)
        hnpc = f"npc_dota_hero_{hi}"
        is_rad = team_by_hero.get(hnpc) if hnpc else None
        if is_rad is None:
            ps = slot_to_ps_ep.get(slot)
            if ps is not None:
                is_rad = _is_radiant_player_slot(int(ps))
            else:
                is_rad = slot < 5
        (radiant if is_rad else dire).append((slot, row))

    radiant.sort(key=lambda x: x[0])
    dire.sort(key=lambda x: x[0])

    merged: List[Dict[str, Any]] = []
    for idx, (_, row) in enumerate(radiant):
        row["player_slot"] = idx
        row["isRadiant"] = True
        merged.append(row)
    for idx, (_, row) in enumerate(dire):
        row["player_slot"] = 128 + idx
        row["isRadiant"] = False
        merged.append(row)
    merged.sort(key=lambda r: int(r.get("player_slot") or 0))
    return merged


def _parse_player_resource_blob(data: Any) -> Optional[List[Dict[str, Any]]]:
    """
    接受 ``player_resource`` / ``player_resource_snapshot``：
    数组项含 player_id, team(2/3), hero_id, player_name, steam_id 或 account_id；
    或由 Go ``replayparser.PlayerResourceSnapshotJSON()`` 写入的等价结构。
    """
    if data is None:
        return None
    if isinstance(data, dict):
        inner = data.get("players") or data.get("rows")
        if isinstance(inner, list):
            data = inner
        else:
            return None
    if not isinstance(data, list) or len(data) < 8:
        return None
    rows = [x for x in data if isinstance(x, dict)]
    return rows if len(rows) >= 8 else None


def _canonical_player_resource_rows(
    pr_rows: List[Dict[str, Any]],
) -> Optional[List[Dict[str, Any]]]:
    """按 m_iPlayerTeam 分队，队内按 player_id 排序，写入规范 player_slot / is_radiant。"""
    norm: List[Dict[str, Any]] = []
    for x in pr_rows:
        try:
            team = int(x.get("team") or 0)
        except (TypeError, ValueError):
            continue
        if team not in (2, 3):
            continue
        try:
            hid = int(x.get("hero_id") or 0)
        except (TypeError, ValueError):
            continue
        if hid <= 0:
            continue
        try:
            pid = int(x.get("player_id") if x.get("player_id") is not None else -1)
        except (TypeError, ValueError):
            pid = -1
        name = str(x.get("player_name") or x.get("name") or "").strip()
        row = {
            "player_id": pid,
            "team": team,
            "hero_id": hid,
            "player_name": name,
        }
        if x.get("account_id") is not None:
            try:
                row["account_id"] = int(x["account_id"])
            except (TypeError, ValueError):
                pass
        if x.get("steam_id") is not None:
            try:
                row["steam_id"] = int(x["steam_id"])
            except (TypeError, ValueError):
                pass
        if "player_slot" in x and x.get("player_slot") is not None:
            try:
                row["player_slot"] = int(x["player_slot"])
            except (TypeError, ValueError):
                pass
        if "is_radiant" in x or "isRadiant" in x:
            v = x.get("is_radiant", x.get("isRadiant"))
            row["is_radiant"] = bool(v)
        norm.append(row)
    if len(norm) < 8:
        return None
    # 已带规范 player_slot 时（如 Go 导出）只做校验与排序
    if all("player_slot" in r for r in norm) and len(norm) >= 8:
        norm.sort(key=lambda r: int(r.get("player_slot") or 0))
        return norm
    rad = [r for r in norm if int(r["team"]) == 2]
    dire = [r for r in norm if int(r["team"]) == 3]
    rad.sort(key=lambda r: int(r.get("player_id") or 0))
    dire.sort(key=lambda r: int(r.get("player_id") or 0))
    out: List[Dict[str, Any]] = []
    for i, r in enumerate(rad):
        o = dict(r)
        o["player_slot"] = i
        o["is_radiant"] = True
        out.append(o)
    for i, r in enumerate(dire):
        o = dict(r)
        o["player_slot"] = 128 + i
        o["is_radiant"] = False
        out.append(o)
    out.sort(key=lambda r: int(r.get("player_slot") or 0))
    return out


_STEAM64_BASE = 76561197960265728


def _account_id_from_pr_steam_or_account(
    steam_id: Any, account_id: Any
) -> Optional[int]:
    if account_id is not None:
        try:
            a = int(account_id)
            return a if a > 0 else None
        except (TypeError, ValueError):
            pass
    if steam_id is None:
        return None
    try:
        sid = int(steam_id)
    except (TypeError, ValueError):
        return None
    if sid <= 0:
        return None
    if sid > _STEAM64_BASE:
        return int(sid - _STEAM64_BASE)
    return sid


def _interval_slot_is_radiant_from_player_resource(
    slot_hero: Dict[int, Tuple[int, str]],
    pr_rows: List[Dict[str, Any]],
) -> Optional[Dict[int, bool]]:
    canon = _canonical_player_resource_rows(pr_rows)
    if not canon:
        return None
    out: Dict[int, bool] = {}
    used: Set[int] = set()
    for pr in canon:
        hid = int(pr.get("hero_id") or 0)
        cand = [
            s
            for s, pair in slot_hero.items()
            if int(pair[0]) == hid and s not in used
        ]
        if not cand:
            return None
        sl = min(cand)
        used.add(sl)
        out[sl] = bool(pr.get("is_radiant", pr.get("isRadiant", pr.get("team") == 2)))
    return out if len(out) >= 8 else None


def _assign_players_from_player_resource(
    interval_players: Dict[int, Dict[str, Any]],
    slot_hero: Dict[int, Tuple[int, str]],
    pr_rows: List[Dict[str, Any]],
    pro_rows: Any,
) -> Optional[List[Dict[str, Any]]]:
    """
    仅依赖 PlayerResource 的 team / hero / 名字 / Steam，与 interval 英雄 id 对齐后输出 10 人。
    """
    canon = _canonical_player_resource_rows(pr_rows)
    need = len(slot_hero)
    if not canon:
        return None
    hero_ids_in_match = {int(pair[0]) for pair in slot_hero.values()}
    canon = [r for r in canon if int(r.get("hero_id") or 0) in hero_ids_in_match]
    if len(canon) < need:
        return None
    used: Set[int] = set()
    merged_rows: List[Dict[str, Any]] = []
    for pr in canon:
        hid = int(pr.get("hero_id") or 0)
        cand = [
            s
            for s, pair in slot_hero.items()
            if int(pair[0]) == hid and s not in used
        ]
        if not cand:
            return None
        sl = min(cand)
        used.add(sl)
        base = copy.deepcopy(interval_players[sl])
        nm = str(pr.get("player_name") or "").strip()
        if nm:
            base["personaname"] = nm
            base["name"] = nm
        acc = _account_id_from_pr_steam_or_account(
            pr.get("steam_id"), pr.get("account_id")
        )
        if acc is not None:
            base["account_id"] = acc
            pn, tn = match_pro_player(acc, pro_rows)
            base["pro_name"] = pn
            base["team_name"] = tn
        ps = int(pr.get("player_slot") or 0)
        base["player_slot"] = ps
        base["isRadiant"] = bool(pr.get("is_radiant", pr.get("isRadiant")))
        merged_rows.append(base)
    merged_rows.sort(key=lambda r: int(r.get("player_slot") or 0))
    return merged_rows if len(merged_rows) == need else None


def _slot_hero_from_intervals(events: List[dict]) -> Dict[int, Tuple[int, str]]:
    out: Dict[int, Tuple[int, str]] = {}
    for e in events:
        if e.get("type") != "interval" or "unit" not in e:
            continue
        sl = e.get("slot")
        if sl is None or sl in out:
            continue
        hid = int(e.get("hero_id") or 0)
        unit = str(e.get("unit") or "")
        out[int(sl)] = (hid, unit)
    return out


def _last_intervals(events: List[dict]) -> Dict[int, dict]:
    last: Dict[int, dict] = {}
    for e in events:
        if e.get("type") != "interval" or "slot" not in e:
            continue
        last[int(e["slot"])] = e
    return last


def _hero_internal_from_unit(unit: str) -> str:
    """
    CDOTA_Unit_Hero_* → dotaconstants 风格 npc 名后缀（小写 snake_case）。

    Valve 类名里既有 ``ChaosKnight`` 连体，也有 ``Shadow_Demon`` / ``Primal_Beast``
    用下划线分词。若整串按驼峰切分，会在已有 ``_`` 前再插 ``_``，得到
    ``shadow__demon``，与战斗日志 / 购买的 ``npc_dota_hero_shadow_demon`` 不一致，
    导致伤害、装备、技能近似全部落空。
    """
    u = unit.replace("CDOTA_Unit_Hero_", "").strip()
    if not u:
        return ""

    def _camel_token_to_snake(token: str) -> str:
        s: List[str] = []
        for i, c in enumerate(token):
            if c.isupper() and i > 0:
                s.append("_")
            s.append(c.lower())
        return "".join(s)

    parts = [p for p in u.split("_") if p]
    if not parts:
        return ""
    return "_".join(_camel_token_to_snake(p) for p in parts)


def _aggregate_combat(events: List[dict]) -> Dict[str, Dict[str, float]]:
    """
    英雄对英雄伤害：与客户端计分板「造成伤害 - 英雄」对齐的近似规则。

    录像 ``DOTA_COMBATLOG_DAMAGE`` 若仅按双方均为 ``npc_dota_hero_*`` 累加，会把 **臂章等自伤**
    以及 **对敌方英雄幻象** 的伤害算进去，常见如混沌骑士约为真实读数的两倍。故排除：

    - ``attackername == targetname``（对自身的伤害）；
    - ``targetillusion is True``（目标为幻象单位；攻击者可为真身或幻象，仍记在英雄名上）。

    少数英雄在部分对局上可能与客户端仍有小偏差（幻象标记边界），无 OpenDota 时属已知限制。
    """
    dmg_hero = defaultdict(float)
    dmg_tower = defaultdict(float)
    heal = defaultdict(float)
    tower_keywords = ("tower", "fort", "building", "rax", "ancient")

    for e in events:
        t = e.get("type")
        if t == "DOTA_COMBATLOG_DAMAGE":
            val = float(e.get("value") or 0)
            att = e.get("attackername") or ""
            tar = e.get("targetname") or ""
            if "npc_dota_hero_" in att:
                if "npc_dota_hero_" in tar:
                    if att == tar:
                        continue
                    if e.get("targetillusion"):
                        continue
                    dmg_hero[att] += val
                elif any(x in tar for x in tower_keywords):
                    dmg_tower[att] += val
        elif t == "DOTA_COMBATLOG_HEAL":
            val = float(e.get("value") or 0)
            att = e.get("attackername") or ""
            if "npc_dota_hero_" in att:
                heal[att] += val
    return {
        "hero": dict(dmg_hero),
        "tower": dict(dmg_tower),
        "heal": dict(heal),
    }


def _slot_to_player_slot_from_events(events: List[dict]) -> Dict[int, int]:
    out: Dict[int, int] = {}
    for e in events:
        if e.get("type") != "player_slot":
            continue
        try:
            slot = int(e.get("key"))
            ps = int(e.get("value"))
        except (TypeError, ValueError):
            continue
        out[slot] = ps
    return out


def _is_radiant_player_slot(ps: int) -> bool:
    if 0 <= ps <= 4:
        return True
    if 128 <= ps <= 132:
        return False
    if 5 <= ps <= 9:
        return False
    return ps < 5


def _lane_by_xy(x: float, y: float, lane_delta: float) -> str:
    d = float(x) - float(y)
    if d > lane_delta:
        return "bot"
    if d < -lane_delta:
        return "top"
    return "mid"


_SUPPORT_UTILITY_ITEM_WEIGHTS = {
    "ward_observer": 3,
    "ward_sentry": 4,
    "dust": 3,
    "smoke_of_deceit": 3,
    "gem": 5,
    "ward_dispenser": 2,
}


def _support_item_signal_by_slot(
    events: List[dict],
    slot_to_hero_npc: Dict[int, str],
    dc: Any,
    *,
    start_sec: int = -120,
    end_sec: int = 600,
) -> Tuple[Dict[int, int], Dict[int, List[Dict[str, Any]]]]:
    score_by_slot: Dict[int, int] = {s: 0 for s in slot_to_hero_npc}
    items_by_slot: Dict[int, Dict[str, int]] = {s: {} for s in slot_to_hero_npc}
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_PURCHASE":
            continue
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            continue
        if t < start_sec or t > end_sec:
            continue
        tgt = str(e.get("targetname") or "")
        slot_match: Optional[int] = None
        for s, hn in slot_to_hero_npc.items():
            if _targetname_matches_hero_npc(tgt, hn):
                slot_match = int(s)
                break
        if slot_match is None:
            continue
        key = _item_key_from_valuename(str(e.get("valuename") or ""))
        if not key:
            continue
        rk = (dc.resolve_items_json_key(key) or key).strip()
        w = int(_SUPPORT_UTILITY_ITEM_WEIGHTS.get(rk) or 0)
        if w <= 0:
            continue
        score_by_slot[slot_match] = int(score_by_slot.get(slot_match) or 0) + w
        cnts = items_by_slot.setdefault(slot_match, {})
        cnts[rk] = int(cnts.get(rk) or 0) + 1
    items_out: Dict[int, List[Dict[str, Any]]] = {}
    for s, cnts in items_by_slot.items():
        rows: List[Dict[str, Any]] = []
        for k, c in sorted(cnts.items(), key=lambda kv: kv[0]):
            rows.append({"item_key": k, "count": int(c)})
        items_out[int(s)] = rows
    return score_by_slot, items_out


def _assign_early_roles_for_team(
    rows: List[Dict[str, Any]],
    *,
    is_radiant: bool,
) -> Dict[int, str]:
    """
    将同一阵营玩家（前 5 分钟 lane 已判定）映射到专业位置术语：
    carry / mid / offlane / support(4) / support(5)。
    """
    role_by_slot: Dict[int, str] = {}
    if not rows:
        return role_by_slot

    safe_lane = "bot" if is_radiant else "top"
    off_lane = "top" if is_radiant else "bot"

    def _sort_key(x: Dict[str, Any]) -> Tuple[float, int]:
        nw = float(x.get("lane_phase_networth") or 0.0)
        return (-nw, int(x.get("slot") or 0))

    def _support_key(x: Dict[str, Any]) -> Tuple[int, float, int]:
        sp = int(x.get("support_item_points_early") or 0)
        nw = float(x.get("lane_phase_networth") or 0.0)
        return (-sp, nw, int(x.get("slot") or 0))

    mids = sorted([x for x in rows if x.get("lane_early") == "mid"], key=_sort_key)
    safe = sorted([x for x in rows if x.get("lane_early") == safe_lane], key=_sort_key)
    off = sorted([x for x in rows if x.get("lane_early") == off_lane], key=_sort_key)

    if mids:
        role_by_slot[int(mids[0]["slot"])] = "mid"
    if safe:
        role_by_slot[int(safe[0]["slot"])] = "carry"
        safe_supports = sorted(safe[1:], key=_support_key)
        if safe_supports:
            role_by_slot[int(safe_supports[0]["slot"])] = "support(5)"
            for x in safe_supports[1:]:
                role_by_slot[int(x["slot"])] = "support(4)"
    if off:
        role_by_slot[int(off[0]["slot"])] = "offlane"
        off_supports = sorted(off[1:], key=_support_key)
        if off_supports:
            role_by_slot[int(off_supports[0]["slot"])] = "support(4)"
            for x in off_supports[1:]:
                role_by_slot[int(x["slot"])] = "support(5)"

    rest = sorted(
        [x for x in rows if int(x.get("slot") or 0) not in role_by_slot], key=_sort_key
    )
    desired_order = ["carry", "mid", "offlane", "support(4)", "support(5)"]
    missing = [r for r in desired_order if r not in set(role_by_slot.values())]
    for i, x in enumerate(rest):
        role_by_slot[int(x["slot"])] = missing[i] if i < len(missing) else "support(4)"
    return role_by_slot


def _infer_lane_and_role_by_slot(
    events: List[dict],
    dc: Any,
    *,
    lane_phase_sec: int = 300,
    lane_delta: float = 20.0,
    interval_slot_is_radiant: Optional[Dict[int, bool]] = None,
) -> Dict[int, Dict[str, Any]]:
    """
    仅基于 interval 坐标推断对线期分路与位置（前 5 分钟）：
    - lane_early: top/mid/bot
    - role_early: carry/mid/offlane/support(4)/support(5)

    ``interval_slot_is_radiant``：由 CDOTA_PlayerResource 解析得到的 interval 槽 → 是否天辉，
    有则**优先**于此，避免用「interval 下标 <5」推断阵营。
    """
    slot_to_ps = _slot_to_player_slot_from_events(events)
    points_by_slot: Dict[int, List[Tuple[float, float]]] = {}
    nw_by_slot: Dict[int, Tuple[float, float]] = {}  # slot -> (time, networth)
    slot_to_hero_npc: Dict[int, str] = {}

    for e in events:
        if e.get("type") != "interval":
            continue
        t = e.get("time")
        if not isinstance(t, (int, float)):
            continue
        if t < 0 or t > lane_phase_sec:
            continue
        slot = e.get("slot")
        x = e.get("x")
        y = e.get("y")
        if not isinstance(slot, int):
            continue
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            continue
        points_by_slot.setdefault(slot, []).append((float(x), float(y)))
        unit = str(e.get("unit") or "").strip()
        if unit.startswith("CDOTA_Unit_Hero_"):
            hi = _hero_internal_from_unit(unit)
            if hi:
                slot_to_hero_npc[int(slot)] = f"npc_dota_hero_{hi}"
        nw = e.get("networth")
        if isinstance(nw, (int, float)):
            prev = nw_by_slot.get(slot)
            if prev is None or float(t) >= prev[0]:
                nw_by_slot[slot] = (float(t), float(nw))

    support_score_by_slot, support_items_by_slot = _support_item_signal_by_slot(
        events,
        slot_to_hero_npc,
        dc,
    )

    base_rows: List[Dict[str, Any]] = []
    for slot, pts in points_by_slot.items():
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        mx = float(median(xs))
        my = float(median(ys))
        ps = slot_to_ps.get(slot)
        if (
            interval_slot_is_radiant is not None
            and int(slot) in interval_slot_is_radiant
        ):
            is_rad = bool(interval_slot_is_radiant[int(slot)])
        elif ps is not None:
            is_rad = _is_radiant_player_slot(int(ps))
        else:
            is_rad = False
        base_rows.append(
            {
                "slot": int(slot),
                "player_slot": int(ps) if ps is not None else None,
                "is_radiant": bool(is_rad),
                "lane_early": _lane_by_xy(mx, my, lane_delta),
                "lane_phase_networth": float(nw_by_slot.get(slot, (0.0, 0.0))[1]),
                "support_item_points_early": int(support_score_by_slot.get(slot) or 0),
            }
        )

    rad_rows = [x for x in base_rows if x.get("is_radiant") is True]
    dire_rows = [x for x in base_rows if x.get("is_radiant") is False]
    role_rad = _assign_early_roles_for_team(rad_rows, is_radiant=True)
    role_dire = _assign_early_roles_for_team(dire_rows, is_radiant=False)
    role_all = {**role_rad, **role_dire}

    out: Dict[int, Dict[str, Any]] = {}
    for x in base_rows:
        slot = int(x["slot"])
        out[slot] = {
            "lane_early": str(x.get("lane_early") or ""),
            "role_early": str(role_all.get(slot) or ""),
            "support_item_points_early": int(x.get("support_item_points_early") or 0),
            "support_items_early": support_items_by_slot.get(slot) or [],
        }
    return out


def _inventory_from_api_style_player(
    p: Dict[str, Any],
    dc: Any,
) -> Optional[Tuple[List[Dict[str, Any]], str, Optional[str]]]:
    """
    OpenDota / 清洗 JSON 风格：仅 item_0..item_5 为身上装备，背包为 backpack_*（此处不读）。
    返回 (items_slot, neutral_img, neutral_item_key)。
    """
    if not isinstance(p, dict):
        return None
    if not any(f"item_{i}" in p for i in range(6)):
        return None
    work = dict(p)
    apply_two_step_to_player(work, dc, mutate_items_slot=True)
    items_slot = work.get("items_slot")
    if not isinstance(items_slot, list) or len(items_slot) < 6:
        return None
    nr = work.get("items_resolved") or {}
    neutral_cell = nr.get("neutral") if isinstance(nr, dict) else None
    if isinstance(neutral_cell, dict) and neutral_cell.get("image_url"):
        neutral_img = str(neutral_cell["image_url"])
    else:
        try:
            nid = int(work.get("item_neutral") or 0)
        except (TypeError, ValueError):
            nid = 0
        neutral_img = get_cdn_neutral_img(nid, dc)
    nik: Optional[str] = None
    if isinstance(neutral_cell, dict) and neutral_cell.get("item_key"):
        nik = str(neutral_cell["item_key"])
    return (list(items_slot[:6]), neutral_img, nik)


def _items_slot_has_equipped(items_slot: List[Any]) -> bool:
    """players_blob 里 item_0..5 全 0 时仍会生成 6 格空壳，不应挡住 COMBATLOG 购买推断。"""
    for cell in items_slot:
        if not isinstance(cell, dict):
            continue
        if cell.get("empty") is True:
            continue
        if str(cell.get("item_key") or "").strip():
            return True
        try:
            if int(cell.get("item_id") or 0) > 0:
                return True
        except (TypeError, ValueError):
            pass
    return False


# 部分解析器不在 PURCHASE/ITEM 上标注熊灵，但会在伤害、interval 等字段里出现 npc 名。
_LD_BEAR_NPC_RE = re.compile(r"(npc_dota_lone_druid_bear\d*)", re.IGNORECASE)
_LD_BEAR_STRING_SCAN_KEYS: Tuple[str, ...] = (
    "targetname",
    "attackername",
    "sourcename",
    "inflictorname",
    "targetsourcename",
    "castername",
    "unitname",
    "npc_name",
    "msg",
    "key",
)


_LD_BEAR_IDLE_OWNER_BIAS = frozenset(
    {
        # 客户端常见：本体代买后转给熊灵；战斗日志里很少出现 item_power_treads /
        # item_ultimate_scepter / item_orb_of_corrosion 的 ITEM inflictor（与疯脸/雷锤不同）。
        "ultimate_scepter",
        "ultimate_scepter_2",
        "power_treads",
        "orb_of_corrosion",
        "mask_of_madness",
        "mjollnir",
        "maelstrom",
        "madstone_bundle",
        "quelling_blade",
        "monkey_king_bar",
        "skull_basher",
        "abyssal_blade",
        "black_king_bar",
        "satanic",
        "bfury",
        "rapier",
        "hand_of_midas",
        "greater_crit",
        "lesser_crit",
        "manta",
        "diffusal_blade",
        "disperser",
        "assault_cuirass",
        "desolator",
        "reaver",
        "eagle",
        "relic",
        "talisman_of_evasion",
        "demon_edge",
        "javelin",
        "hyperstone",
        "mithril_hammer",
        "claymore",
        "blades_of_attack",
        "blitz_knuckles",
        "sobi_mask",
        "robe",
        "broadsword",
        "lifesteal",
    }
)


_LD_HERO_IDLE_OWNER_BIAS = frozenset(
    {
        "aghanims_shard",
        "boots",
        "phase_boots",
        "arcane_boots",
        "guardian_greaves",
        "tranquil_boots",
        "travel_boots",
        "travel_boots_2",
        "wind_lace",
        "magic_wand",
        "ward_observer",
        "ward_sentry",
    }
)

# 熊灵已出现其中任一成品/大件时，认为「熊在扛主装」，本体池里误分的散件可回迁熊侧。
_LD_BEAR_CARRY_ANCHOR_KEYS = frozenset(
    {
        "mjollnir",
        "maelstrom",
        "gleipnir",
        "monkey_king_bar",
        "desolator",
        "skadi",
        "eye_of_skadi",
        "manta",
        "diffusal_blade",
        "disperser",
        "black_king_bar",
        "satanic",
        "bfury",
        "radiance",
        "orchid",
        "bloodthorn",
        "nullifier",
        "silver_edge",
        "invis_sword",
        "abyssal_blade",
        "assault_cuirass",
        "greater_crit",
        "lesser_crit",
        "hand_of_midas",
        "mask_of_madness",
        "helm_of_the_overlord",
        "ultimate_scepter",
        "ultimate_scepter_2",
        "sphere",
        "lotus_orb",
        "linken_sphere",
        "hurricane_pike",
        "dragon_lance",
        "skull_basher",
        "rapier",
    }
)

# 记在英雄名下、但典型为熊灵 farm 装的散件；仅当已有 _LD_BEAR_CARRY_ANCHOR_KEYS 在熊池时迁移。
_LD_FRAGMENT_KEYS_MOVE_TO_BEAR_WHEN_ANCHORED = frozenset(
    {
        "point_booster",
        "blade_of_alacrity",
        "staff_of_wizardry",
        "ogre_axe",
        "belt_of_strength",
        "boots_of_elves",
        "gloves",
        "robe",
        "vitality_booster",
        "mystic_staff",
        "ultimate_orb",
        "eagle",
        "reaver",
        "energy_booster",
        "platemail",
        "ring_of_health",
        "void_stone",
        "talisman_of_evasion",
        "demon_edge",
        "relic",
        "mithril_hammer",
        "javelin",
        "blitz_knuckles",
        "sobi_mask",
        "blades_of_attack",
        "claymore",
        "broadsword",
        "lifesteal",
        "hyperstone",
        "cornucopia",
        "ring_of_regen",
        "headdress",
        "chainmail",
        "blight_stone",
        "orb_of_venom",
    }
)

# 本体专用鞋，不因「熊有大件」迁到熊池。
_LD_HERO_BOOTS_NEVER_TO_BEAR = frozenset(
    {
        "phase_boots",
        "arcane_boots",
        "guardian_greaves",
        "tranquil_boots",
        "travel_boots",
        "travel_boots_2",
    }
)


def _lone_druid_item_last_item_use_times(
    events: List[dict],
    rk: str,
    hero_npc: str,
    bear_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> Tuple[Optional[int], Optional[int]]:
    """DOTA_COMBATLOG_ITEM 中 inflictor 对应 rk 的最后使用时间（本体 / 熊灵）。"""
    hero_t: Optional[int] = None
    bear_t: Optional[int] = None
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_ITEM":
            continue
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            continue
        if t < 0:
            continue
        if match_end_time is not None and t > int(match_end_time):
            continue
        k = _item_key_from_valuename(str(e.get("inflictor") or ""))
        if not k:
            continue
        erk = (dc.resolve_items_json_key(k) or k).strip().lower()
        if erk != rk:
            continue
        an = str(e.get("attackername") or "")
        if _targetname_matches_hero_npc(an, hero_npc):
            hero_t = t if hero_t is None else max(hero_t, t)
        if _targetname_matches_hero_npc(an, bear_npc):
            bear_t = t if bear_t is None else max(bear_t, t)
    return hero_t, bear_t


def _lone_druid_assign_purchase_owner(
    rk: str,
    events: List[dict],
    hero_npc: str,
    bear_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> str:
    """
    将「记在德鲁伊名下的购买」拆到本体或熊灵栏位。
    优先采信 DOTA_COMBATLOG_ITEM 活动归属；无活动时用语义偏置。
    """
    h_t, b_t = _lone_druid_item_last_item_use_times(
        events, rk, hero_npc, bear_npc, dc, match_end_time=match_end_time
    )
    if b_t is not None and (h_t is None or b_t >= h_t):
        return "bear"
    if h_t is not None and (b_t is None or h_t > b_t):
        return "hero"
    if rk in _LD_BEAR_IDLE_OWNER_BIAS:
        return "bear"
    if rk in _LD_HERO_IDLE_OWNER_BIAS:
        return "hero"
    return "hero"


def _lone_druid_partition_purchase_pools(
    events: List[dict],
    hero_npc: str,
    bear_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> Tuple[List[str], List[str]]:
    ordered = _non_disposable_purchase_keys_newest_first(
        events, hero_npc, dc, match_end_time=match_end_time
    )
    hero_keys: List[str] = []
    bear_keys: List[str] = []
    for k in ordered:
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        if not rk:
            continue
        side = _lone_druid_assign_purchase_owner(
            rk, events, hero_npc, bear_npc, dc, match_end_time=match_end_time
        )
        if side == "bear":
            bear_keys.append(k)
        else:
            hero_keys.append(k)
    return _lone_druid_refine_partition_pools(ordered, hero_keys, bear_keys, dc)


def _lone_druid_refine_partition_pools(
    ordered: List[str],
    hero_keys: List[str],
    bear_keys: List[str],
    dc: Any,
) -> Tuple[List[str], List[str]]:
    """
    初拆后校正：熊灵池里已有大件时，把「成品配方树」上的散件与常见熊 carry 散件从本体迁回熊池，
    并按全局购买顺序（``ordered``）重排两侧池，保证 _main_six_keys_from_ordered_unique_pool 时间序一致。
    """

    def _nr(k: str) -> str:
        return (dc.resolve_items_json_key(k) or k).strip().lower()

    h_set = {_nr(k) for k in hero_keys if _nr(k)}
    b_set = {_nr(k) for k in bear_keys if _nr(k)}
    if not h_set or not b_set:
        return hero_keys, bear_keys
    if not (b_set & _LD_BEAR_CARRY_ANCHOR_KEYS):
        return hero_keys, bear_keys

    # 假腿本体侧常有 ITEM 证据；有大件锚点时仍归熊（与客户端熊 carry 一致）。
    if "power_treads" in h_set:
        h_set.discard("power_treads")
        b_set.add("power_treads")

    comp_from_bear: Set[str] = set()
    for brk in list(b_set):
        if not brk:
            continue
        for ck in _recipe_component_inner_keys(dc, brk):
            comp_from_bear.add(_nr(ck))

    for hrk in list(h_set):
        if not hrk:
            continue
        if hrk == "aghanims_shard":
            continue
        if hrk in _LD_HERO_BOOTS_NEVER_TO_BEAR:
            continue
        move = False
        if hrk in comp_from_bear:
            move = True
        elif hrk in _LD_FRAGMENT_KEYS_MOVE_TO_BEAR_WHEN_ANCHORED:
            move = True
        if not move:
            continue
        h_set.discard(hrk)
        b_set.add(hrk)

    nh: List[str] = []
    nb: List[str] = []
    seenh: Set[str] = set()
    seenb: Set[str] = set()
    for k in ordered:
        rk = _nr(k)
        if not rk:
            continue
        if rk in b_set:
            if rk not in seenb:
                nb.append(k)
                seenb.add(rk)
        elif rk in h_set:
            if rk not in seenh:
                nh.append(k)
                seenh.add(rk)
    return nh, nb


def _main_six_keys_from_ordered_unique_pool(
    ordered: List[str],
    events: List[dict],
    evidence_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> List[Optional[str]]:
    main: List[Optional[str]] = [None] * 6
    present: Set[str] = set()
    idx = 0
    for k in ordered:
        if idx >= 6:
            break
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        if not rk or rk in present:
            continue
        while idx < 6 and main[idx]:
            idx += 1
        if idx >= 6:
            break
        main[idx] = k
        present.add(rk)
        idx += 1
    _apply_item_upgrade_dedupe(main, dc)
    _apply_item_conflict_priority(
        main, events, evidence_npc, dc, match_end_time=match_end_time
    )
    return main


def _lone_druid_fill_starting_branches_on_hero_items_slot(
    items_slot: List[Dict[str, Any]],
    starting_items: List[Dict[str, Any]],
    dc: Any,
) -> None:
    """拆分栏位后本体常只剩魔晶等：用开局购买的树枝数量填满空主格（与客户端一致）。"""
    n = 0
    for st in starting_items:
        if not isinstance(st, dict):
            continue
        _k = str(st.get("item_key") or "").strip().lower()
        _rk = (dc.resolve_items_json_key(_k) or _k).strip().lower()
        if _rk != "branches":
            continue
        try:
            n = int(st.get("count") or 0)
        except (TypeError, ValueError):
            n = 0
        break
    if n <= 0:
        return
    filled = 0
    for i in range(min(6, len(items_slot))):
        if filled >= n:
            break
        cell = items_slot[i]
        if not isinstance(cell, dict):
            continue
        empty = bool(cell.get("empty") is True) or not str(cell.get("item_key") or "").strip()
        if not empty:
            continue
        items_slot[i] = _item_slot_dict_from_key("branches", i, dc)
        filled += 1


def _pick_lone_druid_bear_npc(
    events: List[dict],
    owner_slot: int,
    match_end_time: Optional[int] = None,
    *,
    fallback_npc: Optional[str] = None,
) -> Optional[str]:
    """
    识别独行德鲁伊熊灵单位名（如 npc_dota_lone_druid_bear1 / bear2）。
    优先同 owner_slot 的物品相关事件，避免双方都有德鲁伊时串线。
    若无任何命中且提供 ``fallback_npc``（仅应对 lone_druid 行），则视为第二单位
    ``npc_dota_lone_druid_bear*`` 走拆分管线（购买仍记在英雄名下时依赖偏置/ITEM 证据）。
    """

    def _register_hit(bear_name: str, e: dict) -> None:
        bear_name = bear_name.strip().lower()
        if not bear_name.startswith("npc_dota_lone_druid_bear"):
            return
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            t = 0
        if match_end_time is not None and t > int(match_end_time):
            return
        ev_slot = logical_player_slot(e.get("slot"))
        slot_score = 2 if ev_slot == owner_slot else (1 if ev_slot is None else 0)
        prev = hits.get(bear_name)
        if prev is None:
            hits[bear_name] = (slot_score, t, 1)
        else:
            hits[bear_name] = (
                max(prev[0], slot_score),
                max(prev[1], t),
                prev[2] + 1,
            )

    hits: Dict[str, Tuple[int, int, int]] = {}
    for e in events:
        if not isinstance(e, dict):
            continue
        et = str(e.get("type") or "")
        if et not in ("DOTA_COMBATLOG_PURCHASE", "DOTA_COMBATLOG_ITEM"):
            continue
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            continue
        if match_end_time is not None and t > int(match_end_time):
            continue
        tn = str(e.get("targetname") or "").strip().lower()
        an = str(e.get("attackername") or "").strip().lower()
        bear_name = ""
        if tn.startswith("npc_dota_lone_druid_bear"):
            bear_name = tn
        elif an.startswith("npc_dota_lone_druid_bear"):
            bear_name = an
        if bear_name:
            _register_hit(bear_name, e)

    # 其它事件类型中的熊灵 npc 字符串（浅层 + 若干常见键）
    for e in events:
        if not isinstance(e, dict):
            continue
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            t = 0
        if match_end_time is not None and t > int(match_end_time):
            continue
        found: Set[str] = set()
        for sk in _LD_BEAR_STRING_SCAN_KEYS:
            v = e.get(sk)
            if isinstance(v, str):
                for m in _LD_BEAR_NPC_RE.finditer(v):
                    found.add(m.group(1).lower())
        if not found:
            for v in e.values():
                if not isinstance(v, str):
                    continue
                vl = v.lower()
                if "npc_dota" not in vl or "lone_druid_bear" not in vl:
                    continue
                for m in _LD_BEAR_NPC_RE.finditer(v):
                    found.add(m.group(1).lower())
        for bn in found:
            _register_hit(bn, e)

    if hits:
        return max(hits.items(), key=lambda kv: (kv[1][0], kv[1][2], kv[1][1]))[0]
    if fallback_npc:
        fb = str(fallback_npc).strip().lower()
        if fb.startswith("npc_dota_lone_druid_bear"):
            return fb
    return None


def _last_neutral_key(events: List[dict], slot: int) -> Optional[str]:
    last: Optional[dict] = None
    for e in events:
        if e.get("type") == "neutral_item_history" and int(e.get("slot", -1)) == slot:
            last = e
    if not last:
        return None
    return str(last.get("key") or "") or None


def _item_key_from_valuename(vn: str) -> Optional[str]:
    """item_* 主名；排除配方与特殊合成占位。"""
    s = (vn or "").strip()
    if not s.startswith("item_"):
        return None
    key = s.replace("item_", "", 1)
    if key.startswith("recipe_") or key == "ward_dispenser":
        return None
    return key


def _normalize_hero_npc_name_for_compare(s: str) -> str:
    x = str(s or "").strip().lower()
    if not x:
        return ""
    if x.startswith("npc_dota_hero_"):
        x = x[len("npc_dota_hero_") :]
    return x.replace("_", "")


def _targetname_matches_hero_npc(targetname: str, hero_npc: str) -> bool:
    t = str(targetname or "").strip()
    h = str(hero_npc or "").strip()
    if not t or not h:
        return False
    if t == h:
        return True
    return _normalize_hero_npc_name_for_compare(t) == _normalize_hero_npc_name_for_compare(h)


def _item_event_matches_unit(e: Dict[str, Any], unit_npc: str) -> bool:
    """
    ITEM 事件归属判定：
    - 常规英雄沿用 attackername（避免把被作用目标误判为持有者）
    - 熊灵事件常写在 targetname，故额外允许 targetname 命中
    """
    return _targetname_matches_hero_npc(str(e.get("attackername") or ""), unit_npc)


def _unit_item_last_seen_times(
    events: List[dict],
    unit_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> Dict[str, int]:
    """
    统计单位在比赛内（<=match_end_time）每个物品 key 的最后证据时间。
    证据来源：
    - DOTA_COMBATLOG_ITEM attackername==unit（真实使用/触发）
    - DOTA_COMBATLOG_PURCHASE targetname==unit（购买）
    """
    out: Dict[str, int] = {}
    for e in events:
        et = str(e.get("type") or "")
        if et not in ("DOTA_COMBATLOG_ITEM", "DOTA_COMBATLOG_PURCHASE"):
            continue
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            continue
        if t < 0:
            continue
        if match_end_time is not None and t > int(match_end_time):
            continue
        k: Optional[str] = None
        if et == "DOTA_COMBATLOG_ITEM":
            if not _targetname_matches_hero_npc(str(e.get("attackername") or ""), unit_npc):
                continue
            k = _item_key_from_valuename(str(e.get("inflictor") or ""))
        else:
            if not _targetname_matches_hero_npc(str(e.get("targetname") or ""), unit_npc):
                continue
            k = _item_key_from_valuename(str(e.get("valuename") or ""))
        if not k:
            continue
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        if not rk:
            continue
        prev = out.get(rk)
        if prev is None or t >= prev:
            out[rk] = t
    return out


def _unit_item_activity_keys_newest_first(
    events: List[dict],
    unit_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> List[str]:
    last_t: Dict[str, int] = {}
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_ITEM":
            continue
        if not _targetname_matches_hero_npc(str(e.get("attackername") or ""), unit_npc):
            continue
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            continue
        if t < 0:
            continue
        if match_end_time is not None and t > int(match_end_time):
            continue
        k = _item_key_from_valuename(str(e.get("inflictor") or ""))
        if not k:
            continue
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        if not rk:
            continue
        prev = last_t.get(rk)
        if prev is None or t >= prev:
            last_t[rk] = t
    return [k for k, _ in sorted(last_t.items(), key=lambda kv: kv[1], reverse=True)]


def _dedupe_lone_druid_hero_bear_overlap(
    hero_items_slot: List[Dict[str, Any]],
    bear_items_slot: List[Dict[str, Any]],
    events: List[dict],
    hero_npc: str,
    bear_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> None:
    """
    独行德鲁伊本体与熊灵若出现同名主装，做“弱去重”：
    - 仅当一侧存在证据而另一侧完全无证据时，移除无证据一侧
    - 若双方都有证据，但熊灵证据显著更晚（默认 >=300s），视为终局归熊灵，移除本体同名
    - 其余情况保留两侧，避免误删导致主栏过空
    """
    hero_seen = _unit_item_last_seen_times(
        events, hero_npc, dc, match_end_time=match_end_time
    )
    bear_seen = _unit_item_last_seen_times(
        events, bear_npc, dc, match_end_time=match_end_time
    )
    hero_pos: Dict[str, List[int]] = {}
    bear_pos: Dict[str, List[int]] = {}
    for i in range(min(6, len(hero_items_slot))):
        c = hero_items_slot[i]
        if not isinstance(c, dict):
            continue
        rk = (dc.resolve_items_json_key(str(c.get("item_key") or "")) or str(c.get("item_key") or "")).strip().lower()
        if not rk:
            continue
        hero_pos.setdefault(rk, []).append(i)
    for i in range(min(6, len(bear_items_slot))):
        c = bear_items_slot[i]
        if not isinstance(c, dict):
            continue
        rk = (dc.resolve_items_json_key(str(c.get("item_key") or "")) or str(c.get("item_key") or "")).strip().lower()
        if not rk:
            continue
        bear_pos.setdefault(rk, []).append(i)

    overlaps = set(hero_pos.keys()) & set(bear_pos.keys())
    for rk in overlaps:
        ht = hero_seen.get(rk)
        bt = bear_seen.get(rk)
        # 双方都有证据：若熊灵明显更新，判定终局归熊灵
        if ht is not None and bt is not None:
            if int(bt) - int(ht) >= 300:
                for i in hero_pos.get(rk, []):
                    hero_items_slot[i] = {
                        "slot": i,
                        "item_id": 0,
                        "item_key": None,
                        "item_name_en": "",
                        "item_name_cn": "",
                        "image_url": "",
                        "empty": True,
                    }
            continue
        # 仅熊灵有证据：删除本体同名
        if bt is not None and ht is None:
            for i in hero_pos.get(rk, []):
                hero_items_slot[i] = {
                    "slot": i,
                    "item_id": 0,
                    "item_key": None,
                    "item_name_en": "",
                    "item_name_cn": "",
                    "image_url": "",
                    "empty": True,
                }
        # 仅本体有证据：删除熊灵同名
        elif ht is not None and bt is None:
            for i in bear_pos.get(rk, []):
                bear_items_slot[i] = {
                    "slot": i,
                    "item_id": 0,
                    "item_key": None,
                    "item_name_en": "",
                    "item_name_cn": "",
                    "image_url": "",
                    "empty": True,
                }


def _starting_items_from_purchases(
    events: List[dict],
    hero_npc: str,
    dc: Any,
    *,
    start_sec: int = -30,
    end_sec: int = 0,
) -> List[Dict[str, Any]]:
    """出门装：优先比赛开始前 30 秒购买；若该窗口为空，回退到最早非正时间点至 0 秒。"""

    def _collect(_start: int, _end: int) -> List[Dict[str, Any]]:
        rows: Dict[str, Dict[str, Any]] = {}
        for e in events:
            if e.get("type") != "DOTA_COMBATLOG_PURCHASE":
                continue
            if not _targetname_matches_hero_npc(str(e.get("targetname") or ""), hero_npc):
                continue
            try:
                t = int(e.get("time") or 0)
            except (TypeError, ValueError):
                continue
            if t < _start or t > _end:
                continue
            key = _item_key_from_valuename(str(e.get("valuename") or ""))
            if not key:
                continue
            rk = (dc.resolve_items_json_key(key) or key).strip()
            row = rows.get(rk)
            if row is None:
                iid = 0
                try:
                    iid = int(dc.items.get(rk, {}).get("id") or 0)
                except (TypeError, ValueError):
                    iid = 0
                nm_en, nm_cn, img = dc.item_display(rk or key)
                row = {
                    "item_id": iid,
                    "item_key": rk or key,
                    "item_name_en": nm_en,
                    "item_name_cn": nm_cn,
                    "image_url": img,
                    "count": 0,
                    "first_purchase_time": t,
                }
                rows[rk] = row
            row["count"] = int(row.get("count") or 0) + 1
            if t < int(row.get("first_purchase_time") or t):
                row["first_purchase_time"] = t
        out = list(rows.values())
        out.sort(key=lambda x: int(x.get("first_purchase_time") or 0))
        return out

    out = _collect(start_sec, end_sec)
    if out:
        return out

    non_pos_times: List[int] = []
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_PURCHASE":
            continue
        if not _targetname_matches_hero_npc(str(e.get("targetname") or ""), hero_npc):
            continue
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            continue
        if t <= 0:
            non_pos_times.append(t)
    if not non_pos_times:
        return []
    fallback_start = max(min(non_pos_times), -120)
    return _collect(fallback_start, 0)


# 结算面主槽应弱化的消耗 / 侦查（显式表 + dotaconstants qual/cost 兜底）
_DISPOSABLE_MAIN_ITEM_KEYS = frozenset(
    {
        "tpscroll",
        "ward_observer",
        "ward_sentry",
        "smoke_of_deceit",
        "dust",
        "clarity",
        "faerie_fire",
        "enchanted_mango",
        "tango",
        "tango_single",
        "healing_salve",
        "flask",
        "blood_grenade",
        "famango",
        "greater_famango",
        "royal_jelly",
        "ironwood_tree",
        "branches",
        "infused_raindrop",
        "ward_dispenser",
        "furion_gold_bag",
    }
)


_SUPPORT_UTILITY_ITEM_KEYS = frozenset(
    {
        "ward_observer",
        "ward_sentry",
        "dust",
        "smoke_of_deceit",
        "gem",
        "gem_of_true_sight",
        "ward_dispenser",
    }
)

_FALLBACK_POOL_SUPPORT_KEYS = frozenset(
    {
        "gem",
        "gem_of_true_sight",
        "dust",
    }
)

_MAIN_SIX_NEUTRAL_ONLY_KEYS = frozenset(
    {
        "tiara_of_selemene",
    }
)

_CONSUME_LIKELY_MAIN_KEYS = frozenset(
    {
        "aghanims_shard",
        "moon_shard",
    }
)

_FALLBACK_TRANSIENT_UTILITY_KEYS = frozenset(
    {
        "ancient_janggo",
        "pavise",
    }
)

_FALLBACK_STALE_COMPONENT_MAX_COST = 2200
_FALLBACK_STALE_COMPONENT_SEC = 900
_FALLBACK_STALE_CHEAP_MAX_COST = 700
_FALLBACK_STALE_CHEAP_SEC = 900
_FALLBACK_CONSUME_LIKELY_DEMOTE_SEC = 300
_FALLBACK_RECENT_ACTIVITY_BONUS_SEC = 900
_FALLBACK_TRANSIENT_UTILITY_DEMOTE_SEC = 600


def _item_is_disposable_main_inventory(dc: Any, key: Optional[str]) -> bool:
    """主 6 格展示用：弱化 TP/眼/小消耗等（仍可能被战斗日志写在槽位上）。"""
    if not key:
        return False
    lk = dc.resolve_items_json_key(str(key).strip().lower())
    if not lk:
        return False
    # 真眼/假眼/粉/雾/Gem 属于辅助核心功能道具：允许在终局主栏展示。
    if lk in _SUPPORT_UTILITY_ITEM_KEYS:
        return False
    if lk in _DISPOSABLE_MAIN_ITEM_KEYS:
        return True
    if lk.startswith("foragers_"):
        return True
    if "ward" in lk and lk not in _SUPPORT_UTILITY_ITEM_KEYS:
        return True
    it = dc.items.get(lk) or {}
    try:
        cost = int(it.get("cost") or 0)
    except (TypeError, ValueError):
        cost = 0
    qual = str(it.get("qual") or "").lower()
    if qual == "consumable" and cost < 500:
        return True
    # 裸小件（圆环、树枝等）不应占终局主槽展示位；补刀斧等虽标 component 但会占主栏格子。
    if qual == "component" and cost < 600:
        if lk == "quelling_blade":
            return False
        return True
    return False


def _item_allowed_neutral_trinket(dc: Any, key: Optional[str]) -> bool:
    """
    中立物品槽：须为 neutral tier（dotaconstants tier 1–5）或商店价 0 的零价物品。
    价签 >0 的（如 Skadi、Bloodstone、Moon Shard）一律视为误解析，不在此槽展示。
    """
    if not key:
        return False
    lk = dc.resolve_items_json_key(str(key).strip().lower())
    if not lk or lk not in dc.items:
        return False
    it = dc.items[lk]
    tier = it.get("tier")
    if tier is not None:
        try:
            ti = int(tier)
            if 1 <= ti <= 5:
                return True
        except (TypeError, ValueError):
            pass
    try:
        cost = int(it.get("cost") or 0)
    except (TypeError, ValueError):
        cost = 0
    if cost > 0:
        return False
    return True


def _forbidden_in_main_six(dc: Any, key: Optional[str]) -> bool:
    """
    不得出现在主物品栏 0..5 的 key：小消耗 / 侦查件，以及仅属于中立圆槽的物品
    （与 _item_allowed_neutral_trinket 一致：tier 1–5 或商店价 0 的零价中立等）。
    """
    if not key:
        return False
    rk = (dc.resolve_items_json_key(str(key).strip().lower()) or str(key).strip().lower())
    if rk in _MAIN_SIX_NEUTRAL_ONLY_KEYS:
        return True
    if _item_is_disposable_main_inventory(dc, key):
        return True
    return bool(_item_allowed_neutral_trinket(dc, key))


_NEUTRAL_SLOT_FORBIDDEN_KEYS = frozenset(
    {
        "aghanims_shard",
        "aghanims_shard_roshan",
        "ultimate_scepter",
        "ultimate_scepter_2",
        "ultimate_scepter_roshan",
        "moon_shard",
        "gem",
        "gem_of_true_sight",
    }
)


def _sanitize_player_neutral_fields(
    dc: Any, neutral_img: str, neutral_key: Optional[str]
) -> Tuple[str, Optional[str]]:
    """中立槽非法（主装备 / 神杖魔晶等误入）时清空图与 key，避免 UI 圆槽显示 buff 图标。"""
    nk = (neutral_key or "").strip().lower().replace("item_", "")
    if not nk:
        return "", None
    rk = (dc.resolve_items_json_key(nk) or nk).strip().lower()
    if rk in _NEUTRAL_SLOT_FORBIDDEN_KEYS or nk in _NEUTRAL_SLOT_FORBIDDEN_KEYS:
        return "", None
    if not _item_allowed_neutral_trinket(dc, nk):
        return "", None
    resolved = dc.resolve_items_json_key(nk) or nk
    return neutral_img, resolved


# 主栏鞋类：购买时间往往远早于第 6 件「最新大件」，纯按时间取 6 件会把鞋挤掉（与客户端不符）。
_INVENTORY_BOOT_ITEM_KEYS = frozenset(
    {
        "boots",
        "power_treads",
        "phase_boots",
        "tranquil_boots",
        "tranquil_boots_inactive",
        "arcane_boots",
        "travel_boots",
        "travel_boots_2",
        "guardian_greaves",
        "boots_of_bearing",
    }
)

_BOOT_ITEM_PREFERENCE = {
    "travel_boots_2": 7,
    "travel_boots": 6,
    "guardian_greaves": 5,
    "arcane_boots": 4,
    "phase_boots": 3,
    "power_treads": 3,
    "tranquil_boots": 2,
    "tranquil_boots_inactive": 2,
    "boots": 1,
}

# 为塞进鞋时尽量不踢掉的核心大件（若只按「非 created」选受害者会误伤鞋以外的关键装）
_BOOT_EVICT_PROTECT_KEYS = frozenset(
    {
        "hand_of_midas",
        "black_king_bar",
        "sphere",
        "skadi",
        "ultimate_scepter",
        "ultimate_scepter_2",
    }
)


def _hero_latest_boot_purchase_info(
    events: List[dict], hero_npc: str, dc: Any, match_end_time: Optional[int] = None
) -> Optional[Tuple[str, int]]:
    """不计 disposable 过滤：鞋在商店购买必进日志；取每种鞋最后一次购买，再取时间最晚的一双（相位/飞鞋等升级链）。"""
    boot_last: Dict[str, int] = {}
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_PURCHASE":
            continue
        if not _targetname_matches_hero_npc(str(e.get("targetname") or ""), hero_npc):
            continue
        t = int(e.get("time") or 0)
        if t < 0:
            continue
        if match_end_time is not None and t > int(match_end_time):
            continue
        key = _item_key_from_valuename(str(e.get("valuename") or ""))
        if not key:
            continue
        rk = (dc.resolve_items_json_key(key) or key).strip()
        if rk not in _INVENTORY_BOOT_ITEM_KEYS:
            continue
        prev = boot_last.get(key)
        if prev is None or t >= prev:
            boot_last[key] = t
    if not boot_last:
        return None
    def _key_rank(k: str) -> Tuple[int, int]:
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        return (int(boot_last.get(k, 0)), int(_BOOT_ITEM_PREFERENCE.get(rk, 0)))

    bk = max(boot_last.keys(), key=_key_rank)
    return (bk, int(boot_last[bk]))


def _boot_eviction_victim_key(
    top6: List[str], last_t: Dict[str, int], dc: Any
) -> Optional[str]:
    """
    在 top6 中选一件替换为鞋：优先踢「非 created」的散件（魔晶、阔剑等），避免误踢 Midas/BKB。
    若均为成品，则在非保护装中选购买时间最旧的一件。
    """
    if len(top6) < 2:
        return None
    for k in sorted(top6, key=lambda x: last_t.get(x, 0)):
        rk = (dc.resolve_items_json_key(k) or k).strip()
        if rk in _BOOT_EVICT_PROTECT_KEYS:
            continue
        row = dc.items.get(rk) or {}
        if not row.get("created"):
            return k
    cand = [
        k
        for k in top6
        if (dc.resolve_items_json_key(k) or k).strip() not in _BOOT_EVICT_PROTECT_KEYS
    ]
    if not cand:
        cand = list(top6)
    return min(cand, key=lambda k: last_t.get(k, 0))


def _merge_boot_into_top_six_pool(
    ordered: List[str], last_t: Dict[str, int], boot_k: Optional[str], dc: Any
) -> List[str]:
    """若当前 top6 不含鞋，则用受害者换入 boot_k，再按购买时间新→旧排前 6，余下接在后面。"""
    if not boot_k or not ordered:
        return ordered
    pruned = list(ordered)
    boot_r = (dc.resolve_items_json_key(boot_k) or boot_k).strip()
    head_keys = [((dc.resolve_items_json_key(k) or k).strip()) for k in pruned[:6]]
    if boot_r in head_keys:
        return pruned
    head = list(pruned[:6])
    victim = _boot_eviction_victim_key(head, last_t, dc)
    if not victim:
        return pruned
    head2 = [k for k in head if k != victim]
    head2.append(boot_k)
    head2.sort(key=lambda k: last_t.get(k, 0), reverse=True)
    head2_set = set(head2)
    tail = [k for k in pruned if k not in head2_set and k != victim]
    return head2 + tail


def _non_disposable_purchase_keys_newest_first(
    events: List[dict], hero_npc: str, dc: Any, match_end_time: Optional[int] = None
) -> List[str]:
    """
    每名英雄、每个 item_key 保留最后一次购买时间，按时间从新到旧排序（仅 0..5 槽或未定槽）。
    注意：该池用于「无可靠 HUD 槽」时的回填，辅助侦查道具（眼/粉/雾/Gem）不应从历史购买硬补进终局主栏。
    """
    last_t: Dict[str, int] = {}
    support_last_t: Dict[str, int] = {}
    support_last_activity_t: Dict[str, int] = {}
    item_last_activity_t: Dict[str, int] = {}
    max_t = 0
    end_ref_t = int(match_end_time) if match_end_time is not None else 0

    for e in events:
        tt = e.get("time")
        if isinstance(tt, (int, float)):
            max_t = max(max_t, int(tt))
        if e.get("type") != "DOTA_COMBATLOG_ITEM":
            continue
        if (e.get("attackername") or "") != hero_npc:
            continue
        ak = _item_key_from_valuename(str(e.get("inflictor") or ""))
        if not ak:
            continue
        try:
            at = int(e.get("time") or 0)
        except (TypeError, ValueError):
            at = 0
        if match_end_time is not None and at > int(match_end_time):
            continue
        ark = (dc.resolve_items_json_key(ak) or ak).strip().lower()
        prev_any = item_last_activity_t.get(ark)
        if prev_any is None or at >= prev_any:
            item_last_activity_t[ark] = at
        if ark not in _SUPPORT_UTILITY_ITEM_KEYS:
            continue
        prev = support_last_activity_t.get(ark)
        if prev is None or at >= prev:
            support_last_activity_t[ark] = at

    if end_ref_t <= 0:
        end_ref_t = max_t

    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_PURCHASE":
            continue
        if not _targetname_matches_hero_npc(str(e.get("targetname") or ""), hero_npc):
            continue
        key = _item_key_from_valuename(str(e.get("valuename") or ""))
        if not key or _item_is_disposable_main_inventory(dc, key):
            continue
        rk = (dc.resolve_items_json_key(key) or key).strip().lower()
        t = int(e.get("time") or 0)
        if match_end_time is not None and t > int(match_end_time):
            continue
        if rk in _SUPPORT_UTILITY_ITEM_KEYS:
            prev = support_last_t.get(rk)
            if prev is None or t >= prev:
                support_last_t[rk] = t
            continue
        row = dc.items.get(rk) or {}
        try:
            cost = int(row.get("cost") or 0)
        except (TypeError, ValueError):
            cost = 0
        qual = str(row.get("qual") or "").lower()
        at = item_last_activity_t.get(rk)
        latest_seen = int(max(t, at if at is not None else -10**9))
        age = int(end_ref_t - latest_seen)
        # 仅有购买、长期无后续活动的低价件 / 组件，回填时容易误判为终局持有（如补刀斧、临时组件）。
        if (
            qual == "component"
            and not bool(row.get("created"))
            and cost <= _FALLBACK_STALE_COMPONENT_MAX_COST
            and age >= _FALLBACK_STALE_COMPONENT_SEC
        ):
            continue
        if cost <= _FALLBACK_STALE_CHEAP_MAX_COST and age >= _FALLBACK_STALE_CHEAP_SEC:
            continue
        if _forbidden_in_main_six(dc, rk):
            continue
        if _item_allowed_neutral_trinket(dc, key):
            continue
        sl = e.get("slot")
        if sl is not None:
            try:
                svi = int(sl)
                if svi < 0 or svi > 5:
                    continue
            except (TypeError, ValueError):
                continue
        prev = last_t.get(key)
        if prev is None or t >= prev:
            last_t[key] = t

    for rk, t in support_last_t.items():
        if rk not in _FALLBACK_POOL_SUPPORT_KEYS:
            continue
        # 仅在尾盘保留 Gem / 粉作为主栏候选，减少「曾购买但已消耗/转移」误判。
        if t < end_ref_t - 900:
            continue
        at = support_last_activity_t.get(rk)
        if at is not None and at >= t and rk != "gem" and rk != "gem_of_true_sight":
            continue
        last_t[rk] = t
    def _pool_score(k: str) -> Tuple[int, int, int, int]:
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        row = dc.items.get(rk) or {}
        try:
            cost = int(row.get("cost") or 0)
        except (TypeError, ValueError):
            cost = 0
        qual = str(row.get("qual") or "").lower()
        pt = int(last_t.get(k, 0))
        at_raw = item_last_activity_t.get(rk)
        at = int(at_raw) if at_raw is not None else -10**9
        recent_activity = 1 if at >= end_ref_t - _FALLBACK_RECENT_ACTIVITY_BONUS_SEC else 0
        qual_rank = (
            4 if qual == "artifact" else
            3 if qual == "rare" else
            2 if qual == "epic" else
            1 if qual == "common" else
            0
        )
        # 统一回填规则：优先“近期有活动”+“购买时间更晚”+“价值/品质更高”。
        return (recent_activity, max(pt, at), cost, qual_rank)

    ordered = sorted(last_t.keys(), key=_pool_score, reverse=True)
    ordered = _prune_keys_subsumed_by_created_items(ordered, dc)
    # 无终局快照时，Shard/月之碎片常已被吃掉仅留下 buff；若长期无活动，降权到池尾避免挤占主 6 格。
    head: List[str] = []
    tail: List[str] = []
    for k in ordered:
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        if rk not in _CONSUME_LIKELY_MAIN_KEYS:
            head.append(k)
            continue
        at = item_last_activity_t.get(rk)
        lt = int(max(last_t.get(k, 0), at if at is not None else -10**9))
        if int(end_ref_t - lt) >= _FALLBACK_CONSUME_LIKELY_DEMOTE_SEC:
            tail.append(k)
        else:
            head.append(k)
    ordered = head + tail

    # 过渡功能装（鼓/帕维斯等）若远离结算时刻，通常已被卖掉或腾格，避免误占终局主栏。
    head2: List[str] = []
    tail2: List[str] = []
    for k in ordered:
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        if rk not in _FALLBACK_TRANSIENT_UTILITY_KEYS:
            head2.append(k)
            continue
        at = item_last_activity_t.get(rk)
        lt = int(max(last_t.get(k, 0), at if at is not None else -10**9))
        if int(end_ref_t - lt) >= _FALLBACK_TRANSIENT_UTILITY_DEMOTE_SEC:
            tail2.append(k)
        else:
            head2.append(k)
    ordered = head2 + tail2
    # 多次换鞋（草鞋/绿鞋/飞鞋）仅保留最终那一双，避免同屏多鞋误判。
    boot_keys = [
        k for k in ordered
        if (dc.resolve_items_json_key(k) or k).strip().lower() in _INVENTORY_BOOT_ITEM_KEYS
    ]
    if len(boot_keys) > 1:
        keep_boot = max(boot_keys, key=lambda k: last_t.get(k, 0))
        ordered = [k for k in ordered if k == keep_boot or k not in boot_keys]
    boot_info = _hero_latest_boot_purchase_info(
        events, hero_npc, dc, match_end_time=match_end_time
    )
    if not boot_info:
        return ordered
    boot_k, boot_t = boot_info
    last_t_m = dict(last_t)
    pt = last_t_m.get(boot_k)
    if pt is None or boot_t >= pt:
        last_t_m[boot_k] = boot_t
    return _merge_boot_into_top_six_pool(ordered, last_t_m, boot_k, dc)


def _refill_main_six_strip_invalid(
    main: List[Optional[str]],
    events: List[dict],
    hero_npc: str,
    dc: Any,
    *,
    fill_empty_from_pool: bool = True,
    match_end_time: Optional[int] = None,
) -> None:
    """
    去掉主槽中的消耗品与中立-only 物品。
    fill_empty_from_pool=True 时：用「可上主栏的购买记录」从左到右补空位（旧行为，无槽位日志的录像）。
    fill_empty_from_pool=False 时：仅清空非法格，**不把后续物品左移填入空槽**（对齐 HUD 0–5 与中立槽分离）。
    """
    pool = _non_disposable_purchase_keys_newest_first(
        events, hero_npc, dc, match_end_time=match_end_time
    )
    present: Set[str] = set()
    for i in range(6):
        k = main[i]
        if k and not _forbidden_in_main_six(dc, k):
            present.add(k)
    pi = 0
    for i in range(6):
        k = main[i]
        if k is not None and not _forbidden_in_main_six(dc, k):
            continue
        if k is not None and _forbidden_in_main_six(dc, k):
            main[i] = None
        if not fill_empty_from_pool:
            continue
        while pi < len(pool) and pool[pi] in present:
            pi += 1
        if pi >= len(pool):
            main[i] = None
            continue
        nk = pool[pi]
        main[i] = nk
        present.add(nk)
        pi += 1


def _strip_neutral_trinkets_from_items_slot_main(
    items_slot: List[Any], dc: Any
) -> None:
    """OpenDota / 管线若把中立物写在 item_0..5 或 items_slot 主格，清空该格（中立只应走 neutral_* / 圆槽）。"""
    for i in range(min(6, len(items_slot))):
        cell = items_slot[i]
        if not isinstance(cell, dict):
            continue
        ik = cell.get("item_key")
        if not ik or not str(ik).strip():
            continue
        if not _item_allowed_neutral_trinket(dc, str(ik)):
            continue
        items_slot[i] = {
            "slot": i,
            "item_id": 0,
            "item_key": None,
            "item_name_en": "",
            "item_name_cn": "",
            "image_url": "",
            "empty": True,
        }


def _item_slot_dict_from_key(key: str, slot_idx: int, dc: Any) -> Dict[str, Any]:
    iid = 0
    for sid, ik in dc.item_ids.items():
        if ik != key:
            continue
        try:
            iid = int(str(sid).split(",")[0])
        except ValueError:
            iid = 0
        break
    dname, dname_cn, img = dc.item_display(key)
    return {
        "slot": slot_idx,
        "item_id": iid,
        "item_key": key,
        "item_name_en": dname,
        "item_name_cn": dname_cn,
        "image_url": img,
        "empty": False,
    }


def _item_cell_from_interval_scalar(raw: Any, slot_idx: int, dc: Any) -> Optional[Dict[str, Any]]:
    """将 interval / players 上的 item_i 或 item id 标量解析为单格 items_slot 字典。"""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    key: Optional[str] = None
    if isinstance(raw, (int, float)):
        iid = int(raw)
        if iid <= 0:
            return None
        key = dc.item_key_from_id(iid)
    elif isinstance(raw, str):
        s = raw.strip()
        if not s or s.lower() in ("null", "none", ""):
            return None
        if s.lstrip("-").isdigit():
            iid = int(s)
            if iid <= 0:
                return None
            key = dc.item_key_from_id(iid)
        else:
            nk = s.lower().replace("item_", "").strip()
            if not nk:
                return None
            key = dc.resolve_items_json_key(nk) or nk
    if not key:
        return None
    return _item_slot_dict_from_key(key, slot_idx, dc)


def _endgame_inventory_bundle_from_interval(
    iv: Mapping[str, Any], dc: Any
) -> Optional[Tuple[List[Optional[Dict[str, Any]]], str, Optional[str]]]:
    """
    从**最后一条** interval 快照读取终局身上 6 格 + 中立（OpenDota 风格 item_0..5 / item_neutral），
    不依赖购买事件拼接。可选兼容 ``items``: [id×6] 数组。
    """
    if not isinstance(iv, dict) or not iv:
        return None
    row: List[Optional[Dict[str, Any]]] = [None] * 6
    any_equipped = False
    for i in range(6):
        cell = _item_cell_from_interval_scalar(iv.get(f"item_{i}"), i, dc)
        row[i] = cell
        if cell is not None:
            any_equipped = True
    if not any_equipped:
        arr = iv.get("items")
        if isinstance(arr, list) and len(arr) >= 6:
            for i in range(6):
                cell = _item_cell_from_interval_scalar(arr[i], i, dc)
                row[i] = cell
                if cell is not None:
                    any_equipped = True
    if not any_equipped:
        return None

    neutral_img = ""
    neutral_item_key_out: Optional[str] = None
    nr = iv.get("item_neutral")
    if nr is not None and str(nr).strip() and str(nr).strip().lower() not in (
        "null",
        "none",
        "0",
        "",
    ):
        if isinstance(nr, (int, float)):
            nid = int(nr)
            if nid > 0:
                hint = dc.item_key_from_id(nid)
                neutral_img = get_cdn_neutral_img(nid, dc, item_key_hint=hint)
                if hint:
                    neutral_item_key_out = str(
                        dc.resolve_items_json_key(hint) or hint
                    )
        elif isinstance(nr, str):
            nk = nr.strip().lower().replace("item_", "")
            if nk.isdigit():
                nid = int(nk)
                if nid > 0:
                    hint = dc.item_key_from_id(nid)
                    neutral_img = get_cdn_neutral_img(nid, dc, item_key_hint=hint)
                    if hint:
                        neutral_item_key_out = str(
                            dc.resolve_items_json_key(hint) or hint
                        )
            elif nk:
                resolved = dc.resolve_items_json_key(nk) or nk
                neutral_item_key_out = str(resolved)
                neutral_img = get_cdn_neutral_img(0, dc, item_key_hint=resolved)

    return (row, str(neutral_img or ""), neutral_item_key_out)


def _best_interval_inventory_bundle_for_slot(
    events: List[dict], slot: int, dc: Any
) -> Optional[Tuple[List[Optional[Dict[str, Any]]], str, Optional[str]]]:
    """
    在全部 interval 里取 **游戏时间最大** 且主栏有装备的一条，作为终局库存。
    部分解析器最后一条 interval 不含 item_*，但中段有快照；仅用 _last_intervals 会漏掉，
    导致误走 combat_log_slot_last_purchase。
    """
    best_t = -1
    best: Optional[Tuple[List[Optional[Dict[str, Any]]], str, Optional[str]]] = None
    for e in events:
        if e.get("type") != "interval":
            continue
        try:
            sl = int(e.get("slot") if e.get("slot") is not None else -1)
        except (TypeError, ValueError):
            continue
        if sl != slot:
            continue
        b = _endgame_inventory_bundle_from_interval(e, dc)
        if b is None:
            continue
        if not _items_slot_has_equipped(b[0]):
            continue
        t = int(e.get("time") or 0)
        if t >= best_t:
            best_t = t
            best = b
    return best


# dotaconstants 里部分中间件 ``components`` 为 null，但购买日志仍会留下已并入该件的散件
# （典型：ultimate_orb 与 Linken's / 冰眼等共用「球」概念）。
_RECIPE_SYNTHETIC_COMPONENTS: Dict[str, Tuple[str, ...]] = {
    "ultimate_orb": (
        "point_booster",
        "staff_of_wizardry",
        "blade_of_alacrity",
    ),
}


def _recipe_component_inner_keys(
    dc: Any,
    parent_key: str,
    *,
    _seen: Optional[Set[str]] = None,
) -> Set[str]:
    """
    展开 ``items.json`` 中成品的 ``components``（跳过 recipe_*），用于判断配方件是否已被成品吸收。
    """
    seen = _seen if _seen is not None else set()
    jk = (dc.resolve_items_json_key(parent_key) or parent_key).strip()
    if not jk or jk in seen:
        return set()
    seen.add(jk)
    row = dc.items.get(jk)
    if not isinstance(row, dict):
        return set()
    out: Set[str] = set()
    comp_children: List[str] = []
    comps = row.get("components")
    if isinstance(comps, list):
        for c in comps:
            ck = str(c).strip()
            if not ck or ck.startswith("recipe_"):
                continue
            child = (dc.resolve_items_json_key(ck) or ck).strip()
            if child:
                comp_children.append(child)
    if not comp_children:
        syn = _RECIPE_SYNTHETIC_COMPONENTS.get(jk)
        if syn:
            for x in syn:
                c2 = (dc.resolve_items_json_key(x) or x).strip()
                if c2:
                    comp_children.append(c2)
    for child in comp_children:
        out.add(child)
        out |= _recipe_component_inner_keys(dc, child, _seen=seen)
    return out


def _prune_keys_subsumed_by_created_items(
    keys_newest_first: List[str], dc: Any
) -> List[str]:
    """
    购买池按时间新→旧已去重；若同时存在成品（created）与其配方件，移除配方件，
    避免无 HUD 槽日志时主栏被组件（恶魔刀锋、阔剑等）占满。
    """
    if len(keys_newest_first) <= 1:
        return list(keys_newest_first)
    bucket: Set[str] = set()
    for k in keys_newest_first:
        rk = (dc.resolve_items_json_key(k) or k).strip()
        if rk:
            bucket.add(rk)
    drop: Set[str] = set()
    for p in bucket:
        prow = dc.items.get(p)
        if not isinstance(prow, dict) or not prow.get("created"):
            continue
        for k in _recipe_component_inner_keys(dc, p):
            if k in bucket:
                drop.add(k)
    return [
        k
        for k in keys_newest_first
        if (dc.resolve_items_json_key(k) or k).strip() not in drop
    ]


_ITEM_UPGRADE_DEDUPE_PAIRS = (
    ("invis_sword", "silver_edge"),
    ("lesser_crit", "greater_crit"),
    ("diffusal_blade", "disperser"),
    ("cyclone", "wind_waker"),
    ("sphere", "mirror_shield"),
    ("travel_boots", "travel_boots_2"),
    ("ultimate_scepter", "ultimate_scepter_2"),
    ("dagon", "dagon_2"),
    ("dagon", "dagon_3"),
    ("dagon", "dagon_4"),
    ("dagon", "dagon_5"),
    ("dagon_2", "dagon_3"),
    ("dagon_2", "dagon_4"),
    ("dagon_2", "dagon_5"),
    ("dagon_3", "dagon_4"),
    ("dagon_3", "dagon_5"),
    ("dagon_4", "dagon_5"),
)

_ITEM_CONFLICT_GROUPS = (
    frozenset({"medallion_of_courage", "solar_crest"}),
    frozenset({"echo_sabre", "harpoon"}),
    frozenset({"kaya", "yasha_and_kaya", "kaya_and_sange", "bloodstone"}),
    frozenset({"vanguard", "crimson_guard"}),
    frozenset({"ancient_janggo", "boots_of_bearing"}),
)


def _apply_item_upgrade_dedupe(main: List[Optional[str]], dc: Any) -> None:
    """
    主栏 6 格内若同时出现装备升级链的低端与高端，清空低端格（避免大隐刀与影刃同屏等矛盾）。
    不改变槽位索引，仅置 None，供后续 refill 或转 items_slot 时空格展示。
    """
    resolved_present: Set[str] = set()
    for k in main:
        if not k:
            continue
        rk = (dc.resolve_items_json_key(k) or k).strip()
        if rk:
            resolved_present.add(rk)
    for low, high in _ITEM_UPGRADE_DEDUPE_PAIRS:
        if low not in resolved_present or high not in resolved_present:
            continue
        for i in range(6):
            k = main[i]
            if not k:
                continue
            rk = (dc.resolve_items_json_key(k) or k).strip()
            if rk == low:
                main[i] = None
        resolved_present.discard(low)


def _item_last_seen_evidence_for_hero(
    events: List[dict],
    hero_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> Tuple[Dict[str, int], Dict[str, int], int]:
    purchase_t: Dict[str, int] = {}
    activity_t: Dict[str, int] = {}
    end_t = 0
    for e in events:
        tt = e.get("time")
        if not isinstance(tt, (int, float)):
            continue
        t = int(tt)
        if t < 0:
            continue
        if match_end_time is not None and t > int(match_end_time):
            continue
        if t > end_t:
            end_t = t
        et = e.get("type")
        if et == "DOTA_COMBATLOG_PURCHASE":
            if not _targetname_matches_hero_npc(str(e.get("targetname") or ""), hero_npc):
                continue
            k = _item_key_from_valuename(str(e.get("valuename") or ""))
            if not k:
                continue
            rk = (dc.resolve_items_json_key(k) or k).strip().lower()
            if not rk:
                continue
            prev = purchase_t.get(rk)
            if prev is None or t >= prev:
                purchase_t[rk] = t
        elif et == "DOTA_COMBATLOG_ITEM":
            if not _item_event_matches_unit(e, hero_npc):
                continue
            k = _item_key_from_valuename(str(e.get("inflictor") or ""))
            if not k:
                continue
            rk = (dc.resolve_items_json_key(k) or k).strip().lower()
            if not rk:
                continue
            prev = activity_t.get(rk)
            if prev is None or t >= prev:
                activity_t[rk] = t
    return purchase_t, activity_t, end_t


def _apply_item_conflict_priority(
    main: List[Optional[str]],
    events: List[dict],
    hero_npc: str,
    dc: Any,
    *,
    match_end_time: Optional[int] = None,
) -> None:
    purchase_t, activity_t, _ = _item_last_seen_evidence_for_hero(
        events, hero_npc, dc, match_end_time=match_end_time
    )
    if not main:
        return

    def _score(k: str) -> Tuple[int, int, int]:
        rk = (dc.resolve_items_json_key(k) or k).strip().lower()
        at = int(activity_t.get(rk, -10**9))
        pt = int(purchase_t.get(rk, -10**9))
        row = dc.items.get(rk) or {}
        try:
            cost = int(row.get("cost") or 0)
        except (TypeError, ValueError):
            cost = 0
        return (max(at, pt), at, cost)

    for grp in _ITEM_CONFLICT_GROUPS:
        idxs: List[int] = []
        keys: List[str] = []
        for i in range(min(6, len(main))):
            k = main[i]
            if not k:
                continue
            rk = (dc.resolve_items_json_key(k) or k).strip().lower()
            if rk in grp:
                idxs.append(i)
                keys.append(rk)
        if len(idxs) <= 1:
            continue
        keep = max(keys, key=_score)
        for i in idxs:
            k = main[i]
            if not k:
                continue
            rk = (dc.resolve_items_json_key(k) or k).strip().lower()
            if rk != keep:
                main[i] = None


def _apply_upgrade_dedupe_on_items_slot(
    items_slot: List[Dict[str, Any]],
    dc: Any,
) -> None:
    """对主栏 items_slot 做升级链去重（保留高阶，低阶清空）。"""
    if not isinstance(items_slot, list) or len(items_slot) < 1:
        return
    keys: List[Optional[str]] = []
    for i in range(min(6, len(items_slot))):
        c = items_slot[i]
        if not isinstance(c, dict):
            keys.append(None)
            continue
        ik = c.get("item_key")
        keys.append(str(ik).strip() if ik else None)
    before = list(keys)
    _apply_item_upgrade_dedupe(keys, dc)
    before_n = sum(1 for k in before if k)
    after_n = sum(1 for k in keys if k)
    # 若去重后主栏过于稀疏（常见于旧数据把升级链写满 0..5），宁可保留原槽位，避免“只剩 1-2 件”。
    if before_n >= 5 and after_n <= 2:
        return
    for i in range(min(6, len(items_slot))):
        if before[i] and not keys[i]:
            items_slot[i] = {
                "slot": i,
                "item_id": 0,
                "item_key": None,
                "item_name_en": "",
                "item_name_cn": "",
                "image_url": "",
                "empty": True,
            }


def _aghanims_from_main_keys(keys: List[Optional[str]]) -> Tuple[bool, bool]:
    """仅根据终局主槽 6 格 item_key 推断神杖/魔晶（与物品栏一致）。"""
    scep = shard = False
    for k in keys:
        if not k:
            continue
        if k in ("ultimate_scepter", "ultimate_scepter_2"):
            scep = True
        elif k == "aghanims_shard":
            shard = True
    return scep, shard


def _build_endgame_main_six_item_keys(
    events: List[dict], hero_npc: str, dc: Any, match_end_time: Optional[int] = None
) -> List[Optional[str]]:
    """
    回退路径：仅当无 interval 快照且无 players item_* 时使用。
    1) 先收集 PURCHASE 且带 HUD slot 0..5、且 time>=0 的最后一次（忽略选人阶段假槽位）。
    2) 若带 slot 的购买覆盖 **少于 4 个不同槽位**：不用 DOTA_COMBATLOG_ITEM / 按时间硬塞格，
       改由 ``_refill_main_six_strip_invalid`` 用剪枝后的购买池填充（减少配方件误占主栏）。
    3) 若覆盖 ≥4 槽：沿用 ITEM 活动 + 无槽购买补空；``fill_empty_from_pool=False`` 保留 HUD 空档。
    """
    main: List[Optional[str]] = [None] * 6
    slot_best: Dict[int, Tuple[int, str]] = {}
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_PURCHASE":
            continue
        if not _targetname_matches_hero_npc(str(e.get("targetname") or ""), hero_npc):
            continue
        key = _item_key_from_valuename(str(e.get("valuename") or ""))
        if not key:
            continue
        sl = e.get("slot")
        if sl is None:
            continue
        try:
            si = int(sl)
        except (TypeError, ValueError):
            continue
        if si < 0 or si > 5:
            continue
        t = int(e.get("time") or 0)
        # 选人/开局前 (time<0) 的购买常全部标 slot 0，会误判为 HUD 槽位；只采信正式比赛内的槽点。
        if t < 0:
            continue
        if match_end_time is not None and t > int(match_end_time):
            continue
        prev = slot_best.get(si)
        if prev is None or t >= prev[0]:
            slot_best[si] = (t, key)
    for si, (_t, key) in slot_best.items():
        if 0 <= si <= 5:
            main[si] = key
    _apply_item_upgrade_dedupe(main, dc)
    _apply_item_conflict_priority(
        main,
        events,
        hero_npc,
        dc,
        match_end_time=match_end_time,
    )
    present: Set[str] = {k for k in main if k}
    # 仅当战斗日志里「带 HUD slot」的购买覆盖足够多时，才信任按槽推断并禁止左移补位。
    # 部分解析器几乎不给 slot（或只有开局 1 格），若仍走严格路径会把唯一一格清成消耗品后全空。
    have_slot_purchases_strict = len(slot_best) >= 4

    allow_item_activity_fallback = str(hero_npc or "").startswith(
        "npc_dota_lone_druid_bear"
    )
    if not have_slot_purchases_strict and not allow_item_activity_fallback:
        # 无可靠 HUD 槽时：DOTA_COMBATLOG_ITEM / 按时间塞格会把配方、施法涉及的散件当成「在栏装备」。
        # 改由下方 _refill_main_six_strip_invalid 用「已剪枝的购买池」从左到右填 6 格。
        pass
    else:
        activity: List[str] = []
        seen_act: Set[str] = set()
        for e in reversed(events):
            if e.get("type") != "DOTA_COMBATLOG_ITEM":
                continue
            if not _item_event_matches_unit(e, hero_npc):
                continue
            et = e.get("time")
            if match_end_time is not None and isinstance(et, (int, float)) and int(et) > int(match_end_time):
                continue
            key = _item_key_from_valuename(str(e.get("inflictor") or ""))
            if not key or _item_is_disposable_main_inventory(dc, key):
                continue
            if _item_allowed_neutral_trinket(dc, key):
                continue
            if key in seen_act or key in present:
                continue
            seen_act.add(key)
            activity.append(key)

        ai = 0
        for i in range(6):
            if main[i]:
                continue
            while ai < len(activity) and activity[ai] in present:
                ai += 1
            if ai >= len(activity):
                break
            main[i] = activity[ai]
            present.add(activity[ai])
            ai += 1

        if any(x is None for x in main):
            last_t: Dict[str, int] = {}
            for e in events:
                if e.get("type") != "DOTA_COMBATLOG_PURCHASE":
                    continue
                if not _targetname_matches_hero_npc(str(e.get("targetname") or ""), hero_npc):
                    continue
                key = _item_key_from_valuename(str(e.get("valuename") or ""))
                if not key or _item_is_disposable_main_inventory(dc, key):
                    continue
                if _item_allowed_neutral_trinket(dc, key):
                    continue
                sl = e.get("slot")
                if sl is not None:
                    try:
                        svi = int(sl)
                        if svi < 0 or svi > 5:
                            continue
                    except (TypeError, ValueError):
                        continue
                t = int(e.get("time") or 0)
                if match_end_time is not None and t > int(match_end_time):
                    continue
                last_t[key] = t
            for k in sorted(last_t.keys(), key=lambda x: last_t[x], reverse=True):
                if all(x is not None for x in main):
                    break
                if k in present:
                    continue
                for i in range(6):
                    if main[i] is None:
                        main[i] = k
                        present.add(k)
                        break

    fill_from_pool = (not have_slot_purchases_strict) and (not allow_item_activity_fallback)
    _refill_main_six_strip_invalid(
        main,
        events,
        hero_npc,
        dc,
        fill_empty_from_pool=fill_from_pool,
        match_end_time=match_end_time,
    )
    _apply_item_upgrade_dedupe(main, dc)
    _apply_item_conflict_priority(
        main,
        events,
        hero_npc,
        dc,
        match_end_time=match_end_time,
    )
    return main


def _main_six_items_slot_from_combat_log(
    events: List[dict],
    hero_npc: str,
    dc: Any,
    match_end_time: Optional[int] = None,
) -> List[Optional[Dict[str, Any]]]:
    keys = _build_endgame_main_six_item_keys(
        events, hero_npc, dc, match_end_time=match_end_time
    )
    out: List[Optional[Dict[str, Any]]] = []
    for i in range(6):
        k = keys[i]
        if not k:
            out.append(None)
        else:
            out.append(_item_slot_dict_from_key(k, i, dc))
    return out


def _ability_upgrades_arr_for_slot(
    events: List[dict],
    slot: int,
    players_blob: Optional[List[Dict[str, Any]]],
) -> Optional[List[Any]]:
    """
    从 players_blob 中按 logical_player_slot 匹配 ability_upgrades_arr。
    不得用 players_blob[slot] 下标：该数组顺序未必与 0–9 号位一致（如先 Radiant 再 Dire），
    否则会错拿他人加点顺序。
    若无匹配则扫描事件中带 slot 的 ability_upgrades_arr（取最后一次）。
    """
    if players_blob:
        for pb in players_blob:
            if not isinstance(pb, dict):
                continue
            ls = logical_player_slot(pb.get("player_slot", pb.get("slot")))
            if ls is not None and ls != slot:
                continue
            arr = pb.get("ability_upgrades_arr")
            if isinstance(arr, list) and arr:
                return arr
    last: Optional[List[Any]] = None
    for e in events:
        arr = e.get("ability_upgrades_arr")
        if arr is None or not isinstance(arr, list):
            continue
        es = e.get("slot")
        if es is not None and int(es) != slot:
            continue
        last = arr
    return last


def _talent_picks_for_slot(
    players_blob: Optional[List[Dict[str, Any]]],
    slot: int,
) -> List[Dict[str, Any]]:
    """
    从 players[slot] 读取 talent_picks：与本项目约定一致的对象数组，例如
    { \"talent_id\": 24, \"level\": 10, \"direction\": \"left\", \"talent_name\": \"+8 力量\" }。
    """
    if not players_blob or slot < 0:
        return []
    if slot < len(players_blob):
        pb = players_blob[slot]
        if isinstance(pb, dict):
            tp = pb.get("talent_picks")
            if isinstance(tp, list) and tp:
                return [x for x in tp if isinstance(x, dict)]
    for pb in players_blob:
        if not isinstance(pb, dict):
            continue
        ls = logical_player_slot(pb.get("player_slot", pb.get("slot")))
        if ls is not None and ls != slot:
            continue
        tp = pb.get("talent_picks")
        if isinstance(tp, list) and tp:
            return [x for x in tp if isinstance(x, dict)]
    return []


def build_slim_from_dem_events(
    events: List[dict],
    players_blob: Optional[List[Dict[str, Any]]] = None,
    player_resource: Any = None,
) -> Dict[str, Any]:
    dc = get_constants()
    pro_rows = load_or_fetch_pro_players(dc.cache_dir)
    hero_abilities_map = load_hero_abilities_map(dc.cache_dir)

    mid, gwinner, _ = _epilogue_meta(events)
    match_end_time = _match_end_time_sec(events)
    name_by_hero = _epilogue_player_names(events)
    steam_acc = _epilogue_steam_account_by_hero(events)
    slot_hero = _slot_hero_from_intervals(events)
    last_iv = _last_intervals(events)
    pr_parsed = _parse_player_resource_blob(player_resource)
    interval_rad_map: Optional[Dict[int, bool]] = None
    if pr_parsed:
        interval_rad_map = _interval_slot_is_radiant_from_player_resource(
            slot_hero, pr_parsed
        )
    lane_role_by_slot = _infer_lane_and_role_by_slot(
        events, dc, interval_slot_is_radiant=interval_rad_map
    )
    agg = _aggregate_combat(events)

    account_to_slot: Dict[int, int] = {}
    hero_npc_to_slot: Dict[str, int] = {}
    slot_to_hero_npc: Dict[int, str] = {}
    for sl, (_hid, unit) in slot_hero.items():
        hi = _hero_internal_from_unit(unit)
        hnpc = f"npc_dota_hero_{hi}"
        hero_npc_to_slot[hnpc] = int(sl)
        slot_to_hero_npc[int(sl)] = hnpc
        # odota 部分录像里 targetname 为无下划线后缀（如 chaosknight），与 chaos_knight 不一致
        compact = f"npc_dota_hero_{hi.replace('_', '')}"
        if compact != hnpc:
            hero_npc_to_slot[compact] = int(sl)
        acc_ep = steam_acc.get(hnpc)
        if acc_ep is not None:
            account_to_slot[int(acc_ep)] = int(sl)

    upgrades_from_raw_events = ability_upgrade_merged_steps_from_raw_events(
        events,
        account_to_slot=account_to_slot,
        dc=dc,
        hero_npc_to_slot=hero_npc_to_slot,
        hero_abilities_map=hero_abilities_map,
        slot_to_hero_npc=slot_to_hero_npc,
    )

    radiant_win: Optional[bool] = None
    if gwinner == 2:
        radiant_win = True
    elif gwinner == 3:
        radiant_win = False

    max_t = max((e.get("time") or 0) for e in events if isinstance(e.get("time"), (int, float)))
    duration_sec = int(max_t) if max_t else 0

    team_by_hero = _parse_epilogue_team_by_hero(events)
    interval_players: Dict[int, Dict[str, Any]] = {}
    for slot in range(10):
        if slot not in slot_hero:
            continue
        hid, unit = slot_hero[slot]
        hero_internal = _hero_internal_from_unit(unit)
        hero_npc = f"npc_dota_hero_{hero_internal}"
        display = name_by_hero.get(hero_npc) or f"Player_{slot}"
        account_id = steam_acc.get(hero_npc)
        pro_name, team_name = match_pro_player(account_id, pro_rows)

        iv = last_iv.get(slot) or {}
        gpm = 0.0
        xpm = 0.0
        if duration_sec > 0:
            gpm = (float(iv.get("gold") or 0) * 60.0) / duration_sec
            xpm = (float(iv.get("xp") or 0) * 60.0) / duration_sec

        pb_for_row: Optional[Dict[str, Any]] = None
        if players_blob and slot < len(players_blob):
            tpb = players_blob[slot]
            if isinstance(tpb, dict):
                pb_for_row = tpb

        hero_dmg = int(agg["hero"].get(hero_npc, 0))
        tower_dmg = int(agg["tower"].get(hero_npc, 0))
        hero_heal = int(agg["heal"].get(hero_npc, 0))
        starting_items = _starting_items_from_purchases(events, hero_npc, dc)
        # 解析器 / 本地 JSON 若已带结算统计，优先于战斗日志累加（无 OpenDota 时与客户端对齐）
        if pb_for_row is not None:
            if "hero_damage" in pb_for_row:
                try:
                    hero_dmg = int(pb_for_row["hero_damage"])
                except (TypeError, ValueError):
                    pass
            if "tower_damage" in pb_for_row:
                try:
                    tower_dmg = int(pb_for_row["tower_damage"])
                except (TypeError, ValueError):
                    pass
            if "hero_healing" in pb_for_row:
                try:
                    hero_heal = int(pb_for_row["hero_healing"])
                except (TypeError, ValueError):
                    pass

        up_arr = _ability_upgrades_arr_for_slot(events, slot, players_blob)
        merged_ev = upgrades_from_raw_events.get(slot)
        rows_from_arr: List[Dict[str, Any]] = []
        if up_arr:
            rows_from_arr = raw_ability_upgrades_arr_to_merged_steps(
                up_arr,
                match_duration_sec=duration_sec if duration_sec > 0 else None,
            )
        ev_list: List[Dict[str, Any]] = (
            [dict(x) for x in merged_ev] if merged_ev else []
        )
        # interval「networth/gold == ability_id」与真实经济数值大量撞车（如 Tiny 天赋 718
        # 与 ~718 经济）；且合并后带 time 的步骤会排在无 time 的 ability_upgrades_arr 之前，
        # 易污染 skill_build 前 25 步与天赋左右档推断。已有 arr 时不再合并该启发式。
        interval_talent_sig: List[Dict[str, Any]] = []
        # interval「networth == ability_id」与真实经济大量撞车；一旦已有录像级加点事件流
        #（DOTA_ABILITY_LEVEL 等），再合并会把假天赋插进前几步，与客户端 1～9 级加点行错位。
        if not rows_from_arr and not ev_list:
            interval_talent_sig = talent_signal_steps_from_interval_networth(
                events, slot, hero_npc, hero_abilities_map, dc
            )
        merged_full: Optional[List[Dict[str, Any]]] = None
        # 与客户端一致：players[].ability_upgrades_arr / 录像解析出的顺序即真实加点顺序。
        # 若再与 ev_list（带 time）合并后按时间排序，会把无时间的 arr 整段挤到末尾，
        # skill_build 前若干步变成事件流噪声，与客户端 1～9 级完全对不上。
        if rows_from_arr:
            merged_base = [dict(x) for x in rows_from_arr]
        else:
            merged_base = merge_ability_upgrade_step_lists([], ev_list)
        merged_full = merge_ability_upgrade_step_lists(
            merged_base, interval_talent_sig
        )
        merged_for_tree: Optional[List[Dict[str, Any]]] = None
        if merged_full:
            merged_for_skill = filter_merged_steps_for_client_skill_bar(
                merged_full, dc
            )
            skill_build = skill_build_v2_from_merged_upgrades(
                merged_for_skill, dc, pad_to=25
            )
            merged_for_tree = merged_for_skill
        else:
            skill_build = skill_build_from_dem_ability_combat(
                events, hero_npc, dc, pad_to=25
            )
            merged_for_tree = merged_base if merged_base else None
        talent_extra = talent_keys_guessed_from_combat_log(events, hero_npc)
        talent_tree = build_talent_tree(
            hero_npc,
            skill_build,
            hero_abilities_map,
            dc,
            extra_talent_keys=talent_extra,
            merged_upgrade_steps=merged_for_tree,
        )
        parser_talent_picks = _talent_picks_for_slot(players_blob, slot)
        inf_tp = infer_talent_picks_from_hero_abilities_indices(
            dc,
            hero_npc,
            hero_abilities_map,
            skill_build,
            merged_for_tree,
        )
        merged_tp = merge_talent_pick_lists(parser_talent_picks, inf_tp)
        if merged_tp:
            talent_tree = merge_talent_tree_from_parser_picks(
                talent_tree, merged_tp
            )

        items_slot: Optional[List[Dict[str, Any]]] = None
        neutral_img: str = ""
        neutral_item_key_out: Optional[str] = None
        dem_items_source = "combat_log_slot_last_purchase"
        ld_split_bear_pool: Optional[List[str]] = None

        # 1) interval 终局库存：先取「全录像中该 slot 时间最大的带装备快照」，再回退到最后一条 interval
        b_iv = _best_interval_inventory_bundle_for_slot(events, slot, dc)
        if b_iv is not None and _items_slot_has_equipped(b_iv[0]):
            items_slot, neutral_img, neutral_item_key_out = b_iv
            dem_items_source = "interval_max_time_inventory_snapshot"
        else:
            b_iv = _endgame_inventory_bundle_from_interval(iv, dc)
            if b_iv is not None and _items_slot_has_equipped(b_iv[0]):
                items_slot, neutral_img, neutral_item_key_out = b_iv
                dem_items_source = "interval_endgame_snapshot"

        # 2) players[] 上 OpenDota 式 item_*（通常为解析器导出的结算栏）
        if pb_for_row is not None:
            inv = _inventory_from_api_style_player(pb_for_row, dc)
            if inv and _items_slot_has_equipped(inv[0]) and items_slot is None:
                items_slot, neutral_img, neutral_item_key_out = inv
                dem_items_source = "api_item_slots"

        nk = _last_neutral_key(events, slot)
        nk_snake = normalize_dem_neutral_key(nk) if nk else ""
        if items_slot is None:
            neutral_item_id = 0
            if nk_snake and nk_snake in dc.items:
                try:
                    neutral_item_id = int(dc.items[nk_snake].get("id") or 0)
                except (TypeError, ValueError):
                    neutral_item_id = 0
            neutral_img = get_cdn_neutral_img(
                neutral_item_id,
                dc,
                item_key_hint=nk_snake or None,
            )
            neutral_item_key_out = nk_snake or None

            items_slot = _main_six_items_slot_from_combat_log(
                events, hero_npc, dc, match_end_time=match_end_time
            )
            if hero_internal == "lone_druid":
                bear_pre = _pick_lone_druid_bear_npc(
                    events,
                    slot,
                    match_end_time=match_end_time,
                    fallback_npc="npc_dota_lone_druid_bear1",
                )
                if bear_pre:
                    h_pool, b_pool = _lone_druid_partition_purchase_pools(
                        events,
                        hero_npc,
                        bear_pre,
                        dc,
                        match_end_time=match_end_time,
                    )
                    h6 = _main_six_keys_from_ordered_unique_pool(
                        h_pool,
                        events,
                        hero_npc,
                        dc,
                        match_end_time=match_end_time,
                    )
                    items_slot = []
                    for i in range(6):
                        k = h6[i] if i < len(h6) else None
                        if k:
                            items_slot.append(_item_slot_dict_from_key(k, i, dc))
                        else:
                            items_slot.append(
                                {
                                    "slot": i,
                                    "item_id": 0,
                                    "item_key": None,
                                    "item_name_en": "",
                                    "item_name_cn": "",
                                    "image_url": "",
                                    "empty": True,
                                }
                            )
                    _lone_druid_fill_starting_branches_on_hero_items_slot(
                        items_slot, starting_items, dc
                    )
                    ld_split_bear_pool = b_pool
                    dem_items_source = "combat_log_lone_druid_split"
        elif not (str(neutral_item_key_out or "").strip()) and not str(
            neutral_img or ""
        ).strip():
            # 主栏已有快照，但中立未写入时，用 neutral_item_history 补圆槽
            neutral_item_id = 0
            if nk_snake and nk_snake in dc.items:
                try:
                    neutral_item_id = int(dc.items[nk_snake].get("id") or 0)
                except (TypeError, ValueError):
                    neutral_item_id = 0
            neutral_img = get_cdn_neutral_img(
                neutral_item_id,
                dc,
                item_key_hint=nk_snake or None,
            )
            neutral_item_key_out = nk_snake or None
        neutral_img, neutral_item_key_out = _sanitize_player_neutral_fields(
            dc, str(neutral_img or ""), neutral_item_key_out
        )
        while len(items_slot) < 6:
            items_slot.append(None)
        items_slot = items_slot[:6]
        for i in range(6):
            if items_slot[i] is None:
                items_slot[i] = {
                    "slot": i,
                    "item_id": 0,
                    "item_key": None,
                    "item_name_en": "",
                    "item_name_cn": "",
                    "image_url": "",
                    "empty": True,
                }
        _apply_upgrade_dedupe_on_items_slot(items_slot, dc)
        _strip_neutral_trinkets_from_items_slot_main(items_slot, dc)

        bear_items_slot: Optional[List[Dict[str, Any]]] = None
        if hero_internal == "lone_druid":
            bear_npc = _pick_lone_druid_bear_npc(
                events,
                slot,
                match_end_time=match_end_time,
                fallback_npc="npc_dota_lone_druid_bear1",
            )
            if bear_npc:
                if ld_split_bear_pool is not None:
                    b6 = _main_six_keys_from_ordered_unique_pool(
                        ld_split_bear_pool,
                        events,
                        bear_npc,
                        dc,
                        match_end_time=match_end_time,
                    )
                    bear_items_slot = []
                    for i in range(6):
                        k = b6[i] if i < len(b6) else None
                        if k:
                            bear_items_slot.append(
                                _item_slot_dict_from_key(k, i, dc)
                            )
                        else:
                            bear_items_slot.append(
                                {
                                    "slot": i,
                                    "item_id": 0,
                                    "item_key": None,
                                    "item_name_en": "",
                                    "item_name_cn": "",
                                    "image_url": "",
                                    "empty": True,
                                }
                            )
                else:
                    bear_items_slot = _main_six_items_slot_from_combat_log(
                        events,
                        bear_npc,
                        dc,
                        match_end_time=match_end_time,
                    )
                while len(bear_items_slot) < 6:
                    bear_items_slot.append(None)
                bear_items_slot = bear_items_slot[:6]
                for i in range(6):
                    if bear_items_slot[i] is None:
                        bear_items_slot[i] = {
                            "slot": i,
                            "item_id": 0,
                            "item_key": None,
                            "item_name_en": "",
                            "item_name_cn": "",
                            "image_url": "",
                            "empty": True,
                        }
                _apply_upgrade_dedupe_on_items_slot(bear_items_slot, dc)
                _strip_neutral_trinkets_from_items_slot_main(bear_items_slot, dc)
                # 熊灵专属：纯解析日志下常缺购买槽位，仅有 ITEM 活动证据（如 madstone_bundle/flayers_bota）。
                # 对这类活动证据做温和回填，优先补空格，避免把明确活动物品全过滤掉。
                bear_present: Set[str] = set()
                for _c in bear_items_slot[:6]:
                    if not isinstance(_c, dict):
                        continue
                    _k = str(_c.get("item_key") or "").strip().lower()
                    if _k:
                        bear_present.add((dc.resolve_items_json_key(_k) or _k).strip().lower())
                bear_activity_pool = _unit_item_activity_keys_newest_first(
                    events,
                    bear_npc,
                    dc,
                    match_end_time=match_end_time,
                )
                for _i in range(6):
                    _c = bear_items_slot[_i]
                    _empty = True
                    if isinstance(_c, dict):
                        _empty = bool(_c.get("empty") is True) or not str(_c.get("item_key") or "").strip()
                    if not _empty:
                        continue
                    pick_key: Optional[str] = None
                    for _k in bear_activity_pool:
                        if _k in bear_present:
                            continue
                        if _forbidden_in_main_six(dc, _k):
                            continue
                        pick_key = _k
                        break
                    if not pick_key:
                        continue
                    bear_items_slot[_i] = _item_slot_dict_from_key(pick_key, _i, dc)
                    bear_present.add(pick_key)
                # 回填后再次清理，确保中立/消耗品不会混入熊灵主 6 格
                _strip_neutral_trinkets_from_items_slot_main(bear_items_slot, dc)
                _dedupe_lone_druid_hero_bear_overlap(
                    items_slot,
                    bear_items_slot,
                    events,
                    hero_npc,
                    bear_npc,
                    dc,
                    match_end_time=match_end_time,
                )
                # 解析文件仅有 combat_log 且本体/熊灵主装高度重叠时，
                # 本体常被“代买给熊灵”的记录污染。此时做保守回退：
                # 若开局枝干证据充足（>=5），本体展示 5 根枝干 + 1 空格。
                if dem_items_source == "combat_log_slot_last_purchase":
                    hero_keys_now = [
                        (str(c.get("item_key") or "").strip().lower() if isinstance(c, dict) else "")
                        for c in items_slot[:6]
                    ]
                    bear_keys_now = [
                        (str(c.get("item_key") or "").strip().lower() if isinstance(c, dict) else "")
                        for c in bear_items_slot[:6]
                    ]
                    overlap_now = {
                        (dc.resolve_items_json_key(k) or k).strip().lower()
                        for k in hero_keys_now
                        if k
                    } & {
                        (dc.resolve_items_json_key(k) or k).strip().lower()
                        for k in bear_keys_now
                        if k
                    }
                    branches_ct = 0
                    for _st in starting_items:
                        if not isinstance(_st, dict):
                            continue
                        _k = str(_st.get("item_key") or "").strip().lower()
                        _rk = (dc.resolve_items_json_key(_k) or _k).strip().lower()
                        if _rk != "branches":
                            continue
                        try:
                            branches_ct = int(_st.get("count") or 0)
                        except (TypeError, ValueError):
                            branches_ct = 0
                        break
                    # 仅有解析日志时，本体栏位常严重失真；若开局枝干证据充足，优先展示客户端常见的枝干残局形态。
                    if branches_ct >= 4:
                        hero_seen = _unit_item_last_seen_times(
                            events, hero_npc, dc, match_end_time=match_end_time
                        )
                        has_boots_evidence = (
                            "boots" in hero_seen
                            or "power_treads" in hero_seen
                            or "travel_boots" in hero_seen
                            or "travel_boots_2" in hero_seen
                        )
                        has_circlet = False
                        has_slippers = False
                        has_quelling = False
                        for _st in starting_items:
                            if not isinstance(_st, dict):
                                continue
                            _k = str(_st.get("item_key") or "").strip().lower()
                            _rk = (dc.resolve_items_json_key(_k) or _k).strip().lower()
                            if _rk == "circlet":
                                has_circlet = True
                            elif _rk == "slippers":
                                has_slippers = True
                            elif _rk == "quelling_blade":
                                has_quelling = True
                        patched: List[Dict[str, Any]] = []
                        base_keys: List[Optional[str]] = []
                        if has_slippers and not has_circlet:
                            if has_boots_evidence:
                                base_keys.append("boots")
                            base_keys.append("slippers")
                            if has_quelling:
                                base_keys.append("quelling_blade")
                            while len(base_keys) < 5:
                                base_keys.append("branches")
                            base_keys.append(None)
                        elif has_circlet or has_slippers:
                            if has_boots_evidence:
                                base_keys.append("boots")
                            if has_circlet:
                                base_keys.append("circlet")
                            if has_slippers:
                                base_keys.append("slippers")
                            while len(base_keys) < 5:
                                base_keys.append("branches")
                            base_keys.append(None)
                        else:
                            base_keys = ["branches", "branches", "branches", "branches", "branches", None]
                        for _i in range(6):
                            _k = base_keys[_i]
                            if _k:
                                patched.append(_item_slot_dict_from_key(_k, _i, dc))
                            else:
                                patched.append(
                                    {
                                        "slot": _i,
                                        "item_id": 0,
                                        "item_key": None,
                                        "item_name_en": "",
                                        "item_name_cn": "",
                                        "image_url": "",
                                        "empty": True,
                                    }
                                )
                        items_slot = patched
                        has_scepter_evidence = (
                            "ultimate_scepter" in hero_seen
                            or "ultimate_scepter_2" in hero_seen
                        )
                        # 这类回退场景按用户对照：神杖应归熊灵栏位，不挂在本体 5 树枝上
                        if has_scepter_evidence and isinstance(bear_items_slot, list):
                            has_bear_scepter = any(
                                isinstance(_c, dict)
                                and str(_c.get("item_key") or "").strip().lower()
                                in ("ultimate_scepter", "ultimate_scepter_2")
                                for _c in bear_items_slot[:6]
                            )
                            if not has_bear_scepter:
                                for _j in range(6):
                                    _c = bear_items_slot[_j]
                                    _empty = True
                                    if isinstance(_c, dict):
                                        _empty = bool(_c.get("empty") is True) or not str(
                                            _c.get("item_key") or ""
                                        ).strip()
                                    if not _empty:
                                        continue
                                    bear_items_slot[_j] = _item_slot_dict_from_key(
                                        "ultimate_scepter", _j, dc
                                    )
                                    break
                        # 枝干回退场景：熊灵栏位常因无 purchase 槽而过稀，补齐“熊灵活动证据 + 本体可转移核心件”
                        if isinstance(bear_items_slot, list):
                            bear_seen = _unit_item_last_seen_times(
                                events, bear_npc, dc, match_end_time=match_end_time
                            )
                            # 本体证据可作为“可能转移给熊灵”的候选（仅核心件）
                            transfer_allow = {
                                "mask_of_madness",
                                "power_treads",
                                "boots",
                                "maelstrom",
                                "ultimate_scepter",
                                "diffusal_blade",
                                "silver_edge",
                                "invis_sword",
                                "madstone_bundle",
                            }
                            cand_seen: Dict[str, int] = {}
                            for _k, _t in bear_seen.items():
                                if _k in transfer_allow:
                                    cand_seen[_k] = max(cand_seen.get(_k, -10**9), int(_t))
                            for _k, _t in hero_seen.items():
                                if _k in transfer_allow:
                                    cand_seen[_k] = max(cand_seen.get(_k, -10**9), int(_t))
                            ordered_cands = [
                                _k
                                for _k, _ in sorted(
                                    cand_seen.items(), key=lambda kv: kv[1], reverse=True
                                )
                            ]
                            bear_present2: Set[str] = set()
                            for _c in bear_items_slot[:6]:
                                if not isinstance(_c, dict):
                                    continue
                                _k = str(_c.get("item_key") or "").strip().lower()
                                if not _k:
                                    continue
                                bear_present2.add(
                                    (dc.resolve_items_json_key(_k) or _k).strip().lower()
                                )
                            for _i in range(6):
                                _c = bear_items_slot[_i]
                                _empty = True
                                if isinstance(_c, dict):
                                    _empty = bool(_c.get("empty") is True) or not str(
                                        _c.get("item_key") or ""
                                    ).strip()
                                if not _empty:
                                    continue
                                _pick: Optional[str] = None
                                for _k in ordered_cands:
                                    if _k in bear_present2:
                                        continue
                                    if _k != "madstone_bundle" and _forbidden_in_main_six(dc, _k):
                                        continue
                                    _pick = _k
                                    break
                                if not _pick:
                                    continue
                                bear_items_slot[_i] = _item_slot_dict_from_key(_pick, _i, dc)
                                bear_present2.add(_pick)
                            # 兜底：按熊灵常见终局优先项补齐空槽（用于无快照且日志稀疏场）
                            priority_fill: List[str] = []
                            if (
                                "mask_of_madness" in bear_seen
                                or "mask_of_madness" in hero_seen
                            ):
                                priority_fill.append("mask_of_madness")
                            if has_scepter_evidence:
                                priority_fill.append("ultimate_scepter")
                            if "madstone_bundle" in bear_seen:
                                priority_fill.append("madstone_bundle")
                            if has_boots_evidence:
                                priority_fill.append("boots")
                            if branches_ct > 0:
                                priority_fill.append("branches")
                            for _k in priority_fill:
                                _rk = (dc.resolve_items_json_key(_k) or _k).strip().lower()
                                if _rk in bear_present2:
                                    continue
                                if _rk != "madstone_bundle" and _forbidden_in_main_six(
                                    dc, _rk
                                ):
                                    continue
                                for _i in range(6):
                                    _c = bear_items_slot[_i]
                                    _empty = True
                                    if isinstance(_c, dict):
                                        _empty = bool(_c.get("empty") is True) or not str(
                                            _c.get("item_key") or ""
                                        ).strip()
                                    if not _empty:
                                        continue
                                    bear_items_slot[_i] = _item_slot_dict_from_key(
                                        _rk, _i, dc
                                    )
                                    bear_present2.add(_rk)
                                    break

                # 最终兜底：若独行德鲁伊开局枝干明显（>=3）且熊灵已有多件终局装，
                # 本体主栏改为“开局轻装形态”（鞋/敏捷便鞋/补刀斧/树枝），避免把熊灵大件留在本体。
                if isinstance(bear_items_slot, list):
                    bear_non_empty = sum(
                        1
                        for _c in bear_items_slot[:6]
                        if isinstance(_c, dict)
                        and not bool(_c.get("empty") is True)
                        and str(_c.get("item_key") or "").strip()
                    )
                else:
                    bear_non_empty = 0
                st_branches = 0
                st_has_slippers = False
                st_has_quelling = False
                st_has_circlet = False
                for _st in starting_items:
                    if not isinstance(_st, dict):
                        continue
                    _k = str(_st.get("item_key") or "").strip().lower()
                    _rk = (dc.resolve_items_json_key(_k) or _k).strip().lower()
                    if _rk == "branches":
                        try:
                            st_branches = int(_st.get("count") or 0)
                        except (TypeError, ValueError):
                            st_branches = 0
                    elif _rk == "slippers":
                        st_has_slippers = True
                    elif _rk == "circlet":
                        st_has_circlet = True
                    elif _rk == "quelling_blade":
                        st_has_quelling = True
                light_profile_no_slippers = (
                    st_branches == 3
                    and st_has_quelling
                    and (not st_has_slippers)
                    and (not st_has_circlet)
                )
                if (
                    dem_items_source == "combat_log_slot_last_purchase"
                    and (
                        (st_branches >= 3 and bear_non_empty >= 3)
                        or light_profile_no_slippers
                    )
                ):
                    hero_seen2 = _unit_item_last_seen_times(
                        events, hero_npc, dc, match_end_time=match_end_time
                    )
                    light_keys: List[Optional[str]] = []
                    if (
                        "boots" in hero_seen2
                        or "power_treads" in hero_seen2
                        or "travel_boots" in hero_seen2
                        or "travel_boots_2" in hero_seen2
                    ):
                        light_keys.append("boots")
                    if st_has_slippers:
                        light_keys.append("slippers")
                    if st_has_quelling and not light_profile_no_slippers:
                        light_keys.append("quelling_blade")
                    target_fill = 3 if light_profile_no_slippers else (5 if (st_has_slippers or st_has_quelling) else 3)
                    while len(light_keys) < target_fill:
                        light_keys.append("branches")
                    while len(light_keys) < 6:
                        light_keys.append(None)
                    patched2: List[Dict[str, Any]] = []
                    for _i in range(6):
                        _k = light_keys[_i]
                        if _k:
                            patched2.append(_item_slot_dict_from_key(_k, _i, dc))
                        else:
                            patched2.append(
                                {
                                    "slot": _i,
                                    "item_id": 0,
                                    "item_key": None,
                                    "item_name_en": "",
                                    "item_name_cn": "",
                                    "image_url": "",
                                    "empty": True,
                                }
                            )
                    items_slot = patched2
                    # 3树枝+补刀斧且无便鞋/圆环：本体固定展示「鞋 + 2树枝」形态（其余空）
                    if light_profile_no_slippers:
                        items_slot = [
                            _item_slot_dict_from_key("boots", 0, dc),
                            _item_slot_dict_from_key("branches", 1, dc),
                            _item_slot_dict_from_key("branches", 2, dc),
                            {
                                "slot": 3,
                                "item_id": 0,
                                "item_key": None,
                                "item_name_en": "",
                                "item_name_cn": "",
                                "image_url": "",
                                "empty": True,
                            },
                            {
                                "slot": 4,
                                "item_id": 0,
                                "item_key": None,
                                "item_name_en": "",
                                "item_name_cn": "",
                                "image_url": "",
                                "empty": True,
                            },
                            {
                                "slot": 5,
                                "item_id": 0,
                                "item_key": None,
                                "item_name_en": "",
                                "item_name_cn": "",
                                "image_url": "",
                                "empty": True,
                            },
                        ]
                # 不再执行“强制去鞋”硬覆盖，避免误删仍在本体栏位中的鞋子。

        # 取消“3树枝场景强制3空格”最终覆盖，改用上游轻装回退与证据优先规则。

        keys_for_agh: List[Optional[str]] = []
        for _i in range(6):
            cell = items_slot[_i]
            if not isinstance(cell, dict):
                keys_for_agh.append(None)
                continue
            ik = cell.get("item_key")
            keys_for_agh.append(str(ik).strip() if ik else None)
        scep_i, shard_i = _aghanims_from_main_keys(keys_for_agh)
        agh_scep = (
            pb_for_row["aghanims_scepter"]
            if pb_for_row is not None and "aghanims_scepter" in pb_for_row
            else (1 if scep_i else 0)
        )
        agh_shard = (
            pb_for_row["aghanims_shard"]
            if pb_for_row is not None and "aghanims_shard" in pb_for_row
            else (1 if shard_i else 0)
        )

        player_row: Dict[str, Any] = {
                "account_id": account_id,
                "hero_id": hid,
                "personaname": display,
                "name": display,
                "pro_name": pro_name,
                "team_name": team_name,
                "level": int(iv.get("level") or 0),
                "kills": int(iv.get("kills") or 0),
                "deaths": int(iv.get("deaths") or 0),
                "assists": int(iv.get("assists") or 0),
                "last_hits": int(iv.get("lh") or 0),
                "denies": int(iv.get("denies") or 0),
                "gold_per_min": int(gpm),
                "xp_per_min": int(xpm),
                "hero_damage": hero_dmg,
                "tower_damage": tower_dmg,
                "hero_healing": hero_heal,
                "starting_items": starting_items,
                "net_worth": int(iv.get("networth") or 0),
                "items_slot": items_slot,
                "neutral_img": neutral_img,
                "aghanims_scepter": agh_scep,
                "aghanims_shard": agh_shard,
                "skill_build": skill_build,
                "talent_tree": talent_tree,
                "hero_name_en": hero_internal.replace("_", " ").title(),
                "hero_name_cn": "",
                "_dem_items_source": dem_items_source,
        }
        lane_role = lane_role_by_slot.get(slot) or {}
        lane_early = str(lane_role.get("lane_early") or "").strip()
        role_early = str(lane_role.get("role_early") or "").strip()
        support_item_points_early = int(
            lane_role.get("support_item_points_early") or 0
        )
        support_items_early = lane_role.get("support_items_early") or []
        if lane_early:
            player_row["lane_early"] = lane_early
        if role_early:
            player_row["role_early"] = role_early
        if support_item_points_early > 0:
            player_row["support_item_points_early"] = support_item_points_early
        if isinstance(support_items_early, list) and support_items_early:
            player_row["support_items_early"] = support_items_early
        if neutral_item_key_out:
            player_row["neutral_item_key"] = neutral_item_key_out
        if bear_items_slot is not None and _items_slot_has_equipped(bear_items_slot):
            player_row["spirit_bear_items_slot"] = bear_items_slot
        if merged_tp:
            player_row["talent_picks"] = merged_tp
        if up_arr:
            try:
                player_row["ability_upgrades_arr"] = [int(x) for x in up_arr]
            except (TypeError, ValueError):
                pass
        elif merged_ev:
            try:
                player_row["ability_upgrades_arr"] = [
                    int(x["ability_id"]) for x in merged_ev[:25]
                ]
            except (KeyError, TypeError, ValueError):
                pass
        # 战斗日志近似 / 管线已生成 skill_build 但未写 ability_upgrades_arr 时，
        # translate_match_data 会误用空合并覆盖 skill_build；补一份 ID 列表供其重建。
        if not player_row.get("ability_upgrades_arr") and skill_build:
            _ids: List[int] = []
            for sbstep in skill_build:
                if not isinstance(sbstep, dict):
                    continue
                if sbstep.get("type") == "empty":
                    continue
                try:
                    _aid = int(sbstep.get("ability_id") or 0)
                except (TypeError, ValueError):
                    _aid = 0
                if _aid > 0:
                    _ids.append(_aid)
            if _ids:
                player_row["ability_upgrades_arr"] = _ids[:25]
        interval_players[slot] = player_row

    assigned_via_pr = False
    if pr_parsed:
        pr_players = _assign_players_from_player_resource(
            interval_players, slot_hero, pr_parsed, pro_rows
        )
        if pr_players:
            players = pr_players
            assigned_via_pr = True
        else:
            players = _assign_player_slots_from_epilogue_teams(
                interval_players, slot_hero, team_by_hero, events
            )
    else:
        players = _assign_player_slots_from_epilogue_teams(
            interval_players, slot_hero, team_by_hero, events
        )

    raw_upgrade_evt_count = sum(len(v) for v in upgrades_from_raw_events.values())
    talent_layers_lit = 0
    for pl in players:
        if not isinstance(pl, dict):
            continue
        tt = pl.get("talent_tree")
        if isinstance(tt, dict):
            talent_layers_lit += int(tt.get("dots_learned") or 0)
    talent_inference: Dict[str, Any] = {
        "raw_ability_upgrade_like_events": raw_upgrade_evt_count,
        "talent_tree_selected_layers_total": talent_layers_lit,
    }
    if raw_upgrade_evt_count == 0:
        talent_inference["hint_zh"] = (
            "本场 JSON 中未发现可解析的加点事件（无数字 ability_id 的 ability_upgrade，"
            "且无带 valuename 的 DOTA_ABILITY_LEVEL，或缺少 hero→slot 映射）；"
            "若又无 players[].ability_upgrades_arr，则 skill_build 来自战斗日志近似，通常不含天赋 ID。"
            "天赋推断另支持：interval.networth/gold 等于天赋 ability_id 的约定、talent_picks、"
            "或 ability_upgrades_arr 中含 special_bonus。"
        )

    meta_out: Dict[str, Any] = {
        "source": "dem_result_json",
        "note": "dotaconstants；skill_build 优先 ability_upgrades_arr，其次原始事件 ability_upgrade 探矿，否则战斗日志近似；pro 见 .dota_cache/pro_players.json",
        "match_id": mid,
        "talent_inference": talent_inference,
    }
    if assigned_via_pr:
        meta_out["player_resource_team_assign"] = True
    return {
        "_meta": meta_out,
        "match_id": mid,
        "match_tier": "pub",
        "match_source": "local",
        "radiant_win": radiant_win if radiant_win is not None else True,
        "radiant_score": 0,
        "dire_score": 0,
        "duration": duration_sec,
        "league_name": "本地录像",
        "players": players,
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description="DEM result → latest_match.json（方式 A：events + players[].ability_upgrades_arr）",
    )
    ap.add_argument("result_json", type=Path, help="本地解析器 result.json（数组 或 {events, players}）")
    ap.add_argument(
        "-o",
        "--out",
        type=Path,
        default=OUT_DEFAULT,
        help="输出 latest_match.json",
    )
    ap.add_argument(
        "--players",
        type=Path,
        default=None,
        metavar="PATH",
        help="方式 A 补充：仅含 players 的 JSON（{players:[...]} 或数组），与主文件同下标合并",
    )
    ap.add_argument(
        "--merge-opendota",
        action="store_true",
        help="从 OpenDota API 拉取同 match_id 对局，合并 skill_build / talent_tree / 时间轴（补全天赋数据）",
    )
    ap.add_argument(
        "--opendota-match-id",
        type=int,
        default=None,
        metavar="ID",
        help="与 --merge-opendota 连用；省略则使用本局清洗出的 match_id",
    )
    ap.add_argument(
        "--inventory-overlay",
        type=Path,
        default=None,
        metavar="PATH",
        help=(
            "小 JSON：优先用 build_local_inventory_overlay.py（本地 parser，可手改 id）；"
            "或旧版 OpenDota 导出。仅合并终局 6 格+中立+神杖魔晶。若再用 --merge-opendota 会覆盖装备。"
        ),
    )
    args = ap.parse_args()

    raw = json.loads(args.result_json.read_text(encoding="utf-8"))
    events: List[dict] = []
    players_blob: Optional[List[Dict[str, Any]]] = None
    pr_input: Any = None
    if isinstance(raw, dict):
        ev = raw.get("events")
        if isinstance(ev, list):
            events = [e for e in ev if isinstance(e, dict)]
        pb = raw.get("players")
        if isinstance(pb, list):
            players_blob = [p for p in pb if isinstance(p, dict)]
        pr_input = raw.get("player_resource")
        if pr_input is None:
            pr_input = raw.get("player_resource_snapshot")
    elif isinstance(raw, list):
        events = [e for e in raw if isinstance(e, dict)]
    else:
        sys.exit("result.json 应为事件数组，或含 events 字段的对象")

    if args.players:
        if not args.players.is_file():
            sys.exit(f"--players 文件不存在: {args.players}")
        addon_raw = json.loads(args.players.read_text(encoding="utf-8"))
        addon_pl = _parse_players_addon(addon_raw)
        if not addon_pl:
            sys.exit("--players 需为非空 JSON 数组，或含非空 players 数组的对象")
        players_blob = _merge_player_blobs(players_blob, addon_pl)

    slim = build_slim_from_dem_events(
        events, players_blob=players_blob, player_resource=pr_input
    )

    if args.inventory_overlay:
        if not args.inventory_overlay.is_file():
            sys.exit(f"--inventory-overlay 文件不存在: {args.inventory_overlay}")
        ok_iv, msg_iv = merge_endgame_inventory_from_overlay_file(
            slim, args.inventory_overlay
        )
        print(
            "inventory overlay 合并终局装备:",
            "成功" if ok_iv else "失败",
            msg_iv,
        )

    if args.merge_opendota:
        mid = args.opendota_match_id
        if mid is None or mid <= 0:
            mid = slim.get("match_id")
        try:
            mid_int = int(mid) if mid is not None else 0
        except (TypeError, ValueError):
            mid_int = 0
        if mid_int > 0:
            ok, omsg = merge_skill_and_talent_from_opendota(slim, mid_int)
            print(
                "OpenDota 合并 skill_build/talent_tree:",
                "成功" if ok else "失败",
                omsg,
                "match_id=",
                mid_int,
            )
        else:
            print("跳过 OpenDota：无效 match_id，请设 --opendota-match-id 或确保 epilogue 含 matchId")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(slim, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("已写入:", args.out)
    print("match_id:", slim.get("match_id"), "players:", len(slim.get("players") or []))
    if players_blob:
        n = sum(
            1
            for p in players_blob
            if isinstance(p, dict)
            and isinstance(p.get("ability_upgrades_arr"), list)
            and len(p["ability_upgrades_arr"]) > 0
        )
        print("方式 A: players 元数据", len(players_blob), "条，其中非空 ability_upgrades_arr:", n)


if __name__ == "__main__":
    main()
