"""
OpenDota / dotaconstants 数据映射：下载常量、解析比赛 JSON 为带中文与 CDN 链接的精简结构。
"""

from __future__ import annotations

import json
import os
import urllib.request
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Tuple, Union

# -----------------------------------------------------------------------------
# 配置
# -----------------------------------------------------------------------------

DOTACONSTANTS_BUILD_BASE = (
    "https://raw.githubusercontent.com/odota/dotaconstants/master/build"
)

DEFAULT_CACHE_DIR = Path(__file__).resolve().parent / ".dota_cache"

STEAM_CDN_BASE = "https://cdn.cloudflare.steamstatic.com"

# 与 utils/dota_zh 下的可选中文覆盖表
_DEFAULT_ZH_DIR = Path(__file__).resolve().parent / "dota_zh"

# 从玩家对象中剔除的体积较大、一般前端不直接展示的原生字段
_HEAVY_PLAYER_KEYS = frozenset(
    {
        "purchase_log",
        "lane_pos",
        "obs",
        "sen",
        "obs_log",
        "sen_log",
        "kills_log",
        "runes_log",
        "connection_log",
        "life_state",
        "max_hero_hit",
        "observer_uses",
        "sentry_uses",
        "cosmetics",
        "neutral_tokens_log",
    }
)


def _http_download(url: str, dest: Path, timeout: int = 120) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "plab-dota-mapping/1.0 (+https://github.com/odota/dotaconstants)",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    dest.write_bytes(data)


def download_dotaconstants_build(
    cache_dir: Optional[Path] = None,
    *,
    extra_files: Optional[Iterable[str]] = None,
) -> Path:
    """
    从 odota/dotaconstants/build 拉取最新 JSON 到本地缓存目录。

    默认下载：heroes, items, abilities；并额外下载 ability_ids、item_ids（解析对局必需）。

    加点映射依赖（两步：数字 ID → 内部名 → 详情）::

      - https://raw.githubusercontent.com/odota/dotaconstants/master/build/ability_ids.json
      - https://raw.githubusercontent.com/odota/dotaconstants/master/build/abilities.json

    实际 URL 使用 ``DOTACONSTANTS_BUILD_BASE`` + 文件名。
    """
    root = Path(cache_dir or os.environ.get("DOTA_CONSTANTS_CACHE") or DEFAULT_CACHE_DIR)
    root.mkdir(parents=True, exist_ok=True)

    base_files = ["heroes.json", "items.json", "abilities.json"]
    extra = (
        list(extra_files)
        if extra_files is not None
        else ["ability_ids.json", "item_ids.json", "hero_abilities.json"]
    )
    for name in base_files + extra:
        url = f"{DOTACONSTANTS_BUILD_BASE}/{name}"
        dest = root / name
        _http_download(url, dest)
    return root


def steam_asset_url(path: Optional[str]) -> str:
    """dotaconstants 中的 /apps/dota2/... 相对路径 -> Steam CDN 绝对 URL。"""
    if not path:
        return ""
    p = path.split("?", 1)[0].strip()
    if p.startswith("http://") or p.startswith("https://"):
        return p
    if not p.startswith("/"):
        p = "/" + p
    return f"{STEAM_CDN_BASE}{p}"


def _load_json_path(path: Path) -> Any:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


