"""读取 Supabase `site_settings`（id=1）中的当前补丁号，供上传脚本使用。"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict


def fetch_site_settings_row() -> Dict[str, Any]:
    url = (
        os.environ.get("VITE_SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or os.environ.get("SUPABASE_URL")
        or ""
    ).strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        raise RuntimeError(
            "缺少环境变量：需 VITE_SUPABASE_URL（或 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL）"
            " 与 SUPABASE_SERVICE_ROLE_KEY，以读取 site_settings"
        )
    rest = f"{url.rstrip('/')}/rest/v1/site_settings?id=eq.1&select=current_patch,previous_patch"
    req = urllib.request.Request(
        rest,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"读取 site_settings HTTP {e.code}: {body[:500]}") from e
    data = json.loads(raw)
    if not isinstance(data, list) or len(data) < 1:
        raise RuntimeError(
            "site_settings 无 id=1 行：请在 Supabase 执行 opendota-match-ui/supabase/site_settings.sql"
        )
    return data[0] if isinstance(data[0], dict) else {}


def fetch_current_patch() -> str:
    row = fetch_site_settings_row()
    cp = str(row.get("current_patch") or "").strip()
    if not cp:
        raise RuntimeError("site_settings.current_patch 为空")
    return cp
