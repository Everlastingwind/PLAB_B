"""
将已写入的 slim 对局 JSON 中每名玩家的 hero_damage / tower_damage / hero_healing
按 OpenDota 本场数据按 player_slot 覆盖（与客户端计分板同源）。

DEM 管线原先仅从战斗日志聚合伤害，易与客户端「对英雄伤害」不一致；导入脚本已改为在
能拉取 OpenDota 时合并上述字段。本脚本用于**不重跑 DEM** 地修补历史 public 数据。

用法（项目根）::
  python scripts/repair_opendota_damage_stats_in_match_json.py --dry-run --limit 5
  python scripts/repair_opendota_damage_stats_in_match_json.py
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.dota_mapping import get_constants, translate_match_data  # noqa: E402

import scripts.dem_result_to_slim_match as dem  # noqa: E402


def _by_slot_from_api_players(
    api_players: List[Dict[str, Any]], duration: int
) -> Dict[int, Dict[str, Any]]:
    od_slim = translate_match_data({"players": api_players, "duration": int(duration)})
    by_slot: Dict[int, Dict[str, Any]] = {}
    for p in od_slim.get("players") or []:
        if not isinstance(p, dict):
            continue
        ps = p.get("player_slot")
        if ps is None:
            continue
        try:
            by_slot[int(ps)] = p
        except (TypeError, ValueError):
            continue
    return by_slot


def _patch_file(path: Path, *, dry_run: bool) -> Tuple[str, int]:
    raw_local = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw_local, dict):
        return ("skip_not_object", 0)
    try:
        mid = int(raw_local.get("match_id") or 0)
    except (TypeError, ValueError):
        mid = 0
    if mid <= 0:
        return ("skip_no_match_id", 0)
    players = raw_local.get("players")
    if not isinstance(players, list) or len(players) < 2:
        return ("skip_bad_players", 0)

    raw_od, err = dem._fetch_opendota_match_json(mid)
    if not raw_od or not isinstance(raw_od.get("players"), list):
        return (f"fetch_fail:{err}", 0)
    try:
        dur = int(raw_od.get("duration") or raw_local.get("duration") or 0)
    except (TypeError, ValueError):
        dur = 0
    by_slot = _by_slot_from_api_players(raw_od["players"], dur)
    changed = 0
    for p in players:
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
        before = {k: p.get(k) for k in ("hero_damage", "tower_damage", "hero_healing")}
        dem._merge_opendota_damage_stats_into_player(p, src)
        after = {k: p.get(k) for k in ("hero_damage", "tower_damage", "hero_healing")}
        if before != after:
            changed += 1
    if changed == 0:
        return ("ok_no_change", 0)
    if dry_run:
        return ("dry_run_would_write", changed)
    path.write_text(
        json.dumps(raw_local, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return ("ok_written", changed)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--matches-dir",
        type=Path,
        default=ROOT / "opendota-match-ui" / "public" / "data" / "matches",
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="最多处理文件数，0 表示不限制")
    ap.add_argument("--sleep", type=float, default=1.0, help="每次请求 OpenDota 后的间隔（秒）")
    args = ap.parse_args()

    get_constants().load()

    files = sorted(args.matches_dir.glob("*.json"))
    if args.limit > 0:
        files = files[: args.limit]

    n_ok = n_fail = n_skip = 0
    slots_changed = 0
    for fp in files:
        tag, ch = _patch_file(fp, dry_run=args.dry_run)
        if tag.startswith("ok"):
            n_ok += 1
        elif tag.startswith("fetch_fail") or tag.startswith("dry_run"):
            n_fail += 1
        else:
            n_skip += 1
        slots_changed += ch
        print(f"{fp.name}: {tag} slots_changed={ch}", flush=True)
        if not tag.startswith("skip") and args.sleep > 0:
            time.sleep(args.sleep)

    print(
        f"done files={len(files)} ok-ish={n_ok} other={n_fail} skip={n_skip} "
        f"player_rows_touched={slots_changed} dry_run={args.dry_run}",
        flush=True,
    )


if __name__ == "__main__":
    main()
