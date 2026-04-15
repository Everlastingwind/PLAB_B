"""
示例：保存比赛数据时使用 translate_match_data，持久化精简 JSON。
可按你的框架（FastAPI / Flask / Django）把 save_match_payload 挂到路由上。
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping

OPENDOTA_MATCH_URL = "https://api.opendota.com/api/matches/{match_id}"

# 确保项目根在 path 中（若用 uvicorn 从 backend 目录启动，按需调整）
import sys

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from utils.dota_mapping import translate_match_data


def fetch_opendota_match_raw(match_id: int) -> Dict[str, Any]:
    """从 OpenDota 拉取原始比赛 JSON（含每名玩家的 ability_upgrades / ability_upgrades_arr）。"""
    url = OPENDOTA_MATCH_URL.format(match_id=match_id)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "plab-dota/1.0 (+match_service)"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode("utf-8"))

# 兼容旧路径：按 match_id 归档
DATA_DIR = _ROOT / "data" / "matches"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 前端 Vite 静态资源：npm run dev / build 时可通过 /data/latest_match.json 访问
FRONTEND_PUBLIC_DATA = _ROOT / "opendota-match-ui" / "public" / "data"
FRONTEND_PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
FRONTEND_MATCHES_DIR = FRONTEND_PUBLIC_DATA / "matches"
REPLAYS_INDEX_PATH = FRONTEND_PUBLIC_DATA / "replays_index.json"


def _is_radiant_from_player_dict(p: Mapping[str, Any]) -> bool:
    """与前端 matchGrouping 一致：优先用 player_slot，避免缺省 is_radiant 时全员天辉。"""
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
    """标准 5v5：天辉 0–4，夜魇 128–132 或 5–9。133+ 常为教练槽，不参与索引头像行。"""
    if 0 <= slot <= 4:
        return True
    if 5 <= slot <= 9:
        return True
    if 128 <= slot <= 132:
        return True
    return False


def _summarize_players_for_index(players: List[Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in players:
        if not isinstance(p, dict):
            continue
        ps = int(p.get("player_slot") or 0)
        if not _is_canonical_dota_lobby_slot(ps):
            continue
        out.append(
            {
                "player_slot": ps,
                "account_id": int(p.get("account_id") or 0),
                "hero_id": int(p.get("hero_id") or 0),
                "pro_name": p.get("pro_name"),
                "is_radiant": _is_radiant_from_player_dict(p),
                "kills": int(p.get("kills") or 0),
                "deaths": int(p.get("deaths") or 0),
                "assists": int(p.get("assists") or 0),
            }
        )
    return out


def _uploaded_at_timestamp(path: Path, data: Dict[str, Any]) -> float:
    meta = data.get("_meta") if isinstance(data.get("_meta"), dict) else {}
    u = (meta or {}).get("uploaded_at") or data.get("uploaded_at")
    if isinstance(u, str) and u.strip():
        try:
            s = u.strip().replace("Z", "+00:00")
            return datetime.fromisoformat(s).timestamp()
        except ValueError:
            pass
    return path.stat().st_mtime


def rebuild_replays_index() -> int:
    """
    扫描 ``public/data/matches/*.json``，按 ``_meta.uploaded_at``（缺省则文件 mtime）
    **从新到旧** 排序，写入 ``replays_index.json``（首页列表顺序与此一致）。
    """
    FRONTEND_MATCHES_DIR.mkdir(parents=True, exist_ok=True)
    files = [f for f in FRONTEND_MATCHES_DIR.glob("*.json") if f.is_file()]
    loaded: List[tuple[float, Path, Dict[str, Any]]] = []
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        ts = _uploaded_at_timestamp(f, data)
        loaded.append((ts, f, data))
    loaded.sort(key=lambda x: x[0], reverse=True)

    replays: List[Dict[str, Any]] = []
    for _ts, _f, data in loaded:
        mid = int(data.get("match_id") or 0)
        if mid <= 0:
            continue
        meta = data.get("_meta") if isinstance(data.get("_meta"), dict) else {}
        uploaded = (meta or {}).get("uploaded_at") or data.get("uploaded_at")
        if not isinstance(uploaded, str) or not uploaded.strip():
            uploaded = datetime.fromtimestamp(_f.stat().st_mtime, tz=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        replays.append(
            {
                "match_id": mid,
                "uploaded_at": uploaded.strip()
                if str(uploaded).endswith("Z")
                else str(uploaded),
                "duration_sec": int(data.get("duration") or data.get("duration_sec") or 0),
                "radiant_win": bool(data.get("radiant_win")),
                "league_name": str(data.get("league_name") or "—"),
                "radiant_score": int(data.get("radiant_score") or 0),
                "dire_score": int(data.get("dire_score") or 0),
                "players": _summarize_players_for_index(data.get("players") or []),
            }
        )

    REPLAYS_INDEX_PATH.write_text(
        json.dumps({"version": 1, "replays": replays}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return len(replays)


def save_uploaded_match_slim(
    slim: Mapping[str, Any], *, rebuild_index: bool = True
) -> Path:
    """
    接收已是 ``translate_match_data`` 结果的 JSON，写入 ``public/data/matches/{match_id}.json``、
    ``latest_match.json``；默认重建 ``replays_index.json``（新上传排在列表最前）。
    批量导入时可设 ``rebuild_index=False``，全部写完后再调用 ``rebuild_replays_index()``。
    """
    mid = int(slim.get("match_id") or 0)
    if mid <= 0:
        raise ValueError("match_id 无效")

    meta: Dict[str, Any] = dict(slim.get("_meta") or {}) if isinstance(slim.get("_meta"), dict) else {}
    meta["source"] = meta.get("source") or "api_upload"
    meta["match_id"] = mid
    meta["uploaded_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    out: Dict[str, Any] = {**dict(slim), "_meta": meta}

    FRONTEND_MATCHES_DIR.mkdir(parents=True, exist_ok=True)
    match_path = FRONTEND_MATCHES_DIR / f"{mid}.json"
    match_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    latest = FRONTEND_PUBLIC_DATA / "latest_match.json"
    latest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    if rebuild_index:
        n = rebuild_replays_index()
        print(f"[save_uploaded_match_slim] match_id={mid} replays_index entries={n}", flush=True)
    else:
        print(f"[save_uploaded_match_slim] match_id={mid} (index 延迟重建)", flush=True)
    return match_path


def save_match_payload(raw_match: Mapping[str, Any], *, match_id: int | None = None) -> Path:
    """
    接收 OpenDota /matches/{id} 或 DEM 解析管线输出的比赛 JSON，经 translate_match_data 清洗后：
    - 写入 data/matches/{match_id}.json（归档）
    - 写入 opendota-match-ui/public/data/matches/{match_id}.json（供 /match/:id）
    - 写入 opendota-match-ui/public/data/latest_match.json（供首页默认）
    - 重建 public/data/replays_index.json
    """
    mid = match_id
    if mid is None:
        mid = int(raw_match.get("match_id") or 0)
    if mid <= 0:
        raise ValueError("match_id 无效")

    slim: Dict[str, Any] = translate_match_data(raw_match)
    slim["_meta"] = {
        "source": "opendota_pipeline",
        "note": "由 Python translate_match_data 自 API/DEM 衍生字段；英雄/物品含 hero_id、item_id 映射",
        "match_id": mid,
    }

    archive = DATA_DIR / f"{mid}.json"
    archive.write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")

    FRONTEND_MATCHES_DIR.mkdir(parents=True, exist_ok=True)
    match_path = FRONTEND_MATCHES_DIR / f"{mid}.json"
    match_path.write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")

    latest = FRONTEND_PUBLIC_DATA / "latest_match.json"
    latest.write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")

    n = rebuild_replays_index()
    print(f"[save_match_payload] match_id={mid} replays_index entries={n}", flush=True)
    return match_path


def load_saved_match(match_id: int) -> Dict[str, Any]:
    path = DATA_DIR / f"{match_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def refresh_match_from_opendota(match_id: int) -> Path:
    """
    重新从 OpenDota 读取对局并清洗，写入归档与 opendota-match-ui/public/data/latest_match.json。
    用于刷新全员技能加点（ability_timeline）等依赖原始 ability 字段的数据。
    """
    raw = fetch_opendota_match_raw(match_id)
    return save_match_payload(raw, match_id=match_id)
