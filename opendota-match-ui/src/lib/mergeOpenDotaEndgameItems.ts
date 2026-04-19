/**
 * 本地 DEM slim 在 OpenDota 已收录时，用官方对局 JSON 覆盖终局 6 格 + 神杖/魔晶 buff，
 * 与客户端结算栏一致（含空槽）；404 时静默跳过。不合并中立物品。
 */
import { STEAM_CDN } from "../data/mockMatchPlayers";
import type { EntityMapsPayload } from "../types/entityMaps";
import type { SlimMatchJson, SlimPlayer, SlimItemSlot } from "../types/slimMatch";
import { isPubTierMatch } from "./matchTier";

type OdPlayer = Record<string, unknown>;

function numId(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function slimSlotFromItemId(
  slot: number,
  itemId: number,
  maps: EntityMapsPayload
): SlimItemSlot {
  if (itemId <= 0) {
    return {
      slot,
      item_id: 0,
      item_key: null,
      item_name_en: "",
      item_name_cn: "",
      image_url: "",
      empty: true,
    };
  }
  const row = maps.items[String(itemId)];
  const rawKey = row?.key?.trim() ?? "";
  const key = rawKey ? rawKey.replace(/^item_/, "") : null;
  const clean = key ?? "";
  const imageUrl = clean
    ? `${STEAM_CDN}/apps/dota2/images/dota_react/items/${clean}.png`
    : "";
  return {
    slot,
    item_id: itemId,
    item_key: key,
    item_name_en: row?.nameEn ?? clean,
    item_name_cn: row?.nameCn ?? row?.nameEn ?? clean,
    image_url: imageUrl,
    empty: !key,
  };
}

/**
 * 若 OpenDota 存在该 match_id，将 ``players[].items_slot`` / 神杖魔晶 与 API 对齐。
 * @returns 是否至少合并了一名玩家
 */
export async function mergeOpenDotaEndgameItemsIntoSlim(
  slim: SlimMatchJson,
  maps: EntityMapsPayload
): Promise<boolean> {
  const mid = numId(slim.match_id);
  if (mid <= 0) return false;
  if (isPubTierMatch(slim)) return false;

  const meta = slim._meta;
  if (meta && typeof meta === "object") {
    const src = String((meta as { source?: string }).source ?? "").trim();
    if (src === "opendota_api") return false;
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  let od: { players?: OdPlayer[] };
  try {
    const res = await fetch(
      `https://api.opendota.com/api/matches/${mid}`,
      { cache: "no-store", signal: ac.signal }
    );
    if (!res.ok) return false;
    od = (await res.json()) as { players?: OdPlayer[] };
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }

  const odPlayers = od.players;
  if (!Array.isArray(odPlayers) || odPlayers.length === 0) return false;

  const bySlot = new Map<number, OdPlayer>();
  for (const row of odPlayers) {
    if (!row || typeof row !== "object") continue;
    const ps = row["player_slot"];
    if (ps === undefined || ps === null) continue;
    const s = numId(ps);
    bySlot.set(s, row);
  }

  let merged = 0;
  const players = slim.players;
  if (!Array.isArray(players)) return false;

  for (const p of players) {
    if (!p || typeof p !== "object") continue;
    const slot = numId(p.player_slot);
    const src = bySlot.get(slot);
    if (!src) continue;

    const slots: SlimItemSlot[] = [];
    for (let i = 0; i < 6; i++) {
      const id = numId(src[`item_${i}`]);
      slots.push(slimSlotFromItemId(i, id, maps));
      (p as Record<string, unknown>)[`item_${i}`] = id;
    }
    (p as SlimPlayer).items_slot = slots;

    if ("aghanims_scepter" in src) {
      (p as SlimPlayer).aghanims_scepter = src["aghanims_scepter"] as
        | number
        | boolean;
    }
    if ("aghanims_shard" in src) {
      (p as SlimPlayer).aghanims_shard = src["aghanims_shard"] as
        | number
        | boolean;
    }
    if (Array.isArray(src["permanent_buffs"])) {
      (p as SlimPlayer).permanent_buffs = src[
        "permanent_buffs"
      ] as SlimPlayer["permanent_buffs"];
    }

    merged++;
  }

  if (merged > 0) {
    const meta = { ...(slim._meta ?? {}) };
    meta.opendota_endgame_items_merge = {
      at: new Date().toISOString(),
      match_id: mid,
      players_merged: merged,
    };
    slim._meta = meta;
  }

  return merged > 0;
}
