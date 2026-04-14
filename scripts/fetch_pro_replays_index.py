"""
每日定时（建议 09:20）运行：从 OpenDota 拉取职业比赛，按 liquipedia_top20_team_ids.json
过滤后写入 opendota-match-ui/public/data/pro_replays_index.json。

用法（项目根 PLAB_B）:
  python scripts/fetch_pro_replays_index.py

依赖网络；若 429 可降低 MAX_DETAIL_FETCH 或加重试/间隔。
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Set

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.dota_mapping import translate_match_data  # noqa: E402

PUB = ROOT / "opendota-match-ui" / "public" / "data"
MATCH_DIR = PUB / "matches"
TEAM_IDS_PATH = PUB / "liquipedia_top20_team_ids.json"
OUT = PUB / "pro_replays_index.json"
UA = {"User-Agent": "plab-dota/fetch_pro_replays_index (+OpenDota)"}

# 单场详情请求上限（避免一次跑太久；定时任务可改为 40+）
MAX_DETAIL_FETCH = int(__import__("os").environ.get("PRO_FETCH_LIMIT", "12"))
REQUEST_SLEEP_SEC = 0.35
PRO_PATCH_ID_RAW = __import__("os").environ.get("PRO_PATCH_ID", "").strip()
PRO_PATCH_ID = int(PRO_PATCH_ID_RAW) if PRO_PATCH_ID_RAW else None


def _get(url: str) -> Any:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def summarize_players(players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in players:
        if not isinstance(p, dict):
            continue
        out.append(
            {
                "player_slot": int(p.get("player_slot") or 0),
                "account_id": int(p.get("account_id") or 0),
                "hero_id": int(p.get("hero_id") or 0),
                "pro_name": p.get("pro_name"),
                "is_radiant": bool(p.get("isRadiant", p.get("is_radiant", True))),
                "kills": int(p.get("kills") or 0),
                "deaths": int(p.get("deaths") or 0),
                "assists": int(p.get("assists") or 0),
            }
        )
    return out


def main() -> None:
    team_ids: Set[int] = set()
    if TEAM_IDS_PATH.is_file():
        blob = json.loads(TEAM_IDS_PATH.read_text(encoding="utf-8"))
        for x in blob.get("team_ids") or []:
            try:
                team_ids.add(int(x))
            except (TypeError, ValueError):
                pass
    if not team_ids:
        raise SystemExit(f"no team_ids in {TEAM_IDS_PATH}")

    pro_matches = _get("https://api.opendota.com/api/proMatches")
    if not isinstance(pro_matches, list):
        raise SystemExit("proMatches not a list")

    picked: List[Dict[str, Any]] = []
    for m in pro_matches:
        if not isinstance(m, dict):
            continue
        rid = m.get("radiant_team_id")
        did = m.get("dire_team_id")
        try:
            ri = int(rid) if rid is not None else None
        except (TypeError, ValueError):
            ri = None
        try:
            di = int(did) if did is not None else None
        except (TypeError, ValueError):
            di = None
        if (ri and ri in team_ids) or (di and di in team_ids):
            picked.append(m)
        if len(picked) >= MAX_DETAIL_FETCH * 2:
            break

    replays: List[Dict[str, Any]] = []
    scan_limit = min(len(picked), max(MAX_DETAIL_FETCH * 8, MAX_DETAIL_FETCH))
    for i, m in enumerate(picked[:scan_limit]):
        mid = int(m["match_id"])
        try:
            raw = _get(f"https://api.opendota.com/api/matches/{mid}")
        except urllib.error.HTTPError as e:
            print("skip", mid, e.code)
            time.sleep(REQUEST_SLEEP_SEC)
            continue
        if PRO_PATCH_ID is not None:
            try:
                patch_id = int(raw.get("patch") or 0)
            except (TypeError, ValueError):
                patch_id = 0
            if patch_id != PRO_PATCH_ID:
                time.sleep(REQUEST_SLEEP_SEC)
                continue

        slim = translate_match_data(raw)
        MATCH_DIR.mkdir(parents=True, exist_ok=True)
        slim_path = MATCH_DIR / f"{mid}.json"
        slim_path.write_text(
            json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        start = m.get("start_time")
        try:
            st = int(start) if start is not None else 0
        except (TypeError, ValueError):
            st = 0
        if st > 0:
            from datetime import UTC, datetime as dt

            uploaded = dt.fromtimestamp(st, tz=UTC).isoformat().replace("+00:00", "Z")
        else:
            uploaded = ""
        replays.append(
            {
                "match_id": mid,
                "uploaded_at": uploaded,
                "duration_sec": int(slim.get("duration") or m.get("duration") or 0),
                "radiant_win": bool(slim.get("radiant_win")),
                "league_name": str(
                    slim.get("league_name") or m.get("league_name") or "—"
                ),
                "radiant_score": int(slim.get("radiant_score") or m.get("radiant_score") or 0),
                "dire_score": int(slim.get("dire_score") or m.get("dire_score") or 0),
                "players": summarize_players(list(slim.get("players") or [])),
            }
        )
        print("ok", mid, len(replays))
        if len(replays) >= MAX_DETAIL_FETCH:
            break
        time.sleep(REQUEST_SLEEP_SEC)

    meta = {
        "source": "opendota_proMatches_filtered",
        "team_ids_count": len(team_ids),
        "fetched_matches": len(replays),
        "patch_id_filter": PRO_PATCH_ID,
    }
    OUT.write_text(
        json.dumps(
            {"version": 1, "_meta": meta, "replays": replays},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("wrote", OUT, "count", len(replays))


if __name__ == "__main__":
    main()
