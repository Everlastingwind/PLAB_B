#!/usr/bin/env python3
"""
本地 .dem 批量解析 → 数据清洗 → 上传后端的工业级流水线。

前置：
  - Docker 解析器监听（默认）http://localhost:5600
  - pip install -r requirements.txt（含 requests）
  - 在项目根目录执行：python batch_processor.py

目录：
  待处理 .dem：默认 replays_pending/，或环境变量 BATCH_DEM_PENDING（例如 E:\\doreplays）
  replays_completed/、replays_error/  在项目根（成功/失败归档 .dem）
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any

import requests

# -----------------------------------------------------------------------------
# 路径：保证可从项目根导入 utils
# -----------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# -----------------------------------------------------------------------------
# 数据清洗：对接已有 OpenDota 映射与 TALENT_OVERRIDES（见 utils/dota_pipeline 等）
# -----------------------------------------------------------------------------
from utils.dota_mapping import get_constants, translate_match_data  # noqa: E402


def clean_match_data(raw_json: dict[str, Any]) -> dict[str, Any]:
    """
    将解析器返回的原始 match JSON 转为站点前端所需结构。
    内部使用 translate_match_data（含字典映射、天赋分支、TALENT_OVERRIDES 等）。
    """
    return translate_match_data(raw_json)


# -----------------------------------------------------------------------------
# 全局配置（按需修改）
# -----------------------------------------------------------------------------
PARSER_BASE_URL = "http://localhost:5600"
# 若解析器挂在子路径，例如 http://localhost:5600/parse，则设为 "/parse"
PARSER_UPLOAD_PATH = "/"
# (连接超时, 读超时)：上传原始字节流 + 服务端解析 + 响应 JSON；大文件请适当加大
PARSER_CONNECT_TIMEOUT = 60.0
PARSER_READ_TIMEOUT = 600.0

# 本地开发：先安装依赖并在项目根启动后端（Windows 用 python -m uvicorn）
#   pip install -r requirements.txt
#   python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000 --app-dir .
API_ENDPOINT = "http://127.0.0.1:8000/api/matches/upload"
API_TOKEN = "my_secret_token"
API_TIMEOUT = 60.0
# 上传时 Bearer；若后端用 X-Api-Key，可改 _upload_match_json 内的 headers

# 待处理 .dem：默认项目根下 replays_pending/；可用环境变量指向任意目录，例如 E:\doreplays
#   PowerShell: $env:BATCH_DEM_PENDING="E:\doreplays"; python batch_processor.py
DIR_PENDING = (
    Path(os.environ["BATCH_DEM_PENDING"].strip())
    if os.environ.get("BATCH_DEM_PENDING", "").strip()
    else ROOT / "replays_pending"
)
DIR_COMPLETED = ROOT / "replays_completed"
DIR_ERROR = ROOT / "replays_error"

LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format=LOG_FORMAT,
        datefmt=DATE_FORMAT,
    )


def _ensure_dirs() -> None:
    for d in (DIR_PENDING, DIR_COMPLETED, DIR_ERROR):
        d.mkdir(parents=True, exist_ok=True)
        logging.info("目录就绪: %s", d)


def _parser_url() -> str:
    base = PARSER_BASE_URL.rstrip("/")
    path = PARSER_UPLOAD_PATH if PARSER_UPLOAD_PATH.startswith("/") else f"/{PARSER_UPLOAD_PATH}"
    return f"{base}{path}"


def _scan_pending_queue() -> list[Path]:
    files = sorted(DIR_PENDING.glob("*.dem"))
    return [p for p in files if p.is_file()]


def _move_to(dest_dir: Path, src: Path) -> Path:
    """同名冲突时追加序号，避免 shutil.move 失败。"""
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / src.name
    if not target.exists():
        shutil.move(str(src), str(target))
        return target
    stem, suf = src.stem, src.suffix
    for i in range(1, 10_000):
        candidate = dest_dir / f"{stem}_{i}{suf}"
        if not candidate.exists():
            shutil.move(str(src), str(candidate))
            return candidate
    raise OSError(f"无法为 {src.name} 生成唯一目标名")


def _post_dem_to_parser(dem_path: Path) -> dict[str, Any]:
    """
    向解析器 POST 原始 .dem 字节流（与 ``curl --data-binary @file.dem`` 类似）。

    使用 ``data=open(..., 'rb')`` 分块上传；勿用 ``files=`` / multipart / 整文件 ``read()``。
    """
    url = _parser_url()
    size = dem_path.stat().st_size
    logging.info("Step A: POST %s <- %s (%d bytes)", url, dem_path.name, size)

    with dem_path.open("rb") as dem_fp:
        resp = requests.post(
            url,
            data=dem_fp,
            headers={
                "Content-Type": "application/octet-stream",
                "Accept": "application/json",
                "Connection": "close",
            },
            timeout=(PARSER_CONNECT_TIMEOUT, PARSER_READ_TIMEOUT),
        )

    resp.raise_for_status()
    try:
        data = resp.json()
    except json.JSONDecodeError as e:
        logging.error("Step A: 响应非 JSON: %s", e)
        raise

    if not isinstance(data, dict):
        raise TypeError(f"解析器应返回 JSON 对象，实际: {type(data).__name__}")
    logging.info("Step A: 成功，顶层键: %s", list(data.keys())[:12])
    return data


def _upload_match_json(payload: dict[str, Any]) -> None:
    logging.info("Step C: POST %s", API_ENDPOINT)
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    resp = requests.post(
        API_ENDPOINT,
        json=payload,
        headers=headers,
        timeout=API_TIMEOUT,
    )
    resp.raise_for_status()
    logging.info("Step C: 上传成功 HTTP %s", resp.status_code)


def process_one_file(dem_path: Path) -> None:
    """处理单个文件；任一步失败则抛异常（由外层捕获并归档）。"""
    logging.info("======== 开始处理: %s ========", dem_path.name)

    raw = _post_dem_to_parser(dem_path)

    logging.info("Step B: clean_match_data() …")
    cleaned = clean_match_data(raw)
    logging.info("Step B: 清洗完成（键数量约 %d）", len(cleaned) if isinstance(cleaned, dict) else -1)

    _upload_match_json(cleaned)

    dest = _move_to(DIR_COMPLETED, dem_path)
    logging.info("Step D: 已移至 completed: %s", dest)


def run_batch() -> None:
    _setup_logging()
    _ensure_dirs()

    logging.info("加载 OpenDota / dotaconstants 缓存（首次可能下载）…")
    get_constants().load()

    queue = _scan_pending_queue()
    if not queue:
        logging.info("replays_pending/ 中无 .dem 文件，退出。")
        return

    logging.info("待处理文件数: %d", len(queue))

    for dem_path in queue:
        try:
            process_one_file(dem_path)
        except Exception as e:
            logging.exception(
                "处理失败 %s: %s — 将移入 replays_error/",
                dem_path.name,
                e,
            )
            try:
                if dem_path.is_file():
                    err_dest = _move_to(DIR_ERROR, dem_path)
                    logging.info("已归档至 error: %s", err_dest)
                else:
                    logging.warning("源文件已不存在，跳过移动: %s", dem_path)
            except Exception as move_err:
                logging.exception("移入 error 目录失败: %s", move_err)
            continue

    logging.info("======== 批量任务结束 ========")


if __name__ == "__main__":
    run_batch()
