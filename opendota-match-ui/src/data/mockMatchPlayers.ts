/**
 * 比赛玩家表格 + 扳选 Mock（对齐 OpenDota「物品」页结构）
 * 图片 CDN：Steam Cloudflare（与客户端资源路径一致）
 */
export const STEAM_CDN =
  "https://cdn.cloudflare.steamstatic.com";

/**
 * dotaconstants / 管线常见 `/apps/dota2/...` 相对路径；若不拼 CDN，浏览器会向本站请求 → 404空白。
 * 协议相对 `//cdn...` 亦归一为 https。
 */
export function normalizeDotaAssetUrl(raw: string): string {
  const u = (raw || "").trim();
  if (!u) return "";
  if (u.startsWith("https://") || u.startsWith("http://")) return u.split("?")[0];
  if (u.startsWith("//")) return `https:${u}`.split("?")[0];
  if (u.startsWith("/")) return `${STEAM_CDN}${u}`;
  if (u.startsWith("apps/")) return `${STEAM_CDN}/${u}`;
  return u;
}

/**
 * Steam CDN小图：`referrerPolicy=no-referrer` 减少部分环境下拒链。
 * 首屏少量头像用 eager；技能/物品/列表量多，用 lazy 减轻单域名并发排队。
 */
export const steamCdnImgHero = {
  loading: "eager" as const,
  decoding: "async" as const,
  referrerPolicy: "no-referrer" as const,
};

export const steamCdnImgDefer = {
  loading: "lazy" as const,
  decoding: "async" as const,
  referrerPolicy: "no-referrer" as const,
};

/** 英雄：`dota_react/heroes/{英文名}.png` */
export function heroIconUrl(heroKey: string): string {
  const key = heroKey.replace(/^npc_dota_hero_/, "");
  return `${STEAM_CDN}/apps/dota2/images/dota_react/heroes/${key}.png`;
}

/** 物品：`dota_react/items/{英文名}.png` */
export function itemIconUrl(itemKey: string): string {
  return `${STEAM_CDN}/apps/dota2/images/dota_react/items/${itemKey}.png`;
}

/** 技能/天赋图标（与清洗管线 image_url 同源路径时可与 STEAM_CDN 拼接） */
export function abilityIconUrl(abilityKey: string): string {
  const key = abilityKey.replace(/^ability_/, "");
  return `${STEAM_CDN}/apps/dota2/images/dota_react/abilities/${key}.png`;
}

/** CDN 404 或未知 ability 时的占位（与客户端 filler 一致） */
export const abilityIconFallbackUrl = `${STEAM_CDN}/apps/dota2/images/dota_react/abilities/filler_ability.png`;

/** 中立物品格底图（仅作槽位背景，非物品图标） */
export const neutralSlotBgUrl = `${STEAM_CDN}/apps/dota2/images/dota_react/icons/neutral_slot.png`;

/** 客户端 HUD 天赋树图标（加点时间轴天赋节点） */
export const dotaTalentsIconUrl = `${STEAM_CDN}/apps/dota2/images/dota_react/icons/talents.svg`;

/** 物品格上的覆盖信息：冷却时间 / 充能等 */
export type ItemOverlay =
  | { kind: "cd"; text: string }
  | { kind: "charges"; text: string }
  | { kind: "time"; text: string };

export interface ItemSlotMock {
  /** dotaconstants 物品 key，如 black_king_bar */
  itemKey: string;
  /** 后端写入的完整 CDN（若有则优先于 itemKey 拼接） */
  imageUrl?: string;
  overlay?: ItemOverlay;
}

export interface PlayerBuffsMock {
  /** 是否显示 A 杖 / 魔晶 / 银月 等图标位 */
  aghanims?: "none" | "scepter" | "shard" | "both";
  moonShard?: boolean;
}

/** 单步加点（技能或天赋），对齐 latest_match 中 ability_timeline */
export interface AbilityBuildStep {
  time: number | null;
  abilityId: number;
  abilityKey: string | null;
  abilityNameEn: string;
  abilityNameCn: string;
  imageUrl: string;
  isTalent: boolean;
  level?: number;
}

/** 后端 skill_build 单步（25 格）；天赋用 desc + 树形占位图标 */
export interface SkillBuildStepUi {
  step: number;
  kind: "ability" | "talent" | "empty" | "unknown";
  /** 后端 v2：与 kind 一致时可省略 */
  level?: number;
  abilityKey: string | null;
  isTalent: boolean;
  /** 技能图标 URL（含 img_url 合并） */
  img: string;
  labelEn: string;
  labelCn: string;
  /** 天赋/未知 ID 等：优先作为 Tooltip 文案 */
  desc?: string;
  /** 后端 talent.name 或 ability.name */
  name?: string;
}

