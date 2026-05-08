/**
 * 全局英雄搜索：中文名、英文名、内部 key、数字 id、社区简称/别名、无空格英文组合、多词英文首字母缩写。
 * 与 `public/data/entity_maps.json` 中 `heroes[].key` 对齐。
 */

/** 这些英雄的「英文名首字母串」与其他英雄重复；仅用别名/全称匹配，避免缩写撞车。 */
const INITIALS_COLLISION_KEYS = new Set<string>([
  "earth_spirit",
  "ember_spirit",
  "naga_siren",
  "night_stalker",
  "shadow_shaman",
  "storm_spirit",
  "vengefulspirit",
  "void_spirit",
]);

export type HeroSearchFields = {
  key: string;
  nameEn: string;
  nameCn?: string | null;
  /** 来自 maps 的英雄 id 字符串，如 "44" */
  id?: string;
};

export function normalizeHeroSearchQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

function heroEnglishInitials(nameEn: string): string {
  return nameEn
    .split(/[\s\-]+/)
    .filter((w) => w.length > 0)
    .map((w) => {
      const m = /[A-Za-z]/.exec(w);
      return m ? m[0].toLowerCase() : "";
    })
    .join("");
}

function compactAsciiLower(s: string): string {
  return s.replace(/[\s\-']/g, "").toLowerCase();
}

function aliasMatches(
  alias: string,
  trimmedRaw: string,
  queryLower: string
): boolean {
  const a = alias.trim();
  if (!a) return false;
  if (/[\u0080-\uFFFF]/.test(a)) {
    return a.includes(trimmedRaw) || trimmedRaw.includes(a);
  }
  const al = a.toLowerCase();
  return (
    al === queryLower ||
    (queryLower.length >= 2 &&
      (al.includes(queryLower) ||
        (al.length >= 2 && queryLower.includes(al))))
  );
}

function initialsMatch(
  key: string,
  nameEn: string,
  queryLower: string
): boolean {
  if (queryLower.length < 2) return false;
  if (INITIALS_COLLISION_KEYS.has(key)) return false;
  const ini = heroEnglishInitials(nameEn);
  return ini.length >= 2 && ini === queryLower;
}

/**
 * 社区常用简称 / 俗称（英文缩写、部分昵称、中文俗称）。
 * 与自动首字母、英文名子串互补；有冲突的缩写（如三猫 es）放在此处用唯一别名区分。
 */
export const HERO_ALIASES_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  abaddon: ["亚巴顿"],
  abyssal_underlord: ["underlord", "pit", "大屁股"],
  alchemist: ["ga", "炼金"],
  ancient_apparition: ["aa", "冰魂"],
  antimage: ["am", "敌法"],
  arc_warden: ["arc", "电狗"],
  axe: ["斧王"],
  bane: ["祸乱"],
  batrider: ["bat", "蝙蝠"],
  beastmaster: ["兽王"],
  bloodseeker: ["bs", "血魔"],
  bounty_hunter: ["bh", "赏金"],
  brewmaster: ["panda", "熊猫"],
  bristleback: ["bb", "钢背"],
  broodmother: ["蜘蛛"],
  centaur: ["人马"],
  chaos_knight: ["ck", "混沌"],
  chen: ["陈"],
  clinkz: ["骨弓"],
  crystal_maiden: ["cm", "冰女"],
  dark_seer: ["ds", "兔子"],
  dark_willow: ["dw", "花仙子"],
  dawnbreaker: ["破晓"],
  dazzle: ["暗牧"],
  death_prophet: ["dp", "先知女"],
  disruptor: ["萨尔"],
  doom_bringer: ["doom", "末日"],
  dragon_knight: ["dk", "龙骑"],
  drow_ranger: ["drow", "小黑"],
  earth_spirit: ["earth", "土猫"],
  earthshaker: ["es", "shake", "牛头"],
  elder_titan: ["et", "大牛"],
  ember_spirit: ["ember", "火猫"],
  enchantress: ["小鹿"],
  enigma: ["谜团"],
  faceless_void: ["fv", "虚空"],
  furion: ["np", "先知"],
  grimstroke: ["墨客"],
  gyrocopter: ["gyro", "飞机"],
  hoodwink: ["松鼠"],
  huskar: ["哈斯卡"],
  invoker: ["inv", "卡尔"],
  jakiro: ["双头龙"],
  juggernaut: ["jugg", "主宰"],
  keeper_of_the_light: ["kotl", "光法"],
  kez: ["凯"],
  kunkka: ["船长"],
  largo: ["拉戈"],
  legion_commander: ["lc", "军团"],
  leshrac: ["老鹿"],
  lich: ["巫妖"],
  life_stealer: ["naix", "小狗"],
  lina: ["火女"],
  lion: ["莱恩"],
  lone_druid: ["ld", "德鲁伊"],
  luna: ["露娜"],
  lycan: ["狼人"],
  magnataur: ["mag", "猛犸"],
  marci: ["玛西"],
  mars: ["马尔斯"],
  medusa: ["med", "美杜莎"],
  meepo: ["狗头"],
  mirana: ["pom", "白虎"],
  monkey_king: ["mk", "大圣"],
  morphling: ["水人"],
  muerta: ["琼英"],
  naga_siren: ["naga", "小娜迦"],
  necrolyte: ["nec", "死灵法"],
  nevermore: ["sf", "影魔"],
  night_stalker: ["ns", "夜魔"],
  nyx_assassin: ["nyx", "小强"],
  obsidian_destroyer: ["od", "黑鸟"],
  ogre_magi: ["蓝胖"],
  omniknight: ["全能"],
  oracle: ["神谕"],
  pangolier: ["滚滚"],
  phantom_assassin: ["pa", "幻刺"],
  phantom_lancer: ["pl", "猴子"],
  phoenix: ["凤凰"],
  primal_beast: ["獸"],
  puck: ["帕克"],
  pudge: ["屠夫"],
  pugna: ["骨法"],
  queenofpain: ["qop", "女王"],
  rattletrap: ["clock", "发条"],
  razor: ["电棍"],
  riki: ["力丸"],
  ringmaster: ["马戏"],
  rubick: ["拉比克"],
  sand_king: ["sk", "沙王"],
  shadow_demon: ["sd", "毒狗"],
  shadow_shaman: ["ss", "小y"],
  shredder: ["timber", "伐木机"],
  silencer: ["沉默"],
  skeleton_king: ["wk", "骷髅王"],
  skywrath_mage: ["sky", "天怒"],
  slardar: ["大鱼"],
  slark: ["小鱼"],
  snapfire: ["老奶奶"],
  sniper: ["火枪"],
  spectre: ["幽鬼"],
  spirit_breaker: ["sb", "白牛"],
  storm_spirit: ["storm", "蓝猫"],
  sven: ["斯文"],
  techies: ["炸弹人"],
  templar_assassin: ["ta", "圣堂"],
  terrorblade: ["tb", "恐怖"],
  tidehunter: ["潮汐"],
  tinker: ["修补"],
  tiny: ["小小"],
  treant: ["大树"],
  troll_warlord: ["巨魔"],
  tusk: ["海民"],
  undying: ["尸王"],
  ursa: ["拍拍"],
  vengefulspirit: ["vs", "复仇"],
  venomancer: ["剧毒"],
  viper: ["毒龙"],
  visage: ["死灵龙"],
  void_spirit: ["void", "紫猫"],
  warlock: ["术士"],
  weaver: ["蚂蚁"],
  windrunner: ["wr", "风行"],
  winter_wyvern: ["冰龙"],
  witch_doctor: ["wd", "巫医"],
  wisp: ["io", "小精灵"],
  zuus: ["zeus", "宙斯"],
};

export function heroMatchesSearchQuery(
  hero: HeroSearchFields,
  rawQuery: string,
  options?: { treatEmptyQueryAsMatch?: boolean }
): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return options?.treatEmptyQueryAsMatch ?? false;
  }

  const qLower = trimmed.toLowerCase();
  const keyLower = hero.key.toLowerCase();
  const nameLower = hero.nameEn.toLowerCase();

  if (hero.id !== undefined && hero.id === trimmed) return true;

  if (keyLower.includes(qLower)) return true;
  if (nameLower.includes(qLower)) return true;

  const nameCompact = compactAsciiLower(hero.nameEn);
  const qCompact = compactAsciiLower(trimmed);
  if (qCompact.length >= 2 && nameCompact.includes(qCompact)) return true;

  const cn = hero.nameCn?.trim();
  if (cn && cn.includes(trimmed)) return true;

  for (const a of HERO_ALIASES_BY_KEY[hero.key] ?? []) {
    if (aliasMatches(a, trimmed, qLower)) return true;
  }

  if (initialsMatch(hero.key, hero.nameEn, qLower)) return true;

  return false;
}
