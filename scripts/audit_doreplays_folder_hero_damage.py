"""
核对指定目录下 DEM 解析器输出的 JSON（事件数组或含 events 的对象），
用与 ``dem_result_to_slim_match.build_slim_from_dem_events`` 相同的规则
（含 ``_aggregate_combat``：排除自伤、排除 target 为幻象）重新计算每名玩家的
``hero_damage`` / ``tower_damage`` / ``hero_healing``，并写出汇总 JSON。

用法（项目根 PLAB_B）::

  python scripts/audit_doreplays_folder_hero_damage.py
  python scripts/audit_doreplays_folder_hero_damage.py --dir \"E:\\\\doreplays_json_results\"
  python scripts/audit_doreplays_folder_hero_damage.py --dir \"E:\\\\doreplays_json_results\" --write-public
  python scripts/audit_doreplays_folder_hero_damage.py --dir \"E:\\\\doreplays_json_results\" --out \"E:\\\\doreplays_json_results\\\\_hero_damage_reaudit.json\"
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_dem_module() -> Any:
    path = ROOT / "scripts" / "dem_result_to_slim_match.py"
    spec = importlib.util.spec_from_file_location("dem_result_to_slim_match", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载: {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _parse_input(raw: Any):
    if isinstance(raw, list):
        return [e for e in raw if isinstance(e, dict)], None
    if isinstance(raw, dict):
        ev = raw.get("events")
        events = [e for e in ev if isinstance(e, dict)] if isinstance(ev, list) else []
        pb = raw.get("players")
        blob = [p for p in pb if isinstance(p, dict)] if isinstance(pb, list) else None
        return events, blob
    return [], None


def main() -> None:
    ap = argparse.ArgumentParser(description="核对目录内 DEM JSON 的伤害汇总")
    ap.add_argument(
        "--dir",
        type=Path,
        default=Path(r"E:\doreplays_json_results"),
        help="含解析结果 *.json 的目录",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="汇总输出路径；默认写入 --dir/_hero_damage_reaudit.json",
    )
    ap.add_argument(
        "--write-public",
        action="store_true",
        help=(
            "每场经 translate_match_data 后写入 opendota-match-ui/public/data/matches/{match_id}.json，"
            "最后重建 replays_index.json，并将 latest_match.json 设为本批次中 match_id 最大的一场。"
        ),
    )
    args = ap.parse_args()

    src = args.dir
    if not src.is_dir():
        raise SystemExit(f"目录不存在: {src}")

    out_path = args.out or (src / "_hero_damage_reaudit.json")

    from utils.dota_mapping import get_constants, translate_match_data

    get_constants().load()
    dem = _load_dem_module()

    matches_out: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    written_mids: List[int] = []

    files = sorted(src.glob("*.json"))
    # 跳过本脚本生成的汇总文件
    files = [f for f in files if f.name != "_hero_damage_reaudit.json"]

    for fp in files:
        try:
            raw = json.loads(fp.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            errors.append({"file": fp.name, "error": str(e)[:300]})
            continue
        events, players_blob = _parse_input(raw)
        if len(events) < 100:
            errors.append({"file": fp.name, "error": "事件过少或无法解析"})
            continue
        try:
            slim = dem.build_slim_from_dem_events(events, players_blob=players_blob)
        except Exception as e:
            errors.append({"file": fp.name, "error": str(e)[:500]})
            continue
        mid = slim.get("match_id")
        rows: List[Dict[str, Any]] = []
        for p in slim.get("players") or []:
            if not isinstance(p, dict):
                continue
            rows.append(
                {
                    "player_slot": p.get("player_slot"),
                    "hero_id": p.get("hero_id"),
                    "personaname": p.get("personaname") or p.get("name"),
                    "hero_damage": p.get("hero_damage"),
                    "tower_damage": p.get("tower_damage"),
                    "hero_healing": p.get("hero_healing"),
                }
            )
        matches_out.append(
            {
                "source_file": fp.name,
                "match_id": mid,
                "duration": slim.get("duration"),
                "players": rows,
            }
        )
        print(
            f"OK {fp.name} match_id={mid} players={len(rows)}",
            flush=True,
        )

        if args.write_public:
            try:
                mid_int = int(mid or 0)
            except (TypeError, ValueError):
                mid_int = 0
            if mid_int <= 0:
                errors.append(
                    {"file": fp.name, "error": "write_public跳过：match_id 无效"}
                )
            else:
                from backend.match_service import save_uploaded_match_slim

                final = translate_match_data(slim)
                save_uploaded_match_slim(final, rebuild_index=False)
                written_mids.append(mid_int)
                print(f"  -> public data/matches/{mid_int}.json", flush=True)

    if args.write_public and written_mids:
        from backend.match_service import (
            FRONTEND_MATCHES_DIR,
            FRONTEND_PUBLIC_DATA,
            rebuild_replays_index,
        )

        n = rebuild_replays_index()
        best_mid = max(written_mids)
        latest_path = FRONTEND_PUBLIC_DATA / "latest_match.json"
        src_match = FRONTEND_MATCHES_DIR / f"{best_mid}.json"
        latest_path.write_text(src_match.read_text(encoding="utf-8"), encoding="utf-8")
        print(
            f"latest_match.json <- match_id={best_mid}（本批最大）; "
            f"replays_index entries={n}",
            flush=True,
        )

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rules_zh": (
            "hero_damage/tower_damage/hero_healing 来自 dem_result_to_slim_match："
            "对英雄伤害为战斗日志聚合，已排除 attacker==target 与 targetillusion。"
            "若 players[] 中带 hero_damage 等字段则 build 时会优先覆盖。"
        ),
        "source_dir": str(src.resolve()),
        "matches": matches_out,
        "errors": errors,
    }
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"写入汇总: {out_path}", flush=True)
    if errors:
        print(f"失败 {len(errors)} 个:", errors, flush=True)


if __name__ == "__main__":
    main()
