/**
 * 二段施放 / 衍生技能：录像与 OpenDota「加点」序列里可能出现，但客户端加点横条只统计主技能。
 * 与后端 `utils/dota_pipeline.SUB_ABILITY_UPGRADE_BLACKLIST_KEYS` 保持同步。
 */
export const SUB_ABILITY_UPGRADE_BLACKLIST_KEYS: readonly string[] = [
  "tusk_launch_snowball",
  "puck_ethereal_jaunt",
  "keeper_of_the_light_illuminate_end",
  /** Focus Fire 取消施放（录像常插入加点序列，非独立加点） */
  "windrunner_focusfire_cancel",
  "brewmaster_primal_split_cancel",
  "naga_siren_song_of_the_siren_cancel",
  "kez_shodo_sai_parry_cancel",
];

const SET = new Set(
  SUB_ABILITY_UPGRADE_BLACKLIST_KEYS.map((k) => k.toLowerCase())
);

export function isSubAbilityUpgradeBlacklistKey(key: string | null | undefined): boolean {
  const k = String(key ?? "")
    .trim()
    .toLowerCase();
  return k.length > 0 && SET.has(k);
}