/** 后端 talent_picks 单条（四档左右 + 展示名） */
export interface TalentPickUi {
  level: number;
  direction: string;
  talent_name?: string;
  name?: string;
}

/** 与 latest_match.json 中 talent_tree 对齐；加点由 tiers[].selected 与 dots_learned 描述 */
export interface TalentTreeUi {
  tiers: {
    heroLevel: number;
    left: { labelCn: string; labelEn: string; abilityKey: string };
    right: { labelCn: string; labelEn: string; abilityKey: string };
    /** 本层已选左/右天赋，来自 JSON；可与 skill_build 中天赋步交叉校验 */
    selected: "left" | "right" | null;
  }[];
  /** 已点天赋层数（10/15/20/25 中有选择的档位数） */
  dotsLearned: number;
}

export interface PlayerRowMock {
  slot: number;
  /** DEM / API 原始英雄 ID，用于与 entity_maps 对照 */
  heroId?: number;
  /** 用于头像 URL（已由 hero_id 解析） */
  heroKey: string;
  /** 来自清洗 JSON hero_name_cn，用于弹窗标题 */
  heroNameCn?: string;
  /** 职业选手名（account_id 匹配 pro 列表） */
  proName?: string | null;
  /** 用于选手页链接；无或非正数时不展示可点击链接 */
  accountId?: number;
  steamName: string;
  /** @deprecated 展示改用 leaderboardRank；保留兼容旧 mock */
  rankLabel: string;
  rankColorClass: string;
  /** OpenDota `leaderboard_rank`：全球天梯名次，有则显示为极简 Rank / 奖牌样式 */
  leaderboardRank?: number;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  netWorth?: number;
  gpm: number;
  xpm: number;
  heroDamage: number;
  towerDamage: number;
  /** 无数据时为 undefined，界面显示「-」 */
  heroHeal?: number;
  /**
   * 结算面：神杖 / 魔晶是否生效（由 slim 适配器从 item_0..5、Buff、API 标量合并）。
   * 未设置时物品列用 `buffs.aghanims` 推断（兼容旧 mock）。
   */
  scepterActive?: boolean;
  shardActive?: boolean;
  items: {
    main: [ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null];
    /** 背包区：常见为 3 小格，此处用数组表示 */
    backpack: [ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null];
    neutral: ItemSlotMock | null;
  };
  buffs: PlayerBuffsMock;
  /** 已弃用：详情页不展示中立槽，适配层恒为 null */
  neutralImg?: string | null;
  /** 25 步 skill_build（优先于 abilityTimeline 展示） */
  skillBuild?: SkillBuildStepUi[];
  /** 天赋树（头像旁徽章 + 悬停） */
  talentTree?: TalentTreeUi | null;
  /** 四档天赋左右（hero_abilities 8 槽推断 + 解析器覆盖），优先点亮 2×4 网格 */
  talentPicks?: TalentPickUi[];
  /** 本局技能加点顺序（含天赋行，isTalent 区分） */
  abilityTimeline?: AbilityBuildStep[];
  /** 仅天赋（与管线 talents_taken 一致；缺省时可由 abilityTimeline 筛出） */
  talentsTaken?: AbilityBuildStep[];
}

export interface TeamTableMock {
  teamName: string;
  /** 阵营区块标题，如「天辉」「夜魇」 */
  factionLabel?: string;
  side: "radiant" | "dire";
  won: boolean;
  players: PlayerRowMock[];
}

