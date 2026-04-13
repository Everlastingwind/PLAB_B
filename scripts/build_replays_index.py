"""
根据 public/data/matches/*.json（slim）生成 public/data/replays_index.json。
排序：_meta.uploaded_at / 文件 mtime，从新到旧（与 API 上传后逻辑一致）。

用法（项目根 PLAB_B）::

  python scripts/build_replays_index.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.match_service import rebuild_replays_index  # noqa: E402


def main() -> None:
    n = rebuild_replays_index()
    if n == 0:
        raise SystemExit("no valid json in opendota-match-ui/public/data/matches/")
    print("wrote replays_index.json, entries:", n)


if __name__ == "__main__":
    main()
