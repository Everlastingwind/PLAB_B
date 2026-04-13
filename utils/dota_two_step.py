"""
两阶段映射（经典 ID → 内部名 → 详情 / CDN）：

1. ``item_ids.json`` / ``ability_ids.json``：数字 ID → 内部英文名（value）
2. ``items.json`` / ``abilities.json``：内部名 → 详情（含官方 ``img`` 相对路径）

避免用数字直接索引 ``items.json`` / ``abilities.json``（其 key 为英文名）。
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, MutableMapping, Optional

from utils.dota_mapping import (
    DotaConstants,
    is_talent_ability,
    raw_ability_upgrades_arr_to_merged_steps,
    steam_asset_url,
)

STEAM_CDN = "https://cdn.cloudflare.steamstatic.com"
DOTA_REACT_ITEMS = f"{STEAM_CDN}/apps/dota2/images/dota_react/items"
DOTA_REACT_ABILITIES = f"{STEAM_CDN}/apps/dota2/images/dota_react/abilities"


def _safe_int_id(val: Any) -> Optional[int]:
    if val is None:
        return None
    try:
        i = int(val)
    except (TypeError, ValueError):
        return None
    return i if i > 0 else None


def strip_item_prefix_for_cdn(internal_name: str) -> str:
    """item_ids 可能给出 ``item_xxx``；items.json 的 key 多为去掉 ``item_`` 后的名。CDN 文件名用干净名。"""
    s = (internal_name or "").strip()
    if s.startswith("item_"):
        return s[5:]
    return s


def fallback_item_cdn_png(clean_key: str) -> str:
    """无 ``items`` 条目时的兜底 PNG（与客户端路径约定一致）。"""
    name = strip_item_prefix_for_cdn(clean_key)
    return f"{DOTA_REACT_ITEMS}/{name}.png"


def fallback_ability_cdn_png(ability_key: str) -> str:
    k = (ability_key or "").strip()
    if not k:
        return ""
    return f"{DOTA_REACT_ABILITIES}/{k}.png"


def step1_item_id_to_internal_name(dc: DotaConstants, item_id: Any) -> Optional[str]:
    iid = _safe_int_id(item_id)
    if iid is None:
        return None
    raw = dc.item_ids.get(str(iid))
    if raw:
        return str(raw).strip()
    return None


def step1_ability_id_to_internal_name(dc: DotaConstants, ability_id: Any) -> Optional[str]:
    aid = _safe_int_id(ability_id)
    if aid is None:
        return None
    return dc.ability_key_from_id(aid)


def resolve_one_item_slot(
    dc: DotaConstants,
    slot: int,
    raw_item_id: Any,
    *,
    group: str,
) -> Dict[str, Any]:
    """
    单格物品：ID → item_ids → items.json → image_url。

    - ``group``: ``main`` | ``backpack`` | ``neutral``
    """
    iid = 0
    try:
        if raw_item_id is not None:
            iid = int(raw_item_id)
    except (TypeError, ValueError):
        iid = 0

    internal = step1_item_id_to_internal_name(dc, iid) if iid > 0 else None
    json_key = dc.resolve_items_json_key(internal) if internal else None

    if not json_key:
        return {
            "group": group,
            "slot": slot,
            "item_id": iid,
            "item_key": None,
            "item_name_en": "",
            "item_name_cn": "",
            "image_url": "",
            "empty": True,
            "resolve_note": None if iid <= 0 else f"unknown_item_id:{iid}",
        }

    row = dc.items.get(json_key) or {}
    dname = str(row.get("dname") or json_key)
    cn = dc.items_zh_by_key.get(json_key) or dname
    img = steam_asset_url(row.get("img")) if row else ""
    if not img:
        img = fallback_item_cdn_png(internal or json_key)

    return {
        "group": group,
        "slot": slot,
        "item_id": iid,
        "item_key": json_key,
        "item_name_en": dname,
        "item_name_cn": cn,
        "image_url": img,
        "empty": False,
        "resolve_note": None,
    }


def build_player_items_resolved(
    player: Mapping[str, Any],
    dc: DotaConstants,
) -> Dict[str, Any]:
    """
    遍历 ``item_0..5``、``backpack_0..2``、``item_neutral``，
    全部经 ``item_ids`` → ``items`` 两步解析。
    """
    main: List[Dict[str, Any]] = []
    for s in range(6):
        main.append(
            resolve_one_item_slot(dc, s, player.get(f"item_{s}"), group="main")
        )

    backpack: List[Dict[str, Any]] = []
    for s in range(3):
        backpack.append(
            resolve_one_item_slot(
                dc, s, player.get(f"backpack_{s}"), group="backpack"
            )
        )

    neutral_raw = player.get("item_neutral")
    neutral: Optional[Dict[str, Any]] = None
    try:
        nid = int(neutral_raw) if neutral_raw is not None else 0
    except (TypeError, ValueError):
        nid = 0
    if nid > 0:
        neutral = resolve_one_item_slot(dc, 0, nid, group="neutral")
    else:
        neutral = None

    return {"main": main, "backpack": backpack, "neutral": neutral}


def build_skill_build_two_step(
    dc: DotaConstants,
    ability_upgrades_arr: Any,
    *,
    match_duration_sec: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    ``ability_upgrades_arr`` 纯数字 ID 列表 → ``ability_ids`` → ``abilities.json``。

    输出（每步一项，最多 25 步）::

      天赋: { "type": "talent", "level": n, "name": str, "ability_id", "ability_key" }
      技能: { "type": "ability", "level": n, "img_url": str, "ability_id", "ability_key" }
      未知: { "type": "unknown", "level": n, "ability_id", "reason": "..." }
    """
    merged = raw_ability_upgrades_arr_to_merged_steps(
        ability_upgrades_arr,
        match_duration_sec=match_duration_sec,
    )
    out: List[Dict[str, Any]] = []
    for i, step in enumerate(merged[:25]):
        level = i + 1
        try:
            aid = int(step.get("ability_id") or 0)
        except (TypeError, ValueError):
            aid = 0
        if aid <= 0:
            continue

        akey = step1_ability_id_to_internal_name(dc, aid)
        json_key = dc.resolve_abilities_json_key(akey) if akey else None
        ab_row = dc.abilities.get(json_key) if json_key else None

        if not akey:
            out.append(
                {
                    "type": "unknown",
                    "level": level,
                    "ability_id": aid,
                    "ability_key": None,
                    "reason": "ability_id_not_in_ability_ids",
                }
            )
            continue

        if not json_key or not isinstance(ab_row, dict):
            out.append(
                {
                    "type": "unknown",
                    "level": level,
                    "ability_id": aid,
                    "ability_key": akey,
                    "reason": "ability_key_not_in_abilities_json",
                    "img_url": fallback_ability_cdn_png(akey),
                }
            )
            continue

        is_talent = is_talent_ability(
            json_key, ab_row if isinstance(ab_row, dict) else None
        )
        name_en = str(ab_row.get("dname") or akey)
        name_cn = dc.abilities_zh_by_key.get(json_key) or name_en

        if is_talent:
            out.append(
                {
                    "type": "talent",
                    "level": level,
                    "name": name_cn,
                    "name_en": name_en,
                    "ability_id": aid,
                    "ability_key": json_key,
                }
            )
        else:
            img = steam_asset_url(ab_row.get("img"))
            if not img:
                img = fallback_ability_cdn_png(json_key)
            out.append(
                {
                    "type": "ability",
                    "level": level,
                    "img_url": img,
                    "name_en": name_en,
                    "name_cn": name_cn,
                    "ability_id": aid,
                    "ability_key": json_key,
                }
            )

    return out


