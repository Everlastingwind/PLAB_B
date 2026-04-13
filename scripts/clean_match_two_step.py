#!/usr/bin/env python3
"""
使用「数字 ID → item_ids/ability_ids → items/abilities」两步映射清洗比赛 JSON。

读取 OpenDota 风格或含 players[].item_0..5、ability_upgrades_arr 的 JSON，
输出带 items_resolved、skill_build_two_step、items_slot（已纠正映射）的精简结构。

用法（项目根 PLAB_B）::

  python scripts/clean_match_two_step.py path/to/match.json -o out.json
  python scripts/clean_match_two_step.py path/to/match.json --pretty

依赖：utils/.dota_cache 下已有或自动下载的
``item_ids.json``, ``items.json``, ``ability_ids.json``, ``abilities.json`` 等。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.dota_mapping import get_constants, translate_match_data  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Two-step ID→key→details match JSON cleaner (dotaconstants).",
    )
    ap.add_argument("input_json", type=Path, help="原始比赛 JSON（OpenDota /matches 或含 players）")
    ap.add_argument(
        "-o",
        "--out",
        type=Path,
        default=None,
        help="输出路径；省略则打印到 stdout",
    )
    ap.add_argument(
        "--pretty",
        action="store_true",
        help="缩进 2 空格（默认 minified）",
    )
    ap.add_argument(
        "--skip-translate",
        action="store_true",
        help="仅校验常量加载，不跑完整 translate_match_data（调试用）",
    )
    args = ap.parse_args()

    if not args.input_json.is_file():
        print(f"文件不存在: {args.input_json}", file=sys.stderr)
        sys.exit(1)

    raw = json.loads(args.input_json.read_text(encoding="utf-8"))
    get_constants().load()

    if args.skip_translate:
        out = raw
    else:
        out = translate_match_data(raw)

    indent = 2 if args.pretty else None
    text = json.dumps(out, ensure_ascii=False, indent=indent)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
        print("已写入:", args.out)
    else:
        print(text)


if __name__ == "__main__":
    main()
