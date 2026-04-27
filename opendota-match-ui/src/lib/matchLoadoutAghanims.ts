/**
 * Dota 2 结算面：神杖 / 魔晶是否生效（身上 6 格 + API 标量 + permanent_buffs + 购买流水）。
 * 与客户端一致：permanent_buff 2 ≈ 神杖、12 ≈ 魔晶。
 * 本地/DEM 管线常把 `aghanims_*` 写成 0；若 `purchase_history`（或 OpenDota 式 `purchase_log`）曾购买则补推断。
 */
import type { ItemSlotMock } from "../data/mockMatchPlayers";

/** 标准 A 杖（ultimate_scepter） */
export const AGHANIM_SCEPTER_ITEM_ID = 108;

/** 常见魔晶 / 肉山魔晶 id（不同版本可能增减，与 item_key 检测互为兜底） */
export const AGHANIM_SHARD_ITEM_IDS = new Set<number>([416, 609, 725]);

/**
 * 神杖实体 id：标准杖、祝福、肉山祝福（与 entity_maps / 客户端一致）；
 * 变体名另见 `SCEPTER_KEYS`。
 */
export const AGHANIM_SCEPTER_ITEM_IDS = new Set<number>([
  AGHANIM_SCEPTER_ITEM_ID,
  271,
  727,
]);

const SCEPTER_KEYS = new Set([
  "ultimate_scepter",
  "ultimate_scepter_2",
  "ultimate_scepter_roshan",
]);
const SHARD_KEYS = new Set([
  "aghanims_shard",
  "aghanims_shard_roshan",
]);

function truthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number" && v > 0) return true;
  if (v === 1 || v === "1") return true;
  return false;
}

function buffsFromPermanent(raw: unknown): { scepter: boolean; shard: boolean } {
  let scepter = false;
  let shard = false;
  if (!Array.isArray(raw)) return { scepter, shard };
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = Number((row as { permanent_buff?: unknown }).permanent_buff);
    if (id === 2) scepter = true;
    if (id === 12) shard = true;
  }
  return { scepter, shard };
}

function normItemKey(k: string): string {
  return k.replace(/^item_/, "").trim().toLowerCase();
}

function itemKeySignalsAghsScepter(k: string): boolean {
  if (SCEPTER_KEYS.has(k)) return true;
  if (k.includes("ultimate_scepter") && !k.includes("recipe")) return true;
  return false;
}

function itemKeySignalsAghsShard(k: string): boolean {
  if (SHARD_KEYS.has(k)) return true;
  if (k.includes("aghanims_shard")) return true;
  return false;
}

/** 从 slim `purchase_history` / 原始 `purchase_log` 推断是否曾购入（含已消耗仍占 Buff 位）。 */
function inferScepterShardFromPurchaseStreams(
  raw: Record<string, unknown>
): { scepter: boolean; shard: boolean } {
  let scepter = false;
  let shard = false;

  const hist = raw["purchase_history"];
  if (Array.isArray(hist)) {
    for (const row of hist) {
      if (!row || typeof row !== "object") continue;
      const o = row as { item?: unknown; item_key?: unknown };
      const rawItem = String(o.item ?? o.item_key ?? "").trim();
      const k = normItemKey(rawItem);
      if (!k) continue;
      if (itemKeySignalsAghsScepter(k)) scepter = true;
      if (itemKeySignalsAghsShard(k)) shard = true;
    }
  }

  const log = raw["purchase_log"];
  if (Array.isArray(log)) {
    for (const row of log) {
      if (!row || typeof row !== "object") continue;
      const keyRaw = String((row as { key?: unknown }).key ?? "").trim();
      const k = normItemKey(keyRaw);
      if (!k) continue;
      if (itemKeySignalsAghsScepter(k)) scepter = true;
      if (itemKeySignalsAghsShard(k)) shard = true;
    }
  }

  return { scepter, shard };
}

/**
 * 从玩家原始字段 + 六主槽展示数据推导神杖/魔晶是否点亮。
 * `mainItemIds`：与 item_0..item_5 同序；缺省时仅用槽位 itemKey + API/Buff。
 */
export type ScepterShardBuffState = { scepter: boolean; shard: boolean };

/**
 * 主 6 格展示与客户端一致：神杖 / 魔晶只由 BUFF 图标表示，不占主栏格子。
 * 凡槽位为 A 杖或魔晶（`mainItemIds` 与 `ItemSlotMock.itemKey` 任一命中），清空该格。
 * `computeScepterShardActive` 须已根据槽位 / API / permanent_buffs 合并过点亮状态。
 */
export function stripConsumedAghanimsFromMainSlots(
  main: readonly (ItemSlotMock | null)[],
  mainItemIds: readonly number[]
): [
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
  ItemSlotMock | null,
] {
  const out = [...main] as [
    ItemSlotMock | null,
    ItemSlotMock | null,
    ItemSlotMock | null,
    ItemSlotMock | null,
    ItemSlotMock | null,
    ItemSlotMock | null,
  ];
  for (let i = 0; i < 6; i++) {
    const id = mainItemIds[i] ?? 0;
    const slot = out[i];
    const key = normItemKey(slot?.itemKey ?? "");
    const isScepter =
      AGHANIM_SCEPTER_ITEM_IDS.has(id) || SCEPTER_KEYS.has(key);
    const isShard = AGHANIM_SHARD_ITEM_IDS.has(id) || SHARD_KEYS.has(key);
    if (isScepter || isShard) out[i] = null;
  }
  return out;
}

export function computeScepterShardActive(opts: {
  raw: Record<string, unknown>;
  main: readonly (ItemSlotMock | null)[];
  /** 长度 6，与主槽一一对应；0 表示空 */
  mainItemIds?: readonly number[] | null;
}): ScepterShardBuffState {
  const { raw, main, mainItemIds } = opts;
  let scepter = truthyFlag(raw["aghanims_scepter"]);
  let shard = truthyFlag(raw["aghanims_shard"]);
  const pb = buffsFromPermanent(raw["permanent_buffs"]);
  if (pb.scepter) scepter = true;
  if (pb.shard) shard = true;

  const idsFromRaw: number[] = [];
  let rawHasSlots = false;
  for (let i = 0; i < 6; i++) {
    const k = `item_${i}`;
    if (Object.prototype.hasOwnProperty.call(raw, k)) rawHasSlots = true;
    const n = Math.floor(Number(raw[k]));
    idsFromRaw.push(Number.isFinite(n) && n > 0 ? n : 0);
  }

  const perSlotIds = rawHasSlots
    ? idsFromRaw
    : mainItemIds && mainItemIds.length === 6
      ? [...mainItemIds]
      : null;

  if (perSlotIds) {
    for (const id of perSlotIds) {
      if (AGHANIM_SCEPTER_ITEM_IDS.has(id)) scepter = true;
      if (AGHANIM_SHARD_ITEM_IDS.has(id)) shard = true;
    }
  }

  for (const slot of main) {
    if (!slot?.itemKey) continue;
    const key = normItemKey(slot.itemKey);
    if (!key) continue;
    if (SCEPTER_KEYS.has(key)) scepter = true;
    if (SHARD_KEYS.has(key)) shard = true;
  }

  const fromPurch = inferScepterShardFromPurchaseStreams(raw);
  if (fromPurch.scepter) scepter = true;
  if (fromPurch.shard) shard = true;

  return { scepter, shard };
}

export function scepterShardToBuffMode(
  scepter: boolean,
  shard: boolean
): "none" | "scepter" | "shard" | "both" {
  if (scepter && shard) return "both";
  if (scepter) return "scepter";
  if (shard) return "shard";
  return "none";
}
