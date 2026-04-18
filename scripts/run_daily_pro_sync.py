"""
每天执行一次「职业对局同步到网站 pro 选项」。

流程：
1) 运行 ``scripts/fetch_pro_replays_index.py``（按 top20 战队抓取 OpenDota 职业赛）；
2) 可选：自动 git add / commit / push 到远端（触发网站部署）。

用法（项目根 PLAB_B）::

  python scripts/run_daily_pro_sync.py --manual
  python scripts/run_daily_pro_sync.py --manual --push
  python scripts/run_daily_pro_sync.py --manual --push --remote origin --branch main

可用环境变量：
- ``PRO_FETCH_LIMIT``：单次抓取场次上限（默认 12，建议定时任务设为 20~40）。
- ``PRO_PATCH_ID``：仅抓指定 patch 的职业对局。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parents[1]
FETCH_SCRIPT = ROOT / "scripts" / "fetch_pro_replays_index.py"
PRO_INDEX_PATH = ROOT / "opendota-match-ui" / "public" / "data" / "pro_replays_index.json"
MATCH_DIR = ROOT / "opendota-match-ui" / "public" / "data" / "matches"


def _run(cmd: List[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )


def _print_proc(name: str, proc: subprocess.CompletedProcess[str]) -> None:
    if proc.stdout.strip():
        print(f"[{name}] stdout:")
        print(proc.stdout.strip())
    if proc.stderr.strip():
        print(f"[{name}] stderr:")
        print(proc.stderr.strip())


def _read_fetched_count() -> int:
    if not PRO_INDEX_PATH.is_file():
        return 0
    try:
        blob = json.loads(PRO_INDEX_PATH.read_text(encoding="utf-8"))
        meta = blob.get("_meta") if isinstance(blob, dict) else None
        return int((meta or {}).get("fetched_matches") or 0)
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return 0


def _has_staged_changes(cwd: Path) -> bool:
    proc = _run(["git", "diff", "--cached", "--name-only"], cwd=cwd)
    return bool(proc.stdout.strip())


def main() -> None:
    ap = argparse.ArgumentParser(description="抓取职业赛并可选自动推送到网站仓库")
    ap.add_argument(
        "--manual",
        action="store_true",
        help="确认这是手动触发；未传时脚本将直接退出，不执行每日自动同步",
    )
    ap.add_argument("--push", action="store_true", help="抓取后自动 git add/commit/push")
    ap.add_argument("--remote", default="origin", help="git 远端名（默认 origin）")
    ap.add_argument("--branch", default="main", help="git 分支名（默认 main）")
    args = ap.parse_args()

    if not args.manual:
        print("已暂停每日自动职业赛同步；如需手动执行，请显式传入 --manual。")
        return

    if not FETCH_SCRIPT.is_file():
        raise SystemExit(f"找不到脚本: {FETCH_SCRIPT}")

    fetch = _run([sys.executable, str(FETCH_SCRIPT)], cwd=ROOT)
    _print_proc("fetch_pro_replays_index", fetch)
    if fetch.returncode != 0:
        raise SystemExit(fetch.returncode)

    fetched = _read_fetched_count()
    print(f"抓取完成: fetched_matches={fetched}")

    if not args.push:
        return

    add = _run(
        [
            "git",
            "add",
            str(PRO_INDEX_PATH),
            str(MATCH_DIR),
        ],
        cwd=ROOT,
    )
    _print_proc("git add", add)
    if add.returncode != 0:
        raise SystemExit(add.returncode)

    if not _has_staged_changes(ROOT):
        print("无变更可提交，跳过 commit/push。")
        return

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    msg = (
        "chore(pro): daily sync top20 pro matches\n\n"
        f"- fetched_matches={fetched}\n"
        f"- generated_at={now}"
    )
    commit = _run(["git", "commit", "-m", msg], cwd=ROOT)
    _print_proc("git commit", commit)
    if commit.returncode != 0:
        raise SystemExit(commit.returncode)

    push = _run(["git", "push", args.remote, args.branch], cwd=ROOT)
    _print_proc("git push", push)
    if push.returncode != 0:
        raise SystemExit(push.returncode)

    print("已推送到远端，网站部署（若已绑定）将自动开始。")


if __name__ == "__main__":
    main()
