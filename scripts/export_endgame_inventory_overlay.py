#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
（可选）从 OpenDota API 拉取终局装备片段。**多数私房/未上传录像在 OpenDota 查不到**，请改用
``build_local_inventory_overlay.py`` 从本地 parser JSON 生成 overlay（可手改 item id）。

用法（在 PLAB_B 根目录）:
  python scripts/export_endgame_inventory_overlay.py --match-id 8764477088 -o out/overlay.json

与 dem 管线合并:
  python scripts/dem_result_to_slim_match.py your_parser_result.json \\
    --inventory-overlay out/overlay.json \\
    -o opendota-match-ui/public/data/matches/8764477088.json

Docker（挂载本仓库到 /app）:
  docker run --rm -v E:/PLAB_B:/app -w /app python:3.12-slim \\
    bash -lc "pip install -q -r /app/requirements.txt 2>/dev/null || true; PYTHONPATH=/app python /app/scripts/export_endgame_inventory_overlay.py --match-id 8764477088 -o /app/out/overlay.json"

若无 requirements.txt，需保证镜像内能 import utils（将 PLAB_B 加入 PYTHONPATH 即可，脚本只依赖标准库 + 本仓库 utils 被 dem_result 间接用——本脚本仅用 urllib/json，不 import utils）。
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def fetch_opendota_match(match_id: int) -> Tuple[Optional[Dict[str, Any]], str]:
    url = f"https://api.opendota.com/api/matches/{int(match_id)}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "plab-dota/export_endgame_inventory_overlay"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8")), "ok"
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return None, str(e)[:200]


def main() -> None:
    ap = argparse.ArgumentParser(
        description="导出 OpenDota 终局装备 overlay JSON（供 dem_result_to_slim_match --inventory-overlay）",
    )
    ap.add_argument("--match-id", type=int, required=True, metavar="ID", help="比赛 match_id")
    ap.add_argument(
        "-o",
        "--out",
        type=Path,
        required=True,
        help="输出 JSON 路径",
    )
    args = ap.parse_args()

    raw, err = fetch_opendota_match(args.match_id)
    if not raw:
        sys.exit(f"拉取失败: {err}")
    if raw.get("error"):
        sys.exit(f"OpenDota 返回错误: {raw.get('error')}")
    pl = raw.get("players")
    if not isinstance(pl, list) or len(pl) == 0:
        sys.exit("响应中无 players，本场可能未入库")

    overlay: Dict[str, Any] = {
        "format": "endgame_inventory_overlay_v1",
        "match_id": int(args.match_id),
        "source": "opendota_api",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "duration": raw.get("duration"),
        "players": pl,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(overlay, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("已写入:", args.out.resolve())
    print("players:", len(pl))


if __name__ == "__main__":
    main()
