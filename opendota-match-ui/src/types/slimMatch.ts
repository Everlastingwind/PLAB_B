/**
 * Python translate_match_data / OpenDota API 清洗后的比赛 JSON（与 latest_match.json 对齐）
 */
export interface SlimItemSlot {
  slot: number;
  item_id: number;
  item_key: string | null;
  item_name_en: string;
  item_name_cn: string;
  image_url: string;
  empty: boolean;
}

/** 与 Python translate_match_data 中 ability_timeline / talents_taken 单项一致 */
export interface SlimAbilityStep {
  time?: number | null;
  ability_id?: number;
  ability_key?: string | null;
  ability_name_en?: string;
  ability_name_cn?: string;
  image_url?: string;
  is_talent?: boolean;
  level?: number;
}

/** 与 Python skill_build 对齐（固定 25 步）；含 v2 字段 type / desc / level */
export interface SlimSkillBuildStep {
  step: number;
  kind?: "ability" | "talent" | "empty" | "unknown";
  type?: "ability" | "talent" | "empty" | "unknown";
  level?: number;
  ability_id?: number;
  ability_key?: string | null;
  is_talent?: boolean;
  /** 技能 CDN（与 img 二选一，同源） */
  img?: string;
  img_url?: string;
  /** 天赋中文名 / 或 unknown 兜底说明 */
  name?: string;
  label_en?: string;
  label_cn?: string;
  /** 天赋：中文优先的展示文案 */
  desc?: string;
  desc_en?: string;
  desc_cn?: string;
}

export interface SlimTalentSide {
  ability_key: string;
  label_en: string;
  label_cn: string;
  img: string;
}

export interface SlimTalentTier {
  hero_level: number;
  left: SlimTalentSide;
  right: SlimTalentSide;
  selected: "left" | "right" | null;
}

/** 每玩家 talent_tree：后端用 hero_abilities + skill_build 匹配 special_bonus 得到 selected */
export interface SlimTalentTree {
  tiers: SlimTalentTier[];
  /** 与 tiers 中 selected 为 left/right 的个数一致（可被前端用 skill_build 再合并） */
  dots_learned: number;
}

/**
 * 解析器侧天赋选择（与 Dota 10/15/20/25 四档左右分支对应）。
 * 后端 merge_talent_tree_from_parser_picks 会据此设置 talent_tree.tiers[].selected。
 */
export interface SlimTalentPick {
  /** 解析器内部序号，可选 */
  talent_id?: number;
  /** 天赋档英雄等级：10 | 15 | 20 | 25（也可用 hero_level） */
  level?: number;
  hero_level?: number;
  /** 左/右分支 */
  direction: "left" | "right" | string;
  /** 录像内展示文案，可选（会覆盖该侧 label_cn） */
  talent_name?: string;
  /** 与 talent_name 同义，便于与后端字段对齐 */
  name?: string;
}

