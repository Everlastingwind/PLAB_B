/**
 * Dota 2 结算面：神杖 / 魔晶是否生效（身上 6 格 + API 标量 + permanent_buffs）。
 * 与客户端一致：permanent_buff 2 ≈ 神杖、12 ≈ 魔晶。
 */
import type { ItemSlotMock } from "../data/mockMatchPlayers";

/** 标准 A 杖（ultimate_scepter） */
export const AGHANIM_SCEPTER_ITEM_ID = 108;

/** 常见魔晶 / 肉山魔晶 id（不同版本可能增减，与 item_key 检测互为兜底） */
export const AGHANIM_SHARD_ITEM_IDS = new Set<number>([416, 609]);

/** 神杖 id：以 108 为主；变体名依赖下方 item_key 集合 */
export const AGHANIM_SCEPTER_ITEM_IDS = new Set<number>([
  AGHANIM_SCEPTER_ITEM_ID,
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

/**
 * 从玩家原始字段 + 六主槽展示数据推导神杖/魔晶是否点亮。
 * `mainItemIds`：与 item_0..item_5 同序；缺省时仅用槽位 itemKey + API/Buff。
 */
export type ScepterShardBuffState = { scepter: boolean; shard: boolean };

/**
 * 当 permanent_buffs / API 已标记神杖或魔晶生效时，按展示策略处理主槽：
 * - 神杖：保留在主槽（用户需要在装备栏直接看到）
 * - 魔晶：若判定为已生效可继续从主槽去掉，避免重复占位
 */
export function stripConsumedAghanimsFromMainSlots(
  main: readonly (ItemSlotMock | null)[],
  mainItemIds: readonly number[],
  buff: ScepterShardBuffState
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
    if (buff.shard) {
      if (AGHANIM_SHARD_ITEM_IDS.has(id) || SHARD_KEYS.has(key)) {
        out[i] = null;
      }
    }
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
