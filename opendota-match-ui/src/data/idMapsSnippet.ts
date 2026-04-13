/**
 * 简易 ID → 名称对照（开发参考）。生产环境以 `public/data/entity_maps.json` 为准，
 * 该文件由 `PLAB_B/scripts/export_entity_maps.py` 从 dotaconstants + 中文 heroes_by_id 生成，
 * 与 DEM/OpenDota 管线中的 `hero_id`、`item_id` 数字字段对应。
 */
export const HERO_ID_EXAMPLES: Record<number, { key: string; nameCn: string }> = {
  1: { key: "antimage", nameCn: "敌法师" },
  74: { key: "invoker", nameCn: "祈求者" },
  145: { key: "kez", nameCn: "凯" },
};

export const ITEM_ID_EXAMPLES: Record<number, { key: string; nameCn: string }> = {
  1: { key: "blink", nameCn: "闪烁匕首" },
  116: { key: "black_king_bar", nameCn: "黑皇杖" },
};
