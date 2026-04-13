"""
FastAPI 示例：拉取或提交比赛时返回 translate_match_data 结果。
安装: pip install fastapi uvicorn
启动（Windows 推荐用 python -m，避免「uvicorn 不是内部命令」）::
  python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000 --app-dir .
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import urllib.error
from fastapi import Body, Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.match_service import (
    fetch_opendota_match_raw,
    save_match_payload,
    save_uploaded_match_slim,
)
from utils.dota_mapping import translate_match_data
from utils.raw_odota_purify import normalize_match_input_for_translate

app = FastAPI(title="PLAB Dota Match API", version="0.1.0")

# -----------------------------------------------------------------------------
# 批量脚本上传：POST /api/matches/upload
# 环境变量 MATCH_UPLOAD_TOKEN 覆盖默认口令；与 batch_processor.API_TOKEN 保持一致
# -----------------------------------------------------------------------------
_UPLOAD_TOKEN = os.environ.get("MATCH_UPLOAD_TOKEN", "my_secret_token")
_bearer = HTTPBearer()


def _verify_upload_token(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> None:
    if credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authorization must be Bearer")
    if credentials.credentials != _UPLOAD_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")


def _fetch_opendota_match(match_id: int) -> dict:
    try:
        return fetch_opendota_match_raw(match_id)
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=e.code, detail=str(e)) from e


@app.get("/matches/{match_id}")
def get_match_translated(match_id: int):
    raw = _fetch_opendota_match(match_id)
    return translate_match_data(raw)


@app.post("/matches/{match_id}/save")
def post_save_match(match_id: int):
    raw = _fetch_opendota_match(match_id)
    path = save_match_payload(raw, match_id=match_id)
    slim = translate_match_data(raw)
    return {"saved_to": str(path), "match": slim}


@app.post("/api/matches/upload")
def post_match_upload(
    payload: Any = Body(...),
    _: None = Depends(_verify_upload_token),
) -> dict[str, Any]:
    """
    接收比赛 JSON：可为 **translate_match_data 后的 slim**，或 **odota 巨型事件数组** /
    ``players`` 误填为事件流的 dict。会先提纯 ``type=player_match`` 再经 ``translate_match_data``，
    最后写入 ``public/data/matches/`` 并重建 ``replays_index.json``。
    """
    try:
        data = normalize_match_input_for_translate(payload)
        if not isinstance(data, dict) or not data:
            raise ValueError("无效的 JSON：需要对象或事件数组")
        slim = translate_match_data(data)
        path = save_uploaded_match_slim(slim)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    mid = int(slim.get("match_id") or 0)
    return {
        "message": "Match data uploaded successfully",
        "match_id": mid,
        "saved_to": str(path),
    }
