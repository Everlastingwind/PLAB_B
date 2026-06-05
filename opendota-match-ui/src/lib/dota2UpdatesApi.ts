import type { SupabaseClient } from "@supabase/supabase-js";

export type Dota2UpdateRow = {
  id: number;
  gid: string;
  title: string;
  content: string | null;
  version: string | null;
  release_date: string | null;
  url: string | null;
};

/** 导航 Tab / Link：补丁详情页路径（小写 slug，忽略大小写） */
export function patchNotesRoutePath(version: string): string {
  const v = String(version ?? "").trim().toLowerCase();
  return v ? `/patches/${encodeURIComponent(v)}` : "/patches";
}

/** 导航 Tab 展示标签（全站统一大写，如 7.41D） */
export function patchNavDisplayLabel(version: string): string {
  return String(version ?? "").trim().toUpperCase();
}

/**
 * 按站点当前补丁拉取 `dota2_updates` 行（`ilike` 忽略 version 大小写）。
 */
export async function fetchDota2UpdateByVersion(
  client: SupabaseClient,
  version: string
): Promise<{ row: Dota2UpdateRow | null; error: string | null }> {
  const v = String(version ?? "").trim();
  if (!v) {
    return { row: null, error: "补丁版本号为空" };
  }
  const { data, error } = await client
    .from("dota2_updates")
    .select("*")
    .ilike("version", v)
    .order("release_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { row: null, error: error.message };
  }
  return { row: (data as Dota2UpdateRow) ?? null, error: null };
}

/** 英雄页「最新改动」：仅 version + content */
export async function fetchDota2UpdateContentByVersion(
  client: SupabaseClient,
  version: string
): Promise<{ version: string | null; content: string | null } | null> {
  const { row, error } = await fetchDota2UpdateByVersion(client, version);
  if (error) {
    console.warn("[dota2_updates]", error);
    return null;
  }
  if (!row) return null;
  return {
    version: row.version ?? null,
    content: row.content ?? null,
  };
}