class DotaConstants:
    """内存中的 heroes/items/abilities 及 ID 映射表。"""

    def __init__(
        self,
        cache_dir: Optional[Path] = None,
        zh_dir: Optional[Path] = None,
    ) -> None:
        self.cache_dir = Path(cache_dir or os.environ.get("DOTA_CONSTANTS_CACHE") or DEFAULT_CACHE_DIR)
        self.zh_dir = Path(zh_dir or os.environ.get("DOTA_ZH_DIR") or _DEFAULT_ZH_DIR)

        self.heroes: Dict[str, Any] = {}
        self.items: Dict[str, Any] = {}
        self.abilities: Dict[str, Any] = {}
        self.item_ids: Dict[str, str] = {}
        self.ability_ids: Dict[str, str] = {}

        self.heroes_zh_by_id: Dict[str, str] = {}
        self.items_zh_by_key: Dict[str, str] = {}
        self.abilities_zh_by_key: Dict[str, str] = {}

        self._hero_by_numeric_id: Dict[int, MutableMapping[str, Any]] = {}

    def load(self) -> None:
        """从 cache_dir 读取 JSON；若不存在则自动下载。"""
        need = [
            "heroes.json",
            "items.json",
            "abilities.json",
            "item_ids.json",
            "ability_ids.json",
            "hero_abilities.json",
        ]
        missing = [n for n in need if not (self.cache_dir / n).is_file()]
        if missing:
            download_dotaconstants_build(self.cache_dir)

        self.heroes = _load_json_path(self.cache_dir / "heroes.json") or {}
        self.items = _load_json_path(self.cache_dir / "items.json") or {}
        self.abilities = _load_json_path(self.cache_dir / "abilities.json") or {}
        self.item_ids = _load_json_path(self.cache_dir / "item_ids.json") or {}
        self.ability_ids = _load_json_path(self.cache_dir / "ability_ids.json") or {}

        for hk, hv in self.heroes.items():
            try:
                hid = int(hv.get("id", hk))
            except (TypeError, ValueError):
                continue
            self._hero_by_numeric_id[hid] = hv

        zh_heroes = _load_json_path(self.zh_dir / "heroes_by_id.json")
        if isinstance(zh_heroes, dict):
            self.heroes_zh_by_id = {str(k): str(v) for k, v in zh_heroes.items()}

        zh_items = _load_json_path(self.zh_dir / "items_by_key.json")
        if isinstance(zh_items, dict):
            self.items_zh_by_key = {str(k): str(v) for k, v in zh_items.items()}

        zh_abi = _load_json_path(self.zh_dir / "abilities_by_key.json")
        if isinstance(zh_abi, dict):
            self.abilities_zh_by_key = {str(k): str(v) for k, v in zh_abi.items()}

    def hero_by_id(self, hero_id: int) -> Optional[MutableMapping[str, Any]]:
        return self._hero_by_numeric_id.get(int(hero_id))

    def item_key_from_id(self, item_id: int) -> Optional[str]:
        if item_id is None or int(item_id) <= 0:
            return None
        return self.item_ids.get(str(int(item_id)))

    def resolve_items_json_key(self, raw: Optional[str]) -> Optional[str]:
        """
        ``item_ids`` 映射得到的内部名 → ``items.json`` 顶层 key。
        若带 ``item_`` 前缀而 ``items`` 中无此 key，则尝试去掉前缀（两表命名不完全一致时）。
        """
        if not raw:
            return None
        k = str(raw).strip()
        if not k:
            return None
        if k in self.items:
            return k
        if k.startswith("item_"):
            rest = k[5:]
            if rest in self.items:
                return rest
        return None

    def resolve_abilities_json_key(self, raw: Optional[str]) -> Optional[str]:
        """``ability_ids`` → ``abilities.json`` 顶层 key（必要时微调前缀）。"""
        if not raw:
            return None
        k = str(raw).strip()
        if not k:
            return None
        if k in self.abilities:
            return k
        if k.startswith("ability_") and k[8:] in self.abilities:
            return k[8:]
        return None

    def ability_key_from_id(self, ability_id: int) -> Optional[str]:
        aid = abs(int(ability_id))
        key = self.ability_ids.get(str(aid))
        if key:
            return key
        # 极少数条目使用组合键（如 "3060,1617"），遍历匹配末尾
        for k, v in self.ability_ids.items():
            if "," in k:
                continue
            try:
                if int(k) == aid:
                    return v
            except ValueError:
                continue
        return None

    def item_display(self, item_key: Optional[str]) -> Tuple[str, str, str]:
        """返回 (英文名 dname, 中文名, CDN 图 URL)。始终经 ``resolve_items_json_key`` 查表。"""
        lk = self.resolve_items_json_key(item_key)
        if not lk:
            return ("", "", "")
        it = self.items[lk]
        dname = str(it.get("dname") or lk)
        img = steam_asset_url(it.get("img"))
        cn = self.items_zh_by_key.get(lk) or dname
        return (dname, cn, img)

    def ability_display(self, ability_key: Optional[str]) -> Tuple[str, str, str]:
        ak = self.resolve_abilities_json_key(ability_key)
        if not ak:
            return ("", "", "")
        ab = self.abilities[ak]
        dname = str(ab.get("dname") or ak)
        img = steam_asset_url(ab.get("img"))
        cn = self.abilities_zh_by_key.get(ak) or dname
        return (dname, cn, img)


