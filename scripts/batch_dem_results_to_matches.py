#!/usr/bin/env python3
"""
将目录下每条解析器 JSON（events 数组或 {events, players}）批量转为 slim，
写入 opendota-match-ui/public/data/matches/{match_id}.json，并一次性重建 replays_index。

用法（项目根 PLAB_B）::

  python scripts/batch_dem_results_to_matches.py "e:\\doreplays_json_results"
  python scripts/batch_dem_results_to_matches.py "e:\\doreplays_json_results" --dry-run
  python scripts/batch_dem_results_to_matches.py "e:\\doreplays_json_results" --skip-existing --sync-latest
  python scripts/batch_dem_results_to_matches.py "e:\\doreplays_json_results" --all-json
  python scripts/batch_dem_results_to_matches.py "e:\\doreplays_json_results" --import-time-uploaded-at --sync-latest --upload-api

已落盘、需推到「网站」自建 API 时，``--upload-api`` 会使用 ``MATCH_UPLOAD_URL`` / ``MATCH_UPLOAD_TOKEN``，
或项目根 ``site_upload.json``（与 ``upload_public_matches_to_api.py`` 相同字段）；另见该脚本说明。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FRONTEND_PUBLIC = ROOT / "opendota-match-ui" / "public" / "data"
DEFAULT_MATCHES = FRONTEND_PUBLIC / "matches"
SITE_UPLOAD_CONFIG = ROOT / "site_upload.json"


def _load_site_upload_config() -> tuple[str, str]:
    """与 ``upload_public_matches_to_api.py`` 一致：从项目根 ``site_upload.json`` 读 URL / token。"""
    if not SITE_UPLOAD_CONFIG.is_file():
        return "", ""
    try:
        data = json.loads(SITE_UPLOAD_CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "", ""
    if not isinstance(data, dict):
        return "", ""
    return (
        str(data.get("match_upload_url") or "").strip(),
        str(data.get("match_upload_token") or "").strip(),
    )


def _load_dem_module():
    path = ROOT / "scripts" / "dem_result_to_slim_match.py"
    spec = importlib.util.spec_from_file_location("dem_result_to_slim_match", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 dem_result_to_slim_match.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _parse_events_blob(raw: Any) -> Tuple[List[dict], Optional[List[Dict[str, Any]]]]:
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
    return events, players_blob


def main() -> None:
    ap = argparse.ArgumentParser(description="批量 DEM result JSON → slim matches/*.json + replays_index")
    ap.add_argument(
        "input_dir",
        type=Path,
        help="含解析器 JSON 的目录（如 doreplays_json_results）",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_MATCHES,
        help="slim 输出目录（默认 opendota-match-ui/public/data/matches）",
    )
    ap.add_argument("--dry-run", action="store_true", help="只扫描与校验，不写文件")
    ap.add_argument(
        "--skip-existing",
        action="store_true",
        help="若 matches/{match_id}.json 已存在则跳过",
    )
    ap.add_argument(
        "--sync-latest",
        action="store_true",
        help="全部成功后复制 latest_match.json：与 --import-time-uploaded-at 连用时为「最后写入的一场」，否则为「源文件 mtime 最新」",
    )
    ap.add_argument(
        "--all-json",
        action="store_true",
        help="默认只处理文件名纯数字的 *.json（场次）；加此开关才处理目录内全部 *.json",
    )
    ap.add_argument(
        "--import-time-uploaded-at",
        action="store_true",
        help="_meta.uploaded_at 用本次写入的 UTC 时间（便于索引里「刚重导」排在前面）；默认用源文件 mtime",
    )
    ap.add_argument(
        "--upload-api",
        action="store_true",
        help="每场写入磁盘后，再 POST 到本地 API（需已启动 uvicorn）；见 --api-url / 环境变量 MATCH_UPLOAD_TOKEN",
    )
    ap.add_argument(
        "--api-url",
        type=str,
        default="",
        help="与 --upload-api 连用；默认 MATCH_UPLOAD_URL → site_upload.json → 127.0.0.1:8000",
    )
    args = ap.parse_args()

    d = args.input_dir.resolve()
    if not d.is_dir():
        raise SystemExit(f"目录不存在: {d}")

    mod = _load_dem_module()
    build = mod.build_slim_from_dem_events

    files = sorted(d.glob("*.json"), key=lambda p: p.name.lower())
    if not args.all_json:
        files = [p for p in files if p.stem.isdigit()]
    if not files:
        raise SystemExit(
            f"目录内无可用 *.json（默认仅 match_id 文件名如 8770394307.json；需处理全部请加 --all-json）: {d}"
        )

    args.out_dir.mkdir(parents=True, exist_ok=True)

    ok = 0
    skipped = 0
    failed: List[str] = []
    latest_src_mtime = -1.0
    latest_out: Optional[Path] = None
    last_written: Optional[Path] = None
    file_url, file_tok = _load_site_upload_config()
    resolved_api_url = (
        (args.api_url or "").strip()
        or os.environ.get("MATCH_UPLOAD_URL", "").strip()
        or file_url
        or "http://127.0.0.1:8000/api/matches/upload"
    )
    upload_token = (
        os.environ.get("MATCH_UPLOAD_TOKEN", "").strip()
        or file_tok
        or "my_secret_token"
    )
    upload_errors: List[str] = []

    for src in files:
        label = src.name
        try:
            raw = json.loads(src.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as e:
            failed.append(f"{label} (read/json: {e})")
            continue

        events, players_blob = _parse_events_blob(raw)
        if not events:
            failed.append(f"{label} (无 events 或空数组)")
            continue

        try:
            slim = build(events, players_blob=players_blob)
        except Exception as e:
            failed.append(f"{label} (build_slim: {e})")
            continue

        mid = int(slim.get("match_id") or 0)
        if mid <= 0 and src.stem.isdigit():
            mid = int(src.stem)
        if mid <= 0:
            failed.append(f"{label} (无法确定 match_id)")
            continue

        out_path = args.out_dir / f"{mid}.json"
        if args.skip_existing and out_path.is_file():
            skipped += 1
            continue

        meta = slim.get("_meta") if isinstance(slim.get("_meta"), dict) else {}
        meta = dict(meta)
        meta.setdefault("source", "dem_result_json")
        meta["match_id"] = mid
        if args.import_time_uploaded_at:
            meta["uploaded_at"] = datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        else:
            meta["uploaded_at"] = datetime.fromtimestamp(
                src.stat().st_mtime, tz=timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%SZ")
        meta["batch_reimport"] = True
        slim_out: Dict[str, Any] = {**slim, "_meta": meta}

        if not args.dry_run:
            out_path.write_text(
                json.dumps(slim_out, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            last_written = out_path
            mts = src.stat().st_mtime
            if mts >= latest_src_mtime:
                latest_src_mtime = mts
                latest_out = out_path

            if args.upload_api:
                body = json.dumps(slim_out, ensure_ascii=False).encode("utf-8")
                req = urllib.request.Request(
                    resolved_api_url,
                    data=body,
                    method="POST",
                    headers={
                        "Authorization": f"Bearer {upload_token}",
                        "Content-Type": "application/json; charset=utf-8",
                    },
                )
                try:
                    with urllib.request.urlopen(req, timeout=120) as resp:
                        resp.read()
                except urllib.error.HTTPError as e:
                    upload_errors.append(f"{mid}: HTTP {e.code} {e.reason}")
                except urllib.error.URLError as e:
                    upload_errors.append(f"{mid}: {e.reason!s}")

        ok += 1

    if args.dry_run:
        print(f"[dry-run] 可处理: {ok} 个, 将跳过(已存在): {skipped}, 失败: {len(failed)}, 合计文件: {len(files)}")
        for line in failed[:20]:
            print("  FAIL:", line)
        if len(failed) > 20:
            print("  ...", len(failed) - 20, "more")
        return

    from backend.match_service import rebuild_replays_index  # noqa: E402

    n = rebuild_replays_index()
    print(
        f"写入 slim: {ok} 场 → {args.out_dir}",
        f"| 跳过(已存在): {skipped} | 失败: {len(failed)} | replays_index 条目: {n}",
        flush=True,
    )
    for line in failed[:30]:
        print("  FAIL:", line)
    if len(failed) > 30:
        print("  ...", len(failed) - 30, "more")

    if args.sync_latest:
        pick = last_written if args.import_time_uploaded_at else latest_out
        if pick and pick.is_file():
            dest = FRONTEND_PUBLIC / "latest_match.json"
            shutil.copy2(pick, dest)
            print("latest_match.json ←", pick.name, flush=True)

    if upload_errors:
        print("API 上传失败（部分场次）:", len(upload_errors), flush=True)
        for u in upload_errors[:15]:
            print(" ", u, flush=True)
        if len(upload_errors) > 15:
            print(" ...", len(upload_errors) - 15, "more", flush=True)


if __name__ == "__main__":
    main()
