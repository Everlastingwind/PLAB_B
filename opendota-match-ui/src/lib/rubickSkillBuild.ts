import type { SkillBuildStepUi } from "../data/mockMatchPlayers";
import {
  abilityIconUrl,
  normalizeDotaAssetUrl,
} from "../data/mockMatchPlayers";
import type { SlimSkillBuildStep } from "../types/slimMatch";

export const RUBICK_HERO_ID = 86;

/**
 * 加点展示白名单：4 个本体技能 + 旧版 null_field；不含 telekinesis 子技能、不含窃取技能。
 */
export const RUBICK_CORE_ABILITY_KEYS = new Set([
  "rubick_telekinesis",
  "rubick_fade_bolt",
  "rubick_spell_steal",
  "rubick_arcane_supremacy",
  "rubick_null_field",
]);

function isTalentAbilityKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("special_bonus") || k.startsWith("ad_special_bonus");
}

function isAttributeBonusAbilityKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return key.toLowerCase() === "special_bonus_attributes";
}

export function isRubickHero(heroId: number, heroKey: string): boolean {
  return heroId === RUBICK_HERO_ID || heroKey === "rubick";
}

/** 与 slim JSON `skill_build` 行一致的判断（英雄列表页等未走 slimToUi 时用） */
export function isRubickNativeSlimSkillBuildStep(s: SlimSkillBuildStep): boolean {
  const typ = s.type ?? s.kind ?? "ability";
  const isTalent = typ === "talent" || Boolean(s.is_talent);
  if (isTalent) return true;
  if (typ === "empty" || typ === "unknown") return false;
  const k = String(s.ability_key ?? "").trim().toLowerCase();
  if (!k) return false;
  if (isTalentAbilityKey(k) || isAttributeBonusAbilityKey(k)) return true;
  return RUBICK_CORE_ABILITY_KEYS.has(k);
}

export function isRubickNativeSkillBuildStep(s: SkillBuildStepUi): boolean {
  if (s.kind === "talent" || s.isTalent) return true;
  if (s.kind === "empty" || s.kind === "unknown") return false;
  const k = (s.abilityKey || "").trim().toLowerCase();
  if (!k) return false;
  if (isTalentAbilityKey(k) || isAttributeBonusAbilityKey(k)) return true;
  return RUBICK_CORE_ABILITY_KEYS.has(k);
}

function rubickNormalizeCoreAbilityIcon(s: SkillBuildStepUi): SkillBuildStepUi {
  if (s.kind !== "ability" || s.isTalent || !s.abilityKey) return s;
  const k = s.abilityKey.trim().toLowerCase();
  if (!RUBICK_CORE_ABILITY_KEYS.has(k)) return s;
  return {
    ...s,
    img: normalizeDotaAssetUrl(abilityIconUrl(s.abilityKey)),
  };
}

export function filterRubickSkillBuildForDisplay(
  heroId: number,
  heroKey: string,
  steps: SkillBuildStepUi[] | undefined
): SkillBuildStepUi[] | undefined {
  if (!steps?.length) return steps;
  if (!isRubickHero(heroId, heroKey)) return steps;
  const kept = steps.filter((s) => isRubickNativeSkillBuildStep(s));
  if (kept.length === 0) return undefined;
  return kept.map((s, i) => {
    const n = i + 1;
    return rubickNormalizeCoreAbilityIcon({ ...s, step: n, level: n });
  });
}
