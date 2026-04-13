"""
从 OpenDota constants API 拉取全英雄技能名、天赋名，并与 ability_ids 对齐为数值 ID，写入本地 JSON。

依赖端点（需带浏览器 User-Agent，否则可能 403）:
  - GET https://api.opendota.com/api/constants/hero_abilities
  - GET https://api.opendota.com/api/constants/ability_ids   （id 字符串 -> 内部名）

用法（项目根 PLAB_B）:
  python scripts/fetch_opendota_hero_ability_ids.py
  python scripts/fetch_opendota_hero_ability_ids.py -o utils/.dota_cache/opendota_hero_ability_talent_ids.json
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "utils" / ".dota_cache" / "opendota_hero_ability_talent_ids.json"

USER_AGENT = "Mozilla/5.0 (compatible; PLAB_B-fetch-opendota-constants/1.0)"


def _fetch_json(url: str) -> Any:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=120) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


def build_name_to_ids(ability_ids_raw: dict[str, str]) -> dict[str, list[int]]:
    """ability_ids: numeric key (possibly '3060,1617') -> internal ability name."""
    buckets: dict[str, list[int]] = defaultdict(list)
    for key_str, name in ability_ids_raw.items():
        if not isinstance(name, str) or not name:
            continue
        for part in str(key_str).split(","):
            part = part.strip()
            if part.isdigit():
                buckets[name].append(int(part))
    for name, ids in buckets.items():
        buckets[name] = sorted(set(ids))
    return dict(buckets)


def resolve_id(name: str, name_to_ids: dict[str, list[int]]) -> tuple[int | None, list[int]]:
    ids = name_to_ids.get(name)
    if not ids:
        return None, []
    return ids[0], ids


def main() -> None:
    p = argparse.ArgumentParser(description="从 OpenDota 拉取英雄技能/天赋 ID 词典")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUT,
        help=f"输出 JSON 路径（默认 {DEFAULT_OUT}）",
    )
    args = p.parse_args()

    base = "https://api.opendota.com/api/constants"
    hero_abilities = _fetch_json(f"{base}/hero_abilities")
    ability_ids_raw = _fetch_json(f"{base}/ability_ids")

    if not isinstance(hero_abilities, dict) or not isinstance(ability_ids_raw, dict):
        print("Unexpected API shape", file=sys.stderr)
        sys.exit(1)

    name_to_ids = build_name_to_ids(ability_ids_raw)
    missing_abilities: set[str] = set()
    missing_talents: set[str] = set()
    missing_facets: set[str] = set()

    def mark_missing(bucket: set[str], name: str) -> None:
        if name not in name_to_ids:
            bucket.add(name)

    heroes_out: dict[str, Any] = {}
    for hero_key, block in sorted(hero_abilities.items()):
        if not isinstance(block, dict):
            continue
        ab_names = block.get("abilities") or []
        talent_rows = block.get("talents") or []
        facets = block.get("facets") or []

        for n in ab_names:
            if isinstance(n, str):
                mark_missing(missing_abilities, n)
        for t in talent_rows:
            if isinstance(t, dict) and isinstance(t.get("name"), str):
                mark_missing(missing_talents, t["name"])
        for f in facets:
            if isinstance(f, dict) and isinstance(f.get("name"), str):
                mark_missing(missing_facets, f["name"])

        abilities_out = []
        for n in ab_names:
            if not isinstance(n, str):
                continue
            pid, all_ids = resolve_id(n, name_to_ids)
            abilities_out.append({"name": n, "id": pid, "ids": all_ids})

        talents_out = []
        for t in talent_rows:
            if not isinstance(t, dict):
                continue
            tn = t.get("name")
            if not isinstance(tn, str):
                continue
            lvl = t.get("level")
            pid, all_ids = resolve_id(tn, name_to_ids)
            talents_out.append(
                {
                    "name": tn,
                    "level": lvl,
                    "id": pid,
                    "ids": all_ids,
                }
            )

        facets_out = []
        for f in facets:
            if not isinstance(f, dict):
                continue
            fn = f.get("name")
            if not isinstance(fn, str):
                continue
            pid, all_ids = resolve_id(fn, name_to_ids)
            facets_out.append(
                {
                    **f,
                    "ability_id": pid,
                    "ability_ids": all_ids,
                }
            )

        heroes_out[hero_key] = {
            "abilities": abilities_out,
            "talents": talents_out,
            "facets": facets_out,
        }

    fetched_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "_meta": {
            "source": "OpenDota API constants",
            "endpoints": [
                f"{base}/hero_abilities",
                f"{base}/ability_ids",
            ],
            "fetched_at_utc": fetched_at,
            "hero_count": len(heroes_out),
            "ability_id_entries": len(ability_ids_raw),
            "notes": (
                "abilities 与 talents 中的 internal name 均应在 ability_ids 中有对应条目；"
                "facets[].name 多为独立 facet 配置名，常不在 ability_ids 中，故 ability_id 可能为 null。"
            ),
            "missing_internal_names": {
                "abilities_count": len(missing_abilities),
                "talents_count": len(missing_talents),
                "facets_count": len(missing_facets),
                "abilities_sample": sorted(missing_abilities)[:20],
                "talents_sample": sorted(missing_talents)[:20],
                "facets_sample": sorted(missing_facets)[:30],
            },
        },
        "heroes": heroes_out,
    }

    out_path: Path = args.output
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Wrote", out_path)
    print(
        "Heroes:",
        len(heroes_out),
        "missing abilities:",
        len(missing_abilities),
        "talents:",
        len(missing_talents),
        "facets:",
        len(missing_facets),
    )


if __name__ == "__main__":
    main()
