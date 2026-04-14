"""
从 OpenDota /api/proPlayers 拉取职业选手，按指定战队 team_id 过滤，
写入 opendota-match-ui/src/data/proPlayers.ts（供搜索补全、选手页展示）。

用法（项目根 PLAB_B）:
  python scripts/build_seeded_pro_players.py

依赖网络；数据量较大，约数十秒。
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Any, List, Set

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "opendota-match-ui" / "src" / "data" / "proPlayers.ts"
UA = {"User-Agent": "plab-dota/build_seeded_pro_players (+OpenDota)"}

# 用户指定战队（OpenDota team_id）；与 liquipedia_top20_team_ids 对齐时可一并维护
TARGET_TEAM_IDS: Set[int] = {
    8291895,  # Tundra Esports
    9467224,  # Aurora Gaming
    9572001,  # PARIVISION
    9824702,  # PARIVISION (备用/分部)
    9823272,  # Team Yandex
    2163,  # Team Liquid
    9247354,  # Team Falcons
    7119388,  # Team Spirit
    8261500,  # Xtreme Gaming
    8255888,  # BetBoom Team
    36,  # Natus Vincere
    9338413,  # MOUZ
    9303484,  # HEROIC
    7554697,  # Nigma Galaxy
    9964962,  # GamerLegion
    9255039,  # 1w Team
    726228,  # Vici Gaming
    9303383,  # L1GA TEAM
}


def _get(url: str) -> Any:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def _escape_ts_string(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def main() -> None:
    raw = _get("https://api.opendota.com/api/proPlayers")
    if not isinstance(raw, list):
        raise SystemExit("proPlayers response is not a list")

    picked: Dict[int, str] = {}
    for row in raw:
        if not isinstance(row, dict):
            continue
        tid = row.get("team_id")
        try:
            tid_i = int(tid) if tid is not None else 0
        except (TypeError, ValueError):
            continue
        if tid_i not in TARGET_TEAM_IDS:
            continue
        try:
            aid = int(row.get("account_id") or 0)
        except (TypeError, ValueError):
            continue
        if aid <= 0:
            continue
        nm = (row.get("name") or "").strip()
        if not nm:
            nm = (row.get("personaname") or "").strip()
        if not nm:
            continue
        if aid not in picked:
            picked[aid] = nm

    lines: List[str] = [
        "export type SeedProPlayer = {",
        "  accountId: number;",
        "  proName: string;",
        "};",
        "",
        "/**",
        f" * OpenDota proPlayers 按战队过滤生成（{len(TARGET_TEAM_IDS)} 支战队，{len(picked)} 名选手）。",
        " * 重新生成: python scripts/build_seeded_pro_players.py",
        " */",
        "export const SEEDED_PRO_PLAYERS: SeedProPlayer[] = [",
    ]
    for aid in sorted(picked.keys()):
        lines.append(
            f'  {{ accountId: {aid}, proName: "{_escape_ts_string(picked[aid])}" }},'
        )
    lines.append("];")
    lines.extend(
        [
            "",
            "const SEEDED_PRO_BY_ACCOUNT_ID: ReadonlyMap<number, string> = new Map(",
            "  SEEDED_PRO_PLAYERS.map((p) => [p.accountId, p.proName])",
            ");",
            "",
            "/** 种子列表中的注册名（用于选手页标题、是否按职业展示），无则 null */",
            "export function seededProNameForAccount(accountId: number): string | null {",
            "  return SEEDED_PRO_BY_ACCOUNT_ID.get(accountId) ?? null;",
            "}",
            "",
        ]
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {len(picked)} players to {OUT}")


if __name__ == "__main__":
    main()
