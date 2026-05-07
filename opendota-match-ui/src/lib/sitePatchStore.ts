import { supabase } from "./supabaseClient.js";
import {
  buildPlayerHistoryPatchVersions,
  fetchSiteSettingsRow,
  type SiteSettingsRow,
} from "./siteSettings";

/** 前端 / plan_b 查询统一使用的补丁配置（camelCase） */
export type SitePatchConfig = {
  currentPatch: string;
  previousPatch: string;
  playerHistoryPatchVersions: readonly string[];
};

let cached: SitePatchConfig | null = null;
let inflight: Promise<SitePatchConfig> | null = null;
/** 使进行中的拉取在 invalidate 后失效 */
let fetchGeneration = 0;

function rowToConfig(row: SiteSettingsRow): SitePatchConfig {
  const currentPatch = row.current_patch;
  const previousPatch = row.previous_patch;
  return {
    currentPatch,
    previousPatch,
    playerHistoryPatchVersions: buildPlayerHistoryPatchVersions(
      previousPatch,
      currentPatch
    ),
  };
}

/**
 * 拉取并缓存站点补丁配置；多次调用共享同一 in-flight。
 * 依赖已配置的 `supabase` 客户端（见 `VITE_SUPABASE_*`）。
 */
export async function ensureSitePatchLoaded(): Promise<SitePatchConfig> {
  if (cached) return cached;
  if (!inflight) {
    const gen = fetchGeneration;
    inflight = (async () => {
      const client = supabase;
      if (!client) {
        throw new Error(
          "Supabase 未配置，无法加载 site_settings：请设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY"
        );
      }
      const row = await fetchSiteSettingsRow(client);
      if (gen !== fetchGeneration) {
        return ensureSitePatchLoaded();
      }
      const next = rowToConfig(row);
      cached = next;
      return next;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** PatchUpdatePanel 写入 DB 后调用，使下一次 ensure 重新拉取 */
export function invalidateSitePatchCache(): void {
  fetchGeneration += 1;
  cached = null;
  inflight = null;
}

export function getSitePatchSync(): SitePatchConfig | null {
  return cached;
}
