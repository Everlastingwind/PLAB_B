import type { SupabaseClient } from "@supabase/supabase-js";

export type Dota2UpdateRow = {
  gid: string;
  title: string;
  content: string;
  version: string;
  release_date: string;
  url: string;
};

const PATH_ZH = "/datafeed/patchnotes?version=7.41c&language=schinese";
const PATH_EN = "/datafeed/patchnotes?version=7.41c&language=english";

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

function patchTitleFromJson(data: Record<string, unknown>): string {
  const name = data.patch_name;
  if (typeof name === "string" && name.trim()) {
    return `Dota 2 更新说明 — ${name}`;
  }
  return "Dota 2 更新说明 — 7.41c";
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

export async function syncPatch741cFromDota2Datafeed(
  client: SupabaseClient
): Promise<Dota2UpdateRow> {
  const zhData = await fetchPatchObject(PATH_ZH, "中文");
  const enData = await fetchPatchObject(PATH_EN, "English");

  const merged = { zh: zhData, en: enData };
  const content = JSON.stringify(merged);

  const row: Dota2UpdateRow = {
    gid: "patch_7.41c",
    title: patchTitleFromJson(zhData),
    content,
    version: "7.41c",
    release_date: releaseIsoFromJson(zhData),
    url: `${patchNotesUrl(PATH_ZH)} | ${patchNotesUrl(PATH_EN)}`,
  };

  await upsertDota2Update(client, row);
  return row;
}
