#!/usr/bin/env python3
"""
清除本项目中「比赛 / 录像列表」相关数据（不影响英雄图鉴 entity_maps、战队 ID 表等静态资源）。

会删除 / 重置：
  - opendota-match-ui/public/data/matches/*.json
  - opendota-match-ui/public/data/replays_index.json（空列表）
  - opendota-match-ui/public/data/pro_replays_index.json（空列表，保留 version）
  - opendota-match-ui/public/data/latest_match.json（占位空局）
  - data/matches/*.json（项目根归档）
  - replays_pending|completed|error、json_pending|uploaded|error 目录内文件（若存在）

用法（项目根 PLAB_B）::

  python scripts/clear_all_match_data.py
  python scripts/clear_all_match_data.py --yes   # 非交互确认（CI）
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

PUB = ROOT / "opendota-match-ui" / "public" / "data"
MATCH_DIR = PUB / "matches"
DATA_MATCHES = ROOT / "data" / "matches"

BATCH_DIRS = [
    ROOT / "replays_pending",
    ROOT / "replays_completed",
    ROOT / "replays_error",
    ROOT / "json_pending",
    ROOT / "json_uploaded",
    ROOT / "json_error",
]

EMPTY_REPLAYS_INDEX = {"version": 1, "replays": []}

EMPTY_PRO_INDEX = {
    "version": 1,
    "_meta": {"source": "cleared", "note": "run fetch_pro_replays_index.py to refill"},
    "replays": [],
}

LATEST_PLACEHOLDER = {
    "_meta": {"note": "cleared — upload a match or open a replay from list"},
    "match_id": 0,
    "radiant_win": False,
    "radiant_score": 0,
    "dire_score": 0,
    "duration": 0,
    "league_name": "—",
    "players": [],
}


def _rm_tree_contents(d: Path) -> int:
    if not d.is_dir():
        return 0
    n = 0
    for p in d.iterdir():
        if p.is_file():
            p.unlink()
            n += 1
        elif p.is_dir():
            shutil.rmtree(p)
            n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--yes", "-y", action="store_true", help="跳过确认，直接执行"
    )
    args = ap.parse_args()

    if not args.yes:
        s = input('将清除比赛列表与本地归档（保留 entity_maps 等）。输入 YES 继续: ')
        if s.strip() != "YES":
            print("已取消。")
            raise SystemExit(1)

    n_match_files = 0
    for f in MATCH_DIR.glob("*.json"):
        f.unlink()
        n_match_files += 1

    n_data = 0
    DATA_MATCHES.mkdir(parents=True, exist_ok=True)
    for f in DATA_MATCHES.glob("*.json"):
        f.unlink()
        n_data += 1

    (PUB / "replays_index.json").write_text(
        json.dumps(EMPTY_REPLAYS_INDEX, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (PUB / "pro_replays_index.json").write_text(
        json.dumps(EMPTY_PRO_INDEX, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (PUB / "latest_match.json").write_text(
        json.dumps(LATEST_PLACEHOLDER, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    batch_removed = 0
    for d in BATCH_DIRS:
        batch_removed += _rm_tree_contents(d)

    print(
        f"已清除: public/data/matches 文件 {n_match_files} 个, "
        f"data/matches 文件 {n_data} 个, 批处理目录内条目 {batch_removed} 个。"
    )
    print("replays_index / pro_replays_index / latest_match 已重置。")


if __name__ == "__main__":
    main()
