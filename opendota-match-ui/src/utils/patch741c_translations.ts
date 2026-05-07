import { translateNote } from "../lib/patch741Resolve";
import patch741cTranslationFull from "./patch741c_translation_full.json";
import patch741cEntityTitles from "./patch741c_entity_titles.json";

/**
 * 英文标题 → 中文：`entity_maps` 译名优先批量载入，`nameDict` 覆盖缺译或与国服用语不一致的条目。
 */
export const nameDict: Record<string, string> = {
  "Anti-Mage": "敌法师",
  Persecutor: "绝人之路",
  Tough: "坚强",
  Abaddon: "亚巴顿",
  Alchemist: "炼金术士",
  "Ancient Apparition": "远古冰魄",
};

const entityTitles = patch741cEntityTitles as Record<string, string>;

export function translatePatch741cTitle(
  text: string,
  lang: "zh" | "en"
): string {
  if (lang !== "zh") return text;
  const t = text.trim();
  const manual = nameDict[t];
  if (manual !== undefined) return manual;
  const fromMaps = entityTitles[t]?.trim();
  if (fromMaps && fromMaps !== t) return fromMaps;
  return t;
}

/** 官方英文 `note` 全文 → 中文（见 `scripts/write-p741-full-json.mjs` 生成逻辑） */
export const translationDict: Record<string, string> = {
  ...(patch741cTranslationFull as Record<string, string>),
};

export function translatePatch741cNote(text: string, lang: "zh" | "en"): string {
  if (lang !== "zh") return text;
  const t = text.trim();
  const hit = translationDict[t];
  if (hit !== undefined) return hit;
  return translateNote(text, "zh");
}
