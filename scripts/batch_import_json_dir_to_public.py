#!/usr/bin/env python3
"""
将目录内全部 ``*.json`` 写入 ``opendota-match-ui/public/data/matches/`` 并重建索引，
不移动源文件；不经 HTTP。

支持两类输入（自动识别）：

1. **DEM / 解析器事件流**（根为数组，或 ``{events, players?}``）：与
   ``scripts/upload_pub_dem_json.py`` 相同，经 ``build_slim_from_dem_events`` →
   ``translate_match_data`` → ``save_uploaded_match_slim``。
2. **已提纯比赛对象**（OpenDota / ``player_match`` 等）：经 ``normalize_match_input_for_translate`` →
   ``translate_match_data``。

若事件流推断的 ``match_id`` 无效，且文件名为纯数字（如 ``8771034383.json``），
则用文件名作为 ``match_id``（便于 epilogue 缺 matchId 的录像）。

用法::

  python scripts/batch_import_json_dir_to_public.py "E:\\doreplays_json_results"

  python scripts/batch_import_json_dir_to_public.py "E:\\doreplays_json_results" --dry-run
  python scripts/batch_import_json_dir_to_public.py "E:\\doreplays_json_results" --no-opendota-items
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

from backend.match_service import rebuild_replays_index, save_uploaded_match_slim  # noqa: E402
from utils.dota_mapping import get_constants, translate_match_data  # noqa: E402
from utils.raw_odota_purify import normalize_match_input_for_translate  # noqa: E402


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
        raise ValueError("JSON 应为事件数组，或含 events 字段的对象")

    if players_path and players_path.is_file():
        addon_raw = json.loads(players_path.read_text(encoding="utf-8"))
        addon_pl = dem_mod._parse_players_addon(addon_raw)
        if not addon_pl:
            raise ValueError("--players 需为非空 players 数组")
        players_blob = dem_mod._merge_player_blobs(players_blob, addon_pl)

    return events, players_blob


def _looks_like_dem_event_stream(raw: Any) -> bool:
    if isinstance(raw, list) and len(raw) >= 1 and isinstance(raw[0], dict):
        t = raw[0].get("type")
        if t in ("interval", "player_slot", "epilogue", "DOTA_COMBATLOG"):
            return True
    if isinstance(raw, dict) and isinstance(raw.get("events"), list):
        ev = raw["events"]
        if ev and isinstance(ev[0], dict):
            t = ev[0].get("type")
            if t in ("interval", "player_slot", "epilogue", "DOTA_COMBATLOG"):
                return True
    return False


def _apply_filename_match_id(slim: Dict[str, Any], path: Path) -> None:
    stem = path.stem
    if not stem.isdigit():
        return
    mid_hint = int(stem)
    if mid_hint <= 0:
        return
    cur = int(slim.get("match_id") or 0)
    if cur > 0:
        return
    slim["match_id"] = mid_hint
    meta = slim.get("_meta")
    if isinstance(meta, dict):
        meta = dict(meta)
        meta["match_id"] = mid_hint
        slim["_meta"] = meta


def _process_dem_file(
    path: Path,
    dem_mod: Any,
    *,
    dry_run: bool,
    no_opendota_items: bool,
    merge_opendota: bool,
    opendota_match_id: Optional[int],
) -> int:
    raw = json.loads(path.read_text(encoding="utf-8"))
    events, players_blob = _parse_events_blob(raw, None, dem_mod)
    slim: Dict[str, Any] = dem_mod.build_slim_from_dem_events(
        events, players_blob=players_blob
    )
    _apply_filename_match_id(slim, path)

    mid = opendota_match_id
    if mid is None or mid <= 0:
        mid = slim.get("match_id")
    try:
        mid_int = int(mid) if mid is not None else 0
    except (TypeError, ValueError):
        mid_int = 0
    if mid_int <= 0 and path.stem.isdigit():
        mid_int = int(path.stem)

    if not no_opendota_items and mid_int > 0:
        dem_mod.merge_endgame_inventory_from_opendota(slim, mid_int)
    if merge_opendota and mid_int > 0:
        dem_mod.merge_skill_and_talent_from_opendota(slim, mid_int)

    final_slim = translate_match_data(slim)
    mid_out = int(final_slim.get("match_id") or 0)
    if mid_out <= 0:
        raise ValueError("match_id 无效（DEM 管线）")
    npl = len(final_slim.get("players") or [])
    if dry_run:
        print(f"  OK dry-run match_id={mid_out} players={npl}", flush=True)
        return mid_out
    save_uploaded_match_slim(final_slim, rebuild_index=False)
    return mid_out


def _process_purify_file(path: Path, *, dry_run: bool) -> int:
    raw: Any = json.loads(path.read_text(encoding="utf-8"))
    data = normalize_match_input_for_translate(raw)
    if not isinstance(data, dict) or not data:
        raise ValueError("提纯后非有效对象")
    slim: dict[str, Any] = translate_match_data(data)
    mid = int(slim.get("match_id") or 0)
    if mid <= 0 and path.stem.isdigit():
        slim["match_id"] = int(path.stem)
        meta = slim.get("_meta")
        if isinstance(meta, dict):
            m2 = dict(meta)
            m2["match_id"] = int(path.stem)
            slim["_meta"] = m2
        slim = translate_match_data(slim)
        mid = int(slim.get("match_id") or 0)
    if mid <= 0:
        raise ValueError("match_id 无效")
    if dry_run:
        npl = len(slim.get("players") or [])
        print(f"  OK dry-run match_id={mid} players={npl}", flush=True)
        return mid
    save_uploaded_match_slim(slim, rebuild_index=False)
    return mid


def main() -> None:
    ap = argparse.ArgumentParser(description="批量导入本地比赛 JSON 到 public/data")
    ap.add_argument(
        "directory",
        type=Path,
        help=r"含 *.json 的目录，例如 E:\doreplays_json_results",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="只校验、不写文件",
    )
    ap.add_argument(
        "--no-opendota-items",
        action="store_true",
        help="DEM 输入：不从 OpenDota 合并终局装备（默认会合并）",
    )
    ap.add_argument(
        "--merge-opendota",
        action="store_true",
        help="DEM 输入：额外合并 OpenDota 加点/天赋/时间线（需网络）",
    )
    ap.add_argument(
        "--opendota-match-id",
        type=int,
        default=None,
        metavar="ID",
        help="DEM 输入：指定 OpenDota 对局 id（默认用 slim.match_id / 文件名）",
    )
    args = ap.parse_args()
    src = args.directory.resolve()
    if not src.is_dir():
        print(f"不是目录: {src}", file=sys.stderr)
        sys.exit(1)

    files = sorted(src.glob("*.json"))
    if not files:
        print(f"目录中无 .json: {src}")
        return

    print(f"待处理 {len(files)} 个文件 ← {src}", flush=True)
    print("加载 dotaconstants / 映射缓存…", flush=True)
    get_constants().load()
    dem_mod = _load_dem_script_module()

    ok: list[int] = []
    err = 0
    for i, p in enumerate(files, start=1):
        print(f"[{i}/{len(files)}] {p.name}", flush=True)
        try:
            raw_peek: Any = json.loads(p.read_text(encoding="utf-8"))
            if _looks_like_dem_event_stream(raw_peek):
                mid = _process_dem_file(
                    p,
                    dem_mod,
                    dry_run=args.dry_run,
                    no_opendota_items=args.no_opendota_items,
                    merge_opendota=args.merge_opendota,
                    opendota_match_id=args.opendota_match_id,
                )
            else:
                mid = _process_purify_file(p, dry_run=args.dry_run)
            ok.append(mid)
        except Exception as e:
            err += 1
            print(f"  失败: {e}", flush=True)

    if args.dry_run:
        print(f"结束: 成功 {len(ok)}，失败 {err}（未写盘）", flush=True)
        return

    n = rebuild_replays_index()
    print(f"已重建 replays_index.json，条目数={n}", flush=True)
    print(f"结束: 写入 {len(ok)} 场，失败 {err}", flush=True)
    if err:
        sys.exit(1)


if __name__ == "__main__":
    main()
