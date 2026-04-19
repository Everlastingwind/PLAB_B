/**
 * 公开比赛在 OpenDota 常有完整 `ability_upgrades`（含天赋 ability id），
 * 本地录像 JSON 常缺。合并后 `getTalentState` 可与管线 arr 取并集点亮天赋树。
 */
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import { isPubTierMatch } from "./matchTier";

type OdAbilityUpgrade = { ability?: number; time?: number; [k: string]: unknown };

type OdPlayer = {
  player_slot?: number;
  ability_upgrades?: OdAbilityUpgrade[];
  account_id?: number;
  /** OpenDota 对局里常为职业短名（与 Steam personaname 不同） */
  name?: string | null;
  personaname?: string | null;
};

type OdMatch = {
  players?: OdPlayer[];
};

function matchIdFromSlim(slim: SlimMatchJson): number | null {
  const raw = slim.match_id ?? slim._meta?.match_id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function numId(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function looksLikeDemPlaceholderName(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  return /^player_\d+$/i.test(s);
}

/**
 * DEM 管线常丢 Steam id / 职业名；OpenDota 同场按 slot 补全（不改写技能时间线，避免与解析器冲突）。
 */
function mergeOpenDotaIdentityIntoSlimPlayer(sp: SlimPlayer, od: OdPlayer): boolean {
  let changed = false;
  const odAid = numId(od.account_id);
  const spAid = numId(sp.account_id);
  if (odAid > 0 && spAid <= 0) {
    (sp as SlimPlayer).account_id = odAid;
    changed = true;
  }

  const odPersona = String(od.personaname ?? "").trim();
  const spPersona = String(sp.personaname ?? "").trim();
  if (odPersona && looksLikeDemPlaceholderName(spPersona)) {
    sp.personaname = odPersona;
    changed = true;
  }

  const odComp = String(od.name ?? "").trim();
  const spName = String(sp.name ?? "").trim();
  if (odComp && looksLikeDemPlaceholderName(spName)) {
    sp.name = odComp;
    changed = true;
  }

  const hasPro = String(sp.pro_name ?? "").trim().length > 0;
  if (odComp && !hasPro) {
    sp.pro_name = odComp;
    changed = true;
  }

  return changed;
}

/**
 * 拉取 OpenDota 对局并写入每名玩家的 `ability_upgrades`。
 * 本地管线可能已有「截断或缺天赋 id」的列表；OpenDota 为完整时间线时**始终覆盖**，避免漏档/半亮。
 *
 * `match_tier === "pub"` 或 `_meta.source === "dem_result_json"` 时**不请求** OpenDota（Pub 隔离）。
 */
export async function enrichSlimWithOpenDotaAbilityUpgrades(
  slim: SlimMatchJson
): Promise<SlimMatchJson> {
  const mid = matchIdFromSlim(slim);
  if (!mid) return slim;
  if (isPubTierMatch(slim)) return slim;

  const meta = slim._meta;
  let isDemSource = false;
  if (meta && typeof meta === "object") {
    const src = String((meta as { source?: string }).source ?? "").trim();
    if (src === "dem_result_json") {
      isDemSource = true;
    } else if (src === "opendota_api") {
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

  let abilityTouched = 0;
  let identityTouched = 0;
  for (const sp of players) {
    if (!sp || typeof sp !== "object") continue;
    const slot = sp.player_slot;
    if (slot === undefined || slot === null) continue;
    const od = bySlot.get(Number(slot));
    if (!od) continue;

    if (isDemSource) {
      if (mergeOpenDotaIdentityIntoSlimPlayer(sp, od)) identityTouched++;
      continue;
    }

    const ups = od.ability_upgrades;
    if (!Array.isArray(ups) || ups.length === 0) continue;
    (sp as SlimPlayer & { ability_upgrades: OdAbilityUpgrade[] }).ability_upgrades =
      ups;
    abilityTouched++;
  }

  if (abilityTouched === 0 && identityTouched === 0) return slim;

  const nextMeta = { ...(slim._meta ?? {}) };
  if (abilityTouched > 0) {
    nextMeta.opendota_ability_upgrades_merge = {
      at: new Date().toISOString(),
      players_merged: abilityTouched,
      match_id: mid,
    };
  }
  if (identityTouched > 0) {
    nextMeta.opendota_identity_merge = {
      at: new Date().toISOString(),
      players_merged: identityTouched,
      match_id: mid,
    };
  }
  return { ...slim, _meta: nextMeta };
}
