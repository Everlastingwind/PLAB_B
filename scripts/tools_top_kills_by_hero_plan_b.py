"""从 Supabase plan_b 扫描：指定 hero_id 击杀数最高的若干场比赛。"""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_LOCAL = ROOT / "opendota-match-ui" / ".env.local"


def _supabase_rest() -> tuple[str, str]:
    url = ""
    key = ""
    if ENV_LOCAL.is_file():
        for line in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("VITE_SUPABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
            elif line.startswith("VITE_SUPABASE_ANON_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    url = url or os.environ.get("VITE_SUPABASE_URL", "")
    key = key or os.environ.get("VITE_SUPABASE_ANON_KEY", "")
    if not url or not key:
        raise SystemExit("缺少 opendota-match-ui/.env.local 或环境变量 VITE_SUPABASE_*")
    return f"{url.rstrip('/')}/rest/v1/plan_b", key


def unwrap(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    pl = row.get("players")
    if isinstance(pl, list) and pl:
        return row
    for k in ("data", "payload", "slim", "match_json", "body"):
        inner = row.get(k)
        if isinstance(inner, dict):
            q = inner.get("players")
            if isinstance(q, list) and q:
                return inner
    return row


def player_kills(p: dict) -> int:
    for key in ("kills", "k"):
        if key not in p:
            continue
        try:
            return int(p[key])
        except (TypeError, ValueError):
            continue
    return 0


def fetch_all_players_rows(max_rows: int = 2000, page: int = 100) -> list[dict]:
    url, key = _supabase_rest()
    out: list[dict] = []
    offset = 0
    while len(out) < max_rows:
        q = f"?select=match_id,players&order=created_at.desc&limit={page}&offset={offset}"
        req = urllib.request.Request(
            url + q,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        with urllib.request.urlopen(req, timeout=240) as resp:
            batch = json.loads(resp.read().decode("utf-8"))
        if not batch:
            break
        out.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return out[:max_rows]


def top_kills_match_ids(hero_id: int, n: int = 3) -> list[tuple[int, int]]:
    rows = fetch_all_players_rows()
    scored: list[tuple[int, int]] = []
    for row in rows:
        data = unwrap(row)
        if not data or not isinstance(data.get("players"), list):
            continue
        mid = int(data.get("match_id") or row.get("match_id") or 0)
        if not mid:
            continue
        for p in data["players"]:
            if not isinstance(p, dict):
                continue
            try:
                hid = int(p.get("hero_id") or 0)
            except (TypeError, ValueError):
                continue
            if hid != hero_id:
                continue
            k = player_kills(p)
            scored.append((mid, k))
            break
    scored.sort(key=lambda x: (-x[1], x[0]))
    dedup: list[tuple[int, int]] = []
    seen: set[int] = set()
    for mid, k in scored:
        if mid in seen:
            continue
        seen.add(mid)
        dedup.append((mid, k))
        if len(dedup) >= n:
            break
    return dedup


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("hero_id", type=int, help="英雄 hero_id，例如 7=撼地者")
    ap.add_argument("-n", type=int, default=3, help="取前几场（默认 3）")
    args = ap.parse_args()
    for mid, k in top_kills_match_ids(args.hero_id, args.n):
        print(mid, k)