_GLOBAL: Optional[DotaConstants] = None


def get_constants() -> DotaConstants:
    global _GLOBAL
    if _GLOBAL is None:
        _GLOBAL = DotaConstants()
        _GLOBAL.load()
    return _GLOBAL


def reset_constants() -> None:
    """测试或强制重新加载常量时调用。"""
    global _GLOBAL
    _GLOBAL = None


def logical_player_slot(val: Any) -> Optional[int]:
    """
    OpenDota player_slot：0–4 / 5–9 或 128–132（Dire）→ 逻辑位序 0–9。
    """
    if val is None:
        return None
    try:
        v = int(val)
    except (TypeError, ValueError):
        return None
    if 128 <= v <= 132:
        return v - 128 + 5
    if 0 <= v <= 9:
        return v
    return None


def _is_talent_key(ability_key: Optional[str]) -> bool:
    if not ability_key:
        return False
    k = ability_key.lower()
    return "special_bonus" in k or k.startswith("ad_special_bonus")


def is_talent_ability(
    ability_key: Optional[str],
    ability_row: Optional[Mapping[str, Any]],
) -> bool:
    """
    是否为天赋：优先看 ability_key（与 abilities.json 顶层 key 一致，多为 special_bonus_*），
    其次看条目内 name 字段是否包含 special_bonus（与 abilities.json 对齐）。
    """
    if ability_key and _is_talent_key(ability_key):
        return True
    if not ability_row:
        return False
    nm = str(ability_row.get("name") or "").lower()
    return "special_bonus" in nm


