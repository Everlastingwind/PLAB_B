import type { SlimMatchJson } from "../types/slimMatch";

/**
 * 本地录像 / Pub 入库场次：禁止向 OpenDota 发起合并请求（装备、加点、身份等）。
 * 兼容旧 JSON：无 `match_tier` 时依 `_meta.source` / `match_source` 推断。
 */
export function isPubTierMatch(slim: SlimMatchJson | null | undefined): boolean {
  if (!slim) return false;
  if (slim.match_tier === "pub") return true;
  const ms = String((slim as { match_source?: unknown }).match_source ?? "")
    .trim()
    .toLowerCase();
  if (ms === "local") return true;
  const src = String(slim._meta?.source ?? "").trim();
  if (src === "dem_result_json") return true;
  return false;
}