/** 一名「全字段」示例玩家：Invoker，含 BKB 冷却、瓶子充能等 */
export const exampleFullPlayerInvoker: PlayerRowMock = {
  slot: 0,
  heroKey: "invoker",
  heroNameCn: "祈求者",
  steamName: "Somnus丶M",
  rankLabel: "",
  rankColorClass: "text-zinc-500",
  leaderboardRank: 154,
  level: 25,
  kills: 12,
  deaths: 4,
  assists: 18,
  lastHits: 412,
  denies: 18,
  netWorth: 28420,
  gpm: 712,
  xpm: 890,
  heroDamage: 42680,
  towerDamage: 8420,
  heroHeal: 0,
  items: {
    main: [
      { itemKey: "travel_boots_2", overlay: { kind: "cd", text: "0:12" } },
      { itemKey: "sheepstick", overlay: { kind: "cd", text: "12:40" } },
      { itemKey: "black_king_bar", overlay: { kind: "cd", text: "24:17" } },
      { itemKey: "ultimate_scepter", overlay: { kind: "cd", text: "—" } },
      { itemKey: "sphere", overlay: { kind: "cd", text: "6:05" } },
      { itemKey: "bottle", overlay: { kind: "charges", text: "3:11" } },
    ],
    backpack: [
      { itemKey: "tpscroll" },
      { itemKey: "ward_observer" },
      { itemKey: "clarity" },
    ],
    neutral: { itemKey: "apex", overlay: { kind: "time", text: "38:02" } },
  },
  scepterActive: true,
  shardActive: true,
  buffs: { aghanims: "both", moonShard: true },
  /** 示意加点与天赋（无对局 JSON 时用于演示弹窗） */
  abilityTimeline: [
    {
      time: 0,
      abilityId: 5370,
      abilityKey: "invoker_quas",
      abilityNameEn: "Quas",
      abilityNameCn: "冰(Quas)",
      imageUrl: abilityIconUrl("invoker_quas"),
      isTalent: false,
    },
    {
      time: 12,
      abilityId: 5371,
      abilityKey: "invoker_wex",
      abilityNameEn: "Wex",
      abilityNameCn: "雷(Wex)",
      imageUrl: abilityIconUrl("invoker_wex"),
      isTalent: false,
    },
    {
      time: 28,
      abilityId: 5372,
      abilityKey: "invoker_exort",
      abilityNameEn: "Exort",
      abilityNameCn: "火(Exort)",
      imageUrl: abilityIconUrl("invoker_exort"),
      isTalent: false,
    },
    {
      time: 48,
      abilityId: 5373,
      abilityKey: "invoker_invoke",
      abilityNameEn: "Invoke",
      abilityNameCn: "祈求",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: false,
    },
    {
      time: 600,
      abilityId: 5370,
      abilityKey: "invoker_quas",
      abilityNameEn: "Quas",
      abilityNameCn: "冰(Quas)",
      imageUrl: abilityIconUrl("invoker_quas"),
      isTalent: false,
    },
    {
      time: 630,
      abilityId: 6101,
      abilityKey: "special_bonus_unique_invoker_1",
      abilityNameEn: "Talent L10",
      abilityNameCn: "10 级天赋",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: true,
    },
    {
      time: 900,
      abilityId: 6102,
      abilityKey: "special_bonus_unique_invoker_2",
      abilityNameEn: "Talent L15",
      abilityNameCn: "15 级天赋",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: true,
    },
    {
      time: 1200,
      abilityId: 6103,
      abilityKey: "special_bonus_unique_invoker_3",
      abilityNameEn: "Talent L20",
      abilityNameCn: "20 级天赋",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: true,
    },
    {
      time: 1500,
      abilityId: 6104,
      abilityKey: "special_bonus_unique_invoker_4",
      abilityNameEn: "Talent L25",
      abilityNameCn: "25 级天赋",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: true,
    },
  ],
  talentsTaken: [
    {
      time: 630,
      abilityId: 6101,
      abilityKey: "special_bonus_unique_invoker_1",
      abilityNameEn: "Talent L10",
      abilityNameCn: "10 级天赋",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: true,
    },
    {
      time: 900,
      abilityId: 6102,
      abilityKey: "special_bonus_unique_invoker_2",
      abilityNameEn: "Talent L15",
      abilityNameCn: "15 级天赋",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: true,
    },
    {
      time: 1200,
      abilityId: 6103,
      abilityKey: "special_bonus_unique_invoker_3",
      abilityNameEn: "Talent L20",
      abilityNameCn: "20 级天赋",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: true,
    },
    {
      time: 1500,
      abilityId: 6104,
      abilityKey: "special_bonus_unique_invoker_4",
      abilityNameEn: "Talent L25",
      abilityNameCn: "25 级天赋",
      imageUrl: abilityIconUrl("invoker_invoke"),
      isTalent: true,
    },
  ],
};

