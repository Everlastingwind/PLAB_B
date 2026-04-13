#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 DotaParser 等产出的 ``batch_output.json`` 中**仅读取装备字段**（players[].items、neutral_item），
转成 OpenDota 风格 ``item_0..item_5`` / ``item_neutral``，经 ``merge_endgame_inventory_from_api_players``
合并进已有 slim，并 ``save_uploaded_match_slim`` 写入前端（与 dem 管线 --inventory-overlay 等价思路）。

输入 JSON 支持：
  - 数组：[ { "match_id", "players": [ { "player_slot", "items": [...], "neutral_item", ... } ] }, ... ]
  - 或单个比赛对象。

装备格可为：整数 item id、数字字符串、或 item 内部名（如 blink / item_blink，依赖本地 item_ids 缓存）。

用法（PLAB_B 根目录）::
  python scripts/merge_batch_output_inventory.py e:/DotaParser/batch_output.json
  python scripts/merge_batch_output_inventory.py e:/DotaParser/batch_output.json --slim opendota-match-ui/public/data/matches/8768921787.json
  python scripts/merge_batch_output_inventory.py e:/DotaParser/batch_output.json -o out/overlay_only.json --overlay-only
  python scripts/merge_batch_output_inventory.py e:/DotaParser/batch_output.json --post-api
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_dem_merge_module():
    dem = Path(__file__).resolve().parent / "dem_result_to_slim_match.py"
    spec = importlib.util.spec_from_file_location("_dem_slim_merge", dem)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 dem_result_to_slim_match.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _item_token_to_id(dc, tok: Any) -> int:
    if tok is None:
        return 0
    if isinstance(tok, bool):
        return 0
    if isinstance(tok, (int, float)):
        i = int(tok)
        return i if i > 0 else 0
    s = str(tok).strip()
    if not s:
        return 0
    try:
        i = int(s, 10)
        return i if i > 0 else 0
    except ValueError:
        pass
    jk = dc.resolve_items_json_key(s)
    if not jk and not s.startswith("item_"):
        jk = dc.resolve_items_json_key("item_" + s)
    if not jk:
        jk = dc.resolve_items_json_key(s.lower())
    if jk:
        for sid, internal in dc.item_ids.items():
            inm = str(internal).strip()
            if dc.resolve_items_json_key(inm) == jk:
                try:
                    return int(sid)
                except (TypeError, ValueError):
                    continue
    for sid, internal in dc.item_ids.items():
        if str(internal).strip() == s:
            try:
                return int(sid)
            except (TypeError, ValueError):
                continue
    return 0


