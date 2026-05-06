"""
从 Supabase ``plan_b`` 全量生成 ``replays_index.json`` 所需的 replay 行（替代扫描本地 matches/*.json）。
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Set

import requests

# 与 ``fetchPlanBReplayIndexPage`` / snapshot 脚本一致的索引列；含 slim/payload 以便顶层 players 为空时补齐
PLAN_B_SELECT_FULL = (
    "match_id,created_at,duration,radiant_win,radiant_score,dire_score,"
    "league_name,players,payload,slim"
)
PLAN_B_SELECT_FALLBACK = (
    "match_id,created_at,duration,radiant_win,radiant_score,dire_score,league_name,players"
)

PAGE_SIZE = 40
MAX_PAGES = 50000

RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


def _env_supabase_url() -> str:
    u = (
        os.environ.get("VITE_SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or os.environ.get("SUPABASE_URL")
        or ""
    ).strip().rstrip("/")
    if not u.startswith("http"):
        raise RuntimeError(
            "缺少 VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL"
        )
    return u


def _env_service_role() -> str:
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        raise RuntimeError(
            "缺少 SUPABASE_SERVICE_ROLE_KEY（重建索引需读全表 plan_b）"
        )
    return k


def _is_radiant_from_player_dict(p: Mapping[str, Any]) -> bool:
    try:
        ps = int(p.get("player_slot") or 0)
    except (TypeError, ValueError):
        ps = 0
    if 128 <= ps <= 137:
        return False
    if 5 <= ps <= 9:
        return False
    if 0 <= ps <= 4:
        return True
    if 10 <= ps <= 127:
        v = p.get("isRadiant", p.get("is_radiant"))
        if isinstance(v, bool):
            return v
        return False
    return False


def _is_canonical_dota_lobby_slot(slot: int) -> bool:
    if 0 <= slot <= 4:
        return True
    if 5 <= slot <= 9:
        return True
    if 128 <= slot <= 132:
        return True
    return False


def _is_overflow_lobby_slot_for_index(slot: int) -> bool:
    return 133 <= slot <= 137


def _summarize_players_for_index(players: List[Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: Set[int] = set()
    for p in players:
        if not isinstance(p, dict):
            continue
        ps = int(p.get("player_slot") or 0)
        if not _is_canonical_dota_lobby_slot(ps):
            continue
        seen.add(ps)
        out.append(
            {
                "player_slot": ps,
                "account_id": int(p.get("account_id") or 0),
                "hero_id": int(p.get("hero_id") or 0),
                "pro_name": p.get("pro_name"),
                "role_early": p.get("role_early"),
                "is_radiant": _is_radiant_from_player_dict(p),
                "kills": int(p.get("kills") or 0),
                "deaths": int(p.get("deaths") or 0),
                "assists": int(p.get("assists") or 0),
            }
        )
    if len(out) < 10:
        for p in players:
            if not isinstance(p, dict):
                continue
            ps = int(p.get("player_slot") or 0)
            if _is_canonical_dota_lobby_slot(ps):
                continue
            if not _is_overflow_lobby_slot_for_index(ps):
                continue
            if int(p.get("hero_id") or 0) <= 0:
                continue
            if ps in seen:
                continue
            seen.add(ps)
            out.append(
                {
                    "player_slot": ps,
                    "account_id": int(p.get("account_id") or 0),
                    "hero_id": int(p.get("hero_id") or 0),
                    "pro_name": p.get("pro_name"),
                    "role_early": p.get("role_early"),
                    "is_radiant": _is_radiant_from_player_dict(p),
                    "kills": int(p.get("kills") or 0),
                    "deaths": int(p.get("deaths") or 0),
                    "assists": int(p.get("assists") or 0),
                }
            )
    return out


def _parse_json_object(raw: Any) -> Optional[Dict[str, Any]]:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            v = json.loads(raw)
            return v if isinstance(v, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def _effective_players(row: Dict[str, Any]) -> List[Any]:
    pl = row.get("players")
    if isinstance(pl, str):
        try:
            pl = json.loads(pl)
        except json.JSONDecodeError:
            pl = None
    if isinstance(pl, list) and len(pl) > 0:
        return pl

    for key in ("slim", "payload", "match_json", "body"):
        inner = _parse_json_object(row.get(key))
        if not inner:
            continue
        p = inner.get("players")
        if isinstance(p, list) and len(p) > 0:
            return p
        m = inner.get("match")
        if isinstance(m, dict):
            p = m.get("players")
            if isinstance(p, list) and len(p) > 0:
                return p
    return []


def _format_uploaded_at(created_raw: Any, fallback_ts: float) -> str:
    if isinstance(created_raw, str) and created_raw.strip():
        s = created_raw.strip().replace("Z", "+00:00")
        try:
            d = datetime.fromisoformat(s)
            return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            return created_raw.strip()
    return datetime.fromtimestamp(fallback_ts, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def _row_to_replay_entry(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    mid = int(row.get("match_id") or 0)
    if mid <= 0:
        return None

    players_raw = _effective_players(row)
    if len(players_raw) == 0:
        return None

    players = _summarize_players_for_index(players_raw)
    if not players:
        return None

    created_raw = row.get("created_at")
    ts_fallback = time.time()
    uploaded_at = _format_uploaded_at(created_raw, ts_fallback)

    dur = int(row.get("duration") or row.get("duration_sec") or 0)
    tier_raw = str(row.get("match_tier") or "").strip().lower()
    tier = tier_raw if tier_raw in ("pub", "pro") else "pub"

    return {
        "match_id": mid,
        "uploaded_at": uploaded_at,
        "duration_sec": dur,
        "radiant_win": bool(row.get("radiant_win")),
        "league_name": str(row.get("league_name") or "—"),
        "radiant_score": int(row.get("radiant_score") or 0),
        "dire_score": int(row.get("dire_score") or 0),
        "match_tier": tier,
        "players": players,
    }


def _fetch_plan_b_page(
    base_url: str,
    api_key: str,
    select_cols: str,
    offset: int,
    limit: int,
) -> List[Dict[str, Any]]:
    url = f"{base_url}/rest/v1/plan_b"
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Accept-Profile": "public",
    }
    params = {
        "select": select_cols,
        "order": "created_at.desc",
        "limit": str(limit),
        "offset": str(offset),
    }

    last_err: Optional[str] = None
    for attempt in range(5):
        r = requests.get(url, headers=headers, params=params, timeout=180)
        if r.ok:
            data = r.json()
            return data if isinstance(data, list) else []

        last_err = r.text[:400]
        if r.status_code in RETRYABLE_STATUS:
            time.sleep(1.5 * (2**attempt))
            continue
        raise RuntimeError(f"plan_b HTTP {r.status_code}: {last_err}")

    raise RuntimeError(f"plan_b 分页失败 offset={offset}: {last_err}")


def _fetch_all_plan_b_rows(select_cols: str) -> List[Dict[str, Any]]:
    base_url = _env_supabase_url()
    api_key = _env_service_role()

    merged: List[Dict[str, Any]] = []
    offset = 0
    page = 0
    while page < MAX_PAGES:
        batch = _fetch_plan_b_page(base_url, api_key, select_cols, offset, PAGE_SIZE)
        if not batch:
            break
        merged.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        page += 1

    return merged


def build_replays_list_from_plan_b() -> List[Dict[str, Any]]:
    """按 ``created_at`` 降序拉取 plan_b，去重 match_id（保留最新一行），生成索引 replay 列表。"""
    try:
        rows = _fetch_all_plan_b_rows(PLAN_B_SELECT_FULL)
    except Exception as e:
        err = str(e).lower()
        if "column" in err or "42703" in err or "does not exist" in err:
            rows = _fetch_all_plan_b_rows(PLAN_B_SELECT_FALLBACK)
        else:
            raise

    seen: Set[int] = set()
    replays: List[Dict[str, Any]] = []
    for row in rows:
        mid = int(row.get("match_id") or 0)
        if mid <= 0 or mid in seen:
            continue
        entry = _row_to_replay_entry(row)
        if entry:
            seen.add(mid)
            replays.append(entry)

    return replays
