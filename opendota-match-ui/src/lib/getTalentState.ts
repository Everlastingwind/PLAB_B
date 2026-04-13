/**
 * 天赋树点亮：**截取书中 talents 最后 8 项 + 严格下标**（0,1→10 级右/左 … 6,7→25 级）。
 * 兼容 `talents` 项为 **纯字符串** 或 `{ name }` 对象；超长数组视为版本追加，末尾 8 项为当前版本。
 */
import type { EntityMapsPayload } from "../types/entityMaps";
import type { TalentTreeUi } from "../data/mockMatchPlayers";
import abilityIdsRaw from "../data/ability_ids.json";
import talentBookJson from "../data/opendota_hero_ability_talent_ids.json";

export const TALENT_TIER_LEVELS = [10, 15, 20, 25] as const;
export type TalentTierLevel = (typeof TALENT_TIER_LEVELS)[number];
export type TalentBranchPick = "left" | "right" | "none";

/** 每层是左、右还是未学 */
export type TalentState = Record<TalentTierLevel, TalentBranchPick>;

/** OpenDota/dotaconstants 风格：heroes[hero_id].name = npc_dota_hero_* */
export type TalentHeroEntry = {
  name: string;
};

/** OpenDota / dotaconstants：天赋槽可为 internal name 字符串，或带 name 的对象 */
export type TalentSlotEntry = string | { name?: string; level?: number };

export type TalentHeroAbilitiesBlock = {
  talents: TalentSlotEntry[];
};

/**
 * abilities 以 internal name 为键，与需求中 constants.abilities[talent.name].id 一致。
 * id 使用字符串，与 learnedIds 一致。
 */
export type TalentAbilitiesMap = Record<string, { id: string }>;

export type TalentConstants = {
  heroes: Record<string, TalentHeroEntry>;
  hero_abilities: Record<string, TalentHeroAbilitiesBlock>;
  abilities: TalentAbilitiesMap;
};

/** 管线玩家字段：ability_upgrades_arr 或 OpenDota 式 ability_upgrades */
export type TalentPlayerInput = {
  hero_id: number;
  /**
   * 终局英雄等级。若提供，则仅当 level ≥ 10/15/20/25 时才允许对应档从 learned 集合推断为已选，
   * 避免录像初始化/OpenDota 并集里「出现过的天赋 id」误判为已加点。
   */
  hero_level?: number | null;
  ability_upgrades_arr?: readonly number[] | null;
  ability_upgrades?: ReadonlyArray<{
    ability?: number | string;
    time?: number;
  }> | null;
  /**
   * 与 arr 合并为「已学 ability_id」集合（去重）。
   * 应包含 skill_build / ability_timeline / talents_taken 等并集，避免单源漏天赋数值 ID。
   */
  learned_ability_id_union?: readonly number[] | null;
};

export type OpBookTalent = {
  name: string;
  level: number;
  id: number | null;
  ids?: number[];
};

export type OpBookHeroBlock = {
  talents: OpBookTalent[];
};

export type OpBookPayload = {
  heroes: Record<string, OpBookHeroBlock>;
};

const TALENT_BOOK = talentBookJson as { heroes: Record<string, OpBookHeroBlock> };

/** ability_ids：「数值 id 字符串 → internal name」反转为 abilities[name] = { id } */
function buildAbilitiesByNameFromAbilityIds(
  raw: Record<string, string>
): TalentAbilitiesMap {
  const out: TalentAbilitiesMap = {};
  for (const [sid, name] of Object.entries(raw)) {
    if (!name || String(sid).includes(",")) continue;
    out[name] = { id: String(sid) };
  }
  return out;
}

