"""
基于 dotaconstants 的对局数据增强：中立物品 CDN、25 步 skill_build、职业选手匹配。
可与 OpenDota 原始 player 对象或本地 DEM 汇总结果配合使用。
"""

from __future__ import annotations

import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Set, Tuple

from utils.dota_mapping import (
    DotaConstants,
    _is_talent_key,
    _merge_ability_upgrade_sources,
    _parse_ability_upgrades_objects,
    _sort_upgrades,
    get_constants,
    is_talent_ability,
    logical_player_slot,
    merge_upgrade_steps_for_skill_build,
    raw_ability_upgrades_arr_to_merged_steps,
    steam_asset_url,
)

STEAM_CDN = "https://cdn.cloudflare.steamstatic.com"
# dotaconstants 多数天赋无独立 PNG，按 ability_key 拼的 dota_react URL 常为 404；用客户端存在的占位图
_FILLER_ABILITY_IMG = f"{STEAM_CDN}/apps/dota2/images/dota_react/abilities/filler_ability.png"
_VALVE_S_TOKEN = re.compile(r"\{s:([^}]+)\}")


def _cleanup_valve_bonus_garbage(s: str) -> str:
    """
    {s:bonus_*} 展开为空或半空时，常残留 ``+%``、``-s``、``+s``、孤立 ``%`` 等碎片。
    """
    t = (s or "").strip()
    if not t:
        return t
    t = re.sub(r"(?:^|\s)\+\s*%\s*", " ", t)
    t = re.sub(r"(?:^|[\s(])-\s*s\s+", " ", t)
    # "+{s:bonus_ministun_duration}s Infernal" → "+s Infernal" 残片
    t = re.sub(r"(?:^|\s)\+\s*s\s+", " ", t)
    # "grants % Magic"：数值 token 被删后遗留的孤立 %
    t = re.sub(r"(?<=[a-zA-Z])\s+%\s+(?=[A-Z])", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _expand_valve_dname_template(dname: str, ab: Mapping[str, Any]) -> str:
    """
    将 dname 中的 {s:bonus_xxx} 用 abilities.json 的 attrib 表替换；无数据时去掉占位符，避免露出原始 token。
    """
    if not dname or "{s:" not in dname:
        return _cleanup_valve_bonus_garbage((dname or "").strip())
    kv: Dict[str, str] = {}
    for a in ab.get("attrib") or []:
        if not isinstance(a, dict):
            continue
        k = a.get("key")
        if not k:
            continue
        v = a.get("value")
        if isinstance(v, list) and v:
            v = v[-1]
        kv[str(k)] = "" if v is None else str(v)

    def repl(m: re.Match[str]) -> str:
        key = (m.group(1) or "").strip()
        return kv.get(key, "")

    out = _VALVE_S_TOKEN.sub(repl, dname)
    # 未出现在 attrib 的 token 整条删掉，避免残留 "{s:bonus_xxx}"
    out = _VALVE_S_TOKEN.sub("", out)
    out = re.sub(r"\s+", " ", out).strip()
    return _cleanup_valve_bonus_garbage(out)


def _humanize_talent_key(ability_key: str) -> str:
    """dotaconstants 未收录的新增天赋：把 ability_key 转成可读短句。"""
    s = (ability_key or "").strip()
    if not s:
        return ""
    for prefix in ("special_bonus_unique_", "special_bonus_"):
        if s.startswith(prefix):
            s = s[len(prefix) :]
            break
    s = s.replace("_", " ").strip()
    if not s:
        return ability_key
    return " ".join(w[:1].upper() + w[1:] if w else "" for w in s.split())


def _talent_labels_and_img(dc: DotaConstants, ability_key: str) -> Tuple[str, str, str]:
    """天赋行展示：英文/中文描述 + CDN 图（无图时用 filler，避免 404 裂图）。"""
    ab = dc.abilities.get(ability_key) or {}
    len_en, cn_fb, img = dc.ability_display(ability_key)
    dname = str(ab.get("dname") or len_en or ability_key)
    label_en = _expand_valve_dname_template(dname, ab) or (len_en or ability_key)

    zh = dc.abilities_zh_by_key.get(ability_key) or ""
    if zh and "{s:" not in zh:
        label_cn = zh
    elif zh:
        label_cn = _expand_valve_dname_template(zh, ab) or label_en
    else:
        label_cn = _expand_valve_dname_template(str(cn_fb or dname), ab) or label_en

    if not img:
        img = _FILLER_ABILITY_IMG

    # 仍等于原始 key 时（abilities.json 无条目或仅有占位），用语义化短名
    if label_en.strip() == ability_key or (not label_en.strip() and ability_key):
        fallback = _humanize_talent_key(ability_key)
        if fallback:
            label_en = fallback
            if not zh or label_cn.strip() == ability_key:
                label_cn = fallback
    return (
        _cleanup_valve_bonus_garbage(label_en),
        _cleanup_valve_bonus_garbage(label_cn),
        img,
    )


NEUTRAL_SLOT_PLACEHOLDER = (
    f"{STEAM_CDN}/apps/dota2/images/dota_react/icons/neutral_slot.png"
)

PRO_PLAYERS_URL = "https://api.opendota.com/api/proPlayers"


def steam64_to_account_id(steam64: int) -> int:
    """OpenDota / 比赛 JSON 常用 32 位 account_id。"""
    return int(steam64) - 76561197960265728


def _is_dota_combatlog_event(e: Mapping[str, Any]) -> bool:
    t = str(e.get("type") or e.get("Type") or "").upper()
    return t.startswith("DOTA_COMBATLOG")


def _coerce_positive_int(x: Any) -> Optional[int]:
    if x is None:
        return None
    try:
        v = int(x)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _event_dict_views(e: Mapping[str, Any]) -> List[Mapping[str, Any]]:
    """事件本体 + 常见一层嵌套（Protobuf / 解析器封装）。"""
    out: List[Mapping[str, Any]] = [e]
    for k in ("data", "payload", "msg", "event", "body", "value", "GameEvent"):
        v = e.get(k)
        if isinstance(v, dict):
            out.append(v)
    return out


def _ability_id_from_event_view(d: Mapping[str, Any]) -> Optional[int]:
    for key in (
        "ability",
        "ability_id",
        "abilityId",
        "ability_index",
        "abilityindex",
        "m_iAbility",
        "m_nAbilityID",
        "new_ability",
    ):
        a = _coerce_positive_int(d.get(key))
        if a:
            return a
    return None


def _event_looks_like_ability_upgrade(
    e: Mapping[str, Any], view: Mapping[str, Any]
) -> bool:
    """是否为技能加点类事件（非 CombatLog 施法/伤害）。"""
    et_e = str(e.get("type") or "").lower()
    et_v = str(view.get("type") or "").lower()
    mt = str(e.get("msg_type") or view.get("msg_type") or "").lower()
    merged = f"{et_e} {et_v} {mt}"
    if "combatlog" in merged:
        return False
    if "ability_upgrade" in merged or "abilityupgrade" in merged.replace("_", ""):
        return True
    if "ability" in merged and "upgrade" in merged:
        return True
    if "ability_level" in merged or "ability_learn" in merged:
        return True
    if e.get("ability_learned") or view.get("ability_learned"):
        return True
    if any(
        view.get(k) is not None
        for k in ("ability_level", "new_level", "upgrade_level", "abilityupgrade")
    ):
        return True
    return False


def try_parse_ability_upgrade_event(
    e: Mapping[str, Any],
    *,
    account_to_slot: Optional[Mapping[int, int]] = None,
    dc: Optional[DotaConstants] = None,
    hero_npc_to_slot: Optional[Mapping[str, int]] = None,
) -> Optional[Tuple[int, int, Optional[int], Optional[int]]]:
    """
    从单条原始事件解析 (逻辑 slot 0–9, ability_id, time, dota_ability_new_level)。

    第四项仅对 ``DOTA_ABILITY_LEVEL`` 有意义：为事件里的 ``abilitylevel``（该技能升级后的等级）。
    用于推断录像是否省略了 0→1（首条已是 2+），以贴近客户端 Ability Build。

    odota/parser 常见 ``DOTA_ABILITY_LEVEL``：仅有 ``valuename``（ability 内部名）与
    ``targetname``（npc_dota_hero_*），无数字 ability_id；需 ``dc`` 反查 id，
    并用 ``hero_npc_to_slot`` 将英雄映射到逻辑 slot。
    """
    if not isinstance(e, dict) or _is_dota_combatlog_event(e):
        return None

    for view in _event_dict_views(e):
        if _is_dota_combatlog_event(view):
            continue
        if not _event_looks_like_ability_upgrade(e, view):
            continue

        aid_o = _ability_id_from_event_view(view)
        aid = int(aid_o) if aid_o else 0
        if not aid and dc is not None:
            aid = _ability_id_from_dota_ability_level_valuename(e, view, dc)
        if not aid:
            continue

        slot = logical_player_slot(view.get("player_slot", view.get("slot")))
        if slot is None:
            slot = logical_player_slot(e.get("player_slot", e.get("slot")))
        if slot is None and account_to_slot:
            acc = _coerce_positive_int(view.get("account_id") or e.get("account_id"))
            if acc and acc in account_to_slot:
                slot = account_to_slot[acc]
        if slot is None and hero_npc_to_slot:
            tn = view.get("targetname") or e.get("targetname")
            if isinstance(tn, str) and tn.strip():
                hs = hero_npc_to_slot.get(tn.strip())
                if hs is not None:
                    slot = int(hs)
        if slot is None:
            continue

        tm_raw = e.get("time")
        if tm_raw is None:
            tm_raw = view.get("time")
        if tm_raw is None:
            tm_raw = view.get("game_time", view.get("timestamp"))
        try:
            tm: Optional[int] = int(tm_raw) if tm_raw is not None else None
        except (TypeError, ValueError):
            tm = None

        dota_new_level: Optional[int] = None
        et_u = str(e.get("type") or view.get("type") or "").upper()
        if et_u == "DOTA_ABILITY_LEVEL":
            al_raw = view.get("abilitylevel")
            if al_raw is None:
                al_raw = e.get("abilitylevel")
            try:
                if al_raw is not None:
                    dota_new_level = int(al_raw)
            except (TypeError, ValueError):
                dota_new_level = None
        return (slot, aid, tm, dota_new_level)

    return None


def _strip_dota_ability_new_level(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    for r in rows:
        r.pop("dota_ability_new_level", None)
    return rows


def _inject_implicit_first_skill_steps(
    sorted_rows: List[Dict[str, Any]],
    hero_npc: str,
    hero_abilities_map: Mapping[str, Any],
    dc: DotaConstants,
) -> List[Dict[str, Any]]:
    """
    客户端 Ability Build 按「每次加点」列图标；录像中某技能首条 ``DOTA_ABILITY_LEVEL`` 可能已是
    ``abilitylevel>=2``（0→1 未发消息，常见于先天/魔晶等已有 1 级时）。在整段序列前插入
    缺失的同名 ability_id 步，使与客户端一致。

    多技能同时需补时，按 hero_abilities 技能栏顺序（abilities 数组下标）排在 time=-1 段内。
    """
    if not sorted_rows or not hero_npc or not hero_abilities_map:
        return _strip_dota_ability_new_level([dict(r) for r in sorted_rows])

    ha = hero_abilities_map.get(hero_npc)
    if not isinstance(ha, dict):
        return _strip_dota_ability_new_level([dict(r) for r in sorted_rows])

    raw_abs = ha.get("abilities") or []
    if not isinstance(raw_abs, list):
        return _strip_dota_ability_new_level([dict(r) for r in sorted_rows])

    battle_keys: List[str] = []
    for ak in raw_abs:
        if not isinstance(ak, str) or not ak.strip():
            continue
        k = ak.strip()
        if k == "generic_hidden" or k.endswith("_release"):
            continue
        battle_keys.append(k)

    def bar_index_for_key(akey: str) -> int:
        for i, bk in enumerate(battle_keys):
            if bk == akey:
                return i
            alt = dc.resolve_abilities_json_key(bk) or ""
            if alt == akey:
                return i
        return 10_000

    first_new_level: Dict[int, int] = {}
    for r in sorted_rows:
        try:
            aid = int(r.get("ability_id") or 0)
        except (TypeError, ValueError):
            continue
        if not aid or aid in first_new_level:
            continue
        lv_raw = r.get("dota_ability_new_level")
        if lv_raw is None:
            continue
        try:
            lv_i = int(lv_raw)
        except (TypeError, ValueError):
            continue
        first_new_level[aid] = lv_i

    synth: List[Dict[str, Any]] = []
    for aid, lv_first in first_new_level.items():
        if lv_first <= 1:
            continue
        akey = str(dc.ability_ids.get(str(aid), "") or "").strip()
        if not akey or _is_talent_key(akey):
            continue
        if bar_index_for_key(akey) >= 9_999:
            continue
        missing = lv_first - 1
        bi = bar_index_for_key(akey)
        for _ in range(missing):
            synth.append(
                {
                    "ability_id": aid,
                    "time": -1,
                    "_implicit_bar_order": bi,
                }
            )

    if not synth:
        return _strip_dota_ability_new_level([dict(r) for r in sorted_rows])

    combined = [dict(x) for x in synth] + [dict(r) for r in sorted_rows]

    def sort_key(i_r: Tuple[int, Dict[str, Any]]) -> Tuple[int, int, int, int]:
        i, r = i_r
        t = r.get("time")
        if t is None:
            g1, tv = 1, 10**9
        else:
            try:
                tv = int(t)
            except (TypeError, ValueError):
                tv = 10**9
            g1 = 0
        bo = int(r.get("_implicit_bar_order", 1_000_000))
        return (g1, tv, bo, i)

    indexed = list(enumerate(combined))
    indexed.sort(key=sort_key)
    out = [r for _, r in indexed]
    for r in out:
        r.pop("_implicit_bar_order", None)
    return _strip_dota_ability_new_level(out)


def ability_upgrade_merged_steps_from_raw_events(
    events: List[dict],
    *,
    account_to_slot: Optional[Mapping[int, int]] = None,
    dc: Optional[DotaConstants] = None,
    hero_npc_to_slot: Optional[Mapping[str, int]] = None,
    hero_abilities_map: Optional[Mapping[str, Any]] = None,
    slot_to_hero_npc: Optional[Mapping[int, str]] = None,
) -> Dict[int, List[Dict[str, Any]]]:
    """
    遍历原始事件流，按时间顺序收集每名玩家的加点 steps，
    与 raw_ability_upgrades_arr_to_merged_steps 输出格式一致（ability_id + 可选 time），
    供 skill_build_v2_from_merged_upgrades 使用。

    若提供 ``hero_abilities_map`` 与 ``slot_to_hero_npc``，会对 ``DOTA_ABILITY_LEVEL`` 首条已为
    2 级以上的技能插入隐式第 1 级（见 ``_inject_implicit_first_skill_steps``）。
    """
    per_slot: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for ev in events:
        if not isinstance(ev, dict):
            continue
        parsed = try_parse_ability_upgrade_event(
            ev,
            account_to_slot=account_to_slot,
            dc=dc,
            hero_npc_to_slot=hero_npc_to_slot,
        )
        if not parsed:
            continue
        slot, aid, tm, dota_lv = parsed
        row: Dict[str, Any] = {"ability_id": aid}
        if tm is not None:
            row["time"] = tm
        if dota_lv is not None:
            row["dota_ability_new_level"] = dota_lv
        per_slot[slot].append(row)

    out: Dict[int, List[Dict[str, Any]]] = {}
    for slot, rows in per_slot.items():
        if not rows:
            continue
        sorted_rows = _sort_upgrades([dict(r) for r in rows])
        hero_npc = (slot_to_hero_npc or {}).get(slot) if slot_to_hero_npc else None
        if (
            hero_npc
            and hero_abilities_map
            and dc
            and isinstance(hero_abilities_map, Mapping)
        ):
            out[slot] = _inject_implicit_first_skill_steps(
                sorted_rows, hero_npc, hero_abilities_map, dc
            )
        else:
            out[slot] = _strip_dota_ability_new_level(sorted_rows)
    return out


def _cdn_item_img_by_key(dc: DotaConstants, item_key: Optional[str]) -> str:
    if not item_key:
        return ""
    _, _, img = dc.item_display(item_key)
    return img


def get_cdn_neutral_img(
    item_id: int,
    dc: DotaConstants,
    *,
    item_key_hint: Optional[str] = None,
) -> str:
    """
    中立物品：item_id -> dotaconstants items.img -> Steam CDN 绝对 URL。
    若 id 无效可提供 item_key_hint（已去掉 item_ 前缀的 key，如 cloak_of_flames）。
    路径中不含多余 item_ 前缀（由 dotaconstants 的 img 字段决定）。
    解析失败时返回空字符串（前端仅显示槽位底图），避免与 neutral_slot 底图叠成「双底图」。
    """
    from utils.dota_two_step import fallback_item_cdn_png

    key: Optional[str] = None
    if item_id and int(item_id) > 0:
        key = dc.item_key_from_id(int(item_id))
    if not key and item_key_hint:
        k = item_key_hint.strip().lower().replace("item_", "")
        if k in dc.items:
            key = k
        else:
            rk = dc.resolve_items_json_key(k)
            if rk:
                key = rk
    if key:
        key = dc.resolve_items_json_key(key) or key
    if not key:
        return ""
    img = _cdn_item_img_by_key(dc, key)
    if not img:
        img = fallback_item_cdn_png(key)
    return img or ""


def normalize_dem_neutral_key(raw: str) -> str:
    """Cloak_Of_Flames -> cloak_of_flames"""
    if not raw:
        return ""
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", raw)
    return s.replace("__", "_").lower()


def _talent_label_cn(dc: DotaConstants, ability_key: Optional[str]) -> str:
    if not ability_key:
        return ""
    ab = dc.abilities.get(ability_key) or {}
    dname = str(ab.get("dname") or ability_key)
    cn = dc.abilities_zh_by_key.get(ability_key) or dname
    # 去掉简单占位符 token，保留可读性
    return cn


def _ability_id_from_key(dc: DotaConstants, ability_key: str) -> int:
    """ability_ids.json 为 id -> key，反查首个匹配 id。"""
    for sid, vk in dc.ability_ids.items():
        if vk != ability_key or "," in str(sid):
            continue
        try:
            return int(str(sid).split(",")[0])
        except ValueError:
            continue
    return 0


def _ability_id_from_dota_ability_level_valuename(
    e: Mapping[str, Any],
    view: Mapping[str, Any],
    dc: DotaConstants,
) -> int:
    """
    ``DOTA_ABILITY_LEVEL``：用 ``valuename`` 反查 ability_id。
    开局 time<0 会刷一整树未点天赋（abilitylevel=0），需过滤；
    真实加点为 time>=0 且 abilitylevel>=1。
    """
    et = str(e.get("type") or view.get("type") or "").upper()
    if et != "DOTA_ABILITY_LEVEL":
        return 0
    vn_raw = view.get("valuename")
    if vn_raw is None:
        vn_raw = e.get("valuename")
    if not isinstance(vn_raw, str):
        return 0
    key = vn_raw.strip()
    if not key:
        return 0
    # 全属性点不参与技能条顺序（用户要求隐藏属性图标）。
    if _is_attribute_row_talent(key):
        return 0
    try:
        tm = int(
            e.get("time") if e.get("time") is not None else view.get("time") or -1
        )
    except (TypeError, ValueError):
        tm = -1
    al_raw = view.get("abilitylevel")
    if al_raw is None:
        al_raw = e.get("abilitylevel")
    try:
        al = int(al_raw) if al_raw is not None else 0
    except (TypeError, ValueError):
        al = 0
    # 赛前 time<0 会为每个技能刷 DOTA_ABILITY_LEVEL（多为 abilitylevel=0），
    # 若仍反查 id 会整段插入排序队首，把真实 horn 后加点顺序顶乱，与客户端 Ability Build 完全不符。
    if tm < 0 or al < 1:
        return 0
    aid = _ability_id_from_key(dc, key)
    if aid <= 0:
        jk = dc.resolve_abilities_json_key(key)
        if jk:
            aid = _ability_id_from_key(dc, jk)
    return aid if aid > 0 else 0


def _empty_skill_step_v2(step: int) -> Dict[str, Any]:
    return {
        "step": step,
        "type": "empty",
        "level": step,
        "ability_id": 0,
        "ability_key": None,
        "desc": "",
        "desc_en": "",
        "desc_cn": "",
        "img": "",
        "img_url": "",
        "kind": "empty",
        "is_talent": False,
        "label_en": "",
        "label_cn": "",
    }


def _unknown_skill_step_v2(step: int, ability_id: int) -> Dict[str, Any]:
    """ability_ids 中查无此 id 时的兜底（仍输出一步，便于前端提示）。"""
    hint = f"未知技能 ID {ability_id}（ability_ids 无映射）"
    return {
        "step": step,
        "type": "unknown",
        "level": step,
        "ability_id": ability_id,
        "ability_key": None,
        "name": hint,
        "desc": hint,
        "desc_en": f"Unknown ability id {ability_id}",
        "desc_cn": hint,
        "img": "",
        "img_url": "",
        "kind": "unknown",
        "is_talent": False,
        "label_en": f"#{ability_id}",
        "label_cn": hint,
    }


def annotate_ability_upgrades_arr(
    raw: Any,
    dc: DotaConstants,
) -> List[Dict[str, Any]]:
    """
    将 ability_upgrades_arr（或 OpenDota 交错格式）解析为按时间顺序的加点列表，
    每项含 id、ability_key、is_talent（special_bonus_*）、name（中文优先）、name_en。

    前端可用 if item["is_talent"] 区分技能图标与天赋标记。
    """
    merged = raw_ability_upgrades_arr_to_merged_steps(raw)
    out: List[Dict[str, Any]] = []
    for step in merged:
        try:
            aid = int(step.get("ability_id") or 0)
        except (TypeError, ValueError):
            continue
        if not aid:
            continue
        akey = dc.ability_key_from_id(aid)
        if not akey:
            out.append(
                {
                    "id": aid,
                    "ability_key": None,
                    "is_talent": False,
                    "name": f"unknown_id:{aid}",
                    "name_en": "",
                }
            )
            continue
        jk = dc.resolve_abilities_json_key(akey) or akey
        ab_row = dc.abilities.get(jk) if jk else None
        is_talent = is_talent_ability(
            jk, ab_row if isinstance(ab_row, dict) else None
        )
        if is_talent:
            en, cn, _ = _talent_labels_and_img(dc, jk)
            name = (cn or en or "").strip() or _humanize_talent_key(jk)
            name_en = (en or jk).strip()
        else:
            ne, nc, _ = dc.ability_display(jk)
            name = (nc or ne or jk).strip()
            name_en = (ne or jk).strip()
        out.append(
            {
                "id": aid,
                "ability_key": jk,
                "is_talent": is_talent,
                "name": name,
                "name_en": name_en,
            }
        )
    return out


def _ability_behaviors_normalized(row: Mapping[str, Any]) -> Set[str]:
    b = row.get("behavior")
    if isinstance(b, list):
        return {str(x) for x in b}
    if isinstance(b, str) and b.strip():
        return {b.strip()}
    return set()


# 录像 ability_upgrades_arr 会混入 facet/魔晶/子技能/占位 ID；客户端加点条不展示这些「非手点格子」。
_CLIENT_SKILL_BAR_EXTRA_DROP_KEYS = frozenset(
    {
        "terrorblade_terror_wave",  # Aghanim 衍生，replay 会插进序列
        "hoodwink_decoy",
        "hoodwink_hunters_boomerang",
        "kez_switch_weapons",
    }
)


def ability_step_excluded_from_client_skill_bar(
    dc: DotaConstants,
    ability_key: Optional[str],
) -> bool:
    """
    判断是否应从「客户端技能加点横条」序列中剔除。

    与 OpenDota ``ability_upgrades`` 不同，本地解析器常输出含先天解锁、
    generic_hidden、子技能（*_release）等；不剔除则 Ult/天赋会整体错位。
    """
    if not ability_key:
        return True
    k = str(ability_key).strip().lower()
    if not k or k.replace(" ", "") in ("dota_unknown",):
        return True
    if _is_attribute_row_talent(k):
        return True
    if k == "generic_hidden":
        return True
    if k in _CLIENT_SKILL_BAR_EXTRA_DROP_KEYS:
        return True
    if k.endswith("_release") or k.endswith("_release_alt"):
        return True
    jk = (dc.resolve_abilities_json_key(k) or k).strip()
    if _is_attribute_row_talent(jk):
        return True
    if jk in _CLIENT_SKILL_BAR_EXTRA_DROP_KEYS:
        return True
    if jk.endswith("_release") or jk.endswith("_release_alt"):
        return True
    # Terrorblade Demon Zeal 在新版本可作为可学习技能出现；尽管有 Hidden/No Target 标记，
    # 客户端加点条会展示其加点，不能被通用 Hidden 规则误删。
    if jk == "terrorblade_demon_zeal":
        return False
    row = dc.abilities.get(jk)
    if not isinstance(row, dict):
        return False
    beh = _ability_behaviors_normalized(row)
    # 纯被动先天（Dark Unity、Solid Core、魔晶登记等）：不占加点条
    if row.get("is_innate") is True:
        if "Passive" in beh and not (
            "No Target" in beh
            or "Unit Target" in beh
            or "Point Target" in beh
            or "Channeled" in beh
        ):
            return True
    # 隐藏且非「可加点」类（如 Demon Zeal、Treant Eyes）：Kez Falcon 等为 Hidden+Instant Cast，须保留
    if "Hidden" in beh:
        if "Instant Cast" in beh or "Channeled" in beh:
            return False
        if "Point Target" in beh or "AOE" in beh:
            return False
        if "Passive" in beh:
            return True
        if "No Target" in beh or "Unit Target" in beh:
            return True
    return False


def filter_merged_steps_for_client_skill_bar(
    merged: List[Dict[str, Any]],
    dc: DotaConstants,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for step in merged:
        if not isinstance(step, dict):
            continue
        try:
            aid = int(step.get("ability_id") or 0)
        except (TypeError, ValueError):
            aid = 0
        if aid <= 0:
            continue
        ak = dc.ability_key_from_id(aid) if aid else None
        if not ak and step.get("_key"):
            ak = str(step.get("_key")).strip() or None
        if ability_step_excluded_from_client_skill_bar(dc, ak):
            continue
        out.append(dict(step))
    return out


def skill_build_v2_from_merged_upgrades(
    merged: List[Dict[str, Any]],
    dc: DotaConstants,
    *,
    pad_to: int = 25,
) -> List[Dict[str, Any]]:
    """
    统一 skill_build 输出（与前端约定）。

    映射链：数字 ability_id → ``ability_ids.json`` 内部名 → ``abilities.json`` 详情。

    - talent: ``special_bonus*`` → type=talent, name/desc=中文 dname（ abilities + 可选 zh 表）
    - ability: type=ability, img / img_url = Steam ``dota_react/abilities/{key}.png``
    - unknown: ability_ids 无此 id
    - empty: 占位
    另保留 kind / label_en / label_cn 兼容旧逻辑。
    """
    out: List[Dict[str, Any]] = []
    for i, step in enumerate(merged[:pad_to]):
        try:
            aid = int(step["ability_id"])
        except (KeyError, TypeError, ValueError):
            aid = 0
        akey = dc.ability_key_from_id(aid) if aid else None
        if not akey and step.get("_key"):
            akey = str(step["_key"]).strip() or None
        if not akey:
            if aid > 0:
                out.append(_unknown_skill_step_v2(i + 1, aid))
            else:
                out.append(_empty_skill_step_v2(i + 1))
            continue
        json_key = dc.resolve_abilities_json_key(akey) or akey
        ab_row = dc.abilities.get(json_key)
        is_talent = is_talent_ability(
            json_key or akey, ab_row if isinstance(ab_row, dict) else None
        )
        level = i + 1
        if is_talent:
            en, cn, _img_unused = _talent_labels_and_img(dc, json_key or akey)
            desc = (cn or en or "").strip() or _humanize_talent_key(akey)
            out.append(
                {
                    "step": level,
                    "type": "talent",
                    "level": level,
                    "ability_id": aid,
                    "ability_key": json_key or akey,
                    "name": desc,
                    "desc": desc,
                    "desc_en": en,
                    "desc_cn": cn,
                    "img": "",
                    "img_url": "",
                    "kind": "talent",
                    "is_talent": True,
                    "label_en": en,
                    "label_cn": cn,
                }
            )
        else:
            name_en, name_cn, ab_img = dc.ability_display(json_key or akey)
            img = ab_img or ""
            if not img and json_key:
                p = dc.abilities.get(json_key, {}).get("img")
                img = steam_asset_url(p) if p else ""
            if not img and (json_key or akey):
                k = json_key or akey
                img = f"{STEAM_CDN}/apps/dota2/images/dota_react/abilities/{k}.png"
            disp_cn = (name_cn or name_en or akey or "").strip()
            disp_en = (name_en or akey or "").strip()
            out.append(
                {
                    "step": level,
                    "type": "ability",
                    "level": level,
                    "ability_id": aid,
                    "ability_key": json_key or akey,
                    "name": disp_cn,
                    "desc": "",
                    "desc_en": "",
                    "desc_cn": "",
                    "img": img,
                    "img_url": img,
                    "kind": "ability",
                    "is_talent": False,
                    "label_en": disp_en,
                    "label_cn": disp_cn,
                }
            )
    while len(out) < pad_to:
        out.append(_empty_skill_step_v2(len(out) + 1))
    return out[:pad_to]


def get_sequential_skill_build(
    player_data: Mapping[str, Any],
    dc: DotaConstants,
    *,
    pad_to: int = 25,
    match_duration_sec: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    遍历 ability_upgrades + ability_upgrades_arr，生成 25 步 skill_build（v2 结构）。
    """
    objs = _parse_ability_upgrades_objects(player_data.get("ability_upgrades"))
    arr_steps = raw_ability_upgrades_arr_to_merged_steps(
        player_data.get("ability_upgrades_arr"),
        match_duration_sec=match_duration_sec,
    )
    merged = merge_upgrade_steps_for_skill_build(objs, arr_steps)
    merged = filter_merged_steps_for_client_skill_bar(merged, dc)
    return skill_build_v2_from_merged_upgrades(merged, dc, pad_to=pad_to)


def skill_build_from_dem_ability_combat(
    events: List[dict],
    hero_npc: str,
    dc: DotaConstants,
    *,
    pad_to: int = 25,
) -> List[Dict[str, Any]]:
    """
    无 ability_upgrades_arr 时：用 DOTA_COMBATLOG_ABILITY 首次施法顺序近似加点，
    输出与 skill_build_v2 相同结构。
    """
    seen: List[str] = []
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_ABILITY":
            continue
        if (e.get("attackername") or "") != hero_npc:
            continue
        inf = e.get("inflictor") or ""
        if not inf or inf == "dota_unknown" or inf.startswith("item_"):
            continue
        if inf in seen:
            continue
        seen.append(inf)
    merged: List[Dict[str, Any]] = []
    for inf in seen[:pad_to]:
        aid = _ability_id_from_key(dc, inf)
        merged.append({"ability_id": aid, "time": None, "_key": inf})
    return skill_build_v2_from_merged_upgrades(merged, dc, pad_to=pad_to)


def load_or_fetch_pro_players(cache_dir: Path) -> List[Dict[str, Any]]:
    """缓存 pro 列表到本地；首次可联网拉取（静态名单，非对局数据）。"""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / "pro_players.json"
    if path.is_file():
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    try:
        req = urllib.request.Request(
            PRO_PLAYERS_URL,
            headers={"User-Agent": "plab-dota-pipeline/1.0"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, list):
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return data
    except Exception:
        pass
    return []


def match_pro_player(
    account_id: Optional[int],
    pro_rows: List[Dict[str, Any]],
) -> Tuple[Optional[str], Optional[str]]:
    """
    account_id 为 32 位。返回 (pro_name, team_name)。
    OpenDota proPlayers: name, team_name, account_id
    """
    if account_id is None or account_id <= 0:
        return None, None
    aid = int(account_id)
    for row in pro_rows:
        try:
            pid = int(row.get("account_id") or 0)
        except (TypeError, ValueError):
            continue
        if pid == aid:
            name = str(row.get("name") or row.get("personaname") or "").strip()
            team = str(row.get("team_name") or row.get("team_tag") or "").strip()
            return (name or None, team or None)
    return None, None


def ensure_hero_abilities_cached(cache_dir: Path) -> None:
    """确保 hero_abilities.json 存在（供扩展校验使用）。"""
    p = cache_dir / "hero_abilities.json"
    if p.is_file():
        return
    url = "https://raw.githubusercontent.com/odota/dotaconstants/master/build/hero_abilities.json"
    req = urllib.request.Request(url, headers={"User-Agent": "plab-dota-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        p.write_bytes(resp.read())


def load_hero_abilities_map(cache_dir: Path) -> Dict[str, Any]:
    ensure_hero_abilities_cached(cache_dir)
    p = cache_dir / "hero_abilities.json"
    if not p.is_file():
        return {}
    raw = json.loads(p.read_text(encoding="utf-8"))
    return raw if isinstance(raw, dict) else {}


def _talent_numeric_ids_for_hero(
    hero_npc: str,
    hero_abilities_map: Mapping[str, Any],
    dc: DotaConstants,
) -> Set[int]:
    """hero_abilities 前 8 条天赋对应的 ability_id（与天赋树一致）。"""
    ha = hero_abilities_map.get(hero_npc)
    if not isinstance(ha, dict):
        return set()
    raw = ha.get("talents") or []
    out: Set[int] = set()
    for el in raw[:8]:
        nm = el.get("name") if isinstance(el, dict) else None
        if not nm:
            continue
        nm_s = str(nm).strip()
        candidates = [nm_s, dc.resolve_abilities_json_key(nm_s) or ""]
        for cand in candidates:
            if not cand:
                continue
            aid = _ability_id_from_key(dc, cand)
            if aid > 0:
                out.add(aid)
                break
    return out


def talent_signal_steps_from_interval_networth(
    events: List[dict],
    slot: int,
    hero_npc: str,
    hero_abilities_map: Mapping[str, Any],
    dc: DotaConstants,
) -> List[Dict[str, Any]]:
    """
    本地解析器约定：在 ``type=interval`` 里用 **经济类字段**承载天赋树加点
    （整数值 = 该次点选的天赋 ``ability_id``，与真实金币/总经济语义可能混用）。

    **主约定**：``networth`` 为天赋加点指令字段（对全部英雄同一规则）。
    部分解析器改写在 ``gold`` 上，故同时扫描 ``gold``、``networth``，取各天赋 ID
    的最早 ``time``；同一 tick 两字段同 ID 只记一次。

    **注意**：大量天赋 ``ability_id`` 与对局前中期 ``networth`` 同量级（如 558、718、5982），
    与真实经济数值撞车会产生假「学天赋」事件。DEM 管线在已有 ``ability_upgrades_arr``
    时不应再合并本函数结果（见 ``dem_result_to_slim_match.build_slim_from_dem_events``）。
    """
    tids = _talent_numeric_ids_for_hero(hero_npc, hero_abilities_map, dc)
    if not tids:
        return []
    best: Dict[int, int] = {}
    for ev in events:
        if str(ev.get("type") or "").lower() != "interval":
            continue
        try:
            if int(ev.get("slot")) != slot:
                continue
        except (TypeError, ValueError):
            continue
        try:
            tm = int(ev["time"])
        except (KeyError, TypeError, ValueError):
            continue
        for fld in ("networth", "gold"):
            try:
                val = int(ev.get(fld))
            except (TypeError, ValueError):
                continue
            if val not in tids:
                continue
            if val not in best or tm < best[val]:
                best[val] = tm
    steps = [
        {"ability_id": aid, "time": best[aid]}
        for aid in sorted(best.keys(), key=lambda a: (best[a], a))
    ]
    return steps


_TIER_LEVELS = (10, 15, 20, 25)

# 官方英文天赋文案覆盖（build_talent_tree 写入 label_en / label_cn）
TALENT_OVERRIDES = {
    "npc_dota_hero_doom_bringer": {
        10: {
            "left": "+0.2s Infernal Blade StunDuration",
            "right": "+10% Magic Resistance",
        },
        15: {
            "left": "+1.5% Infernal Blade Max HP AsDamage",
            "right": "+7% Scorched Earth MovementSpeed",
        },
        20: {
            "left": "+66 Damage",
            "right": "-10s Doom Cooldown",
        },
        25: {
            "left": "Permanent Scorched Earth",
            "right": "Doom applies Mute",
        },
    }
}

# 录像 / OpenDota 可能用「通用」天赋名记录加点，与 hero_abilities 槽位上的英雄专属 key 不同但为同一选项。
# 对每个 (英雄, 档位, 侧) 登记额外 ability key，并参与 ability_id 等价匹配（见 build_talent_tree）。
TALENT_UPGRADE_ALTERNATE_KEYS: Dict[str, Dict[Tuple[int, str], Tuple[str, ...]]] = {
    "npc_dota_hero_doom_bringer": {
        (10, "right"): ("special_bonus_magic_resistance_10",),
    },
}

# hero_abilities「talents」每对为 [偶数槽, 奇数槽] = [客户端右侧, 左侧]（与游戏 HUD 一致）
_TALENT_FLAT_INDEX_TO_LEVEL_SIDE: List[Tuple[int, str]] = [
    (10, "right"),
    (10, "left"),
    (15, "right"),
    (15, "left"),
    (20, "right"),
    (20, "left"),
    (25, "right"),
    (25, "left"),
]

# dotaconstants 里 talents[] 的成对顺序与部分英雄客户端 HUD 行顺序不一致（Doom 典型：15/20 档）。
# 下列 8 个 ability 名按「偶数槽=右、奇数槽=左」与 _TALENT_FLAT_INDEX_TO_LEVEL_SIDE 一一对应。
_DOOM_BRINGER_TALENT_HUD_ORDER: Tuple[str, ...] = (
    "special_bonus_unique_doom_3",  # 10 右：魔抗
    "special_bonus_unique_doom_4",  # 10 左：炽刃晕眩
    "special_bonus_unique_doom_6",  # 15 右：焦土移速
    "special_bonus_unique_doom_1",  # 15 左：炽刃最大生命百分比伤害
    "special_bonus_unique_doom_9",  # 20 右：末日冷却
    "special_bonus_attack_damage_66",  # 20 左：+66 攻击
    "special_bonus_unique_doom_10",  # 25 右：Mute
    "special_bonus_unique_doom_11",  # 25 左：永久焦土
)

# dotaconstants 中 talents[] 为 [魔抗, 半径], [持续时间, 多段]… 与客户端「右列先读」的 HUD 不一致。
_KEZ_TALENT_HUD_ORDER: Tuple[str, ...] = (
    "special_bonus_unique_kez_raptor_dance_radius",
    "special_bonus_magic_resistance_12",
    "special_bonus_unique_kez_raptor_dance_strikes",
    "special_bonus_unique_kez_falcon_rush_duration",
    "special_bonus_unique_kez_kazura_katana_bleed_damage",
    "special_bonus_unique_kez_falcon_rush_attack_speed",
    "special_bonus_unique_kez_mark_damage",
    "special_bonus_unique_kez_echo_slash_strike_count",
)


def _talents_raw_entries_for_tree(hero_npc: str, raw_src: List[Any]) -> List[Dict[str, Any]]:
    """供 build_talent_tree / infer 使用：Doom 用 HUD 对齐后的 8 槽，其余用 hero_abilities 原顺序。"""
    if hero_npc == "npc_dota_hero_doom_bringer":
        return [{"name": k} for k in _DOOM_BRINGER_TALENT_HUD_ORDER]
    if hero_npc == "npc_dota_hero_kez":
        return [{"name": k} for k in _KEZ_TALENT_HUD_ORDER]
    out: List[Dict[str, Any]] = []
    for el in raw_src[:8]:
        if isinstance(el, dict):
            out.append(dict(el))
        elif el:
            out.append({"name": str(el)})
        else:
            out.append({"name": ""})
    return out


def _is_attribute_row_talent(k: str) -> bool:
    """全属性加点，不参与 10/15/20/25 天赋档匹配。"""
    return (k or "").strip().lower() == "special_bonus_attributes"


def _talent_alternate_ability_ids(
    dc: DotaConstants,
    hero_npc: str,
    lvl: int,
    side: str,
) -> List[int]:
    """与 TALENT_UPGRADE_ALTERNATE_KEYS 对应的 ability_id 列表（用于与录像里 generic id 比对）。"""
    out: List[int] = []
    for alt_key in TALENT_UPGRADE_ALTERNATE_KEYS.get(hero_npc, {}).get((lvl, side), ()):
        eid = _ability_id_from_key(dc, alt_key)
        jk = dc.resolve_abilities_json_key(alt_key) or alt_key
        if eid <= 0:
            eid = _ability_id_from_key(dc, jk)
        if eid > 0:
            out.append(eid)
    return out


def _register_talent_key_side(
    key_to_side: Dict[str, Tuple[int, str]],
    dc: DotaConstants,
    raw_key: str,
    lvl: int,
    side: str,
) -> None:
    """同一档左右键写入多别名，避免 API / 解析器 key 与 hero_abilities 字面量不一致。"""
    k = str(raw_key).strip()
    if not k:
        return
    t: Tuple[int, str] = (lvl, side)
    key_to_side[k] = t
    jk = dc.resolve_abilities_json_key(k)
    if jk and jk != k:
        key_to_side[jk] = t
    if k.startswith("ability_"):
        rest = k[8:]
        if rest:
            key_to_side[rest] = t


def talent_keys_guessed_from_combat_log(
    events: List[dict],
    hero_npc: str,
    *,
    max_keys: int = 24,
) -> List[str]:
    """
    从 DOTA_COMBATLOG_ABILITY 中收集 inflictor 为 special_bonus_* 的条目（少数天赋会以施法形式出现）。
    多数天赋不会在战斗日志中出现，仍需 ability_upgrades / talent_pick_keys。
    """
    seen: List[str] = []
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_ABILITY":
            continue
        if (e.get("attackername") or "") != hero_npc:
            continue
        inf = str(e.get("inflictor") or "").strip()
        if not inf or inf == "dota_unknown":
            continue
        if not _is_talent_key(inf):
            continue
        if inf not in seen:
            seen.append(inf)
        if len(seen) >= max_keys:
            break
    return seen


def skill_build_step_is_tree_talent(dc: DotaConstants, s: Any) -> bool:
    """
    判断是否应参与天赋树档位匹配：除 type/kind 外，也根据 ability_id 反查
    （避免 API 将天赋步标成 ability 或漏填 ability_key）。
    """
    if not isinstance(s, dict):
        return False
    if s.get("type") == "talent" or s.get("kind") == "talent" or s.get("is_talent"):
        return True
    ak = str(s.get("ability_key") or "").strip()
    if ak:
        if _is_attribute_row_talent(ak):
            return False
        if _is_talent_key(ak):
            return True
    try:
        aid = int(s.get("ability_id") or 0)
    except (TypeError, ValueError):
        aid = 0
    if aid <= 0:
        return False
    ak2 = dc.ability_key_from_id(aid)
    if not ak2:
        return False
    if _is_attribute_row_talent(ak2):
        return False
    return bool(_is_talent_key(ak2))


def build_talent_tree(
    hero_npc: str,
    skill_build: List[Dict[str, Any]],
    hero_abilities_map: Mapping[str, Any],
    dc: DotaConstants,
    *,
    extra_talent_keys: Optional[Iterable[str]] = None,
    extra_talent_ids: Optional[Iterable[Any]] = None,
    merged_upgrade_steps: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    依据 hero_abilities.json 中 talents 左右成对 + skill_build 中已选天赋，
    生成前端天赋树浮层数据。

    dotaconstants 每档两条顺序为「右、左」：偶数下标对应客户端右列，奇数下标对应左列。

    匹配优先使用 ``ability_id``（与 ability_ids.json 一致），再回退到 ability_key 多别名，
    避免 OpenDota / 录像解析的 key 字符串与 hero_abilities 字面量不完全相同导致漏判。

    ``merged_upgrade_steps``：完整合并后的加点序列（可长于 25）。在 skill_build 截断异常时
    仍可按 ability_id 补全各档天赋高亮。
    """
    ha = hero_abilities_map.get(hero_npc)
    if not isinstance(ha, dict):
        return {"tiers": [], "dots_learned": 0}
    raw_src = ha.get("talents") or []
    if not isinstance(raw_src, list) or len(raw_src) < 2:
        return {"tiers": [], "dots_learned": 0}
    raw_t = _talents_raw_entries_for_tree(hero_npc, raw_src)
    if len(raw_t) < 2:
        return {"tiers": [], "dots_learned": 0}

    key_to_side: Dict[str, Tuple[int, str]] = {}
    tier_ids: Dict[int, Tuple[int, int]] = {}
    for pair_idx in range(4):
        i = pair_idx * 2
        if i + 1 >= len(raw_t):
            break
        slot_right = raw_t[i]
        slot_left = raw_t[i + 1]
        key_right = slot_right.get("name") if isinstance(slot_right, dict) else None
        key_left = slot_left.get("name") if isinstance(slot_left, dict) else None
        if not key_left or not key_right:
            continue
        lvl = _TIER_LEVELS[pair_idx] if pair_idx < 4 else 25
        k_left, k_right = str(key_left), str(key_right)
        _register_talent_key_side(key_to_side, dc, k_left, lvl, "left")
        _register_talent_key_side(key_to_side, dc, k_right, lvl, "right")
        lid = _ability_id_from_key(dc, k_left)
        rid = _ability_id_from_key(dc, k_right)
        lkr = dc.resolve_abilities_json_key(k_left) or k_left
        rkr = dc.resolve_abilities_json_key(k_right) or k_right
        if lid <= 0:
            lid = _ability_id_from_key(dc, lkr)
        if rid <= 0:
            rid = _ability_id_from_key(dc, rkr)
        tier_ids[lvl] = (lid, rid)

    _alt_reg = TALENT_UPGRADE_ALTERNATE_KEYS.get(hero_npc)
    if _alt_reg:
        for (lvl_a, side_a), extra_keys in _alt_reg.items():
            for ek in extra_keys:
                _register_talent_key_side(key_to_side, dc, ek, lvl_a, side_a)

    selected_by_level: Dict[int, str] = {}

    def _assign_from_key(
        k_raw: Any, *, allow_overwrite: bool, tier_policy: Optional[Dict[int, str]] = None
    ) -> None:
        if not k_raw:
            return
        k0 = str(k_raw).strip()
        if not k0 or not _is_talent_key(k0) or _is_attribute_row_talent(k0):
            return
        candidates = [k0]
        jk = dc.resolve_abilities_json_key(k0)
        if jk and jk not in candidates:
            candidates.append(jk)
        if k0.startswith("ability_"):
            c2 = k0[8:]
            if c2 and c2 not in candidates:
                candidates.append(c2)
        for cand in candidates:
            if cand not in key_to_side:
                continue
            lvl, side = key_to_side[cand]
            pol = (tier_policy or {}).get(lvl, "first")
            if pol == "last":
                selected_by_level[lvl] = side
            elif allow_overwrite or lvl not in selected_by_level:
                selected_by_level[lvl] = side
            return

    def _assign_from_talent_step(
        s: Dict[str, Any],
        *,
        allow_overwrite: bool,
        tier_policy: Optional[Dict[int, str]] = None,
    ) -> None:
        ak = str(s.get("ability_key") or "").strip()
        if ak and _is_attribute_row_talent(ak):
            return
        try:
            aid = int(s.get("ability_id") or 0)
        except (TypeError, ValueError):
            aid = 0
        if aid > 0:
            for lvl in _TIER_LEVELS:
                pair = tier_ids.get(lvl)
                if not pair:
                    continue
                lid, rid = pair
                left_ids = [
                    x
                    for x in ([lid] + _talent_alternate_ability_ids(dc, hero_npc, lvl, "left"))
                    if x > 0
                ]
                right_ids = [
                    x
                    for x in ([rid] + _talent_alternate_ability_ids(dc, hero_npc, lvl, "right"))
                    if x > 0
                ]
                pol = (tier_policy or {}).get(lvl, "first")
                if left_ids and aid in left_ids:
                    if pol == "last":
                        selected_by_level[lvl] = "left"
                    elif allow_overwrite or lvl not in selected_by_level:
                        selected_by_level[lvl] = "left"
                    return
                if right_ids and aid in right_ids:
                    if pol == "last":
                        selected_by_level[lvl] = "right"
                    elif allow_overwrite or lvl not in selected_by_level:
                        selected_by_level[lvl] = "right"
                    return
        _assign_from_key(
            s.get("ability_key"), allow_overwrite=allow_overwrite, tier_policy=tier_policy
        )

    # 10/15 档：录像里常见「较早误报 +8 力量」随后才有真实 DOTA_ABILITY_LEVEL，故用**最后一次**命中。
    # 20/25 档：后期易有重复/噪声事件覆盖真实加点，故用**第一次**命中（与多数英雄 post-game 一致）。
    _MERGE_TIER_POLICY: Dict[int, str] = {10: "last", 15: "last", 20: "first", 25: "first"}

    # 完整 merged 先于截断 skill_build，避免 25 步内缺真实天赋而锁错档。
    if merged_upgrade_steps:
        for step in merged_upgrade_steps:
            if not isinstance(step, dict):
                continue
            try:
                aid = int(step.get("ability_id") or 0)
            except (TypeError, ValueError):
                aid = 0
            if aid <= 0:
                continue
            ak = str(dc.ability_key_from_id(aid) or "").strip()
            synth = {"ability_id": aid, "ability_key": ak}
            if skill_build_step_is_tree_talent(dc, synth):
                _assign_from_talent_step(
                    synth, allow_overwrite=True, tier_policy=_MERGE_TIER_POLICY
                )

    for s in skill_build:
        if skill_build_step_is_tree_talent(dc, s):
            _assign_from_talent_step(s, allow_overwrite=False, tier_policy=None)

    if extra_talent_keys:
        for x in extra_talent_keys:
            _assign_from_key(x, allow_overwrite=True, tier_policy=None)

    if extra_talent_ids:
        for aid_raw in extra_talent_ids:
            try:
                aid = int(aid_raw)
            except (TypeError, ValueError):
                continue
            if aid <= 0:
                continue
            ak_guess = dc.ability_key_from_id(aid) or ""
            _assign_from_talent_step(
                {"ability_id": aid, "ability_key": ak_guess},
                allow_overwrite=True,
                tier_policy=None,
            )

    tiers_out: List[Dict[str, Any]] = []
    for pair_idx in range(4):
        i = pair_idx * 2
        if i + 1 >= len(raw_t):
            break
        slot_right = raw_t[i]
        slot_left = raw_t[i + 1]
        key_right = slot_right.get("name") if isinstance(slot_right, dict) else None
        key_left = slot_left.get("name") if isinstance(slot_left, dict) else None
        if not key_left or not key_right:
            continue
        k_left, k_right = str(key_left), str(key_right)
        len_l, cn_l, img_l = _talent_labels_and_img(dc, k_left)
        len_r, cn_r, img_r = _talent_labels_and_img(dc, k_right)
        lvl = _TIER_LEVELS[pair_idx] if pair_idx < 4 else 25
        ov = TALENT_OVERRIDES.get(hero_npc, {}).get(lvl)
        if ov:
            if ov.get("left"):
                len_l = ov["left"]
                cn_l = ov["left"]
            if ov.get("right"):
                len_r = ov["right"]
                cn_r = ov["right"]
        sel: Optional[str] = selected_by_level.get(lvl)
        tiers_out.append(
            {
                "hero_level": lvl,
                "left": {
                    "ability_key": k_left,
                    "label_en": len_l or k_left,
                    "label_cn": cn_l or len_l or k_left,
                    "img": img_l,
                },
                "right": {
                    "ability_key": k_right,
                    "label_en": len_r or k_right,
                    "label_cn": cn_r or len_r or k_right,
                    "img": img_r,
                },
                "selected": sel,
            }
        )

    dots = sum(1 for t in tiers_out if t.get("selected"))
    return {"tiers": tiers_out, "dots_learned": dots}


def _talent_key_matches_flat_slot(dc: DotaConstants, k_raw: str, slot_name: str) -> bool:
    """判断已学天赋 ability_key 是否与 hero_abilities talents[j].name 一致（多别名）。"""
    if not k_raw or not slot_name:
        return False
    k0 = str(k_raw).strip()
    if not _is_talent_key(k0) or _is_attribute_row_talent(k0):
        return False
    sn = str(slot_name).strip()
    candidates = [k0]
    jk = dc.resolve_abilities_json_key(k0)
    if jk and jk not in candidates:
        candidates.append(jk)
    if k0.startswith("ability_"):
        c2 = k0[8:]
        if c2 and c2 not in candidates:
            candidates.append(c2)
    slot_res = dc.resolve_abilities_json_key(sn) or sn
    for cand in candidates:
        if cand == sn or cand == slot_res:
            return True
    return False


def infer_talent_picks_from_hero_abilities_indices(
    dc: DotaConstants,
    hero_npc: str,
    hero_abilities_map: Mapping[str, Any],
    skill_build: List[Dict[str, Any]],
    merged_upgrade_steps: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    按 hero_abilities.json「talents」8 槽下标推断四档左右选择：
    0→10右, 1→10左, … 7→25左（偶数槽=客户端右，奇数槽=左）。排除 special_bonus_attributes。
    """
    ha = hero_abilities_map.get(hero_npc)
    if not isinstance(ha, dict):
        return []
    raw_src = ha.get("talents") or []
    if not isinstance(raw_src, list) or len(raw_src) < 2:
        return []
    raw_t = _talents_raw_entries_for_tree(hero_npc, raw_src)
    if len(raw_t) < 2:
        return []

    slot_names: List[str] = []
    for el in raw_t[:8]:
        if isinstance(el, dict):
            nm = el.get("name")
        else:
            nm = el
        slot_names.append(str(nm or "").strip())

    n_slots = min(len(slot_names), len(_TALENT_FLAT_INDEX_TO_LEVEL_SIDE))
    steps = merged_upgrade_steps if merged_upgrade_steps else list(skill_build or [])
    # 与 build_talent_tree 的 merged 策略一致：10/15 末次命中，20/25 首次命中
    _INF_TIER_POLICY: Dict[int, str] = {10: "last", 15: "last", 20: "first", 25: "first"}
    by_level: Dict[int, Dict[str, Any]] = {}

    for step in steps:
        if not isinstance(step, dict):
            continue
        try:
            aid = int(step.get("ability_id") or 0)
        except (TypeError, ValueError):
            aid = 0
        ak = str(step.get("ability_key") or "").strip()
        if aid > 0:
            ak2 = dc.ability_key_from_id(aid) or ""
            if ak2:
                ak = ak2
        synth = {"ability_id": aid, "ability_key": ak}
        if not skill_build_step_is_tree_talent(dc, synth):
            continue

        idx: Optional[int] = None
        if aid > 0:
            for j in range(n_slots):
                sn = slot_names[j]
                if not sn:
                    continue
                sid = _ability_id_from_key(dc, sn)
                if sid <= 0:
                    sid = _ability_id_from_key(dc, dc.resolve_abilities_json_key(sn) or sn)
                if sid > 0 and sid == aid:
                    idx = j
                    break
        if idx is None and ak:
            for j in range(n_slots):
                sn = slot_names[j]
                if not sn:
                    continue
                if _talent_key_matches_flat_slot(dc, ak, sn):
                    idx = j
                    break

        if idx is None:
            continue
        lv, dire = _TALENT_FLAT_INDEX_TO_LEVEL_SIDE[idx]
        pol = _INF_TIER_POLICY.get(lv, "first")
        if pol == "first" and lv in by_level:
            continue
        sn = slot_names[idx]
        en, cn, _ = _talent_labels_and_img(dc, sn)
        nm = (cn or en or "").strip() or sn
        by_level[lv] = {
            "level": lv,
            "direction": dire,
            "talent_name": nm,
            "name": nm,
            "talent_index": idx,
        }

    picks = [by_level[k] for k in sorted(by_level)]
    return picks


def merge_talent_pick_lists(
    existing: Optional[List[Dict[str, Any]]],
    inferred: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """先写入推断结果，再以 existing（解析器等）按档覆盖。"""
    by_lv: Dict[int, Dict[str, Any]] = {}
    for x in inferred:
        if not isinstance(x, dict):
            continue
        try:
            lv = int(x.get("level") or 0)
        except (TypeError, ValueError):
            continue
        if lv not in (10, 15, 20, 25):
            continue
        row = dict(x)
        nm = row.get("talent_name") or row.get("name")
        if nm:
            s = str(nm)
            row["talent_name"] = s
            row["name"] = s
        by_lv[lv] = row
    for x in existing or []:
        if not isinstance(x, dict):
            continue
        lv_raw = x.get("level", x.get("hero_level"))
        try:
            lv = int(lv_raw) if lv_raw is not None else 0
        except (TypeError, ValueError):
            continue
        if lv not in (10, 15, 20, 25):
            continue
        row = dict(x)
        nm = row.get("talent_name") or row.get("name")
        if nm:
            s = str(nm)
            row["talent_name"] = s
            row["name"] = s
        by_lv[lv] = row
    return [by_lv[k] for k in sorted(by_lv)]


def merge_talent_tree_from_parser_picks(
    tree: Dict[str, Any],
    picks: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    将解析器直接给出的天赋选择合并进 talent_tree。

    每条 pick 建议形如：
      { "talent_id": 24, "level": 10, "direction": "left", "talent_name": "+8 力量" }
    - level：与客户端一致，为 10 / 15 / 20 / 25 四档之一（对应 tiers[].hero_level）
    - direction：\"left\" | \"right\"（或 l / r）
    - talent_name：可选；若提供则写入该侧 label_cn，便于与录像内文案一致
    - talent_id：可选，仅透传/预留，不参与匹配
    """
    if not picks or not isinstance(picks, list):
        return tree
    tiers = tree.get("tiers")
    if not isinstance(tiers, list) or not tiers:
        return tree

    dir_map = {
        "left": "left",
        "right": "right",
        "l": "left",
        "r": "right",
    }
    by_level: Dict[int, str] = {}
    name_by_level: Dict[int, Tuple[str, str]] = {}
    for raw in picks:
        if not isinstance(raw, dict):
            continue
        lv_raw = raw.get("level", raw.get("hero_level"))
        try:
            lv = int(lv_raw) if lv_raw is not None else 0
        except (TypeError, ValueError):
            continue
        if lv not in (10, 15, 20, 25):
            continue
        d = str(raw.get("direction") or "").strip().lower()
        side = dir_map.get(d)
        if not side:
            continue
        by_level[lv] = side
        nm = str(raw.get("talent_name") or "").strip()
        if nm:
            name_by_level[lv] = (side, nm)

    if not by_level:
        return tree

    new_tiers: List[Dict[str, Any]] = []
    for t in tiers:
        if not isinstance(t, dict):
            new_tiers.append(t)
            continue
        try:
            hl = int(t.get("hero_level") or 0)
        except (TypeError, ValueError):
            hl = 0
        nt = dict(t)
        if hl in by_level:
            nt["selected"] = by_level[hl]
        if hl in name_by_level:
            side, name = name_by_level[hl]
            left = dict(nt.get("left") or {})
            right = dict(nt.get("right") or {})
            if side == "left":
                left["label_cn"] = name
            else:
                right["label_cn"] = name
            nt["left"] = left
            nt["right"] = right
        new_tiers.append(nt)

    dots = sum(1 for x in new_tiers if x.get("selected") in ("left", "right"))
    out = dict(tree)
    out["tiers"] = new_tiers
    out["dots_learned"] = dots
    return out
