import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import { purifyMatchJsonForSlim } from "./purifyRawMatchJson";
import { fetchPlanBSlimPayload } from "./supabasePlanB";
import { staticDataSearchParam } from "./staticDataVersion";

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

/**
 * 优先读本地 `/data/matches/{id}.json`；若缺失、非 JSON 或内容不足以渲染明细，则回退 Supabase plan_b。
 */
export async function loadSlimMatchJsonForDetail(
  matchId: number
): Promise<SlimMatchJson | null> {
  if (!Number.isFinite(matchId) || matchId <= 0) return null;
  const q = staticDataSearchParam();
  let local: SlimMatchJson | null = null;
  try {
    const res = await fetch(`/data/matches/${matchId}.json${q}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const text = await res.text();
      const head = text.trimStart();
      if (head.startsWith("<") || head.startsWith("<!")) {
        /* 常见：dev 服务器对未知路径回 HTML（仍 200） */
      } else {
        try {
          const parsed: unknown = JSON.parse(text);
          const cand = purifyMatchJsonForSlim(parsed) as SlimMatchJson;
          if (slimMatchDetailLooksUsable(cand)) local = cand;
        } catch {
          /* 非 JSON */
        }
      }
    }
  } catch {
    /* 网络错误 → 走云端 */
  }
  if (local) return local;

  try {
    const raw = await fetchPlanBSlimPayload(matchId);
    if (!raw) return null;
    const cand = purifyMatchJsonForSlim(raw) as SlimMatchJson;
    return slimMatchDetailLooksUsable(cand) ? cand : null;
  } catch {
    return null;
  }
}
