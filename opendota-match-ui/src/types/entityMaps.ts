export interface HeroMapEntry {
  key: string;
  nameEn: string;
  nameCn: string;
}

export interface ItemMapEntry {
  key: string;
  nameEn: string;
  nameCn: string;
}

/** ability_id（字符串）→ dotaconstants abilities + ability_ids */
export interface AbilityMapEntry {
  key: string;
  nameEn: string;
  nameCn: string;
  /** abilities.json 的 img，如 /apps/dota2/images/dota_react/abilities/xxx.png */
  img?: string;
}

/** d2vpkr / fetch_latest_dota_data.js 产出的 byAbilityKey 条目（仅取 label 字段即可） */
export interface VpkrTalentLabelEntry {
  labelEn: string;
  labelEnDescription?: string;
}

export interface EntityMapsPayload {
  heroes: Record<string, HeroMapEntry>;
  items: Record<string, ItemMapEntry>;
  /** 可选：由 export_entity_maps.py 从 abilities.json + ability_ids.json 生成 */
  abilities?: Record<string, AbilityMapEntry>;
  /**
   * 可选：与 entity_maps 并行加载的 `public/data/latest_talents_map.json` 中 `byAbilityKey`，
   * 用于用客户端解包文案覆盖天赋树英文（及过时 dotaconstants 文案）。
   */
  talentLabelsByKey?: Record<string, VpkrTalentLabelEntry>;
  source?: string;
}