/** BIZ GAMING（天辉 · 胜） */
export const mockTeamRadiant: TeamTableMock = {
  teamName: "BIZ GAMING",
  side: "radiant",
  won: true,
  players: [
    exampleFullPlayerInvoker,
    {
      slot: 1,
      heroKey: "primal_beast",
      steamName: "Xxs",
      rankLabel: "排名",
      rankColorClass: "text-sky-400",
      level: 22,
      kills: 5,
      deaths: 6,
      assists: 22,
      lastHits: 198,
      denies: 6,
      netWorth: 16820,
      gpm: 421,
      xpm: 512,
      heroDamage: 18200,
      towerDamage: 2100,
      heroHeal: 420,
      items: {
        main: [
          { itemKey: "blink" },
          { itemKey: "blade_mail" },
          { itemKey: "black_king_bar", overlay: { kind: "cd", text: "18:22" } },
          { itemKey: "heart" },
          { itemKey: "travel_boots" },
          { itemKey: "lotus_orb" },
        ],
        backpack: [{ itemKey: "tpscroll" }, { itemKey: "smoke_of_deceit" }, null],
        neutral: { itemKey: "giant_maul" },
      },
      buffs: { aghanims: "shard", moonShard: false },
    },
    {
      slot: 2,
      heroKey: "phoenix",
      steamName: "BoBoKa",
      rankLabel: "排名",
      rankColorClass: "text-amber-400",
      level: 20,
      kills: 4,
      deaths: 5,
      assists: 24,
      lastHits: 86,
      denies: 4,
      netWorth: 12400,
      gpm: 310,
      xpm: 445,
      heroDamage: 12400,
      towerDamage: 800,
      heroHeal: 8960,
      items: {
        main: [
          { itemKey: "spirit_vessel" },
          { itemKey: "urn_of_shadows" },
          { itemKey: "ward_dispenser" },
          { itemKey: "force_staff" },
          { itemKey: "boots" },
          { itemKey: "magic_wand" },
        ],
        backpack: [{ itemKey: "ward_sentry" }, { itemKey: "dust" }, null],
        neutral: { itemKey: "grove_bow" },
      },
      buffs: { aghanims: "scepter", moonShard: false },
    },
    {
      slot: 3,
      heroKey: "disruptor",
      steamName: "planet",
      rankLabel: "排名",
      rankColorClass: "text-emerald-400",
      level: 19,
      kills: 3,
      deaths: 7,
      assists: 26,
      lastHits: 52,
      denies: 2,
      netWorth: 9800,
      gpm: 245,
      xpm: 380,
      heroDamage: 6800,
      towerDamage: 400,
      heroHeal: 0,
      items: {
        main: [
          { itemKey: "glimmer_cape" },
          { itemKey: "arcane_boots" },
          { itemKey: "force_staff" },
          { itemKey: "ward_dispenser" },
          { itemKey: "magic_wand" },
          { itemKey: "ghost" },
        ],
        backpack: [{ itemKey: "smoke_of_deceit" }, null, null],
        neutral: { itemKey: "philosophers_stone" },
      },
      buffs: { aghanims: "shard", moonShard: false },
    },
    {
      slot: 4,
      heroKey: "brewmaster",
      steamName: "Monet",
      rankLabel: "排名",
      rankColorClass: "text-rose-400",
      level: 23,
      kills: 19,
      deaths: 3,
      assists: 8,
      lastHits: 468,
      denies: 22,
      netWorth: 31200,
      gpm: 780,
      xpm: 920,
      heroDamage: 38200,
      towerDamage: 12400,
      heroHeal: 0,
      items: {
        main: [
          { itemKey: "skadi" },
          { itemKey: "black_king_bar", overlay: { kind: "cd", text: "9:44" } },
          { itemKey: "greater_crit" },
          { itemKey: "manta" },
          { itemKey: "power_treads" },
          { itemKey: "bfury" },
        ],
        backpack: [{ itemKey: "tpscroll" }, { itemKey: "enchanted_mango" }, null],
        neutral: { itemKey: "minotaur_horn" },
      },
      buffs: { aghanims: "both", moonShard: true },
    },
  ],
};

