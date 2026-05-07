"""
从 Supabase ``plan_b`` 拉取全量生成 ``public/data/replays_index.json``（不再扫描本地 matches）。

成功写入本地后，若环境变量提供 Supabase 凭据，则**同步上传**到 Storage
``planb-static-data/public/data/replays_index.json``（与 ``build-meta-site-snapshot`` 同桶）。

用法（项目根 PLAB_B）::

  python scripts/build_replays_index.py

需 ``SUPABASE_SERVICE_ROLE_KEY`` 与 ``VITE_SUPABASE_URL``（可放在仓库根或 opendota-match-ui 的 .env.local）。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.match_service import (  # noqa: E402
    FRONTEND_PUBLIC_DATA,
    sync_replays_index_to_cloud_after_plan_b_ingest,
)


def main() -> None:
    n = sync_replays_index_to_cloud_after_plan_b_ingest()
    if n == 0:
        raise SystemExit(
            "plan_b 未产出任何有效索引行（检查 players 是否为空或数据库权限）"
        )
    print("wrote", FRONTEND_PUBLIC_DATA / "replays_index.json", "entries:", n)


if __name__ == "__main__":
    main()
