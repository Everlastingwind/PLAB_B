#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dem_result_to_slim_match import (
    _match_end_time_sec,
    _pick_lone_druid_bear_npc,
    _unit_item_last_seen_times,
    get_constants,
)


def _load_events(path: Path) -> List[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return [e for e in raw if isinstance(e, dict)]
    if isinstance(raw, dict):
        ev = raw.get("events")
        if isinstance(ev, list):
            return [e for e in ev if isinstance(e, dict)]
    raise ValueError("输入 JSON 既不是 events 数组，也不是含 events 的对象")


def _load_slim(path: Path) -> Dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("slim JSON 必须是对象")
    return raw


def _hero_rows(slim: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in slim.get("players") or []:
        if not isinstance(p, dict):
            continue
        hn = str(p.get("hero_name_en") or "").strip().lower().replace(" ", "_")
        if hn == "lone_druid":
            out.append(p)
    return out


def _slot_keys(items_slot: Any) -> List[Optional[str]]:
    out: List[Optional[str]] = []
    if not isinstance(items_slot, list):
        return [None, None, None, None, None, None]
    for i in range(6):
        if i >= len(items_slot) or not isinstance(items_slot[i], dict):
            out.append(None)
            continue
        k = str(items_slot[i].get("item_key") or "").strip().lower()
        out.append(k or None)
    return out


def _item_purchase_last_times(events: List[dict], unit_npc: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for e in events:
        if e.get("type") != "DOTA_COMBATLOG_PURCHASE":
            continue
        if str(e.get("targetname") or "") != unit_npc:
            continue
        vn = str(e.get("valuename") or "").strip().lower()
        if not vn.startswith("item_"):
            continue
        try:
            t = int(e.get("time") or 0)
        except (TypeError, ValueError):
            continue
        key = vn.replace("item_", "", 1)
        prev = out.get(key)
        if prev is None or t >= prev:
            out[key] = t
    return out


def _fmt_t(v: Optional[int]) -> str:
    return "-" if v is None else str(int(v))


def _print_side(
    title: str,
    keys: List[Optional[str]],
    purchase_t: Dict[str, int],
    use_t: Dict[str, int],
) -> None:
    print(f"\n[{title}]")
    print("slot | item_key | last_purchase | last_use")
    print("-----|----------|---------------|---------")
    for i, k in enumerate(keys):
        if not k:
            print(f"{i:<4} | (empty)  | -             | -")
            continue
        print(
            f"{i:<4} | {k:<8} | {_fmt_t(purchase_t.get(k)):<13} | {_fmt_t(use_t.get(k))}"
        )


def _infer_hero_npc_from_row(row: Dict[str, Any]) -> str:
    hn = str(row.get("hero_name_en") or "").strip().lower().replace(" ", "_")
    return f"npc_dota_hero_{hn}" if hn else "npc_dota_hero_lone_druid"


def main() -> None:
    ap = argparse.ArgumentParser(
        description="逐格验证独行德鲁伊本体/熊灵装备，并输出证据时间（purchase/use）"
    )
    ap.add_argument("parser_json", type=Path, help="解析器输出 JSON（events 数组或含 events 对象）")
    ap.add_argument("slim_json", type=Path, help="当前前端使用的 slim match JSON")
    args = ap.parse_args()

    events = _load_events(args.parser_json)
    slim = _load_slim(args.slim_json)
    rows = _hero_rows(slim)
    if not rows:
        print("未在 slim 中找到 lone_druid 玩家。")
        return

    dc = get_constants()
    end_t = _match_end_time_sec(events)
    print(f"match_end_time: {end_t}")

    for idx, row in enumerate(rows, start=1):
        slot = row.get("player_slot")
        name = row.get("personaname")
        hero_npc = _infer_hero_npc_from_row(row)
        logical_slot = int(slot) - 128 if isinstance(slot, int) and slot >= 128 else int(slot or 0)
        bear_npc = _pick_lone_druid_bear_npc(events, logical_slot, match_end_time=end_t)

        print("\n" + "=" * 72)
        print(f"Lone Druid #{idx} | player_slot={slot} | name={name}")
        print(f"hero_npc={hero_npc} | bear_npc={bear_npc or '(not found)'}")

        hero_keys = _slot_keys(row.get("items_slot"))
        hero_purchase_t = _item_purchase_last_times(events, hero_npc)
        hero_use_t = _unit_item_last_seen_times(events, hero_npc, dc, match_end_time=end_t)
        _print_side("Hero main six", hero_keys, hero_purchase_t, hero_use_t)

        bear_keys = _slot_keys(row.get("spirit_bear_items_slot"))
        if bear_npc:
            bear_purchase_t = _item_purchase_last_times(events, bear_npc)
            bear_use_t = _unit_item_last_seen_times(events, bear_npc, dc, match_end_time=end_t)
        else:
            bear_purchase_t = {}
            bear_use_t = {}
        _print_side("Bear main six", bear_keys, bear_purchase_t, bear_use_t)


if __name__ == "__main__":
    main()

