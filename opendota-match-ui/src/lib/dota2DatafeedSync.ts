import type { SupabaseClient } from "@supabase/supabase-js";

export type Dota2UpdateRow = {
  gid: string;
  title: string;
  content: string;
  version: string;
  release_date: string;
  url: string;
};

function patchNotesPaths(version: string): { zh: string; en: string } {
  const v = encodeURIComponent(version.trim());
  return {
    zh: `/datafeed/patchnotes?version=${v}&language=schinese`,
    en: `/datafeed/patchnotes?version=${v}&language=english`,
  };
}

function patchNotesUrl(path: string): string {
  if (import.meta.env.DEV) {
    return `/dota2-api${path}`;
  }
  return `https://www.dota2.com${path}`;
}

async function throwIfBadResponse(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  let body = "";
  try {
    body = await res.text();
  } catch (e) {
    body = e instanceof Error ? e.message : String(e);
  }
  const head = `${label} HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
  throw new Error(
    body.trim() ? `${head}: ${body.slice(0, 1200)}` : head
  );
}

export async function upsertDota2Update(
  client: SupabaseClient,
  row: Dota2UpdateRow
): Promise<void> {
  const { error } = await client.from("dota2_updates").upsert(row, {
    onConflict: "gid",
  });
  if (error) throw error;
}

function patchTitleFromJson(
  data: Record<string, unknown>,
  fallbackVersion: string
): string {
  const name = data.patch_name;
  if (typeof name === "string" && name.trim()) {
    return `Dota 2 更新说明 — ${name}`;
  }
  return `Dota 2 更新说明 — ${fallbackVersion}`;
}

function releaseIsoFromJson(data: Record<string, unknown>): string {
  const ts = data.patch_timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return new Date(ts * 1000).toISOString();
  }
  return new Date().toISOString();
}

async function fetchPatchObject(
  path: string,
  label: string
): Promise<Record<string, unknown>> {
  const url = patchNotesUrl(path);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: ${msg}`);
  }
  await throwIfBadResponse(res, label);
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label}: 接口返回非对象 JSON`);
    }
    data = parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`${label}: ${e.message}`);
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: ${msg}`);
  }
  if (data.success === false) {
    throw new Error(`${label}: 接口返回 success: false`);
  }
  return data;
}

export async function syncPatchFromDota2Datafeed(
  client: SupabaseClient,
  targetVersion: string
): Promise<Dota2UpdateRow> {
  const ver = targetVersion.trim();
  const paths = patchNotesPaths(ver);
  const zhData = await fetchPatchObject(paths.zh, "中文");
  const enData = await fetchPatchObject(paths.en, "English");

  const merged = { zh: zhData, en: enData };
  const content = JSON.stringify(merged);

  const row: Dota2UpdateRow = {
    gid: `patch_${ver}`,
    title: patchTitleFromJson(zhData, ver),
    content,
    version: ver,
    release_date: releaseIsoFromJson(zhData),
    url: `${patchNotesUrl(paths.zh)} | ${patchNotesUrl(paths.en)}`,
  };

  await upsertDota2Update(client, row);
  return row;
}

/** @deprecated 使用 {@link syncPatchFromDota2Datafeed} */
export async function syncPatch741cFromDota2Datafeed(
  client: SupabaseClient
): Promise<Dota2UpdateRow> {
  return syncPatchFromDota2Datafeed(client, "7.41c");
}
