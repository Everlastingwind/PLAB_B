"""
从 utils/.dota_cache 的 dotaconstants JSON 导出前端用 entity_maps.json
（英雄 ID / 物品 ID / 技能 ID -> key、英文名、中文名、技能图路径）

用法（在项目根 PLAB_B 执行）:
  python scripts/export_entity_maps.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

OUT = ROOT / "opendota-match-ui" / "public" / "data" / "entity_maps.json"
CACHE = ROOT / "utils" / ".dota_cache"
ZH_HEROES = ROOT / "utils" / "dota_zh" / "heroes_by_id.json"
ZH_ABILITIES = ROOT / "utils" / "dota_zh" / "abilities_by_key.json"


def main() -> None:
    heroes_path = CACHE / "heroes.json"
    items_path = CACHE / "items.json"
    item_ids_path = CACHE / "item_ids.json"
    abilities_path = CACHE / "abilities.json"
    ability_ids_path = CACHE / "ability_ids.json"
    if not heroes_path.is_file():
        print("缺少", heroes_path, "请先运行: python utils/dota_mapping.py")
        sys.exit(1)

    heroes_raw = json.loads(heroes_path.read_text(encoding="utf-8"))
    items_raw = json.loads(items_path.read_text(encoding="utf-8"))
    item_ids_raw = json.loads(item_ids_path.read_text(encoding="utf-8"))
    abilities_raw: dict = {}
    ability_ids_raw: dict = {}
    if abilities_path.is_file() and ability_ids_path.is_file():
        abilities_raw = json.loads(abilities_path.read_text(encoding="utf-8"))
        ability_ids_raw = json.loads(ability_ids_path.read_text(encoding="utf-8"))
        if not isinstance(abilities_raw, dict):
            abilities_raw = {}
        if not isinstance(ability_ids_raw, dict):
            ability_ids_raw = {}

    zh: dict[str, str] = {}
    if ZH_HEROES.is_file():
        zh = json.loads(ZH_HEROES.read_text(encoding="utf-8"))

    zh_ab: dict[str, str] = {}
    if ZH_ABILITIES.is_file():
        raw_ab = json.loads(ZH_ABILITIES.read_text(encoding="utf-8"))
        if isinstance(raw_ab, dict):
            zh_ab = {str(k): str(v) for k, v in raw_ab.items()}

    heroes_out: dict[str, dict[str, str]] = {}
    for _, h in heroes_raw.items():
        hid = str(h.get("id"))
        name = h.get("name") or ""
        key = name.replace("npc_dota_hero_", "") if "npc_dota_hero_" in name else name
        heroes_out[hid] = {
            "key": key,
            "nameEn": str(h.get("localized_name") or ""),
            "nameCn": zh.get(hid) or str(h.get("localized_name") or ""),
        }

    items_out: dict[str, dict[str, str]] = {}
    for sid, ikey in item_ids_raw.items():
        if "," in sid:
            continue
        it = items_raw.get(ikey)
        if not it:
            continue
        items_out[sid] = {
            "key": ikey,
            "nameEn": str(it.get("dname") or ikey),
            "nameCn": str(it.get("dname") or ikey),
        }

    abilities_out: dict[str, dict[str, str]] = {}
    for sid, akey in ability_ids_raw.items():
        if "," in str(sid):
            continue
        if not isinstance(akey, str) or not akey:
            continue
        ab = abilities_raw.get(akey)
        if isinstance(ab, dict):
            dname = str(ab.get("dname") or akey)
            img = str(ab.get("img") or "").strip()
        else:
            dname = akey
            img = ""
        abilities_out[str(sid)] = {
            "key": akey,
            "nameEn": dname,
            "nameCn": zh_ab.get(akey) or "",
            "img": img,
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload: dict = {
        "heroes": heroes_out,
        "items": items_out,
        "source": "dotaconstants",
    }
    if abilities_out:
        payload["abilities"] = abilities_out
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    na = len(abilities_out) if abilities_out else 0
    print("Wrote", OUT, "heroes", len(heroes_out), "items", len(items_out), "abilities", na)


if __name__ == "__main__":
    main()
