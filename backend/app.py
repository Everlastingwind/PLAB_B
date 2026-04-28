"""
FastAPI 示例：拉取或提交比赛时返回 translate_match_data 结果。
安装: pip install fastapi uvicorn
启动（Windows 推荐用 python -m，避免「uvicorn 不是内部命令」）::
  python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000 --app-dir .
"""

from __future__ import annotations

import json as json_stdlib
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.match_service import (
    build_hero_item_timeline,
    fetch_opendota_match_raw,
    save_match_payload,
    save_uploaded_match_slim,
)
from utils.dota_mapping import translate_match_data
from utils.raw_odota_purify import normalize_match_input_for_translate

app = FastAPI(title="PLAB Dota Match API", version="0.1.0")

# 浏览器直连钉钉 Webhook 会 CORS；前端只打本域 /api/feedback，由这里转发。
_CORS_ORIGINS = [
    x.strip()
    for x in os.environ.get(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,"
        "https://www.dota2planb.com,https://dota2planb.com",
    ).split(",")
    if x.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS
    or ["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FeedbackIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    page_url: str | None = None
    user_agent: str | None = None


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


@app.post("/api/feedback")
def post_feedback(body: FeedbackIn) -> dict[str, Any]:
    """
    接收前端反馈 JSON，转发到钉钉自定义机器人（Webhook）。
    环境变量 ``DINGTALK_WEBHOOK_URL`` 必填（完整 https://oapi.dingtalk.com/... 地址）。
    """
    webhook = os.environ.get("DINGTALK_WEBHOOK_URL", "").strip()
    if not webhook:
        raise HTTPException(
            status_code=503,
            detail="服务器未配置 DINGTALK_WEBHOOK_URL",
        )
    lines = [
        "【网站反馈】",
        body.message.strip(),
        f"页面: {body.page_url or '-'}",
        f"UA: {(body.user_agent or '-')[:500]}",
    ]
    ding_payload = {
        "msgtype": "text",
        "text": {"content": "\n".join(lines)},
    }
    req = urllib.request.Request(
        webhook,
        data=json_stdlib.dumps(ding_payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"钉钉返回 HTTP {e.code}",
        ) from e
    except urllib.error.URLError as e:
        raise HTTPException(status_code=502, detail=f"无法连接钉钉: {e.reason!s}") from e
    return {"ok": True, "dingtalk_response": raw[:500]}


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


@app.get("/api/hero-item-timeline")
def get_hero_item_timeline(hero_id: int) -> dict[str, Any]:
    if hero_id <= 0:
        raise HTTPException(status_code=400, detail="hero_id must be positive")
    return build_hero_item_timeline(hero_id)