def _overlay_rows_from_batch_players(
    dc, players: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for bp in players:
        if not isinstance(bp, dict):
            continue
        try:
            ps = int(bp.get("player_slot", -1))
        except (TypeError, ValueError):
            continue
        if ps < 0:
            continue
        row: Dict[str, Any] = {
            "player_slot": ps,
            "account_id": int(bp.get("account_id") or 0),
            "hero_id": int(bp.get("hero_id") or 0),
        }
        items = bp.get("items")
        if isinstance(items, list):
            for i in range(6):
                tok = items[i] if i < len(items) else None
                row[f"item_{i}"] = _item_token_to_id(dc, tok)
        else:
            for i in range(6):
                row[f"item_{i}"] = 0
        neu = bp.get("neutral_item")
        if neu is None and "item_neutral" in bp:
            neu = bp.get("item_neutral")
        row["item_neutral"] = _item_token_to_id(dc, neu)
        out.append(row)
    return out


def _overlay_has_any_item(rows: List[Dict[str, Any]]) -> bool:
    for r in rows:
        for i in range(6):
            try:
                if int(r.get(f"item_{i}") or 0) > 0:
                    return True
            except (TypeError, ValueError):
                pass
        try:
            if int(r.get("item_neutral") or 0) > 0:
                return True
        except (TypeError, ValueError):
            pass
    return False


def load_batch_matches(path: Path) -> List[Dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        if isinstance(raw.get("matches"), list):
            return [x for x in raw["matches"] if isinstance(x, dict)]
        return [raw]
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    raise SystemExit(f"不支持的 JSON 根类型: {type(raw).__name__}")


def default_slim_path(match_id: int) -> Path:
    return (
        ROOT
        / "opendota-match-ui"
        / "public"
        / "data"
        / "matches"
        / f"{int(match_id)}.json"
    )


def main() -> None:
    ap = argparse.ArgumentParser(
        description="从 batch_output.json 只读装备并合并进 slim / 上传",
    )
    ap.add_argument(
        "batch_json",
        type=Path,
        help="batch_output.json 路径",
    )
    ap.add_argument(
        "--slim",
        type=Path,
        default=None,
        help="已有 slim 比赛 JSON；默认 public/data/matches/{match_id}.json",
    )
    ap.add_argument(
        "--match-id",
        type=int,
        default=None,
        help="指定场次（batch 内多场时必填）",
    )
    ap.add_argument(
        "-o",
        "--out-overlay",
        type=Path,
        default=None,
        help="另存装备 overlay JSON（endgame_inventory_overlay_v1）",
    )
    ap.add_argument(
        "--overlay-only",
        action="store_true",
        help="只写出 overlay，不读 slim、不写入前端",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="打印摘要，不写文件、不 POST",
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="即使装备全空也执行合并（会用空栏覆盖 slim，慎用）",
    )
    ap.add_argument(
        "--post-api",
        action="store_true",
        help="合并后 POST 完整 slim 到 batch_processor 配置的 API（需 TOKEN）",
    )
    args = ap.parse_args()

    from utils.dota_mapping import get_constants

    get_constants().load()
    dc = get_constants()

    matches = load_batch_matches(args.batch_json)
    if not matches:
        raise SystemExit("batch 中无比赛对象")

    picked: Optional[Dict[str, Any]] = None
    if args.match_id is not None:
        mid = int(args.match_id)
        for m in matches:
            try:
                if int(m.get("match_id") or 0) == mid:
                    picked = m
                    break
            except (TypeError, ValueError):
                continue
        if picked is None:
            raise SystemExit(f"batch 中未找到 match_id={mid}")
    elif len(matches) == 1:
        picked = matches[0]
    else:
        raise SystemExit("batch 含多场，请指定 --match-id")

    assert picked is not None
    try:
        match_id = int(picked.get("match_id") or 0)
    except (TypeError, ValueError):
        match_id = 0
    if match_id <= 0:
        raise SystemExit("比赛对象缺少有效 match_id")

    players_raw = picked.get("players")
    if not isinstance(players_raw, list) or not players_raw:
        raise SystemExit("该场无 players 数组")

    overlay_players = _overlay_rows_from_batch_players(dc, players_raw)
    if not overlay_players:
        raise SystemExit("未能从 players 提取任何装备行")

    if not _overlay_has_any_item(overlay_players) and not args.force:
        raise SystemExit(
            "batch 中装备数据全空（items / neutral_item 无有效 id）。"
            "若仍要覆盖 slim，请加 --force"
        )

    duration = picked.get("duration")
    overlay_doc: Dict[str, Any] = {
        "format": "endgame_inventory_overlay_v1",
        "match_id": match_id,
        "source": "dota_parser_batch_output",
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "duration": duration,
        "players": overlay_players,
    }

    if args.out_overlay:
        args.out_overlay.parent.mkdir(parents=True, exist_ok=True)
        if not args.dry_run:
            args.out_overlay.write_text(
                json.dumps(overlay_doc, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        print("overlay:", args.out_overlay.resolve())

    if args.overlay_only:
        if args.dry_run:
            print("[dry-run] overlay-only，未写文件")
        print("match_id=", match_id, "players=", len(overlay_players))
        return

    slim_path = args.slim or default_slim_path(match_id)
    if not slim_path.is_file():
        raise SystemExit(
            f"找不到 slim 文件: {slim_path}\n"
            f"请先生成该场 slim，或用 --slim 指定路径。"
        )

    slim = json.loads(slim_path.read_text(encoding="utf-8"))
    if int(slim.get("match_id") or 0) != match_id:
        print(
            "警告: slim.match_id 与 batch match_id 不一致",
            slim.get("match_id"),
            match_id,
            flush=True,
        )

    mod = _load_dem_merge_module()
    merge_fn = mod.merge_endgame_inventory_from_api_players
    try:
        di = int(duration) if duration is not None else int(slim.get("duration") or 0)
    except (TypeError, ValueError):
        di = int(slim.get("duration") or 0)

    if args.dry_run:
        print("[dry-run] 将合并装备:", slim_path)
        print("match_id=", match_id, "overlay_players=", len(overlay_players))
        return

    ok, msg = merge_fn(
        slim,
        overlay_players,
        duration=di,
        source_meta=f"batch_output:{args.batch_json.name}",
    )
    print("合并装备:", "ok" if ok else "fail", msg, flush=True)
    if not ok:
        raise SystemExit(1)

    from backend.match_service import save_uploaded_match_slim

    out_path = save_uploaded_match_slim(slim)
    print("已写入:", out_path, flush=True)

    if args.post_api:
        try:
            from batch_processor import API_ENDPOINT, API_TOKEN, _upload_match_json
        except ImportError as e:
            raise SystemExit(f"--post-api 需要 batch_processor: {e}") from e
        if not (API_TOKEN and str(API_TOKEN).strip()):
            raise SystemExit("未配置 API_TOKEN，无法 POST")
        _upload_match_json(slim)
        print("已 POST", API_ENDPOINT, flush=True)


if __name__ == "__main__":
    main()
