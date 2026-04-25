/**
 * 从 OpenDota 风格玩家对象读取 item_0..item_5，生成固定 6 格主栏数据。
 * item_id 通过 entity_maps.items 映射为 key / CDN。
 *
 * 主栏：仅 HUD 槽位 0–5（与 `item_0`..`item_5` 一致）。
 * 背包：HUD 槽位 6–8（与 `backpack_0`..`backpack_2` 或 `items_slot[].slot` 一致）。
 * 中立：HUD 槽位 16 或 `item_neutral` / `neutral_img` / `neutral_item_key`，不得写入 main。
 */
import type { EntityMapsPayload } from "../types/entityMaps";
import type { SlimItemSlot } from "../types/slimMatch";
import type { ItemSlotMock } from "../data/mockMatchPlayers";
import { itemIconUrl, normalizeDotaAssetUrl } from "../data/mockMatchPlayers";

/** 身上主物品栏槽位数（不含背包、不含中立）。 */
export const MAIN_INVENTORY_SLOT_COUNT = 6;

/** Dota HUD：主栏 0–5，背包 6–8，中立 16。 */
export const HUD_BACKPACK_SLOT_START = 6;
export const HUD_BACKPACK_SLOT_END = 8;
export const HUD_NEUTRAL_SLOT = 16;

