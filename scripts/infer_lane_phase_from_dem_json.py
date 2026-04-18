"""
从 DEM 解析 JSON（事件数组）推断对线期（前 5 分钟）分路。

规则（尝试版）：
- 只看 ``type=interval`` 且 ``0 <= time <= lane_phase_sec`` 的坐标点；
- 每名英雄取 ``(x, y)`` 中位数作为对线期代表位置；
- 用 ``delta = x - y`` 判路：
  - ``delta > lane_delta`` => bot
  - ``delta < -lane_delta`` => top
  - 其余 => mid

用法：
  python scripts/infer_lane_phase_from_dem_json.py E:\\doreplays_json_results\\8771854870.json
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _hero_name_from_unit(unit: str) -> str:
    s = str(unit or "")
    if "CDOTA_Unit_Hero_" in s:
        s = s.split("CDOTA_Unit_Hero_", 1)[1]
    if "npc_dota_hero_" in s:
        s = s.split("npc_dota_hero_", 1)[1]
    return s


def _lane_by_xy(x: float, y: float, lane_delta: float) -> str:
    d = float(x) - float(y)
    if d > lane_delta:
        return "bot"
    if d < -lane_delta:
        return "top"
    return "mid"


def infer_lanes(
    events: List[Dict[str, Any]],
    *,
    lane_phase_sec: int = 300,
    lane_delta: float = 20.0,
) -> List[Dict[str, Any]]:
    slot_to_player_slot: Dict[int, int] = {}
    points_by_slot: Dict[int, List[Tuple[float, float, str]]] = {}

    for e in events:
        if e.get("type") == "player_slot":
            try:
                slot_to_player_slot[int(e.get("key"))] = int(e.get("value"))
            except (TypeError, ValueError):
                continue

    for e in events:
        if e.get("type") != "interval":
            continue
        t = e.get("time")
        if not isinstance(t, (int, float)):
            continue
        if t < 0 or t > lane_phase_sec:
            continue
        s = e.get("slot")
        x = e.get("x")
        y = e.get("y")
        if not isinstance(s, int):
            continue
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            continue
        unit = str(e.get("unit") or "")
        points_by_slot.setdefault(s, []).append((float(x), float(y), unit))

    out: List[Dict[str, Any]] = []
    for slot in sorted(points_by_slot.keys()):
        pts = points_by_slot[slot]
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        mx = float(statistics.median(xs))
        my = float(statistics.median(ys))
        lane = _lane_by_xy(mx, my, lane_delta)
        player_slot = slot_to_player_slot.get(slot)
        out.append(
            {
                "slot": slot,
                "player_slot": player_slot,
                "is_radiant": bool(player_slot is not None and player_slot < 128),
                "hero": _hero_name_from_unit(pts[-1][2]),
                "samples": len(pts),
                "x_median": round(mx, 3),
                "y_median": round(my, 3),
                "lane_0_300s": lane,
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="推断对线期分路（top/mid/bot）")
    ap.add_argument("json_path", type=Path)
    ap.add_argument("--lane-phase-sec", type=int, default=300)
    ap.add_argument("--lane-delta", type=float, default=20.0)
    args = ap.parse_args()

    raw = json.loads(args.json_path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        events = [e for e in (raw.get("events") or []) if isinstance(e, dict)]
    elif isinstance(raw, list):
        events = [e for e in raw if isinstance(e, dict)]
    else:
        raise SystemExit("输入 JSON 必须是数组，或包含 events 数组的对象")

    rows = infer_lanes(
        events,
        lane_phase_sec=args.lane_phase_sec,
        lane_delta=args.lane_delta,
    )
    print(
        json.dumps(
            {
                "json_path": str(args.json_path),
                "lane_phase_sec": args.lane_phase_sec,
                "lane_delta": args.lane_delta,
                "rows": rows,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