/** Rock n Sports（夜魇 · 负） */
export const mockTeamDire: TeamTableMock = {
  teamName: "Rock n Sports",
  side: "dire",
  won: false,
  players: [
    {
      slot: 5,
      heroKey: "hoodwink",
      steamName: "Player1",
      rankLabel: "排名",
      rankColorClass: "text-zinc-400",
      level: 21,
      kills: 6,
      deaths: 9,
      assists: 11,
      lastHits: 280,
      denies: 12,
      netWorth: 15200,
      gpm: 380,
      xpm: 490,
      heroDamage: 22400,
      towerDamage: 3200,
      heroHeal: 0,
      items: {
        main: [
          { itemKey: "hurricane_pike" },
          { itemKey: "orchid" },
          { itemKey: "black_king_bar", overlay: { kind: "cd", text: "22:01" } },
          { itemKey: "power_treads" },
          { itemKey: "magic_wand" },
          { itemKey: "ward_observer" },
        ],
        backpack: [{ itemKey: "tpscroll" }, null, null],
        neutral: { itemKey: "misericorde" },
      },
      buffs: { aghanims: "shard", moonShard: false },
    },
    {
      slot: 6,
      heroKey: "venomancer",
      steamName: "Player2",
      rankLabel: "排名",
      rankColorClass: "text-zinc-400",
      level: 18,
      kills: 4,
      deaths: 10,
      assists: 14,
      lastHits: 120,
      denies: 8,
      netWorth: 11200,
      gpm: 280,
      xpm: 350,
      heroDamage: 19800,
      towerDamage: 600,
      heroHeal: 400,
      items: {
        main: [
          { itemKey: "spirit_vessel" },
          { itemKey: "veil_of_discord" },
          { itemKey: "boots" },
          { itemKey: "ward_dispenser" },
          { itemKey: "magic_wand" },
          null,
        ],
        backpack: [{ itemKey: "dust" }, null, null],
        neutral: { itemKey: "venom_gland" },
      },
      buffs: { aghanims: "none", moonShard: false },
    },
    {
      slot: 7,
      heroKey: "gyrocopter",
      steamName: "Player3",
      rankLabel: "排名",
      rankColorClass: "text-zinc-400",
      level: 24,
      kills: 8,
      deaths: 6,
      assists: 6,
      lastHits: 520,
      denies: 24,
      netWorth: 26800,
      gpm: 670,
      xpm: 820,
      heroDamage: 45200,
      towerDamage: 18200,
      heroHeal: 0,
      items: {
        main: [
          { itemKey: "monkey_king_bar" },
          { itemKey: "black_king_bar", overlay: { kind: "cd", text: "14:55" } },
          { itemKey: "skadi" },
          { itemKey: "manta" },
          { itemKey: "power_treads" },
          { itemKey: "satanic" },
        ],
        backpack: [{ itemKey: "tpscroll" }, { itemKey: "clarity" }, null],
        neutral: { itemKey: "apex" },
      },
      buffs: { aghanims: "scepter", moonShard: false },
    },
    {
      slot: 8,
      heroKey: "tidehunter",
      steamName: "Player4",
      rankLabel: "排名",
      rankColorClass: "text-zinc-400",
      level: 20,
      kills: 3,
      deaths: 8,
      assists: 16,
      lastHits: 210,
      denies: 4,
      netWorth: 13200,
      gpm: 330,
      xpm: 410,
      heroDamage: 14200,
      towerDamage: 1200,
      heroHeal: 0,
      items: {
        main: [
          { itemKey: "blink" },
          { itemKey: "refresher" },
          { itemKey: "pipe" },
          { itemKey: "arcane_boots" },
          { itemKey: "magic_wand" },
          { itemKey: "ghost" },
        ],
        backpack: [{ itemKey: "smoke_of_deceit" }, null, null],
        neutral: { itemKey: "craggy_coat" },
      },
      buffs: { aghanims: "shard", moonShard: false },
    },
    {
      slot: 9,
      heroKey: "kez",
      steamName: "Player5",
      rankLabel: "排名",
      rankColorClass: "text-zinc-400",
      level: 22,
      kills: 3,
      deaths: 7,
      assists: 12,
      lastHits: 340,
      denies: 10,
      netWorth: 19800,
      gpm: 495,
      xpm: 560,
      heroDamage: 28600,
      towerDamage: 2100,
      heroHeal: 0,
      items: {
        main: [
          { itemKey: "diffusal_blade", overlay: { kind: "cd", text: "8:30" } },
          { itemKey: "manta" },
          { itemKey: "black_king_bar", overlay: { kind: "cd", text: "31:02" } },
          { itemKey: "skadi" },
          { itemKey: "power_treads" },
          { itemKey: "bfury" },
        ],
        backpack: [{ itemKey: "tpscroll" }, null, null],
        neutral: { itemKey: "serrated_shiv" },
      },
      buffs: { aghanims: "both", moonShard: false },
    },
  ],
};