export interface SlimPlayer {
  player_slot?: number;
  hero_id?: number;
  account_id?: number;
  personaname?: string;
  name?: string;
  pro_name?: string | null;
  team_name?: string | null;
  level?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  /** 部分解析器 / API 使用短字段，与 kills/deaths/assists 等价 */
  k?: number;
  d?: number;
  a?: number;
  last_hits?: number;
  denies?: number;
  gold_per_min?: number;
  xp_per_min?: number;
  hero_damage?: number;
  tower_damage?: number;
  hero_healing?: number;
  /** 对线期（前 5 分钟）分路：top/mid/bot */
  lane_early?: "top" | "mid" | "bot" | string;
  /** 对线期推断位置：carry/mid/offlane/support(4)/support(5) */
  role_early?: "carry" | "mid" | "offlane" | "support(4)" | "support(5)" | string;
  /** 出门装：开局前（默认前 30 秒）购买的物品聚合 */
  starting_items?: Array<{
    item_id?: number;
    item_key?: string | null;
    item_name_en?: string;
    item_name_cn?: string;
    image_url?: string;
    count?: number;
    first_purchase_time?: number;
  }>;
  net_worth?: number;
  /** OpenDota API：是否持有 A 杖效果（0/1 或布尔） */
  aghanims_scepter?: number | boolean;
  /** OpenDota API：是否持有魔晶效果（0/1 或布尔） */
  aghanims_shard?: number | boolean;
  /**
   * OpenDota `ability_upgrades`：完整加点时间线（含天赋 ability id），
   * 与 `ability_upgrades_arr` 在 getTalentState 中取并集。
   */
  ability_upgrades?: ReadonlyArray<{
    ability?: number | string;
    time?: number;
  }>;
  /** OpenDota `permanent_buffs`：2≈神杖、12≈魔晶（与 API 字段互补） */
  permanent_buffs?: { permanent_buff?: number; stack_count?: number }[];
  /** OpenDota 全球天梯名次（有则 UI 显示 Rank n） */
  leaderboard_rank?: number;
  isRadiant?: boolean;
  /** OpenDota / 清洗 JSON：结算面身上 6 格与中立（与 items_slot 二选一或并存，适配器优先读此项） */
  item_0?: number | null;
  item_1?: number | null;
  item_2?: number | null;
  item_3?: number | null;
  item_4?: number | null;
  item_5?: number | null;
  item_neutral?: number | null;
  items_slot?: SlimItemSlot[];
  /** 独行德鲁伊熊灵终局主 6 格（与英雄本体分开） */
  spirit_bear_items_slot?: SlimItemSlot[];
  hero_name_cn?: string;
  hero_name_en?: string;
  /** 中立物品槽完整 CDN（已由后端 dotaconstants 解析） */
  neutral_img?: string;
  /** 中立物品内部名（兜底拼 CDN，与 neutral_img 二选一或并存） */
  neutral_item_key?: string | null;
  /** 25 步加点时间轴（技能图标 + 天赋中文描述） */
  skill_build?: SlimSkillBuildStep[];
  /**
   * 原始加点 ID 序列（与 skill_build 二选一或并存）；前端可用 entity_maps.abilities 查表渲染。
   */
  ability_upgrades_arr?: number[];
  /** 天赋树（左右选项 + 本局选择） */
  talent_tree?: SlimTalentTree;
  /** 解析器给出的四档天赋选择（见 SlimTalentPick）；与 talent_tree 合并后驱动徽章高亮 */
  talent_picks?: SlimTalentPick[];
  /** 可选：解析器/后处理直接给出的本局天赋 ability_key（优先用于高亮） */
  talent_pick_keys?: string[];
  /** 加点顺序（含天赋 is_talent） */
  ability_timeline?: SlimAbilityStep[];
  talents_taken?: SlimAbilityStep[];
  /** 松散结构天赋档选择，见 lib/matchTalents.parseTalentsArray */
  talents?: unknown;
  /**
   * 录像管线：按真实学习顺序的加点（常与 25 格 skill_build 互补；前端可合并天赋 key / 时间轴）
   */
  skill_build_two_step?: {
    type?: string;
    level?: number;
    ability_id?: number;
    ability_key?: string | null;
    name_en?: string;
    name_cn?: string;
    img_url?: string;
  }[];
  /** 其它解析字段可扩展 */
  [key: string]: unknown;
}

export interface SlimPickBan {
  is_pick: boolean;
  hero_id: number;
  order?: number;
}

export interface SlimMatchJson {
  _meta?: {
    source?: string;
    match_id?: number;
    note?: string;
    /** 前端从 OpenDota 合并 ability_upgrades 时的调试信息 */
    opendota_ability_upgrades_merge?: {
      at: string;
      players_merged: number;
      match_id: number;
    };
    /** DEM 等来源：仅合并 account_id / 昵称 / 职业名（不覆盖技能时间线） */
    opendota_identity_merge?: {
      at: string;
      players_merged: number;
      match_id: number;
    };
    /** 前端从 OpenDota 合并终局装备（6 格 + 中立 + 神杖魔晶） */
    opendota_endgame_items_merge?: {
      at: string;
      match_id: number;
      players_merged: number;
    };
  };
  match_id?: number;
  /** 本地录像入库为 pub；OpenDota 管线为 pro */
  match_tier?: "pub" | "pro";
  match_source?: string;
  radiant_win?: boolean;
  radiant_score?: number;
  dire_score?: number;
  duration?: number;
  /** OpenDota 根字段常为 `leagueid`；>0 表示联赛/职业场 */
  league_id?: number;
  league_name?: string;
  players?: SlimPlayer[];
  picks_bans?: SlimPickBan[];
}
