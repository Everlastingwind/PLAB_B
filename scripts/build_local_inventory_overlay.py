#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从**本地** parser 产物生成小 JSON，供 ``dem_result_to_slim_match.py --inventory-overlay`` 合并。

重要事实（请读）：
  - OpenDota 官方 parser 吐出的 JSON 里，通常**没有**「游戏结束瞬间每个英雄 6 主格」的字段；
    只有战斗日志（购买、ITEM 等）。因此本脚本**不能凭空**算出和客户端一模一样的终局栏；
    它与 ``dem_result_to_slim_match`` 里用的推断逻辑同源。
  - **真正 100% 对齐客户端**：要么让 parser 在 interval / players 里写出 item_0..item_5（最后一帧），
    要么另用 Clarity 等读 .dem 实体（本仓库未内置 Java 提取器）。

本脚本用途：
  1) 导出一份 ``item_0..item_5`` 列表，**可手工改数字**后再 ``--inventory-overlay`` 合并，修正个别错格；
  2) 从已有 slim 反解出 overlay，方便对比 / 编辑。

用法（PLAB_B 根目录）:
  python scripts/build_local_inventory_overlay.py parser_result.json -o out/overlay.json
  python scripts/build_local_inventory_overlay.py --from-slim public/data/matches/8767833338.json -o out/overlay.json

再合并进 slim:
  python scripts/dem_result_to_slim_match.py parser_result.json --inventory-overlay out/overlay.json -o out/slim.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import importlib.util  # noqa: E402

_dem = Path(__file__).resolve().parent / "dem_result_to_slim_match.py"
_spec = importlib.util.spec_from_file_location("_dem_slim", _dem)
if _spec is None or _spec.loader is None:
    raise RuntimeError("无法加载 dem_result_to_slim_match.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
_parse_players_addon = _mod._parse_players_addon
_merge_player_blobs = _mod._merge_player_blobs
build_slim_from_dem_events = _mod.build_slim_from_dem_events


def _players_from_slim(slim: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in slim.get("players") or []:
        if not isinstance(p, dict):
            continue
        ps = p.get("player_slot")
        hid = p.get("hero_id")
        if ps is None or hid is None:
            continue
        row: Dict[str, Any] = {
            "player_slot": int(ps),
            "hero_id": int(hid),
        }
        slots = p.get("items_slot")
        if isinstance(slots, list):
            for i in range(6):
                cell = slots[i] if i < len(slots) else None
                iid = 0
                if isinstance(cell, dict):
                    try:
                        iid = int(cell.get("item_id") or 0)
                    except (TypeError, ValueError):
                        iid = 0
                row[f"item_{i}"] = iid
        else:
            for i in range(6):
                row[f"item_{i}"] = 0
        nn = p.get("item_neutral")
        if nn is not None:
            try:
                row["item_neutral"] = int(nn)
            except (TypeError, ValueError):
                pass
        for k in ("aghanims_scepter", "aghanims_shard", "permanent_buffs"):
            if k in p:
                row[k] = p[k]
        out.append(row)
    return out


def _load_events_and_blob(path: Path) -> tuple[List[dict], Optional[List[Dict[str, Any]]]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    events: List[dict] = []
    players_blob: Optional[List[Dict[str, Any]]] = None
    if isinstance(raw, dict):
        ev = raw.get("events")
        if isinstance(ev, list):
            events = [e for e in ev if isinstance(e, dict)]
        pb = raw.get("players")
        if isinstance(pb, list):
            players_blob = [p for p in pb if isinstance(p, dict)]
    elif isinstance(raw, list):
        events = [e for e in raw if isinstance(e, dict)]
    else:
        raise SystemExit("输入应为事件数组，或含 events 的对象")
    return events, players_blob


def main() -> None:
    ap = argparse.ArgumentParser(
        description="从本地 parser JSON 或 slim 生成 inventory overlay（无 OpenDota）",
    )
    ap.add_argument(
        "input_json",
        type=Path,
        nargs="?",
        default=None,
        help="parser 输出的 result.json（省略若使用 --from-slim）",
    )
    ap.add_argument("-o", "--out", type=Path, required=True, help="输出 overlay.json")
    ap.add_argument(
        "--from-slim",
        type=Path,
        default=None,
        metavar="PATH",
        help="从已生成的 slim match JSON 提取（用于手改回流）",
    )
    ap.add_argument(
        "--players",
        type=Path,
        default=None,
        metavar="PATH",
        help="与 dem_result_to_slim_match 相同：合并 players 补丁",
    )
    args = ap.parse_args()

    if args.from_slim:
        slim = json.loads(args.from_slim.read_text(encoding="utf-8"))
        if not isinstance(slim, dict):
            sys.exit("--from-slim 须为对象")
        players = _players_from_slim(slim)
        mid = slim.get("match_id")
        dur = slim.get("duration")
    else:
        if not args.input_json or not args.input_json.is_file():
            sys.exit("请提供 parser 的 input.json，或使用 --from-slim")
        events, players_blob = _load_events_and_blob(args.input_json)
        if args.players:
            if not args.players.is_file():
                sys.exit(f"--players 不存在: {args.players}")
            addon = _parse_players_addon(
                json.loads(args.players.read_text(encoding="utf-8"))
            )
            if not addon:
                sys.exit("--players 无效")
            players_blob = _merge_player_blobs(players_blob, addon)
        slim = build_slim_from_dem_events(events, players_blob=players_blob)
        players = _players_from_slim(slim)
        mid = slim.get("match_id")
        dur = slim.get("duration")

    overlay: Dict[str, Any] = {
        "format": "local_inventory_overlay_v1",
        "source": "parser_events_via_slim_inference"
        if not args.from_slim
        else "from_existing_slim_json",
        "match_id": mid,
        "duration": dur,
        "players": players,
        "_note_zh": (
            "item_* 为 dotaconstants 物品数值 id；全 0 表示推断为空。"
            "若与游戏不符，请手改后仍用 --inventory-overlay 合并。"
        ),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(overlay, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("已写入:", args.out.resolve())
    print("players:", len(players))


if __name__ == "__main__":
    main()
