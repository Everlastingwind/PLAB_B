"""
为历史 public 比赛 JSON 批量补齐 players[].role_early，并重建索引。

目标：
1) opendota-match-ui/public/data/matches/*.json
2) replays_index.json（通过 backend.match_service.rebuild_replays_index 重建）
3) pro_replays_index.json（在原有 replays 列表基础上补 players[].role_early）

说明：
- 若某玩家已有 role_early，默认保留（可 --force 覆盖）。
- 无 lane_early 时用阵营内 net_worth 近似排序映射：
  1 -> carry, 2 -> mid, 3 -> offlane, 4 -> support(4), 5 -> support(5)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Mapping, MutableMapping, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PUB = ROOT / "opendota-match-ui" / "public" / "data"
MATCH_DIR = PUB / "matches"
PRO_INDEX = PUB / "pro_replays_index.json"


def _player_slot_int(p: Mapping[str, Any]) -> int:
    try:
        return int(p.get("player_slot") or 0)
    except (TypeError, ValueError):
        return 0


def _is_radiant(p: Mapping[str, Any]) -> bool:
    ps = _player_slot_int(p)
    if 128 <= ps <= 137:
        return False
    if 5 <= ps <= 9:
        return False
    if 0 <= ps <= 4:
        return True
    v = p.get("isRadiant", p.get("is_radiant"))
    if isinstance(v, bool):
        return v
    return ps < 128


def _float_or_zero(v: Any) -> float:
    try:
        return float(v or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _assign_roles_for_team(players: List[MutableMapping[str, Any]]) -> Dict[int, str]:
    """
    基于 networth 近似分配 1~5 号位。
    """
    role_order = ["carry", "mid", "offlane", "support(4)", "support(5)"]
    ranked = sorted(
        players,
        key=lambda p: (
            -_float_or_zero(p.get("net_worth")),
            -_float_or_zero(p.get("gold_per_min")),
            _player_slot_int(p),
        ),
    )
    out: Dict[int, str] = {}
    for i, p in enumerate(ranked):
        ps = _player_slot_int(p)
        role = role_order[i] if i < len(role_order) else "support(4)"
        out[ps] = role
    return out


def _normalize_role(role: Any) -> str:
    s = str(role or "").strip().lower()
    if not s:
        return ""
    if s in {"support4", "support 4", "support(4)", "pos4"}:
        return "support(4)"
    if s in {"support5", "support 5", "support(5)", "pos5"}:
        return "support(5)"
    if s in {"carry", "mid", "offlane"}:
        return s
    return ""


def _patch_match(path: Path, *, force: bool) -> Tuple[bool, int]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return (False, 0)
    players = raw.get("players")
    if not isinstance(players, list) or len(players) < 2:
        return (False, 0)

    rad: List[MutableMapping[str, Any]] = []
    dire: List[MutableMapping[str, Any]] = []
    for p in players:
        if not isinstance(p, MutableMapping):
            continue
        (rad if _is_radiant(p) else dire).append(p)

    role_map: Dict[int, str] = {}
    role_map.update(_assign_roles_for_team(rad))
    role_map.update(_assign_roles_for_team(dire))

    changed = 0
    for p in players:
        if not isinstance(p, MutableMapping):
            continue
        ps = _player_slot_int(p)
        old = _normalize_role(p.get("role_early"))
        new_role = role_map.get(ps, "")
        if not new_role:
            continue
        if old and not force:
            continue
        if old != new_role:
            p["role_early"] = new_role
            changed += 1
        elif "role_early" not in p:
            p["role_early"] = new_role
            changed += 1

    if changed > 0:
        path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
        return (True, changed)
    return (False, 0)


def _rebuild_pro_index_from_matches() -> int:
    if not PRO_INDEX.is_file():
        return 0
    raw = json.loads(PRO_INDEX.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return 0
    replays = raw.get("replays")
    if not isinstance(replays, list):
        return 0

    patched = 0
    for r in replays:
        if not isinstance(r, dict):
            continue
        try:
            mid = int(r.get("match_id") or 0)
        except (TypeError, ValueError):
            mid = 0
        if mid <= 0:
            continue
        mp = MATCH_DIR / f"{mid}.json"
        if not mp.is_file():
            continue
        try:
            m = json.loads(mp.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        m_players = m.get("players")
        if not isinstance(m_players, list):
            continue
        by_ps: Dict[int, Mapping[str, Any]] = {}
        for p in m_players:
            if not isinstance(p, Mapping):
                continue
            by_ps[_player_slot_int(p)] = p
        src_pl = r.get("players")
        if not isinstance(src_pl, list):
            continue
        row_changed = False
        for p in src_pl:
            if not isinstance(p, MutableMapping):
                continue
            ps = _player_slot_int(p)
            src = by_ps.get(ps)
            if not src:
                continue
            role = _normalize_role(src.get("role_early"))
            if role and p.get("role_early") != role:
                p["role_early"] = role
                row_changed = True
        if row_changed:
            patched += 1

    if patched > 0:
        PRO_INDEX.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    return patched


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="覆盖已有 role_early")
    args = ap.parse_args()

    files = sorted(MATCH_DIR.glob("*.json"))
    touched_files = 0
    touched_players = 0
    for fp in files:
        ok, n = _patch_match(fp, force=args.force)
        if ok:
            touched_files += 1
            touched_players += n
            print(f"patched {fp.name}: players={n}", flush=True)

    from backend.match_service import rebuild_replays_index

    replays_n = rebuild_replays_index()
    pro_patched = _rebuild_pro_index_from_matches()
    print(
        f"done files={touched_files} players={touched_players} "
        f"replays_index={replays_n} pro_index_rows={pro_patched}",
        flush=True,
    )


if __name__ == "__main__":
    main()
