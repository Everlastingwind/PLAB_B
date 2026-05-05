import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import { purifyMatchJsonForSlim } from "./purifyRawMatchJson";
import {
  fetchPlanBSlimPayload,
  fetchPlanBSlimPayloadBatch,
} from "./supabasePlanB";
import { staticDataSearchParam } from "./staticDataVersion";
import { forEachConcurrent } from "./fetchConcurrent";

const DETAIL_CACHE_TTL_OK_MS = 5 * 60 * 1000;
const DETAIL_CACHE_TTL_EMPTY_MS = 30 * 1000;

type DetailCacheEntry = {
  value: SlimMatchJson | null;
  expiresAt: number;
};

const detailCache = new Map<number, DetailCacheEntry>();
const detailInflight = new Map<number, Promise<SlimMatchJson | null>>();

/** 判断是否为「可用来渲染出装/加点/天赋」的整局 slim，避免把 SPA 占位页当 JSON 用 */
function slimMatchDetailLooksUsable(s: SlimMatchJson): boolean {
  const pl = s.players ?? [];
  if (pl.length < 2) return false;
  for (const p of pl) {
    if (playerRowLooksUsable(p)) return true;
  }
  return false;
}

function playerRowLooksUsable(p: SlimPlayer): boolean {
  const pr = p as Record<string, unknown>;
  const hasItemScalars = [0, 1, 2, 3, 4, 5].some(
    (i) => Number(pr[`item_${i}`] ?? 0) > 0
  );
  const slots = p.items_slot;
  const hasItemSlot =
    Array.isArray(slots) &&
    slots.some((c) => {
      if (!c || typeof c !== "object") return false;
      const empty = (c as { empty?: boolean }).empty === true;
      if (empty) return false;
      const ik = String((c as { item_key?: string }).item_key || "").trim();
      const iid = Number((c as { item_id?: unknown }).item_id ?? 0);
      return Boolean(ik) || iid > 0;
    });
  const hasSkill =
    (Array.isArray(p.skill_build) && p.skill_build.length > 0) ||
    (Array.isArray(p.ability_upgrades_arr) && p.ability_upgrades_arr.length > 0);
  const hasTalent =
    Boolean(p.talent_tree?.tiers?.length) ||
    (Array.isArray(p.talent_picks) && p.talent_picks.length > 0);
  const hasRole = String(p.role_early ?? "").trim().length > 0;
  return Boolean(
    hasItemScalars || hasItemSlot || hasSkill || hasTalent || hasRole
  );
}

/** 生产环境可对带 `?v=` 的静态文件使用默认缓存，减少重复拉取；开发保留 no-store。 */
const LOCAL_MATCH_JSON_CACHE: RequestCache = import.meta.env.DEV
  ? "no-store"
  : "default";

async function tryFetchLocalSlimMatchJson(
  matchId: number
): Promise<SlimMatchJson | null> {
  const q = staticDataSearchParam();
  try {
    const res = await fetch(`/data/matches/${matchId}.json${q}`, {
      cache: LOCAL_MATCH_JSON_CACHE,
    });
    if (!res.ok) return null;
    const text = await res.text();
    const head = text.trimStart();
    if (head.startsWith("<") || head.startsWith("<!")) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      const cand = purifyMatchJsonForSlim(parsed) as SlimMatchJson;
      return slimMatchDetailLooksUsable(cand) ? cand : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function putDetailCache(matchId: number, value: SlimMatchJson | null): void {
  detailCache.set(matchId, {
    value,
    expiresAt:
      Date.now() +
      (value ? DETAIL_CACHE_TTL_OK_MS : DETAIL_CACHE_TTL_EMPTY_MS),
  });
}

export type LoadSlimMatchDetailsOptions = {
  /**
   * 列表 / 聚合页用：不要对每局请求 `/data/matches/{id}.json`（大量 404 与体积），
   * 直接走 `plan_b` 批量查询。单场详情仍用 `loadSlimMatchJsonForDetail` 的本地优先逻辑。
   */
  preferCloud?: boolean;
};

/**
 * 多局 slim：先读内存缓存与单局 in-flight，再按策略补全（默认可选本地 JSON，再 Supabase 批量）。
 */
export async function loadSlimMatchJsonForDetails(
  matchIds: readonly number[],
  options?: LoadSlimMatchDetailsOptions
): Promise<Record<number, SlimMatchJson | null>> {
  const preferCloud = Boolean(options?.preferCloud);
  const out: Record<number, SlimMatchJson | null> = {};
  const now = Date.now();
  const unique = [
    ...new Set(
      matchIds.filter((id) => Number.isFinite(id) && (id as number) > 0)
    ),
  ] as number[];
  if (unique.length === 0) return out;

  const work: number[] = [];
  for (const id of unique) {
    const hit = detailCache.get(id);
    if (hit && hit.expiresAt > now) {
      out[id] = hit.value;
      continue;
    }
    const inflight = detailInflight.get(id);
    if (inflight) {
      out[id] = await inflight;
      continue;
    }
    work.push(id);
  }
  if (work.length === 0) return out;

  const needCloud: number[] = [];

  if (preferCloud) {
    for (const mid of work) {
      needCloud.push(mid);
    }
  } else {
    await forEachConcurrent(work, 20, async (mid) => {
      const local = await tryFetchLocalSlimMatchJson(mid);
      if (local) {
        putDetailCache(mid, local);
        out[mid] = local;
      } else {
        needCloud.push(mid);
      }
    });
  }

  if (needCloud.length === 0) return out;

  const rawMap = await fetchPlanBSlimPayloadBatch(needCloud);
  for (const mid of needCloud) {
    const raw = rawMap.get(mid);
    let cand: SlimMatchJson | null = null;
    if (raw) {
      const p = purifyMatchJsonForSlim(raw) as SlimMatchJson;
      cand = slimMatchDetailLooksUsable(p) ? p : null;
    }
    putDetailCache(mid, cand);
    out[mid] = cand;
  }
  return out;
}

/**
 * 优先读本地 `/data/matches/{id}.json`；若缺失、非 JSON 或内容不足以渲染明细，则回退 Supabase plan_b。
 */
export async function loadSlimMatchJsonForDetail(
  matchId: number
): Promise<SlimMatchJson | null> {
  if (!Number.isFinite(matchId) || matchId <= 0) return null;

  const now = Date.now();
  const hit = detailCache.get(matchId);
  if (hit && hit.expiresAt > now) return hit.value;

  const inflight = detailInflight.get(matchId);
  if (inflight) return inflight;

  const task = (async (): Promise<SlimMatchJson | null> => {
  const local = await tryFetchLocalSlimMatchJson(matchId);
  if (local) return local;

  try {
    const raw = await fetchPlanBSlimPayload(matchId);
    if (!raw) return null;
    const cand = purifyMatchJsonForSlim(raw) as SlimMatchJson;
    return slimMatchDetailLooksUsable(cand) ? cand : null;
  } catch {
    return null;
  }
  })();

  detailInflight.set(matchId, task);
  try {
    const value = await task;
    putDetailCache(matchId, value);
    return value;
  } finally {
    if (detailInflight.get(matchId) === task) {
      detailInflight.delete(matchId);
    }
  }
}
