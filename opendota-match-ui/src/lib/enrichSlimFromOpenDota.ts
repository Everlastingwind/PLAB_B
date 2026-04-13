/**
 * 公开比赛在 OpenDota 常有完整 `ability_upgrades`（含天赋 ability id），
 * 本地录像 JSON 常缺。合并后 `getTalentState` 可与管线 arr 取并集点亮天赋树。
 */
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";

type OdAbilityUpgrade = { ability?: number; time?: number; [k: string]: unknown };

type OdPlayer = {
  player_slot?: number;
  ability_upgrades?: OdAbilityUpgrade[];
};

type OdMatch = {
  players?: OdPlayer[];
};

function matchIdFromSlim(slim: SlimMatchJson): number | null {
  const raw = slim.match_id ?? slim._meta?.match_id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * 拉取 OpenDota 对局并写入每名玩家的 `ability_upgrades`。
 * 本地管线可能已有「截断或缺天赋 id」的列表；OpenDota 为完整时间线时**始终覆盖**，避免漏档/半亮。
 */
export async function enrichSlimWithOpenDotaAbilityUpgrades(
  slim: SlimMatchJson
): Promise<SlimMatchJson> {
  const mid = matchIdFromSlim(slim);
  if (!mid) return slim;

  const meta = slim._meta;
  if (meta && typeof meta === "object") {
    const src = String((meta as { source?: string }).source ?? "").trim();
    if (src === "dem_result_json") {
      return slim;
    }
    if (src === "opendota_api") {
      return slim;
    }
    if ((meta as { skip_opendota_enrich?: boolean }).skip_opendota_enrich) {
      return slim;
    }
  }

  const url = `https://api.opendota.com/api/matches/${mid}`;
  let data: OdMatch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: ac.signal,
    });
    if (!res.ok) return slim;
    data = (await res.json()) as OdMatch;
  } catch {
    return slim;
  } finally {
    clearTimeout(timer);
  }

  const odPlayers = data.players;
  if (!Array.isArray(odPlayers) || odPlayers.length === 0) return slim;

  const bySlot = new Map<number, OdPlayer>();
  for (const op of odPlayers) {
    if (!op || typeof op !== "object") continue;
    const sl = op.player_slot;
    if (sl === undefined || sl === null) continue;
    bySlot.set(Number(sl), op);
  }

  const players = slim.players;
  if (!Array.isArray(players)) return slim;

  let touched = 0;
  for (const sp of players) {
    if (!sp || typeof sp !== "object") continue;
    const slot = sp.player_slot;
    if (slot === undefined || slot === null) continue;
    const od = bySlot.get(Number(slot));
    const ups = od?.ability_upgrades;
    if (!Array.isArray(ups) || ups.length === 0) continue;
    (sp as SlimPlayer & { ability_upgrades: OdAbilityUpgrade[] }).ability_upgrades =
      ups;
    touched++;
  }

  if (touched > 0) {
    const meta = { ...(slim._meta ?? {}) };
    meta.opendota_ability_upgrades_merge = {
      at: new Date().toISOString(),
      players_merged: touched,
      match_id: mid,
    };
    return { ...slim, _meta: meta };
  }

  return slim;
}