/** 将 talents 槽列表规范为 internal name（支持纯字符串项） */
function normalizeTalentNamesFromSlotList(
  raw: readonly TalentSlotEntry[] | null | undefined
): string[] {
  if (!raw?.length) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t === "string") {
      const s = t.trim();
      if (s) out.push(s);
    } else if (t && typeof t === "object") {
      const s = String((t as { name?: string }).name ?? "").trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** 从 opendota 合并书构建 hero_abilities；保留字符串项或 { name, level? } */
function buildHeroAbilitiesTalentsOnly(
  book: typeof TALENT_BOOK
): Record<string, TalentHeroAbilitiesBlock> {
  const o: Record<string, TalentHeroAbilitiesBlock> = {};
  for (const [npc, block] of Object.entries(book.heroes)) {
    const t = block?.talents;
    if (!Array.isArray(t) || t.length === 0) continue;
    const talents: TalentSlotEntry[] = [];
    for (const x of t as unknown[]) {
      if (typeof x === "string") {
        const s = x.trim();
        if (s) talents.push(s);
      } else if (x && typeof x === "object") {
        const row = x as OpBookTalent;
        const nm = String(row.name ?? "").trim();
        if (!nm) continue;
        talents.push({
          name: nm,
          level: typeof row.level === "number" ? row.level : undefined,
        });
      }
    }
    if (talents.length) o[npc] = { talents };
  }
  return o;
}

const ABILITIES_BY_NAME = buildAbilitiesByNameFromAbilityIds(
  abilityIdsRaw as Record<string, string>
);
const HERO_ABILITIES_TALENTS = buildHeroAbilitiesTalentsOnly(TALENT_BOOK);

function emptyTalentState(): TalentState {
  return { 10: "none", 15: "none", 20: "none", 25: "none" };
}

/**
 * 用 entity_maps.heroes 构造 heroes[hero_id].name = npc_dota_hero_{key}
 */
export function createTalentConstants(
  mapsHeroes: EntityMapsPayload["heroes"]
): TalentConstants {
  const heroes: Record<string, TalentHeroEntry> = {};
  for (const [id, h] of Object.entries(mapsHeroes)) {
    const raw = (h?.key ?? "").trim();
    if (!raw) continue;
    const shortKey = raw.replace(/^npc_dota_hero_/, "");
    heroes[id] = { name: `npc_dota_hero_${shortKey}` };
  }
  return {
    heroes,
    hero_abilities: HERO_ABILITIES_TALENTS,
    abilities: ABILITIES_BY_NAME,
  };
}

/** 是否存在按时间/顺序的加点序列（优先于「id 并集」推断天赋） */
export function playerHasOrderedAbilityUpgrades(
  player: TalentPlayerInput
): boolean {
  return buildOrderedAbilityIds(player).length > 0;
}

function buildOrderedAbilityIds(player: TalentPlayerInput): number[] {
  const out: number[] = [];
  if (Array.isArray(player.ability_upgrades) && player.ability_upgrades.length > 0) {
    const rows = [...player.ability_upgrades]
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const t = (x as { time?: number }).time;
        const tm = typeof t === "number" && Number.isFinite(t) ? t : Number(t) || 0;
        return { ab: (x as { ability?: number | string }).ability, t: tm };
      })
      .filter((x) => x.ab != null && String(x.ab).trim() !== "");
    rows.sort((a, b) => a.t - b.t);
    for (const r of rows) {
      const n = Math.floor(Math.abs(Number(r.ab)));
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return out;
  }
  if (Array.isArray(player.ability_upgrades_arr)) {
    for (const x of player.ability_upgrades_arr) {
      const n = Math.floor(Math.abs(Number(x)));
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
  }
  return out;
}

function stripLeadingTalentRun(
  seq: readonly number[],
  slotTalentIdSet: Set<string>
): number[] {
  let i = 0;
  while (i < seq.length) {
    const sid = String(seq[i]);
    if (!slotTalentIdSet.has(sid)) break;
    i++;
  }
  if (i >= 6) return [...seq.slice(i)];
  return [...seq];
}

function maxAssignableTiers(capLv: number | null, hasCap: boolean): number {
  if (!hasCap || capLv == null) return 4;
  return [10, 15, 20, 25].filter((hl) => capLv >= hl).length;
}

/** 按序列写入 state；返回已点档位数 */
function applySequentialTalentPicks(
  state: TalentState,
  seq: readonly number[],
  talentIds: Array<string | null>,
  slotTalentIdSet: Set<string>,
  capLv: number | null,
  hasCap: boolean
): number {
  const maxPick = maxAssignableTiers(hasCap ? capLv! : 30, hasCap);
  const assignedTier = new Set<number>();
  for (const rawN of seq) {
    if (assignedTier.size >= maxPick) break;
    const sid = String(Math.floor(Math.abs(rawN)));
    if (!slotTalentIdSet.has(sid)) continue;
    const slotIdx = talentIds.findIndex((t) => t === sid);
    if (slotIdx < 0) continue;
    const level = (10 + Math.floor(slotIdx / 2) * 5) as TalentTierLevel;
    if (level !== 10 && level !== 15 && level !== 20 && level !== 25) continue;
    if (hasCap && capLv! < level) continue;
    if (assignedTier.has(level)) continue;
    const position: "left" | "right" = slotIdx % 2 === 0 ? "right" : "left";
    state[level] = position;
    assignedTier.add(level);
  }
  return assignedTier.size;
}

/**
 * 将玩家加点翻译为四档 left / right / none。
 * 优先按 **ability_upgrades（time）或 ability_upgrades_arr 顺序** 推断：先剥离开局连续 6+ 条天赋 id（录像扫树），
 * 再按序每种天赋档只取 **第一次** 出现，并结合 hero_level 上限；避免 learned 并集把未点档位标亮。
 * 无序列时回退到旧「并集」逻辑。
 */
export function getTalentState(
  player: TalentPlayerInput,
  constants: TalentConstants | null | undefined
): TalentState {
  const state = emptyTalentState();
  if (!constants) return state;

  const heroData = constants.heroes[String(player.hero_id)];
  const heroName = heroData?.name;
  if (!heroName) return state;

  const rawSlots = constants.hero_abilities[heroName]?.talents;
  let talentNames = normalizeTalentNamesFromSlotList(rawSlots);
  if (talentNames.length === 0) {
    const book = TALENT_BOOK.heroes[heroName]?.talents;
    talentNames = normalizeTalentNamesFromSlotList(book as TalentSlotEntry[]);
  }
  if (talentNames.length === 0) return state;

  if (talentNames.length > 8) {
    talentNames = talentNames.slice(-8);
  }

  let talentIds: Array<string | null> = talentNames.map((name) => {
    const obj = constants.abilities[name];
    return obj?.id != null && String(obj.id).trim() !== ""
      ? String(obj.id)
      : null;
  });

  // Primal Beast compatibility: some local DEM trees still expose the old
  // `special_bonus_attack_damage_30` slot key, while actual learned id is the
  // new `special_bonus_attack_damage_25` (id 6009). Align slot id to new key.
  if (heroName === "npc_dota_hero_primal_beast") {
    const dmg25Id = constants.abilities["special_bonus_attack_damage_25"]?.id;
    if (dmg25Id != null && String(dmg25Id).trim() !== "") {
      for (let i = 0; i < talentNames.length; i++) {
        if (talentNames[i] === "special_bonus_attack_damage_30") {
          talentIds[i] = String(dmg25Id);
        }
      }
    }
  }

  /** ability_ids 未收录的新天赋名时，用 opendota 天赋书中的数值 id 补槽（与 Kez 等新英雄对齐） */
  const bookTalentsRaw = TALENT_BOOK.heroes[heroName]?.talents;
  if (Array.isArray(bookTalentsRaw)) {
    const bookTalents = bookTalentsRaw as unknown[];
    for (let i = 0; i < talentIds.length; i++) {
      if (talentIds[i]) continue;
      const nm = String(talentNames[i] ?? "").trim();
      if (!nm) continue;
      for (const el of bookTalents) {
        let rowName = "";
        if (typeof el === "string") {
          rowName = el.trim();
        } else if (el && typeof el === "object" && !Array.isArray(el)) {
          rowName = String((el as OpBookTalent).name ?? "").trim();
        }
        if (rowName !== nm) continue;
        if (typeof el !== "object" || el === null || Array.isArray(el)) break;
        const row = el as OpBookTalent;
        const idRaw = row.ids?.[0] ?? row.id;
        const idNum =
          typeof idRaw === "number"
            ? idRaw
            : typeof idRaw === "string"
              ? Number(idRaw)
              : NaN;
        if (Number.isFinite(idNum) && idNum > 0) {
          talentIds[i] = String(Math.floor(idNum));
        }
        break;
      }
    }
  }

  const capLvRaw = player.hero_level;
  const capLv =
    capLvRaw != null && capLvRaw !== undefined && String(capLvRaw).trim() !== ""
      ? Math.floor(Number(capLvRaw))
      : null;
  const hasCap =
    capLv != null && Number.isFinite(capLv) && capLv > 0 && capLv <= 50;

  const slotTalentIdSet = new Set(
    talentIds.filter((x): x is string => Boolean(x))
  );

  const orderedRaw = buildOrderedAbilityIds(player);
  const ordered = stripLeadingTalentRun(orderedRaw, slotTalentIdSet);

  let nSeq = applySequentialTalentPicks(
    state,
    ordered,
    talentIds,
    slotTalentIdSet,
    capLv,
    hasCap
  );
  if (nSeq === 0 && ordered.length === 0 && orderedRaw.length > 0) {
    Object.assign(state, emptyTalentState());
    nSeq = applySequentialTalentPicks(
      state,
      orderedRaw,
      talentIds,
      slotTalentIdSet,
      capLv,
      hasCap
    );
  }

  if (nSeq === 0 && orderedRaw.length === 0) {
    const learned = new Set<string>();
    const addNums = (arr: readonly number[] | null | undefined) => {
      if (!arr?.length) return;
      for (const raw of arr) {
        const n = Math.floor(Math.abs(Number(raw)));
        if (Number.isFinite(n) && n > 0) learned.add(String(n));
      }
    };
    addNums(player.ability_upgrades_arr ?? undefined);
    addNums(player.learned_ability_id_union ?? undefined);
    if (Array.isArray(player.ability_upgrades)) {
      for (const obj of player.ability_upgrades) {
        const s = String(obj?.ability ?? "").trim();
        if (s && s !== "undefined") learned.add(s);
      }
    }
    if (learned.size === 0) return state;

    for (let i = 0; i < talentIds.length; i++) {
      const id = talentIds[i];
      if (!id || !learned.has(id)) continue;
      const level = (10 + Math.floor(i / 2) * 5) as TalentTierLevel;
      if (level !== 10 && level !== 15 && level !== 20 && level !== 25) continue;
      if (hasCap && capLv! < level) continue;
      const position: "left" | "right" = i % 2 === 0 ? "right" : "left";
      state[level] = position;
    }
  }

  return state;
}

function npcFromHeroId(
  heroId: number,
  heroes: EntityMapsPayload["heroes"]
): string | null {
  const h = heroes[String(heroId)];
  const key = (h?.key ?? "").trim();
  if (!key) return null;
  const shortKey = key.replace(/^npc_dota_hero_/, "");
  return `npc_dota_hero_${shortKey}`;
}

function labelForTalentName(
  talentName: string,
  abilities: EntityMapsPayload["abilities"] | undefined
): { abilityKey: string; labelCn: string; labelEn: string } {
  const sid = ABILITIES_BY_NAME[talentName]?.id;
  const entry = sid && abilities ? abilities[sid] : undefined;
  const key = (entry?.key ?? talentName).trim();
  return {
    abilityKey: key,
    labelCn: (entry?.nameCn ?? talentName).trim(),
    labelEn: (entry?.nameEn ?? "").trim(),
  };
}

const BOOK_PAYLOAD: OpBookPayload = {
  heroes: (talentBookJson as { heroes: Record<string, OpBookHeroBlock> }).heroes,
};

/**
 * 当管线未带 talent_tree 时，用书中 talents **最后 8 项 + 严格下标** 搭 UI（与 getTalentState 一致）。
 */
export function buildTalentTreeUiFromBook(
  hero_id: number,
  maps: EntityMapsPayload
): TalentTreeUi | null {
  const npc = npcFromHeroId(hero_id, maps.heroes);
  if (!npc) return null;
  const raw = BOOK_PAYLOAD.heroes[npc]?.talents;
  if (!Array.isArray(raw) || raw.length < 2) return null;

  let names = normalizeTalentNamesFromSlotList(raw as TalentSlotEntry[]);
  if (names.length > 8) names = names.slice(-8);
  if (names.length < 2) return null;

  const tiers = TALENT_TIER_LEVELS.map((hl, tierIdx) => {
    const i0 = tierIdx * 2;
    const tR = names[i0];
    const tL = names[i0 + 1];
    if (!tR || !tL) {
      return {
        heroLevel: hl,
        left: { abilityKey: "", labelCn: "—", labelEn: "" },
        right: { abilityKey: "", labelCn: "—", labelEn: "" },
        selected: null,
      };
    }
    return {
      heroLevel: hl,
      left: labelForTalentName(tL, maps.abilities),
      right: labelForTalentName(tR, maps.abilities),
      selected: null,
    };
  });
  return { tiers, dotsLearned: 0 };
}

/**
 * 将 getTalentState 结果写入 tiers[].selected。
 * 当数值推断为 left/right 时**优先覆盖**已有选择，避免管线 `talent_picks` / key 误匹配挡住
 * OpenDota `ability_upgrades` 中的正确档位（表现为「有的档不亮」或「半亮」）。
 */
export function mergeTalentTreeWithAbilityIdState(
  tree: TalentTreeUi | null | undefined,
  state: TalentState | null | undefined
): TalentTreeUi | null {
  if (!tree?.tiers?.length || !state) return tree ?? null;
  const tiers = tree.tiers.map((tier) => {
    const hl = tier.heroLevel;
    if (hl !== 10 && hl !== 15 && hl !== 20 && hl !== 25) return tier;
    const s = state[hl as TalentTierLevel];
    if (s === "left" || s === "right") return { ...tier, selected: s };
    return tier;
  });
  const dotsLearned = tiers.filter(
    (t) => t.selected === "left" || t.selected === "right"
  ).length;
  return { ...tree, tiers, dotsLearned };
}

/**
 * 客户端规则：10/15/20/25 档天赋仅当英雄等级 ≥ 该档才可视为已选（与游戏一致）。
 * 用于纠正 learned 集合过宽、管线多源合并导致的「低档英雄四档全亮」。
 */
export function clampTalentTreeToHeroLevel(
  tree: TalentTreeUi | null | undefined,
  heroLevel: number | null | undefined
): TalentTreeUi | null | undefined {
  if (tree == null) return tree ?? null;
  if (heroLevel == null || heroLevel === undefined) return tree;
  const lv = Math.floor(Number(heroLevel));
  if (!Number.isFinite(lv) || lv <= 0 || lv > 50) return tree;
  if (!tree.tiers?.length) return tree;
  const tiers = tree.tiers.map((tier) => {
    const req = tier.heroLevel;
    if (
      (req === 10 || req === 15 || req === 20 || req === 25) &&
      lv < req &&
      (tier.selected === "left" || tier.selected === "right")
    ) {
      return { ...tier, selected: null };
    }
    return tier;
  });
  const dotsLearned = tiers.filter(
    (t) => t.selected === "left" || t.selected === "right"
  ).length;
  return { ...tree, tiers, dotsLearned };
}
