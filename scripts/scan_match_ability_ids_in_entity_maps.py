#!/usr/bin/env python3
"""
Scan slim match JSON under opendota-match-ui/public/data/matches for:

1) ability_upgrades_arr IDs missing from entity_maps.json ``abilities``
   (same lookup the web UI uses). Missing IDs → arr-derived timeline shows
   ``unknown`` steps which SkillBuildTimeline filters out → sparse/blank row
   unless the UI falls back to pipeline ``skill_build``.

2) Arrays that satisfy the OpenDota ``[id, time, id, time, …]`` heuristic
   (even length ≥16 and every odd-index value ≤400). Those are treated as
   interleaved on the client; if the replay is actually a pure ID list that
   accidentally matches, the wrong branch can mangle order (less common).

Usage:
  python scripts/scan_match_ability_ids_in_entity_maps.py
  python scripts/scan_match_ability_ids_in_entity_maps.py --min-missing 3
  python scripts/scan_match_ability_ids_in_entity_maps.py --list-interleaved
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def looks_like_opendota_interleaved_ability_arr(raw: list[object]) -> bool:
    """Mirror opendota-match-ui slimToUi ``looksLikeOpenDotaInterleavedAbilityArr``."""
    if len(raw) < 16 or len(raw) % 2 != 0:
        return False
    odds: list[int] = []
    for i in range(1, len(raw), 2):
        try:
            n = float(raw[i])  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return False
        if not float("inf") > n > float("-inf"):
            return False
        odds.append(int(n))
    if len(odds) < 8:
        return False
    return min(odds) <= 400


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    maps_path = root / "opendota-match-ui" / "public" / "data" / "entity_maps.json"
    matches_dir = root / "opendota-match-ui" / "public" / "data" / "matches"

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--min-missing",
        type=int,
        default=1,
        help="Only report players with at least this many unknown ability IDs",
    )
    ap.add_argument(
        "--min-ratio",
        type=float,
        default=0.0,
        help="Only report when missing_count / len(arr) >= this (0–1)",
    )
    ap.add_argument(
        "--list-interleaved",
        action="store_true",
        help="List player slots whose ability_upgrades_arr matches the interleaved heuristic",
    )
    args = ap.parse_args()

    if not maps_path.is_file():
        print("Missing", maps_path, file=sys.stderr)
        sys.exit(1)
    data = json.loads(maps_path.read_text(encoding="utf-8"))
    abilities = data.get("abilities") or {}
    if not isinstance(abilities, dict):
        print("entity_maps.abilities is not an object", file=sys.stderr)
        sys.exit(1)

    match_files = sorted(matches_dir.glob("*.json")) if matches_dir.is_dir() else []
    if not match_files:
        print("No match JSON under", matches_dir, file=sys.stderr)
        sys.exit(0)

    rows: list[tuple[int, int, int, int, float, int]] = []
    interleaved_hits: list[tuple[int, int, int]] = []

    for path in match_files:
        try:
            m = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print("Skip", path.name, e, file=sys.stderr)
            continue
        mid = int(m.get("match_id") or 0)
        players = m.get("players")
        if not isinstance(players, list):
            continue
        for p in players:
            if not isinstance(p, dict):
                continue
            arr = p.get("ability_upgrades_arr")
            if not isinstance(arr, list) or not arr:
                continue
            total = len(arr)
            missing = 0
            for x in arr:
                try:
                    sid = str(abs(int(x)))
                except (TypeError, ValueError):
                    continue
                if sid not in abilities:
                    missing += 1
            if missing >= args.min_missing:
                ratio = missing / total if total else 0.0
                if ratio >= args.min_ratio:
                    slot = int(p.get("player_slot") or -1)
                    rows.append((mid, slot, missing, total, ratio, 0))
            if args.list_interleaved and looks_like_opendota_interleaved_ability_arr(
                arr
            ):
                interleaved_hits.append((mid, int(p.get("player_slot") or -1), len(arr)))

    rows.sort(key=lambda r: (-r[4], -r[2], r[0]))
    print(
        f"Scanned {len(match_files)} matches; "
        f"ability map has {len(abilities)} entries.\n"
        f"Players with >= {args.min_missing} missing IDs "
        f"(ratio >= {args.min_ratio}):\n"
    )
    if not rows:
        print("None.")
    else:
        for mid, slot, missing, total, ratio, _ in rows[:200]:
            print(
                f"match_id={mid} player_slot={slot} "
                f"missing={missing}/{total} ratio={ratio:.2f}"
            )
        if len(rows) > 200:
            print(f"... and {len(rows) - 200} more rows")

    if args.list_interleaved:
        print("\n--- Interleaved heuristic (id,time,...) ---")
        if not interleaved_hits:
            print("None.")
        else:
            for mid, slot, n in interleaved_hits[:200]:
                print(f"match_id={mid} player_slot={slot} len={n}")
            if len(interleaved_hits) > 200:
                print(f"... and {len(interleaved_hits) - 200} more")


if __name__ == "__main__":
    main()
