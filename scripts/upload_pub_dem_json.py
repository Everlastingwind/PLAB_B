#!/usr/bin/env python3
"""
将本机 DEM 解析器输出的事件 JSON（顶层为数组，或含 ``events`` 的对象）转为前端 slim，
经 ``translate_match_data`` 后写入 ``opendota-match-ui/public/data/matches/`` 并重建
``replays_index.json``，首页 **PUB** 标签页即可看到。

示例::

  python scripts/upload_pub_dem_json.py E:\\doreplays_json_results\\8767466369.json

默认在能解析出 **match_id** 时，会**自动从 OpenDota 合并终局 6 格 + 中立装备**（与客户端结算栏一致），
并合并 **对英雄/建筑伤害与治疗**（与客户端计分板同源，避免仅用战斗日志累加造成的偏差）；
加点/天赋仍以本地 DEM 为准。可用 ``--no-opendota-items`` 关闭上述 OpenDota 合并。
完整合并（含 OpenDota skill_build）仍用 ``--merge-opendota``。

与 ``dem_result_to_slim_match.py`` 的输入格式一致；可选 ``--players`` 合并加点辅助 JSON。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_dem_script_module():
    path = ROOT / "scripts" / "dem_result_to_slim_match.py"
    spec = importlib.util.spec_from_file_location("dem_result_to_slim_match", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载: {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _parse_events_blob(
    raw: Any,
    players_path: Optional[Path],
    dem_mod: Any,
) -> tuple[List[dict], Optional[List[Dict[str, Any]]]]:
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
        raise SystemExit("JSON 应为事件数组，或含 events 字段的对象")

    if players_path:
        if not players_path.is_file():
            raise SystemExit(f"--players 文件不存在: {players_path}")
        addon_raw = json.loads(players_path.read_text(encoding="utf-8"))
        addon_pl = dem_mod._parse_players_addon(addon_raw)
        if not addon_pl:
            raise SystemExit("--players 需为非空 JSON 数组，或含非空 players 数组的对象")
        players_blob = dem_mod._merge_player_blobs(players_blob, addon_pl)

    return events, players_blob


def main() -> None:
    ap = argparse.ArgumentParser(
        description="DEM 事件 JSON → PUB 列表（public/data/matches + replays_index）",
    )
    ap.add_argument(
        "result_json",
        type=Path,
        help="解析器输出（数组 或 {events, players}）",
    )
    ap.add_argument(
        "--players",
        type=Path,
        default=None,
        metavar="PATH",
        help="与 dem_result_to_slim_match 相同：合并加点等 players 元数据",
    )
    ap.add_argument(
        "--no-opendota-items",
        action="store_true",
        help="不从 OpenDota 合并终局装备（默认会合并 items_slot / 中立 / 神杖魔晶 buff）",
    )
    ap.add_argument(
        "--merge-opendota",
        action="store_true",
        help="从 OpenDota 额外合并 skill_build / 天赋 / 时间线等（需网络；已含装备）",
    )
    ap.add_argument(
        "--opendota-match-id",
        type=int,
        default=None,
        metavar="ID",
        help="与 --merge-opendota 连用；省略则用 epilogue 推断的 match_id",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印 match_id / 玩家数，不写文件",
    )
    args = ap.parse_args()

    path = args.result_json.resolve()
    if not path.is_file():
        raise SystemExit(f"文件不存在: {path}")

    dem_mod = _load_dem_script_module()

    print("加载 dotaconstants …", flush=True)
    from utils.dota_mapping import get_constants, translate_match_data  # noqa: WPS433

    get_constants().load()

    raw = json.loads(path.read_text(encoding="utf-8"))
    events, players_blob = _parse_events_blob(raw, args.players, dem_mod)

    slim: Dict[str, Any] = dem_mod.build_slim_from_dem_events(
        events, players_blob=players_blob
    )

    mid = args.opendota_match_id
    if mid is None or mid <= 0:
        mid = slim.get("match_id")
    try:
        mid_int = int(mid) if mid is not None else 0
    except (TypeError, ValueError):
        mid_int = 0

    if not args.no_opendota_items and mid_int > 0:
        ok_i, omsg_i = dem_mod.merge_endgame_inventory_from_opendota(slim, mid_int)
        print(
            "OpenDota 终局装备与伤害/治疗合并:",
            "成功" if ok_i else "失败",
            omsg_i,
            "match_id=",
            mid_int,
            flush=True,
        )
    elif not args.no_opendota_items:
        print("跳过 OpenDota 装备：无效 match_id", flush=True)

    if args.merge_opendota:
        if mid_int > 0:
            ok, omsg = dem_mod.merge_skill_and_talent_from_opendota(slim, mid_int)
            print(
                "OpenDota 全量合并:",
                "成功" if ok else "失败",
                omsg,
                "match_id=",
                mid_int,
                flush=True,
            )
        else:
            print(
                "跳过 OpenDota 全量：无效 match_id，请设 --opendota-match-id",
                flush=True,
            )

    print("translate_match_data() …", flush=True)
    final_slim = translate_match_data(slim)

    mid_out = int(final_slim.get("match_id") or 0)
    npl = len(final_slim.get("players") or [])
    print(f"match_id={mid_out} players={npl}", flush=True)

    if args.dry_run:
        return

    from backend.match_service import save_uploaded_match_slim  # noqa: WPS433

    out_path = save_uploaded_match_slim(final_slim)
    print("已写入并更新索引:", out_path, flush=True)


if __name__ == "__main__":
    main()
