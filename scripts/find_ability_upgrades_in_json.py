"""
在任意 JSON 文件中递归查找 ability_upgrades_arr，并用 dotaconstants 打印注解。

用法:
  python scripts/find_ability_upgrades_in_json.py e:\\dota_parser_test\\result.json
  python scripts/find_ability_upgrades_in_json.py match.json --max 3
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Iterator, List, Tuple

# 保证可从项目根导入 utils
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from utils.dota_mapping import get_constants
from utils.dota_pipeline import annotate_ability_upgrades_arr


def _iter_ability_upgrades_paths(
    obj: Any, path: str = "$"
) -> Iterator[Tuple[str, Any]]:
    if isinstance(obj, dict):
        if "ability_upgrades_arr" in obj:
            yield path + ".ability_upgrades_arr", obj["ability_upgrades_arr"]
        for k, v in obj.items():
            if k == "ability_upgrades_arr":
                continue
            sub = f"{path}.{k}" if path != "$" else f"$.{k}"
            yield from _iter_ability_upgrades_paths(v, sub)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _iter_ability_upgrades_paths(v, f"{path}[{i}]")


def main() -> None:
    ap = argparse.ArgumentParser(description="Find ability_upgrades_arr in JSON and annotate IDs.")
    ap.add_argument("json_file", type=Path, help="Path to JSON file")
    ap.add_argument("--max", type=int, default=0, help="Max occurrences to print (0=all)")
    args = ap.parse_args()

    raw_text = args.json_file.read_text(encoding="utf-8", errors="replace")
    data = json.loads(raw_text)

    hits: List[Tuple[str, Any]] = list(_iter_ability_upgrades_paths(data))
    if not hits:
        print("No key 'ability_upgrades_arr' found in this file.", file=sys.stderr)
        sys.exit(1)

    dc = get_constants()
    shown = 0
    for jpath, arr in hits:
        if args.max and shown >= args.max:
            break
        print(f"\n=== {jpath} ===")
        try:
            ann = annotate_ability_upgrades_arr(arr, dc)
        except Exception as e:  # noqa: BLE001
            print(f"(annotate failed: {e})")
            print(repr(arr)[:500])
        else:
            for row in ann:
                tag = "TALENT" if row["is_talent"] else "skill"
                print(f"  [{tag}] id={row['id']} key={row['ability_key']} name={row['name']!r}")
        shown += 1

    print(f"\nTotal occurrences: {len(hits)}")


if __name__ == "__main__":
    main()
