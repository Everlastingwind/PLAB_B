/**
 * 每日任务（建议本地 12:00）：从 Supabase 拉全站 plan_b，合并静态索引，
 * 将快照上传到 Storage `planb-static-data`（version 2：Meta + Items + TOP）。
 *
 * 运行：`npm run build:meta-snapshot`（需 `.env.local` 中 VITE_SUPABASE_*；
 * Storage 上传建议使用 `SUPABASE_SERVICE_ROLE_KEY`，否则可能因策略被拒绝）
 */
import "./env-bootstrap.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
// import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { EntityMapsPayload } from "../src/types/entityMaps";
import type { ReplaySummary, ReplaysIndexPayload } from "../src/types/replaysIndex";
import type { SlimMatchJson } from "../src/types/slimMatch";
import { buildTopSectionSnapshotPayload } from "../src/lib/homeTopSnapshot";
import {
  aggregateMetaGlobalItemStats,
  normalizeMetaItemKey,
} from "../src/lib/metaGlobalItemStats";
import { buildMetaSiteSnapshotPayload } from "../src/lib/metaSiteAggregate";
import { purifyMatchJsonForSlim } from "../src/lib/purifyRawMatchJson";
import {
  fetchPlanBSlimPayloadBatchWithClient,
  overlayPlanBListRowsWithPlayersWithClient,
} from "../src/lib/supabasePlanB";
import {
  mergePubProReplays,
  mergeReplaySummariesByMatchId,
  normalizeReplaySource,
  replayMatchesLatestPatch,
  replaySummariesFromPlanBRows,
} from "../src/lib/replaysApi";
import { topKillMatchIdsForSlim } from "../src/lib/topKillMatchIds";
import { fetchSiteSettingsRow } from "../src/lib/siteSettings";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = join(__dirname, "..");

const PLAN_B_INDEX_SELECT =
  "match_id, created_at, patch_version, duration, radiant_win, radiant_score, dire_score, league_name";

/** 单次 range 行数减小，降低大 json `players` 触发表超时概率 */
const ANALYTICS_PAGE_SIZE = 40;
/** 与历史上 2000×100 一致的总行上限，避免仅缩小分页却少拉数据 */
const ANALYTICS_ROW_CAP = 2000 * 100;
const ANALYTICS_MAX_PAGES = Math.ceil(ANALYTICS_ROW_CAP / ANALYTICS_PAGE_SIZE);

const PLAN_B_PAGE_MAX_RETRIES = 5;
const PLAN_B_PAGE_BASE_DELAY_MS = 1500;
const PLAN_B_DURATION_BATCH = 500;
const ITEMS_TAB_SLIM_SAMPLE_CAP = 200;

function loadCraftableItemKeysFromDisk(root: string): Set<string> {
  const p = join(root, "public/data/item_craftable_keys.json");
  const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
  const set = new Set<string>();
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === "string" && x.trim()) set.add(normalizeMetaItemKey(x));
    }
  }
  for (const k of ["blink"] as const) {
    set.add(normalizeMetaItemKey(k));
  }
  return set;
}

async function slimMapForMatchIds(
  client: SupabaseClient,
  matchIds: readonly number[]
): Promise<Map<number, SlimMatchJson | null>> {
  const uniq = [
    ...new Set(matchIds.filter((id) => Number.isFinite(id) && id > 0)),
  ] as number[];
  const rawMap = await fetchPlanBSlimPayloadBatchWithClient(client, uniq);
  const out = new Map<number, SlimMatchJson | null>();
  for (const id of uniq) {
    const raw = rawMap.get(id);
    if (!raw) {
      out.set(id, null);
      continue;
    }
    const cand = purifyMatchJsonForSlim(raw) as SlimMatchJson;
    const ok = Array.isArray(cand.players) && cand.players.length >= 2;
    out.set(id, ok ? cand : null);
  }
  return out;
}

