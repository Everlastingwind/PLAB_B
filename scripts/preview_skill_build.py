#!/usr/bin/env python3
"""
将 ability_upgrades_arr（JSON 数字数组）经 ability_ids.json → abilities.json 转为 25 步 skill_build。

用法::

  python scripts/preview_skill_build.py "[5194,5196,...]"
  python scripts/preview_skill_build.py --file arr.json

依赖：首次运行会从 dotaconstants 拉取 ability_ids / abilities 等到 utils/.dota_cache。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.dota_mapping import get_constants  # noqa: E402
from utils.dota_pipeline import (  # noqa: E402
    raw_ability_upgrades_arr_to_merged_steps,
    skill_build_v2_from_merged_upgrades,
)


def main() -> None:
    ap = argparse.ArgumentParser(description="ability_upgrades_arr → skill_build JSON")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("arr_json", nargs="?", help='JSON 数组，如 "[1,2,3]"')
    g.add_argument("--file", type=Path, help="含 JSON 数组的文件")
    args = ap.parse_args()

    if args.file:
        raw = json.loads(args.file.read_text(encoding="utf-8"))
    else:
        raw = json.loads(args.arr_json or "[]")

    if not isinstance(raw, list):
        sys.exit("输入须为 JSON 数组")
    dc = get_constants()
    merged = raw_ability_upgrades_arr_to_merged_steps(raw)
    out = skill_build_v2_from_merged_upgrades(merged, dc, pad_to=25)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