def _looks_like_interleaved_id_time(
    nums: List[int],
    *,
    match_duration_sec: Optional[int] = None,
) -> bool:
    """
    区分纯 ability_id 列表与 [id, game_time_sec, ...] 交错格式。

    注意：游戏内时间与 ability 数字 ID 同处 4xxx~7xxx 区间，易误判。
    若假定交错后「时间」列任一数超过对局时长（或超过 2 小时），则判定为**纯 ID 列表**。
    """
    n = len(nums)
    if n < 16 or n % 2 != 0:
        return False
    times_ = [nums[i] for i in range(1, n, 2)]
    ids_ = [nums[i] for i in range(0, n, 2)]
    if len(times_) < 8:
        return False
    # 纯 ability_id 列表（偶数位、奇数位皆是 ID）时，「假时间」多为 4xxx–7xxx；
    # 真实录像时间前几手几乎总含 <400s 的秒数；据此避免误判成交错 id+time。
    if times_ and min(times_) > 400:
        return False
    if max(times_) > 250_000:
        return False
    if min(ids_) < 80:
        return False
    # 真实「秒」不可能超过对局时长太多；否则奇数位实为另一个 ability id（常见于纯 20 个 ID）
    max_plausible_sec = 7200
    if match_duration_sec is not None and match_duration_sec > 0:
        max_plausible_sec = min(7200, int(match_duration_sec) + 180)
    if max(times_) > max_plausible_sec:
        return False
    bad_mono = sum(
        1 for i in range(len(times_) - 1) if times_[i + 1] + 20 < times_[i]
    )
    return bad_mono <= max(2, len(times_) // 8)


def _parse_ability_upgrade_pairs(raw: Any) -> List[Dict[str, Any]]:
    """
    解析 OpenDota 的 ability_upgrades_arr（integer[]）。

    存储为交错数组：[ability_id, game_time_sec, ability_id, game_time_sec, ...]。
    若长度为奇数，最后一个数视为仅有 ability_id（无时间）。
    """
    if not raw or not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    i = 0
    n = len(raw)
    while i < n:
        try:
            a = int(raw[i])
        except (TypeError, ValueError):
            i += 1
            continue
        if i + 1 < n:
            try:
                b = int(raw[i + 1])
            except (TypeError, ValueError):
                out.append({"ability_id": abs(a), "time": None})
                i += 1
                continue
            out.append({"ability_id": abs(a), "time": b})
            i += 2
        else:
            out.append({"ability_id": abs(a), "time": None})
            i += 1
    return out


def _parse_ability_upgrades_objects(raw: Any) -> List[Dict[str, Any]]:
    if not raw or not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        aid = row.get("ability") if "ability" in row else row.get("ability_id")
        if aid is None:
            continue
        try:
            ai = abs(int(aid))
        except (TypeError, ValueError):
            continue
        t = row.get("time")
        try:
            ti = int(t) if t is not None else None
        except (TypeError, ValueError):
            ti = None
        out.append({"ability_id": ai, "time": ti, "level": row.get("level")})
    return out


def _sort_upgrades(merged: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def sort_key(x: Dict[str, Any]) -> Tuple[int, int]:
        t = x.get("time")
        if t is None:
            return (1, 10**9)
        return (0, int(t))

    merged.sort(key=sort_key)
    return merged


def raw_ability_upgrades_arr_to_merged_steps(
    raw: Any,
    *,
    match_duration_sec: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    ability_upgrades_arr 可能是：
    - 纯 ability_id 列表（按加点顺序；第 i 个元素对应第 i+1 级技能点）；
    - 少数工具产出的交错 [ability_id, game_time_sec, ...]。

    ``match_duration_sec``：对局时长（秒），用于避免把纯 ID 列误判为交错格式。
    """
    if not raw or not isinstance(raw, list) or not raw:
        return []
    try:
        nums = [int(x) for x in raw]
    except (TypeError, ValueError):
        return []
    n = len(nums)
    if n >= 16 and n % 2 == 0 and _looks_like_interleaved_id_time(
        nums, match_duration_sec=match_duration_sec
    ):
        pairs = _parse_ability_upgrade_pairs(raw)
        if len(pairs) >= 8:
            return _sort_upgrades(pairs)
    return [{"ability_id": abs(x), "time": None} for x in nums]


def _drop_null_time_when_aid_has_timed_version(
    steps: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    OpenDota 常同时返回 ability_upgrades（带 time）与 ability_upgrades_arr（无 time）。
    合并后同一 ability_id 会出现 (id, T) 与 (id, None) 两条；后者为重复，应丢弃，
    否则 merged 长度超过 25，skill_build 截断 [:25] 会丢掉真实加点（含 10 级天赋）。
    注意：同一技能多点仍为多行同 id 且均带 time，不会被误删。
    """
    timed_aids: set[int] = set()
    for s in steps:
        try:
            aid = int(s["ability_id"])
        except (KeyError, TypeError, ValueError):
            continue
        if s.get("time") is not None:
            timed_aids.add(aid)
    out: List[Dict[str, Any]] = []
    for s in steps:
        try:
            aid = int(s["ability_id"])
        except (KeyError, TypeError, ValueError):
            continue
        if s.get("time") is None and aid in timed_aids:
            continue
        out.append(s)
    return out


def merge_upgrade_steps_for_skill_build(
    objs: List[Dict[str, Any]],
    arr_steps: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    生成与客户端一致的加点顺序。

    当 ability_upgrades_arr 解析为「每步均无 time」的纯序列时，其顺序即录像/解析器权威顺序；
    若再与 ability_upgrades 中带 time 的对象合并后按时间排序，会把无 time 的整段挤到末尾，
    skill_build 前几级错乱。此时仅采用 arr_steps。
    """
    if (
        arr_steps
        and objs
        and all(s.get("time") is None for s in arr_steps)
    ):
        return list(arr_steps)
    return _merge_ability_upgrade_sources(objs, arr_steps)


def _merge_ability_upgrade_sources(
    objs: List[Dict[str, Any]],
    pairs: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    合并 ability_upgrades（对象数组）与 ability_upgrades_arr（交错 id/time）解析结果。
    二者仅取其一若另一为空；若均非空则合并并按 (ability_id, time) 去重，避免漏项或重复。
    """
    if not objs:
        return _sort_upgrades(list(pairs))
    if not pairs:
        return _sort_upgrades(list(objs))
    seen: set[Tuple[int, Optional[int]]] = set()
    out: List[Dict[str, Any]] = []
    for step in objs + pairs:
        try:
            aid = int(step["ability_id"])
        except (KeyError, TypeError, ValueError):
            continue
        t = step.get("time")
        try:
            ti: Optional[int] = int(t) if t is not None else None
        except (TypeError, ValueError):
            ti = None
        key = (aid, ti)
        if key in seen:
            continue
        seen.add(key)
        out.append(dict(step))
    out = _drop_null_time_when_aid_has_timed_version(out)
    return _sort_upgrades(out)


def merge_ability_upgrade_step_lists(
    primary: Optional[List[Dict[str, Any]]],
    secondary: Optional[List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """
    合并「players.ability_upgrades_arr」解析结果与「事件流 ability_upgrade」解析结果。
    每项为 ``{ "ability_id": int, "time"?: int }``。任一侧为空则返回另一侧；均非空时按
    ``(ability_id, time)`` 去重后排序。用于 DEM 管线：避免仅有 arr 时丢掉事件流里的天赋加点。
    """
    a = [dict(x) for x in primary] if primary else []
    b = [dict(x) for x in secondary] if secondary else []
    return _merge_ability_upgrade_sources(a, b)


def _read_hud_item_slot_index(cell: Any) -> Optional[int]:
    if not isinstance(cell, dict) or "slot" not in cell:
        return None
    try:
        si = int(cell["slot"])  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if si < 0 or si > 16:
        return None
    return si


def _items_slot_list_uses_physical_indices(items_slot: Any) -> bool:
    if not isinstance(items_slot, list):
        return False
    for cell in items_slot:
        if _read_hud_item_slot_index(cell) is not None:
            return True
    return False


def _hydrate_player_item_scalars_from_hud_items_slot(
    player: MutableMapping[str, Any],
) -> None:
    isl = player.get("items_slot")
    if not isinstance(isl, list) or not isl:
        return
    if not _items_slot_list_uses_physical_indices(isl):
        return
    for s in range(6):
        player[f"item_{s}"] = 0
    # 仅在 items_slot 里出现 6..8 / 16 时才覆盖；否则保留上游已写的 backpack_* / item_neutral。
    backpack_vals = []
    for s in range(3):
        try:
            backpack_vals.append(int(player.get(f"backpack_{s}") or 0))
        except (TypeError, ValueError):
            backpack_vals.append(0)
    try:
        neutral_val = int(player.get("item_neutral") or 0)
    except (TypeError, ValueError):
        neutral_val = 0

    for cell in isl:
        if not isinstance(cell, dict):
            continue
        si = _read_hud_item_slot_index(cell)
        if si is None:
            continue
        if cell.get("empty") is True:
            iid = 0
        else:
            try:
                iid = int(cell.get("item_id") or 0)
            except (TypeError, ValueError):
                iid = 0
        if not str(cell.get("item_key") or "").strip() and iid <= 0:
            iid = 0
        if 0 <= si <= 5:
            player[f"item_{si}"] = iid
        elif 6 <= si <= 8:
            backpack_vals[si - 6] = iid
        elif si == 16:
            neutral_val = iid
    for s in range(3):
        player[f"backpack_{s}"] = int(backpack_vals[s])
    player["item_neutral"] = int(neutral_val)


def _player_main_item_scalars_all_empty(player: Mapping[str, Any]) -> bool:
    for i in range(6):
        try:
            if int(player.get(f"item_{i}") or 0) > 0:
                return False
        except (TypeError, ValueError):
            continue
    return True


def _backfill_main_item_scalars_from_items_slot_array_order(
    player: MutableMapping[str, Any], isl: List[Any]
) -> None:
    """无 HUD ``slot`` 列时，仅当 ``item_0..5`` 全空才用数组前 6 项回填（旧管线）。"""
    if not isl or not _player_main_item_scalars_all_empty(player):
        return
    for s in range(6):
        if s >= len(isl):
            player[f"item_{s}"] = 0
            continue
        cell = isl[s]
        if not isinstance(cell, dict):
            player[f"item_{s}"] = 0
            continue
        if cell.get("empty") is True:
            player[f"item_{s}"] = 0
            continue
        try:
            player[f"item_{s}"] = int(cell.get("item_id") or 0)
        except (TypeError, ValueError):
            player[f"item_{s}"] = 0


def _items_slot_has_items(items_slot: Any) -> bool:
    """
    DEM / 管线已写入 ``items_slot`` 时，勿用 OpenDota 式 ``item_0..5`` 覆盖。

    须与 ``dem_result_to_slim_match._items_slot_has_equipped`` 一致：战斗日志推断的格子
    在 ``item_ids`` 缺新道具映射时常为 ``item_id==0`` 但已有 ``item_key``；若仅判断
    ``item_id>0`` 会误判为空，随后 ``apply_two_step`` 用不存在的 ``item_*`` 覆盖，造成
    「上传另一场 PUB 后本场装备乱了」等现象（实为二次 translate 时主栏被冲掉）。

    若 ``items_slot`` 行带 HUD ``slot``：仅 **0–5 主栏** 有装备时视为 precooked；
    背包 / 中立（6–8、16）不得把 ``items_precooked`` 判假导致 ``mutate_items_slot`` 冲掉管线。
    """
    if not isinstance(items_slot, list):
        return False
    if _items_slot_list_uses_physical_indices(items_slot):
        for cell in items_slot:
            if not isinstance(cell, dict):
                continue
            si = _read_hud_item_slot_index(cell)
            if si is None or si > 5:
                continue
            if cell.get("empty") is True:
                continue
            if str(cell.get("item_key") or "").strip():
                return True
            try:
                if int(cell.get("item_id") or 0) > 0:
                    return True
            except (TypeError, ValueError):
                continue
        return False
    for cell in items_slot[:6]:
        if not isinstance(cell, dict):
            continue
        if cell.get("empty") is True:
            continue
        if str(cell.get("item_key") or "").strip():
            return True
        try:
            if int(cell.get("item_id") or 0) > 0:
                return True
        except (TypeError, ValueError):
            continue
    return False


def translate_match_data(
    raw_json: Union[Mapping[str, Any], List[Any]],
    *,
    constants: Optional[DotaConstants] = None,
) -> Dict[str, Any]:
    """
    将 OpenDota 原始比赛 JSON 转为带中文与资源 URL 的精简结构。

    每名玩家增加：
    - hero_name_cn / hero_name_en / hero_portrait_url / hero_icon_url
    - items_slot: item_0..item_5 的结构化列表
    - ability_timeline: 加点顺序（含天赋 is_talent）

    入口会先经 ``raw_odota_purify``：若收到巨型事件数组或 ``players`` 被误填为事件流，
    只保留 ``type=player_match`` 的 10 名玩家并按 ``player_slot`` 排序。
    """
    from utils.raw_odota_purify import normalize_match_input_for_translate

    dc = constants or get_constants()
    normalized = normalize_match_input_for_translate(raw_json)
    out = deepcopy(dict(normalized))

    players = out.get("players")
    if not isinstance(players, list):
        return out

    from utils.dota_pipeline import (
        build_talent_tree,
        filter_merged_steps_for_client_skill_bar,
        get_cdn_neutral_img,
        infer_talent_picks_from_hero_abilities_indices,
        load_hero_abilities_map,
        load_or_fetch_pro_players,
        match_pro_player,
        merge_talent_pick_lists,
        merge_talent_tree_from_parser_picks,
        skill_build_v2_from_merged_upgrades,
    )
    from utils.dota_two_step import apply_two_step_to_player

    pro_rows = load_or_fetch_pro_players(dc.cache_dir)
    hero_abilities_map = load_hero_abilities_map(dc.cache_dir)

    try:
        match_duration_sec = int(out.get("duration") or 0)
    except (TypeError, ValueError):
        match_duration_sec = 0
    if match_duration_sec <= 0:
        match_duration_sec = None

    slim_players: List[Dict[str, Any]] = []
    for p in players:
        if not isinstance(p, MutableMapping):
            continue
        player = dict(p)
        for k in _HEAVY_PLAYER_KEYS:
            player.pop(k, None)

        hid = player.get("hero_id")
        try:
            hero_id = int(hid) if hid is not None else 0
        except (TypeError, ValueError):
            hero_id = 0

        hero = dc.hero_by_id(hero_id) if hero_id else None
        if hero:
            loc = str(hero.get("localized_name") or "")
            player["hero_name_en"] = loc
            player["hero_name_cn"] = dc.heroes_zh_by_id.get(str(hero_id)) or loc
            player["hero_portrait_url"] = steam_asset_url(hero.get("img"))
            player["hero_icon_url"] = steam_asset_url(hero.get("icon"))
            player["hero_internal_name"] = hero.get("name")
        else:
            player["hero_name_en"] = ""
            player["hero_name_cn"] = ""
            player["hero_portrait_url"] = ""
            player["hero_icon_url"] = ""
            player["hero_internal_name"] = None

        isl_pre = player.get("items_slot")
        uses_phys = (
            _items_slot_list_uses_physical_indices(isl_pre)
            if isinstance(isl_pre, list)
            else False
        )
        if uses_phys:
            _hydrate_player_item_scalars_from_hud_items_slot(player)
        elif isinstance(isl_pre, list):
            _backfill_main_item_scalars_from_items_slot_array_order(player, isl_pre)

        # 装备栏：item_ids → items.json 两步映射（含 backpack、neutral 规整字段）
        # 带 HUD ``slot`` 的 ``items_slot`` 一律视为管线权威，勿用 ``apply_two_step`` 覆盖（否则仅背包装备时会误冲掉）。
        items_precooked = bool(
            isinstance(isl_pre, list)
            and len(isl_pre) > 0
            and (
                uses_phys or _items_slot_has_items(isl_pre)
            )
        )
        orig_neutral_img = ""
        if items_precooked:
            _ni = player.get("neutral_img")
            if isinstance(_ni, str) and _ni.strip():
                orig_neutral_img = _ni.strip()
        apply_two_step_to_player(
            player,
            dc,
            mutate_items_slot=not items_precooked,
            match_duration_sec=match_duration_sec,
        )
        for slot in range(3):
            player.pop(f"backpack_{slot}", None)

        objs = _parse_ability_upgrades_objects(player.get("ability_upgrades"))
        arr_steps = raw_ability_upgrades_arr_to_merged_steps(
            player.get("ability_upgrades_arr"),
            match_duration_sec=match_duration_sec,
        )
        merged_ordered = merge_upgrade_steps_for_skill_build(objs, arr_steps)
        merged_filtered = filter_merged_steps_for_client_skill_bar(
            merged_ordered, dc
        )
        player["skill_build"] = skill_build_v2_from_merged_upgrades(
            merged_filtered, dc, pad_to=25
        )
        player.pop("ability_upgrades", None)
        # 与客户端加点条对齐：剔除先天/占位/子技后的 ID 序列（前端优先读此字段）
        if player.get("ability_upgrades_arr"):
            player["ability_upgrades_arr"] = [
                int(s["ability_id"])
                for s in merged_filtered
                if int(s.get("ability_id") or 0) > 0
            ][:40]

        timeline: List[Dict[str, Any]] = []
        talents: List[Dict[str, Any]] = []
        for step in merged_filtered:
            aid = int(step["ability_id"])
            akey = dc.ability_key_from_id(aid)
            jk = dc.resolve_abilities_json_key(akey) if akey else None
            name_en, name_cn, ab_img = dc.ability_display(jk or akey)
            ab_row = dc.abilities.get(jk or akey) if (jk or akey) else None
            is_talent = is_talent_ability(
                jk or akey, ab_row if isinstance(ab_row, dict) else None
            )
            entry = {
                "time": step.get("time"),
                "ability_id": aid,
                "ability_key": jk or akey,
                "ability_name_en": name_en,
                "ability_name_cn": name_cn,
                "image_url": ab_img,
                "is_talent": is_talent,
            }
            if "level" in step and step["level"] is not None:
                entry["level"] = step["level"]
            timeline.append(entry)
            if is_talent:
                talents.append(entry)

        player["ability_timeline"] = timeline
        player["talents_taken"] = talents

        hn = str(player.get("hero_internal_name") or "")
        if hn:
            extra_tk = [
                str(x.get("ability_key"))
                for x in (player.get("talents_taken") or [])
                if isinstance(x, dict) and x.get("ability_key")
            ]
            extra_tid: List[int] = []
            for x in talents:
                if not isinstance(x, dict):
                    continue
                try:
                    tid = int(x.get("ability_id") or 0)
                except (TypeError, ValueError):
                    tid = 0
                if tid > 0:
                    extra_tid.append(tid)
            player["talent_tree"] = build_talent_tree(
                hn,
                list(player.get("skill_build") or []),
                hero_abilities_map,
                dc,
                extra_talent_keys=extra_tk,
                extra_talent_ids=extra_tid,
                merged_upgrade_steps=merged_filtered,
            )
            inf_tp = infer_talent_picks_from_hero_abilities_indices(
                dc,
                hn,
                hero_abilities_map,
                list(player.get("skill_build") or []),
                merged_filtered,
            )
            merged_tp = merge_talent_pick_lists(player.get("talent_picks"), inf_tp)
            if merged_tp:
                player["talent_picks"] = merged_tp
                player["talent_tree"] = merge_talent_tree_from_parser_picks(
                    player["talent_tree"], merged_tp
                )
        else:
            player["talent_tree"] = {"tiers": [], "dots_learned": 0}

        try:
            nid = int(player.get("item_neutral") or 0)
        except (TypeError, ValueError):
            nid = 0
        nr = player.get("items_resolved") or {}
        neutral_cell = nr.get("neutral") if isinstance(nr, dict) else None
        if items_precooked and orig_neutral_img:
            player["neutral_img"] = orig_neutral_img
        elif isinstance(neutral_cell, dict) and neutral_cell.get("image_url"):
            player["neutral_img"] = str(neutral_cell["image_url"])
        else:
            player["neutral_img"] = get_cdn_neutral_img(nid, dc)
        if isinstance(neutral_cell, dict) and neutral_cell.get("item_key"):
            player["neutral_item_key"] = str(neutral_cell["item_key"])

        # 回填 OpenDota 式 item_0..item_5（数值 item id）：以 ``items_resolved.main`` 为权威（已由物理槽位 + item_* 驱动）。
        # 无 ``slot`` 列的旧 ``items_slot`` 且 ``main`` 异常时，才按数组前 6 项兜底。
        main_cells = nr.get("main") if isinstance(nr, dict) else None
        if isinstance(main_cells, list) and len(main_cells) >= 6:
            for s in range(6):
                cell = (
                    main_cells[s]
                    if s < len(main_cells) and isinstance(main_cells[s], dict)
                    else {}
                )
                try:
                    player[f"item_{s}"] = int(cell.get("item_id") or 0)
                except (TypeError, ValueError):
                    player[f"item_{s}"] = 0
        elif items_precooked and isinstance(player.get("items_slot"), list):
            isl_fb = player.get("items_slot") or []
            if (
                not _items_slot_list_uses_physical_indices(isl_fb)
                and len(isl_fb) > 0
            ):
                for s in range(6):
                    cell = (
                        isl_fb[s]
                        if s < len(isl_fb) and isinstance(isl_fb[s], dict)
                        else {}
                    )
                    try:
                        player[f"item_{s}"] = int(cell.get("item_id") or 0)
                    except (TypeError, ValueError):
                        player[f"item_{s}"] = 0
        nei = 0
        if isinstance(neutral_cell, dict):
            try:
                nei = int(neutral_cell.get("item_id") or 0)
            except (TypeError, ValueError):
                nei = 0
        player["item_neutral"] = nei

        try:
            acc = int(player.get("account_id") or 0)
        except (TypeError, ValueError):
            acc = None
        pname, tname = match_pro_player(acc, pro_rows)
        player["pro_name"] = pname
        player["team_name"] = tname

        slim_players.append(player)

    out["players"] = slim_players

    meta_root = out.get("_meta") if isinstance(out.get("_meta"), dict) else {}
    src_root = str((meta_root or {}).get("source") or "").strip()
    tier_in = str(out.get("match_tier") or "").strip().lower()
    if tier_in == "pub" or src_root == "dem_result_json":
        out["match_tier"] = "pub"
    else:
        out["match_tier"] = "pro"

    return out


if __name__ == "__main__":
    d = download_dotaconstants_build()
    print("Downloaded dotaconstants build to:", d)