def apply_two_step_to_player(
    player: MutableMapping[str, Any],
    dc: DotaConstants,
    *,
    mutate_items_slot: bool = True,
    match_duration_sec: Optional[int] = None,
) -> None:
    """
    就地写入 ``items_resolved``、``skill_build_two_step``；
    可选：用两步结果覆盖 ``items_slot``（与旧前端字段对齐）。
    """
    player["items_resolved"] = build_player_items_resolved(player, dc)

    raw_arr = player.get("ability_upgrades_arr")
    player["skill_build_two_step"] = build_skill_build_two_step(
        dc, raw_arr, match_duration_sec=match_duration_sec
    )

    if mutate_items_slot:
        main = player["items_resolved"]["main"]
        if isinstance(main, list) and len(main) >= 6:
            items_slot: List[Dict[str, Any]] = []
            for s in range(6):
                cell = main[s] if s < len(main) else {}
                if not isinstance(cell, dict):
                    cell = {}
                items_slot.append(
                    {
                        "slot": s,
                        "item_id": cell.get("item_id", 0),
                        "item_key": cell.get("item_key"),
                        "item_name_en": cell.get("item_name_en", ""),
                        "item_name_cn": cell.get("item_name_cn", ""),
                        "image_url": cell.get("image_url", ""),
                        "empty": bool(cell.get("empty", True)),
                    }
                )
            player["items_slot"] = items_slot
