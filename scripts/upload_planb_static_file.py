"""
将本地文件上传到 Supabase Storage bucket ``planb-static-data``（与前端 CDN 路径一致）。

环境变量（与 ``build-meta-site-snapshot.ts`` / CI 对齐）：
- ``VITE_SUPABASE_URL`` 或 ``NEXT_PUBLIC_SUPABASE_URL``：项目根 URL（勿含 ``/rest/v1``）
- ``SUPABASE_SERVICE_ROLE_KEY``：上传写入 Storage

用法::

  from pathlib import Path
  from scripts.upload_planb_static_file import upload_planb_static_object
  upload_planb_static_object(Path("opendota-match-ui/public/data/replays_index.json"))
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import requests

BUCKET = "planb-static-data"


def _supabase_project_url() -> str:
    u = (
        os.environ.get("VITE_SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or ""
    ).strip().rstrip("/")
    if not u.startswith("http"):
        raise RuntimeError(
            "缺少 VITE_SUPABASE_URL（或 NEXT_PUBLIC_SUPABASE_URL），无法上传 Storage"
        )
    return u


def _service_role_key() -> str:
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        raise RuntimeError("缺少 SUPABASE_SERVICE_ROLE_KEY，无法写入 Storage")
    return k


def upload_planb_static_object(
    local_path: Path,
    *,
    object_key: Optional[str] = None,
    content_type: str = "application/json; charset=utf-8",
) -> None:
    """
    :param object_key: 桶内对象键，默认 ``public/data/<文件名>`` 与站点 ``public/data`` 一致。
    """
    path = local_path.resolve()
    if not path.is_file():
        raise FileNotFoundError(path)

    key = object_key or f"public/data/{path.name}"
    # Storage REST：覆盖已有对象须带 Header ``x-upsert: true``（仅 query 往往仍会 409）
    url = f"{_supabase_project_url()}/storage/v1/object/{BUCKET}/{key}"
    body = path.read_bytes()

    r = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {_service_role_key()}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        data=body,
        timeout=180,
    )
    if not r.ok:
        raise RuntimeError(
            f"Storage 上传失败 HTTP {r.status_code}: {r.text[:500]}"
        )


def load_dotenv_local(repo_root: Path) -> None:
    """合并加载仓库根与 ``opendota-match-ui/.env.local``；同名键以后者为准。"""
    for rel in (".env.local", "opendota-match-ui/.env.local"):
        p = repo_root / rel
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k:
                os.environ[k] = v
