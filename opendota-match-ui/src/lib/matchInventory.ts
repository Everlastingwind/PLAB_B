/**
 * 从 OpenDota 风格玩家对象读取 item_0..item_5，生成固定 6 格主栏数据。
 * item_id 通过 entity_maps.items 映射为 key / CDN。
 *
 * 主栏约束：仅槽位 0–5（与 `item_0`..`item_5` 一致）。槽位 ≥6 视为背包/stash，不得写入 main。
 * 中立槽已弃用：`neutral` 恒为 null，不读 `item_neutral` / `neutral_item_key` / `neutral_img`。
 */
import type { EntityMapsPayload } from "../types/entityMaps";
import type { SlimItemSlot } from "../types/slimMatch";
import type { ItemSlotMock } from "../data/mockMatchPlayers";
import { itemIconUrl } from "../data/mockMatchPlayers";

/** 身上主物品栏槽位数（不含背包、不含中立）。 */
export const MAIN_INVENTORY_SLOT_COUNT = 6;

function numId(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function isEmptyItemScalar(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === 0;
}

function emptyMainTuple(): SixPlusOneItems["main"] {
  return [null, null, null, null, null, null];
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
  main: [
    ItemSlotMock | null,
    ItemSlotMock | null,
    ItemSlotMock | null,
    ItemSlotMock | null,
    ItemSlotMock | null,
    ItemSlotMock | null,
  ];
  /** 保留字段以兼容类型；恒为 null，UI 不展示中立槽 */
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

/** 管线 `items_slot` 已按 0..5 建槽（translate_match_data 输出），应优先于裸 item_* */
function itemsSlotHasIndexedRows(
  slots: SlimItemSlot[] | null | undefined
): boolean {
  if (!Array.isArray(slots) || slots.length === 0) return false;
  for (const row of slots) {
    if (!row || typeof row !== "object") continue;
    const idx = Math.floor(Number((row as SlimItemSlot).slot));
    if (Number.isFinite(idx) && idx >= 0 && idx <= 5) return true;
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

/** 与 Python `_items_slot_has_items` 对齐：有 `item_key` 或 `item_id` 即视为管线主栏有效。 */
function itemsSlotHasAnyEquipped(
  slots: SlimItemSlot[] | null | undefined
): boolean {
  if (!Array.isArray(slots)) return false;
  for (const row of slots.slice(0, MAIN_INVENTORY_SLOT_COUNT)) {
    if (!row || typeof row !== "object") continue;
    if (row.empty === true) continue;
    if (String(row.item_key ?? "").trim()) return true;
    if (numId(row.item_id) > 0) return true;
  }
  return false;
}

function buildMainFromItemsSlotFlexible(
  slots: SlimItemSlot[],
  maps: EntityMapsPayload
): SixPlusOneItems["main"] {
  if (itemsSlotHasIndexedRows(slots)) {
    return buildMainFromIndexedItemsSlot(slots, maps);
  }
  return buildMainFromOrderedItemsSlotFirstSix(slots, maps);
}

/** 仅写入 slot 为 0..5 的行；≥6 为背包，忽略。 */
function buildMainFromIndexedItemsSlot(
  slots: SlimItemSlot[],
  maps: EntityMapsPayload
): SixPlusOneItems["main"] {
  const main = emptyMainTuple();
  for (const row of slots) {
    if (!row || typeof row !== "object") continue;
    const s = row as SlimItemSlot;
    const idx = Math.floor(Number(s.slot));
    if (!Number.isFinite(idx) || idx < 0 || idx > 5) continue;
    if (s.empty) {
      main[idx] = null;
      continue;
    }
    const keyTrim = String(s.item_key ?? "").trim();
    if (!keyTrim && numId(s.item_id) <= 0) {
      main[idx] = null;
      continue;
    }
    const cell = cellFromSlimSlotRow(s, maps);
    main[idx] = cell;
  }
  return main;
}

/** 无槽位索引时：仅取数组前 6 项作为展示主栏（不读取背包段）。 */
function buildMainFromOrderedItemsSlotFirstSix(
  slots: SlimItemSlot[],
  maps: EntityMapsPayload
): SixPlusOneItems["main"] {
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

/** 将任意长度的 main 压成固定 6 格，供 UI 使用（丢弃索引 ≥6 的溢出）。 */
export function normalizeMainSixForDisplay(
  main: readonly (ItemSlotMock | null)[] | null | undefined
): SixPlusOneItems["main"] {
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
  return { main, neutral: null };
}

/**
 * 与 `item_0`..`item_5` 对齐的装备 id（用于神杖/魔晶 id 检测）。
 * 优先读原始字段；否则按 `items_slot[].slot` 填回 0..5（绝不按数组顺序猜测槽位）。
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
  for (const row of slots) {
    if (!row || typeof row !== "object") continue;
    const s = row as SlimItemSlot;
    const idx = Math.floor(Number(s.slot));
    if (!Number.isFinite(idx) || idx < 0 || idx > 5) continue;
    const n = numId(s.item_id);
    out[idx] = n > 0 ? n : 0;
  }
  return out;
}

/**
 * 结算面主 6 格（中立槽已弃用，neutral 恒 null）：
 * 1. 若 `items_slot` 含合法 `slot` 0..5，**优先**用管线槽位（避免与残留 `item_*` 冲突）。
 * 2. 否则若存在 OpenDota 式 `item_0..5`，用其主槽。
 * 3. 否则再按 `items_slot` 兜底。
 */
export function buildSixPlusOneFinal(
  raw: Record<string, unknown>,
  slots: SlimItemSlot[] | undefined | null,
  maps: EntityMapsPayload
): SixPlusOneItems {
  // 只要管线 `items_slot` 上有装备，就优先于残留的 OpenDota `item_0..5`（避免 PUB 混源时主栏被错数据覆盖）
  if (Array.isArray(slots) && slots.length > 0 && itemsSlotHasAnyEquipped(slots)) {
    return {
      main: buildMainFromItemsSlotFlexible(slots, maps),
      neutral: null,
    };
  }

  const od = buildSixPlusOneFromOpenDotaSlots(raw, maps);
  if (od) {
    return { main: od.main, neutral: null };
  }

  if (Array.isArray(slots) && slots.length > 0) {
    return {
      main: buildMainFromItemsSlotFlexible(slots, maps),
      neutral: null,
    };
  }

  return { main: emptyMainTuple(), neutral: null };
}
