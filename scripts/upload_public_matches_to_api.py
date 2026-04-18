#!/usr/bin/env python3
"""
将本地已生成的 slim 比赛 JSON（默认 opendota-match-ui/public/data/matches/*.json）
逐场 POST 到网站后端的 ``/api/matches/upload``（与 ``backend.app.post_match_upload`` 一致）。

**环境变量（必填 URL，令牌与本地示例默认一致）**

- ``MATCH_UPLOAD_URL``：完整上传地址，例如 ``https://你的域名/api/matches/upload``
- ``MATCH_UPLOAD_TOKEN``：Bearer 口令，须与服务器环境变量 ``MATCH_UPLOAD_TOKEN`` 一致（未设时脚本默认 ``my_secret_token``）

用法（项目根 PLAB_B）::

  # PowerShell 示例
  $env:MATCH_UPLOAD_URL="https://example.com/api/matches/upload"
  $env:MATCH_UPLOAD_TOKEN="你的密钥"
  python scripts/upload_public_matches_to_api.py

  python scripts/upload_public_matches_to_api.py --limit 3 --dry-run
  python scripts/upload_public_matches_to_api.py --match-id 8770394307

也可在项目根放置 ``site_upload.json``（参考 ``site_upload.json.example``），无需每次设环境变量。

若你的网站是 **纯静态托管**（如 Vercel 仅托管前端、无此上传 API），则无法通过本脚本推数据；
请运行 ``scripts/publish_static_frontend.ps1``（或 ``npm run build``后 ``vercel deploy --prod``），
把含 ``public/data/matches`` 的构建产物部署上去。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DEFAULT_MATCHES = ROOT / "opendota-match-ui" / "public" / "data" / "matches"
SITE_UPLOAD_CONFIG = ROOT / "site_upload.json"


def _load_site_upload_config() -> tuple[str, str]:
    """从项目根 ``site_upload.json`` 读取 ``match_upload_url`` / ``match_upload_token``（可选）。"""
    if not SITE_UPLOAD_CONFIG.is_file():
        return "", ""
    try:
        data = json.loads(SITE_UPLOAD_CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "", ""
    if not isinstance(data, dict):
        return "", ""
    return (
        str(data.get("match_upload_url") or "").strip(),
        str(data.get("match_upload_token") or "").strip(),
    )


def _post_json(url: str, token: str, payload: Dict[str, Any], timeout: float) -> tuple[int, str]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
            # 部分 CDN（如 Cloudflare）对无 User-Agent 的脚本请求返回 403
            "User-Agent": "Mozilla/5.0 (compatible; PLAB_B-match-upload/1.0; +https://dota2planb.com)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        return int(resp.status), raw


def main() -> None:
    ap = argparse.ArgumentParser(description="上传 public/data/matches 下 slim JSON 到 MATCH_UPLOAD_URL")
    ap.add_argument(
        "--matches-dir",
        type=Path,
        default=DEFAULT_MATCHES,
        help="slim 目录（默认 opendota-match-ui/public/data/matches）",
    )
    ap.add_argument(
        "--api-url",
        type=str,
        default="",
        help="上传 URL；优先于环境变量 MATCH_UPLOAD_URL 与 site_upload.json",
    )
    ap.add_argument(
        "--token",
        type=str,
        default="",
        help="Bearer 令牌；优先于环境变量 MATCH_UPLOAD_TOKEN 与 site_upload.json",
    )
    ap.add_argument("--dry-run", action="store_true", help="只列出将上传的 match_id，不发送请求")
    ap.add_argument("--limit", type=int, default=0, metavar="N", help="仅上传前 N 个文件（0=不限）")
    ap.add_argument("--match-id", type=int, default=0, help="只上传指定 match_id")
    ap.add_argument("--timeout", type=float, default=120.0, help="单次 POST 超时秒数")
    args = ap.parse_args()

    file_url, file_tok = _load_site_upload_config()
    url = (
        (args.api_url or "").strip()
        or os.environ.get("MATCH_UPLOAD_URL", "").strip()
        or file_url
    )
    token = (
        (args.token or "").strip()
        or os.environ.get("MATCH_UPLOAD_TOKEN", "").strip()
        or file_tok
        or "my_secret_token"
    )
    if not url and not args.dry_run:
        raise SystemExit(
            "未设置上传地址。任选其一：\n"
            "  1) 项目根创建 site_upload.json（复制 site_upload.json.example）\n"
            "  2) 环境变量 MATCH_UPLOAD_URL\n"
            "  3)参数 --api-url https://你的站点/api/matches/upload\n"
            "纯静态站点请用 scripts/publish_static_frontend.ps1 部署构建产物。"
        )

    d = args.matches_dir.resolve()
    if not d.is_dir():
        raise SystemExit(f"目录不存在: {d}")

    files = sorted(d.glob("*.json"), key=lambda p: p.name.lower())
    if args.match_id > 0:
        files = [d / f"{args.match_id}.json"]
        files = [p for p in files if p.is_file()]
    if not files:
        raise SystemExit("没有可上传的 *.json")

    if args.dry_run:
        for i, p in enumerate(files):
            if args.limit and i >= args.limit:
                break
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                print("skip (bad json):", p.name)
                continue
            mid = int(data.get("match_id") or 0)
            print("dry-run:", p.name, "match_id=", mid)
        return

    ok = 0
    failed: List[str] = []
    for i, path in enumerate(files):
        if args.limit and ok >= args.limit:
            break
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            failed.append(f"{path.name}: read {e}")
            continue
        mid = int(data.get("match_id") or 0)
        if mid <= 0:
            failed.append(f"{path.name}: invalid match_id")
            continue
        try:
            status, _txt = _post_json(url, token, data, args.timeout)
            if status != 200:
                failed.append(f"{mid}: HTTP {status}")
            else:
                ok += 1
                print(f"OK match_id={mid}", flush=True)
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8", errors="replace")[:200]
            except Exception:
                pass
            failed.append(f"{mid}: HTTP {e.code} {e.reason} {err_body}")
        except urllib.error.URLError as e:
            failed.append(f"{mid}: {e.reason!s}")

    print(f"完成: 成功 {ok}, 失败 {len(failed)}", flush=True)
    for line in failed[:40]:
        print(" FAIL:", line, flush=True)
    if len(failed) > 40:
        print(" ...", len(failed) - 40, "more", flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
