"""
遍历本地解析器 result.json 中的 events，打印前 N 条「键或嵌套内容含 ability、
且 type 非 DOTA_COMBATLOG*」的事件，用于对齐底层加点字段名。

用法（项目根 PLAB_B）:
  python scripts/probe_dem_ability_events.py E:\\dota_parser_test\\result.json
  python scripts/probe_dem_ability_events.py result.json --max 5
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _is_combatlog(e: dict) -> bool:
    t = str(e.get("type") or e.get("Type") or "").upper()
    return t.startswith("DOTA_COMBATLOG")


def _mentions_ability(obj: object, depth: int = 0) -> bool:
    if depth > 14:
        return False
    if isinstance(obj, dict):
        for k, v in obj.items():
            if "ability" in str(k).lower():
                return True
            if _mentions_ability(v, depth + 1):
                return True
    elif isinstance(obj, list):
        for x in obj[:500]:
            if _mentions_ability(x, depth + 1):
                return True
    elif isinstance(obj, str) and "ability" in obj.lower():
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser(description="Probe non-combatlog events mentioning ability.")
    ap.add_argument("result_json", type=Path, help="result.json（根为数组或含 events）")
    ap.add_argument("--max", type=int, default=5, metavar="N", help="最多打印几条（默认 5）")
    args = ap.parse_args()
    if not args.result_json.is_file():
        print(f"文件不存在: {args.result_json}", file=sys.stderr)
        sys.exit(1)

    raw = json.loads(args.result_json.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        ev = raw.get("events")
        events = list(ev) if isinstance(ev, list) else []
    elif isinstance(raw, list):
        events = list(raw)
    else:
        print("根类型应为数组或含 events 的对象", file=sys.stderr)
        sys.exit(1)

    printed = 0
    for e in events:
        if not isinstance(e, dict):
            continue
        if _is_combatlog(e):
            continue
        if not _mentions_ability(e):
            continue
        print(json.dumps(e, ensure_ascii=False, indent=2))
        print("-" * 60)
        printed += 1
        if printed >= args.max:
            break

    if printed == 0:
        print(
            "未找到匹配事件。可检查 events 是否为空，或放宽条件。",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