function numId(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function isEmptyItemScalar(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === 0;
}

export type SixMainTuple = [
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
];

export type BackpackThreeTuple = [
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
];

function emptyMainTuple(): SixMainTuple {
  return [null, null, null, null, null, null];
}

function emptyBackpackTuple(): BackpackThreeTuple {
  return [null, null, null];
}

function itemEntryFromId(
  itemId: number,
  maps: EntityMapsPayload
): ItemSlotMock | null {
  if (itemId <= 0) return null;
  const row = maps.items?.[String(itemId)];
  if (!row?.key) return null;
  const key = String(row.key).trim();
  if (!key) return null;
  const clean = key.replace(/^item_/, "");
  return {
    itemKey: key,
    imageUrl: itemIconUrl(clean),
  };
}

export type SixPlusOneItems = {
  main: SixMainTuple;
  backpack: BackpackThreeTuple;
  /** 中立槽；主 6 格不得承载中立物品 */
  neutral: ItemSlotMock | null;
};

/**
 * 若玩家对象上存在**至少一格非空**的 `item_0`..`item_5`（与 OpenDota 数值 id 一致），
 * 才视为走 OpenDota 主槽分支。全为 0 时仍用 `items_slot`，避免 translate 回填的占位 0 挡掉有效格子。
 */
export function hasOpenDotaItemSlots(p: Record<string, unknown>): boolean {
  for (let i = 0; i < MAIN_INVENTORY_SLOT_COUNT; i++) {
    const k = `item_${i}`;
    if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
    if (!isEmptyItemScalar(p[k])) return true;
  }
  return false;
}

function hasOpenDotaBackpackSlots(p: Record<string, unknown>): boolean {
  for (let i = 0; i < 3; i++) {
    const k = `backpack_${i}`;
    if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
    if (!isEmptyItemScalar(p[k])) return true;
  }
  return false;
}

/** 任意行带合法 `slot` 标量时，按 HUD 物理索引解析，禁止按数组顺序把背包塞进主栏。 */
function itemsSlotArrayUsesExplicitSlotField(
  slots: SlimItemSlot[] | null | undefined
): boolean {
  if (!Array.isArray(slots)) return false;
  for (const row of slots) {
    if (!row || typeof row !== "object") continue;
    if (!Object.prototype.hasOwnProperty.call(row, "slot")) continue;
    const n = Math.floor(Number((row as SlimItemSlot).slot));
    if (Number.isFinite(n)) return true;
  }
  return false;
}

function readHudSlotIndex(row: SlimItemSlot | Record<string, unknown>): number | null {
  if (!row || typeof row !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(row, "slot")) return null;
  const n = Math.floor(Number((row as SlimItemSlot).slot));
  if (!Number.isFinite(n) || n < 0 || n > HUD_NEUTRAL_SLOT) return null;
  return n;
}

function cellEquipped(s: SlimItemSlot): boolean {
  if (s.empty === true) return false;
  if (String(s.item_key ?? "").trim()) return true;
  return numId(s.item_id) > 0;
}

/** 管线 `items_slot` 上主栏 0–5 是否有装备（有 HUD slot 时只看物理主栏，不看数组前 6 项）。 */
function itemsSlotHasMainSlotEquipped(
  slots: SlimItemSlot[],
  declareHudSlots: boolean
): boolean {
  if (declareHudSlots) {
    for (const row of slots) {
      if (!row || typeof row !== "object") continue;
      const s = row as SlimItemSlot;
      const si = readHudSlotIndex(s);
      if (si === null || si < 0 || si > 5) continue;
      if (cellEquipped(s)) return true;
    }
    return false;
  }
  for (let i = 0; i < Math.min(MAIN_INVENTORY_SLOT_COUNT, slots.length); i++) {
    const row = slots[i];
    if (!row || typeof row !== "object") continue;
    if (cellEquipped(row as SlimItemSlot)) return true;
  }
  return false;
}

function cellFromSlimSlotRow(
  s: SlimItemSlot,
  maps: EntityMapsPayload
): ItemSlotMock | null {
  if (s.empty) return null;
  const keyRaw = String(s.item_key ?? "").trim();
  const id = numId(s.item_id);
  if (!keyRaw && id <= 0) return null;
  const key = keyRaw.replace(/^item_/, "");
  if (!key && id > 0) return itemEntryFromId(id, maps);
  const img = String(s.image_url ?? "").trim();
  return {
    itemKey: key,
    ...(img ? { imageUrl: img } : {}),
  };
}

/** 仅写入 HUD slot 为 0..5 的行；6–8、16 等不得进入主栏。 */
function buildMainFromIndexedItemsSlot(
  slots: SlimItemSlot[],
  maps: EntityMapsPayload
): SixMainTuple {
  const main = emptyMainTuple();
  for (const row of slots) {
    if (!row || typeof row !== "object") continue;
    const s = row as SlimItemSlot;
    const idx = readHudSlotIndex(s);
    if (idx === null || idx < 0 || idx > 5) continue;
    if (s.empty) {
      main[idx] = null;
      continue;
    }
    const keyTrim = String(s.item_key ?? "").trim();
    if (!keyTrim && numId(s.item_id) <= 0) {
      main[idx] = null;
      continue;
    }
    main[idx] = cellFromSlimSlotRow(s, maps);
  }
  return main;
}

/**
 * 无 HUD `slot` 列时：仅数组下标 0..5 映射到物理主栏 0..5（旧管线约定）。
 * 一旦存在带 `slot` 的行，不得调用本函数（改走 `buildMainFromIndexedItemsSlot`）。
 */
function buildMainFromOrderedItemsSlotFirstSix(
  slots: SlimItemSlot[],
  maps: EntityMapsPayload
): SixMainTuple {
  const main = emptyMainTuple();
  const n = Math.min(MAIN_INVENTORY_SLOT_COUNT, slots.length);
  for (let i = 0; i < n; i++) {
    const row = slots[i];
    if (!row || typeof row !== "object") continue;
    const s = row as SlimItemSlot;
    if (s.empty) continue;
    main[i] = cellFromSlimSlotRow(s, maps);
  }
  return main;
}

function buildBackpackFromIndexedItemsSlot(
  slots: SlimItemSlot[],
  maps: EntityMapsPayload
): BackpackThreeTuple {
  const bp = emptyBackpackTuple();
  for (const row of slots) {
    if (!row || typeof row !== "object") continue;
    const s = row as SlimItemSlot;
    const idx = readHudSlotIndex(s);
    if (
      idx === null ||
      idx < HUD_BACKPACK_SLOT_START ||
      idx > HUD_BACKPACK_SLOT_END
    ) {
      continue;
    }
    const bi = idx - HUD_BACKPACK_SLOT_START;
    if (s.empty) {
      bp[bi] = null;
      continue;
    }
    const keyTrim = String(s.item_key ?? "").trim();
    if (!keyTrim && numId(s.item_id) <= 0) {
      bp[bi] = null;
      continue;
    }
    bp[bi] = cellFromSlimSlotRow(s, maps);
  }
  return bp;
}

function buildBackpackFromOpenDotaScalars(
  p: Record<string, unknown>,
  maps: EntityMapsPayload
): BackpackThreeTuple {
  const bp = emptyBackpackTuple();
  if (!hasOpenDotaBackpackSlots(p)) return bp;
  for (let i = 0; i < 3; i++) {
    const rawVal = p[`backpack_${i}`];
    if (isEmptyItemScalar(rawVal)) {
      bp[i] = null;
      continue;
    }
    bp[i] = itemEntryFromId(numId(rawVal), maps);
  }
  return bp;
}

/** HUD 背包格优先，缺省时用 OpenDota 式 ``backpack_*`` 补全（合并管线与 API）。 */
function mergeBackpackIndexedWithOpenDotaScalars(
  indexed: BackpackThreeTuple,
  fromScalars: BackpackThreeTuple
): BackpackThreeTuple {
  return [
    indexed[0] ?? fromScalars[0] ?? null,
    indexed[1] ?? fromScalars[1] ?? null,
    indexed[2] ?? fromScalars[2] ?? null,
  ];
}

function buildNeutralFromPlayerAndSlots(
  raw: Record<string, unknown>,
  slots: SlimItemSlot[] | null | undefined,
  maps: EntityMapsPayload,
  declareHudSlots: boolean
): ItemSlotMock | null {
  const img = String(raw["neutral_img"] ?? "").trim();
  const keyRaw = String(raw["neutral_item_key"] ?? "").trim();
  if (img || keyRaw) {
    const key = keyRaw.replace(/^item_/, "");
    return {
      itemKey: key || "unknown",
      ...(img ? { imageUrl: normalizeDotaAssetUrl(img) } : {}),
    };
  }
  if (declareHudSlots && Array.isArray(slots)) {
    for (const row of slots) {
      if (!row || typeof row !== "object") continue;
      const s = row as SlimItemSlot;
      const idx = readHudSlotIndex(s);
      if (idx !== HUD_NEUTRAL_SLOT) continue;
      if (s.empty) return null;
      return cellFromSlimSlotRow(s, maps);
    }
  }
  return itemEntryFromId(numId(raw["item_neutral"]), maps);
}

/** 将任意长度的 main 压成固定 6 格，供 UI 使用（丢弃索引 ≥6 的溢出）。 */
export function normalizeMainSixForDisplay(
  main: readonly (ItemSlotMock | null)[] | null | undefined
): SixMainTuple {
  const a = main ?? [];
  return [
    a[0] ?? null,
    a[1] ?? null,
    a[2] ?? null,
    a[3] ?? null,
    a[4] ?? null,
    a[5] ?? null,
  ];
}

export function normalizeBackpackThreeForDisplay(
  bp: readonly (ItemSlotMock | null)[] | null | undefined
): BackpackThreeTuple {
  const a = bp ?? [];
  return [a[0] ?? null, a[1] ?? null, a[2] ?? null];
}

export function buildSixPlusOneFromOpenDotaSlots(
  p: Record<string, unknown>,
  maps: EntityMapsPayload
): SixPlusOneItems | null {
  if (!hasOpenDotaItemSlots(p)) return null;

  const main = emptyMainTuple();
  for (let i = 0; i < MAIN_INVENTORY_SLOT_COUNT; i++) {
    const rawVal = p[`item_${i}`];
    if (isEmptyItemScalar(rawVal)) {
      main[i] = null;
      continue;
    }
    const id = numId(rawVal);
    main[i] = itemEntryFromId(id, maps);
  }
  return {
    main,
    backpack: buildBackpackFromOpenDotaScalars(p, maps),
    neutral: buildNeutralFromPlayerAndSlots(p, null, maps, false),
  };
}

/**
 * 与 `item_0`..`item_5` 对齐的装备 id（用于神杖/魔晶 id 检测）。
 * 优先读原始字段；否则按 `items_slot[].slot` 填回 0..5（绝不把背包下标当作主栏）。
 */
export function extractSixMainSlotItemIds(
  raw: Record<string, unknown>,
  slots: SlimItemSlot[] | undefined | null
): number[] {
  const out = [0, 0, 0, 0, 0, 0];
  let fromRaw = false;
  for (let i = 0; i < 6; i++) {
    const k = `item_${i}`;
    if (Object.prototype.hasOwnProperty.call(raw, k)) {
      fromRaw = true;
      const n = numId(raw[k]);
      out[i] = n > 0 ? n : 0;
    }
  }
  if (fromRaw) return out;
  if (!Array.isArray(slots)) return out;
  if (itemsSlotArrayUsesExplicitSlotField(slots)) {
    for (const row of slots) {
      if (!row || typeof row !== "object") continue;
      const s = row as SlimItemSlot;
      const idx = readHudSlotIndex(s);
      if (idx === null || idx < 0 || idx > 5) continue;
      const n = numId(s.item_id);
      out[idx] = n > 0 ? n : 0;
    }
    return out;
  }
  for (let i = 0; i < Math.min(6, slots.length); i++) {
    const row = slots[i];
    if (!row || typeof row !== "object") continue;
    const n = numId((row as SlimItemSlot).item_id);
    out[i] = n > 0 ? n : 0;
  }
  return out;
}

/**
 * 结算面 HUD 装备：
 * 1. `items_slot` 含主栏 0–5 装备时优先（若带 `slot` 列则严格按物理索引建 main/backpack/neutral）。
 * 2. 否则若存在 OpenDota 式 `item_0..5`（及 backpack_* / item_neutral），用标量槽位。
 * 3. 否则再按 `items_slot` 无 slot 的定长前 6 项兜底。
 */
export function buildSixPlusOneFinal(
  raw: Record<string, unknown>,
  slots: SlimItemSlot[] | undefined | null,
  maps: EntityMapsPayload
): SixPlusOneItems {
  const slotList = Array.isArray(slots) ? slots : [];
  const declareHud = itemsSlotArrayUsesExplicitSlotField(slotList);
  const pipelineMain =
    slotList.length > 0 &&
    itemsSlotHasMainSlotEquipped(slotList, declareHud);

  const buildFromPipeline = (): SixPlusOneItems => {
    const main = declareHud
      ? buildMainFromIndexedItemsSlot(slotList, maps)
      : buildMainFromOrderedItemsSlotFirstSix(slotList, maps);
    const backpackScalars = buildBackpackFromOpenDotaScalars(raw, maps);
    const backpack = declareHud
      ? mergeBackpackIndexedWithOpenDotaScalars(
          buildBackpackFromIndexedItemsSlot(slotList, maps),
          backpackScalars
        )
      : backpackScalars;
    const neutral = buildNeutralFromPlayerAndSlots(
      raw,
      slotList,
      maps,
      declareHud
    );
    return { main, backpack, neutral };
  };

  if (pipelineMain) {
    return buildFromPipeline();
  }

  const od = buildSixPlusOneFromOpenDotaSlots(raw, maps);
  if (od) {
    return od;
  }

  if (slotList.length > 0) {
    return buildFromPipeline();
  }

  return {
    main: emptyMainTuple(),
    backpack: emptyBackpackTuple(),
    neutral: null,
  };
}
