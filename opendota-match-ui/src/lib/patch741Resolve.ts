import {
  abilities,
  ability_ids as abilityIds,
  heroes,
  item_ids as itemIds,
  items,
} from "dotaconstants";

export type PatchEntityKind = "item" | "hero" | "ability";

export type PatchEntityInfo = { name: string; iconUrl: string };

const itemIdsMap = itemIds as Record<string, string>;
const itemsMap = items as Record<string, { dname?: string }>;
const heroesMap = heroes as Record<
  string,
  { name?: string; localized_name?: string }
>;
const abilityIdsMap = abilityIds as Record<string, string>;
const abilitiesMap = abilities as Record<string, { dname?: string }>;

export function getEntityInfo(
  id: number,
  type: PatchEntityKind
): PatchEntityInfo | null {
  if (type === "item") {
    const key = itemIdsMap[String(id)];
    if (!key) return null;
    const it = itemsMap[key];
    const dname = it?.dname?.trim();
    if (!dname) return null;
    return {
      name: dname,
      iconUrl: `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${key}.png`,
    };
  }
  if (type === "hero") {
    const h = heroesMap[String(id)];
    if (!h?.name) return null;
    const shortName = h.name.replace(/^npc_dota_hero_/, "");
    const name = (h.localized_name?.trim() || shortName).trim();
    return {
      name,
      iconUrl: `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${shortName}.png`,
    };
  }
  const akey = abilityIdsMap[String(id)];
  if (!akey) return null;
  const ab = abilitiesMap[akey];
  const dname = ab?.dname?.trim();
  const name = dname || akey;
  return {
    name,
    iconUrl: `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/abilities/${akey}.png`,
  };
}

export function translateNote(text: string, lang: "zh" | "en"): string {
  if (lang !== "zh") return text;
  let s = text;
  const vocab: [RegExp, string][] = [
    [/Recipe cost/gi, "图纸价格"],
    [/Total cost/gi, "总价格"],
    [/Health bonus/gi, "生命值加成"],
    [/damage per second/gi, "每秒伤害"],
    [/movement speed/gi, "移动速度"],
    [/cooldown/gi, "冷却时间"],
  ];
  for (const [re, rep] of vocab) {
    s = s.replace(re, rep);
  }
  s = s.replace(
    /\bdecreased from (.+?) to (.+?)(?=[.,]|$)/gi,
    (_, a: string, b: string) => `从 ${a.trim()} 降低至 ${b.trim()}`
  );
  s = s.replace(
    /\bincreased from (.+?) to (.+?)(?=[.,]|$)/gi,
    (_, a: string, b: string) => `从 ${a.trim()} 增加至 ${b.trim()}`
  );
  return s;
}
