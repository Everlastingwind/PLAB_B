"""
从 Supabase ``plan_b`` 拉取全量生成 ``public/data/replays_index.json``（不再扫描本地 matches）。

成功写入本地后，若环境变量提供 Supabase 凭据，则**同步上传**到 Storage
``planb-static-data/public/data/replays_index.json``（与 ``build-meta-site-snapshot`` 同桶）。

用法（项目根 PLAB_B）::

  python scripts/build_replays_index.py

需 ``SUPABASE_SERVICE_ROLE_KEY`` 与 ``VITE_SUPABASE_URL``（可放在仓库根或 opendota-match-ui 的 .env.local）。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.match_service import FRONTEND_PUBLIC_DATA, rebuild_replays_index  # noqa: E402
from scripts.upload_planb_static_file import (  # noqa: E402
    load_dotenv_local,
    upload_planb_static_object,
)


def main() -> None:
    load_dotenv_local(ROOT)
    n = rebuild_replays_index()
    if n == 0:
        raise SystemExit(
            "plan_b 未产出任何有效索引行（检查 players 是否为空或数据库权限）"
        )
    print("wrote replays_index.json, entries:", n)

    url_ok = (
        os.environ.get("VITE_SUPABASE_URL", "").strip()
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    )
    if os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip() and url_ok:
        out = FRONTEND_PUBLIC_DATA / "replays_index.json"
        try:
            upload_planb_static_object(
                out,
                object_key="public/data/replays_index.json",
                content_type="application/json; charset=utf-8",
            )
            print(
                "uploaded to Storage: planb-static-data/public/data/replays_index.json"
            )
        except Exception as e:
            print("Storage upload failed:", e, file=sys.stderr)
            raise
    else:
        print(
            "skip Storage upload: set VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to upload"
        )


if __name__ == "__main__":
    main()
