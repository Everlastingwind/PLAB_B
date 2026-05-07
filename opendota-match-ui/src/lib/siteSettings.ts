import type { SupabaseClient } from "@supabase/supabase-js";

export type SiteSettingsRow = {
  current_patch: string;
  previous_patch: string;
};

/**
 * 选手页跨版本 plan_b 扫描：取「上一版本 + 当前版本」去重列表（顺序稳定，供 `.in()`）。
 */
export function buildPlayerHistoryPatchVersions(
  previousPatch: string,
  currentPatch: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [previousPatch, currentPatch]) {
    const t = String(p ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export async function fetchSiteSettingsRow(
  client: SupabaseClient
): Promise<SiteSettingsRow> {
  const { data, error } = await client
    .from("site_settings")
    .select("current_patch, previous_patch")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `读取 site_settings 失败：${error.message}。请先在 Supabase 执行 supabase/site_settings.sql`
    );
  }
  if (!data) {
    throw new Error(
      "site_settings 无 id=1 行。请在 Supabase 执行 supabase/site_settings.sql 初始化"
    );
  }
  const cur = String((data as { current_patch?: unknown }).current_patch ?? "").trim();
  const prev = String((data as { previous_patch?: unknown }).previous_patch ?? "").trim();
  if (!cur) {
    throw new Error("site_settings.current_patch 为空，请在表中填写当前补丁号");
  }
  if (!prev) {
    throw new Error("site_settings.previous_patch 为空，请在表中填写上一补丁号");
  }
  return { current_patch: cur, previous_patch: prev };
}