function parsePlanBDurationSec(raw: unknown): number | null {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 语句超时、连接抖动等可退避重试；权限/语法错误不重试 */
function isRetriablePlanBQueryError(message: string): boolean {
  const m = message.toLowerCase();
  return /timeout|57014|statement timeout|canceling statement|too many connections|econnreset|socket|fetch failed|network|502|503|504|524/i.test(
    m
  );
}

function loadSupabaseFromEnv(): SupabaseClient {
  const url = String(
    process.env.VITE_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      ""
  ).trim();
  const key = String(
    process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      ""
  ).trim();
  if (!/^https?:\/\//i.test(url) || !key) {
    throw new Error(
      "缺少 Supabase：请在 .env.local 设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY"
    );
  }
  return createClient(url, key, {
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

/** Storage 上传：优先 Service Role（绕过 bucket 写策略）；否则退回 anon（可能上传失败） */
function loadSupabaseStorageUploaderFromEnv(): SupabaseClient {
  const url = String(
    process.env.VITE_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      ""
  ).trim();
  const serviceKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
      ""
  ).trim();
  const anonKey = String(
    process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      ""
  ).trim();
  const key = serviceKey || anonKey;
  if (!/^https?:\/\//i.test(url) || !key) {
    throw new Error(
      "缺少 Supabase：上传需要 URL + SUPABASE_SERVICE_ROLE_KEY（推荐）或 ANON_KEY"
    );
  }
  if (!serviceKey) {
    console.warn(
      "[build-meta-site-snapshot] 未设置 SUPABASE_SERVICE_ROLE_KEY，使用 anon key 上传可能因 Storage 策略失败。"
    );
  }
  return createClient(url, key, {
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

const PLANB_STATIC_BUCKET = "planb-static-data";
/** 桶内对象路径（与原先 `public/data/` 下文件名对应，便于前端迁移 CDN 基地址） */
const META_SNAPSHOT_STORAGE_PATH = "public/data/meta_site_snapshot.json";

function readIndex(pathFromUiRoot: string): ReplaysIndexPayload {
  const p = join(UI_ROOT, pathFromUiRoot);
  const raw = JSON.parse(readFileSync(p, "utf8")) as ReplaysIndexPayload;
  return {
    ...raw,
    replays: (raw.replays || []).map((r) => ({
      ...r,
      source: normalizeReplaySource(r, "pub"),
    })),
  };
}

function readProIndex(): ReplaysIndexPayload {
  const p = join(UI_ROOT, "public/data/pro_replays_index.json");
  const raw = JSON.parse(readFileSync(p, "utf8")) as ReplaysIndexPayload;
  return {
    ...raw,
    replays: (raw.replays || []).map((r) => ({
      ...r,
      source: normalizeReplaySource(r, "pro"),
    })),
  };
}

async function fetchPlanBAggregateMatchStats(
  client: SupabaseClient,
  currentPatch: string
): Promise<
  | {
      decidedMatches: number;
      radiantWins: number;
      direWins: number;
      durationSamples: number;
      avgDurationSec: number;
      error: null;
    }
  | { error: string }
> {
  const patchPat = String(currentPatch ?? "").trim();
  const [rwRes, dwRes] = await Promise.all([
    client
      .from("plan_b")
      .select("match_id", { count: "exact", head: true })
      .eq("patch_version", patchPat)
      .eq("radiant_win", true),
    client
      .from("plan_b")
      .select("match_id", { count: "exact", head: true })
      .eq("patch_version", patchPat)
      .eq("radiant_win", false),
  ]);
  const countErr = rwRes.error?.message || dwRes.error?.message;
  if (countErr) return { error: countErr };

  const radiantWins = rwRes.count ?? 0;
  const direWins = dwRes.count ?? 0;
  const decidedMatches = radiantWins + direWins;

  let durationSum = 0;
  let durationSamples = 0;

  for (let from = 0; ; from += PLAN_B_DURATION_BATCH) {
    const to = from + PLAN_B_DURATION_BATCH - 1;
    const { data, error } = await client
      .from("plan_b")
      .select("duration")
      .eq("patch_version", patchPat)
      .order("match_id", { ascending: true })
      .range(from, to);

    if (error) return { error: error.message };

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const dur = parsePlanBDurationSec(r.duration ?? r.duration_sec);
      if (dur !== null) {
        durationSum += dur;
        durationSamples += 1;
      }
    }

    if (rows.length < PLAN_B_DURATION_BATCH) break;
  }

  const avgDurationSec =
    durationSamples > 0 ? durationSum / durationSamples : 0;

  return {
    decidedMatches,
    radiantWins,
    direWins,
    durationSamples,
    avgDurationSec,
    error: null,
  };
}

async function fetchPlanBReplayRowsPageWithRetry(
  client: SupabaseClient,
  pageIndexZeroBased: number,
  pageSize: number,
  currentPatch: string
): Promise<Record<string, unknown>[]> {
  const from = pageIndexZeroBased * pageSize;
  const to = from + pageSize - 1;
  let lastMsg = "";

  for (let attempt = 0; attempt < PLAN_B_PAGE_MAX_RETRIES; attempt++) {
    const { data, error } = await client
      .from("plan_b")
      .select(PLAN_B_INDEX_SELECT)
      .eq("patch_version", String(currentPatch ?? "").trim())
      .order("created_at", { ascending: false })
      .range(from, to);

    if (!error) {
      const light = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : [];
      return overlayPlanBListRowsWithPlayersWithClient(client, light);
    }

    lastMsg = error.message || String(error);
    const canRetry =
      attempt < PLAN_B_PAGE_MAX_RETRIES - 1 &&
      isRetriablePlanBQueryError(lastMsg);
    if (!canRetry) {
      throw new Error(lastMsg);
    }

    const delayMs = PLAN_B_PAGE_BASE_DELAY_MS * 2 ** attempt;
    console.warn(
      `[fetchAllPlanBReplayRows] page offset ${from}–${to} attempt ${attempt + 1}/${PLAN_B_PAGE_MAX_RETRIES} failed: ${lastMsg} → retry in ${delayMs}ms`
    );
    await sleep(delayMs);
  }

  throw new Error(lastMsg || "plan_b page fetch failed");
}

async function fetchAllPlanBReplayRows(
  client: SupabaseClient,
  currentPatch: string
): Promise<Record<string, unknown>[]> {
  const merged: Record<string, unknown>[] = [];
  const pageSize = ANALYTICS_PAGE_SIZE;

  for (let page = 1; page <= ANALYTICS_MAX_PAGES; page++) {
    const rows = await fetchPlanBReplayRowsPageWithRetry(
      client,
      page - 1,
      pageSize,
      currentPatch
    );
    if (rows.length === 0) break;
    merged.push(...rows);
    if (rows.length < pageSize) break;
  }
  return merged;
}

function mergeAnalyticsLikeHomePage(
  pubRows: ReplaySummary[],
  proRows: ReplaySummary[],
  cloudRows: ReplaySummary[]
): ReplaySummary[] {
  const mergedPub = mergeReplaySummariesByMatchId(pubRows, cloudRows);
  return mergePubProReplays(mergedPub, proRows);
}

async function main(): Promise<void> {
  const pubIdx = readIndex("public/data/replays_index.json");
  const proIdx = readProIndex();
  const pubRows = pubIdx.replays;
  const proRows = proIdx.replays;

  const client = loadSupabaseFromEnv();
  const siteRow = await fetchSiteSettingsRow(client);
  const currentPatch = siteRow.current_patch;
  const previousPatch = siteRow.previous_patch;
  console.log(
    "[build-meta-site-snapshot] site_settings 当前补丁:",
    currentPatch,
    "上一补丁:",
    previousPatch
  );

  const [aggPack, planRows] = await Promise.all([
    fetchPlanBAggregateMatchStats(client, currentPatch),
    fetchAllPlanBReplayRows(client, currentPatch),
  ]);

  if ("error" in aggPack && aggPack.error) {
    throw new Error(`聚合统计失败：${aggPack.error}`);
  }
  console.log(
    `[build-meta-site-snapshot] 成功匹配到 ${currentPatch} 对局数量（plan_b 已结算场次 radiant+dire）:`,
    aggPack.decidedMatches,
    `（plan_b 拉取行数: ${planRows.length}）`
  );
  const cloudAgg = {
    decidedMatches: aggPack.decidedMatches,
    radiantWins: aggPack.radiantWins,
    direWins: aggPack.direWins,
    durationSamples: aggPack.durationSamples,
    avgDurationSec: aggPack.avgDurationSec,
  };

  const cloudReplays = replaySummariesFromPlanBRows(planRows);
  const pubRowsLatest = pubRows.filter((r) =>
    replayMatchesLatestPatch(r, currentPatch)
  );
  const proRowsLatest = proRows.filter((r) =>
    replayMatchesLatestPatch(r, currentPatch)
  );
  const analyticsReplays = mergeAnalyticsLikeHomePage(
    pubRowsLatest,
    proRowsLatest,
    cloudReplays
  );
  console.log(
    `[build-meta-site-snapshot] 成功匹配到 ${currentPatch} 对局数量（合并静态索引后的 analytics 条数）:`,
    analyticsReplays.length
  );

  const sampleReplays = analyticsReplays.slice(0, ITEMS_TAB_SLIM_SAMPLE_CAP);
  const topKillIds = topKillMatchIdsForSlim(analyticsReplays, 5);
  const needSlimIds = [
    ...new Set([
      ...sampleReplays.map((r) => r.match_id),
      ...topKillIds,
    ]),
  ];

  const mapsPath = join(UI_ROOT, "public/data/entity_maps.json");
  const entityMaps = JSON.parse(
    readFileSync(mapsPath, "utf8")
  ) as EntityMapsPayload;

  const slimMap = await slimMapForMatchIds(client, needSlimIds);
  const slimRecord: Record<number, SlimMatchJson | null> = {};
  for (const id of needSlimIds) {
    slimRecord[id] = slimMap.get(id) ?? null;
  }

  const craftableKeys = loadCraftableItemKeysFromDisk(UI_ROOT);
  const itemsAggResult = aggregateMetaGlobalItemStats(
    sampleReplays,
    slimRecord,
    craftableKeys
  );
  const itemsMeta = {
    rows: itemsAggResult.rows,
    matchesAnalyzed: itemsAggResult.matchesAnalyzed,
    totalHeroPlayerSlots: itemsAggResult.totalHeroPlayerSlots,
    totalListed: sampleReplays.length,
  };

  const proIndexMatchIds = proIdx.replays.map((r) => r.match_id);
  const topSection = buildTopSectionSnapshotPayload(
    analyticsReplays,
    proIndexMatchIds,
    slimMap,
    entityMaps
  );

  const payload = buildMetaSiteSnapshotPayload(
    analyticsReplays,
    cloudAgg,
    { currentPatch, previousPatch },
    {
      itemsMeta,
      topSection,
    }
  );

  const jsonText = `${JSON.stringify(payload)}\n`;

  // const outPath = join(UI_ROOT, "public/data/meta_site_snapshot.json");
  // writeFileSync(outPath, jsonText, "utf8");

  const uploadClient = loadSupabaseStorageUploaderFromEnv();
  const body = Buffer.from(jsonText, "utf8");
  const { error: uploadError } = await uploadClient.storage
    .from(PLANB_STATIC_BUCKET)
    .upload(META_SNAPSHOT_STORAGE_PATH, body, {
      contentType: "application/json; charset=utf-8",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(
      `Storage 上传失败 (${PLANB_STATIC_BUCKET}/${META_SNAPSHOT_STORAGE_PATH}): ${uploadError.message}`
    );
  }

  console.log(
    "Uploaded",
    `${PLANB_STATIC_BUCKET}/${META_SNAPSHOT_STORAGE_PATH}`,
    "replays:",
    analyticsReplays.length,
    "snapshot v",
    payload.version
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
