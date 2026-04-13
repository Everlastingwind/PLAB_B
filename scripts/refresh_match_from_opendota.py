"""
从 OpenDota 重新拉取指定 match_id 的对局，经 translate_match_data 清洗后写入：
  - data/matches/{match_id}.json
  - opendota-match-ui/public/data/latest_match.json

用于重新生成全员 ability_timeline / talents_taken（技能加点依赖原始 ability_upgrades 字段）。

用法（在项目根 PLAB_B 执行）:
  python scripts/refresh_match_from_opendota.py 7512345678

也可在 FastAPI 启动后调用:
  POST http://127.0.0.1:8000/matches/{match_id}/save
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.match_service import refresh_match_from_opendota  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description="从 OpenDota 刷新对局 JSON（含技能加点）")
    p.add_argument("match_id", type=int, help="比赛 match_id")
    args = p.parse_args()

    try:
        path = refresh_match_from_opendota(args.match_id)
    except urllib.error.HTTPError as e:
        mid = args.match_id
        if e.code == 404:
            print(
                f"OpenDota 无本场数据 (HTTP 404): match_id={mid}\n"
                f"  可在浏览器打开 https://www.opendota.com/matches/{mid} 核对是否收录。\n"
                "  常见原因：对局未公开、未请求解析入库、或 match_id 与录像 epilogue 不一致。"
            )
        else:
            print(f"OpenDota 请求失败: HTTP {e.code} {e.reason!r}")
        sys.exit(1)

    slim = json.loads(path.read_text(encoding="utf-8"))
    players = slim.get("players") or []

    def step_count(pl: dict) -> int:
        return len(pl.get("ability_timeline") or [])

    with_steps = sum(1 for pl in players if step_count(pl) > 0)
    print("已写入:", path)
    print(f"玩家数: {len(players)}，含非空 ability_timeline: {with_steps}")

    for pl in players:
        slot = pl.get("player_slot")
        name = pl.get("personaname") or pl.get("name") or "-"
        n = step_count(pl)
        print(f"  slot {slot} {name}: {n} 条加点")


if __name__ == "__main__":
    main()
