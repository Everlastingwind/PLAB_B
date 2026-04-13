#!/usr/bin/env python3
"""
从本地目录批量读取解析器输出的 JSON，清洗（可选）后 POST 到网站 API。

典型流程：
  1. 你用其它方式批量解析 .dem，得到若干 ``*.json`` 放到 ``json_pending/``
  2. 在项目根执行：``python batch_upload_json.py``
  3. 成功文件移到 ``json_uploaded/``，失败移到 ``json_error/``

若 JSON 已是 ``translate_match_data`` 之后的前端结构，可加 ``--no-clean`` 跳过清洗。

依赖与 ``batch_processor.py`` 相同（requests、utils.dota_mapping）。
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from batch_processor import (  # noqa: E402
    API_ENDPOINT,
    API_TOKEN,
    _upload_match_json,
    clean_match_data,
)
from utils.dota_mapping import get_constants  # noqa: E402

# 与 batch_processor 并列的目录（自动创建）
DIR_JSON_PENDING = ROOT / "json_pending"
DIR_JSON_UPLOADED = ROOT / "json_uploaded"
DIR_JSON_ERROR = ROOT / "json_error"

LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def _setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt=DATE_FORMAT)


def _ensure_dirs(pending: Path, uploaded: Path, error: Path) -> None:
    for d in (pending, uploaded, error):
        d.mkdir(parents=True, exist_ok=True)


def _move_to(dest_dir: Path, src: Path) -> Path:
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


def _process_one_json(
    path: Path,
    *,
    skip_clean: bool,
) -> None:
    logging.info("-------- %s --------", path.name)
    text = path.read_text(encoding="utf-8")
    raw: Any = json.loads(text)
    if not isinstance(raw, dict):
        raise TypeError(f"根对象须为 JSON 对象，实际: {type(raw).__name__}")

    if skip_clean:
        payload = raw
        logging.info("已跳过 clean_match_data（--no-clean）")
    else:
        logging.info("clean_match_data() …")
        payload = clean_match_data(raw)

    _upload_match_json(payload)
    dest = _move_to(DIR_JSON_UPLOADED, path)
    logging.info("已上传并移至: %s", dest)


def main() -> None:
    ap = argparse.ArgumentParser(description="批量上传本地解析 JSON 到 API")
    ap.add_argument(
        "--pending-dir",
        type=Path,
        default=DIR_JSON_PENDING,
        help=f"待上传 JSON 目录（默认: {DIR_JSON_PENDING}）",
    )
    ap.add_argument(
        "--no-clean",
        action="store_true",
        help="JSON 已是前端结构，跳过 translate_match_data",
    )
    args = ap.parse_args()

    pending = args.pending_dir.resolve()
    _setup_logging()
    _ensure_dirs(pending, DIR_JSON_UPLOADED, DIR_JSON_ERROR)

    files = sorted(pending.glob("*.json"))
    if not files:
        logging.info("目录中无 .json：%s", pending)
        return

    if not args.no_clean:
        logging.info("加载 OpenDota / dotaconstants 缓存…")
        get_constants().load()

    logging.info("待上传: %d 个文件 → %s", len(files), API_ENDPOINT)

    for p in files:
        try:
            _process_one_json(p, skip_clean=args.no_clean)
        except Exception as e:
            logging.exception("失败 %s: %s → 移入 json_error/", p.name, e)
            try:
                if p.is_file():
                    _move_to(DIR_JSON_ERROR, p)
            except Exception as move_e:
                logging.exception("归档失败: %s", move_e)

    logging.info("======== 批量上传结束 ========")


if __name__ == "__main__":
    main()
