import type { SlimPlayer } from "../types/slimMatch";

/**
 * 浏览器控制台调试加点数据来源：
 * - `localStorage.setItem('DOTA_DEBUG_SKILL_BUILD', '1')` 后刷新；
 * - 默认仅风行者（便于核对 windrunner_focusfire_cancel / special_bonus_attributes）；
 * - 若需所有英雄：`localStorage.setItem('DOTA_DEBUG_SKILL_BUILD_ALL', '1')`。
 */
export function maybeLogSkillBuildSources(heroKey: string, p: SlimPlayer): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  if (localStorage.getItem("DOTA_DEBUG_SKILL_BUILD") !== "1") return;
  const hk = heroKey.trim().toLowerCase();
  const logAll = localStorage.getItem("DOTA_DEBUG_SKILL_BUILD_ALL") === "1";
  if (!logAll && hk !== "windrunner") return;

  const sb = Array.isArray(p.skill_build) ? p.skill_build : [];
  const pipelinePreview = sb.slice(0, 28).map((row) => {
    if (!row || typeof row !== "object") return row;
    const o = row as unknown as Record<string, unknown>;
    return {
      step: o.step,
      type: o.type ?? o.kind,
      ability_id: o.ability_id,
      ability_key: o.ability_key,
      name: o.name,
    };
  });

  console.debug("[skill-build debug]", {
    hero_key: heroKey,
    hero_id: p.hero_id,
    ability_upgrades_arr: p.ability_upgrades_arr,
    skill_build_pipeline_preview: pipelinePreview,
  });
}
