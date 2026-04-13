/**
 * 解析 API / OpenDota 可能提供的 talents 数组，合并为 10/15/20/25 左/右选择。
 */
import type { TalentTreeUi } from "../data/mockMatchPlayers";

export type TalentTierSelection = {
  heroLevel: number;
  side: "left" | "right";
};

const TIERS = new Set([10, 15, 20, 25]);

function normSide(v: unknown): "left" | "right" | null {
  if (v === true || v === 1 || v === "1") return "right";
  if (v === false || v === 0 || v === "0") return "left";
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s === "left" || s === "l") return "left";
  if (s === "right" || s === "r") return "right";
  return null;
}

/**
 * 支持多种松散结构：
 * - [{ level: 10, is_right: false }, ...]
 * - [{ hero_level: 25, slot: 1 }, ...]  // slot 0=left 1=right
 * - [{ side: "left" }, ...] + level
 */
export function parseTalentsArray(raw: unknown): TalentTierSelection[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: TalentTierSelection[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const lv = numOr(o.level ?? o.hero_level ?? o.tier ?? o.talent_level);
    if (!TIERS.has(lv)) continue;

    let side: "left" | "right" | null = null;
    if (typeof o.is_right === "boolean") {
      side = o.is_right ? "right" : "left";
    } else if (typeof o.is_left === "boolean") {
      side = o.is_left ? "left" : "right";
    } else if (o.slot !== undefined) {
      const sl = numOr(o.slot);
      side = sl <= 0 ? "left" : "right";
    } else {
      side = normSide(o.side ?? o.direction ?? o.branch);
    }
    if (!side) continue;
    out.push({ heroLevel: lv, side });
  }
  return out;
}

function numOr(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/** 将 talents[] 解析结果写入树形 tiers[].selected（不覆盖已有 JSON 显式选择） */
export function applyTalentSelectionsToTree(
  tree: TalentTreeUi | null | undefined,
  selections: TalentTierSelection[]
): TalentTreeUi | null {
  if (!selections.length) return tree ?? null;
  if (!tree?.tiers?.length) return tree ?? null;
  const byLv = new Map(selections.map((s) => [s.heroLevel, s.side]));
  const tiers = tree.tiers.map((tier) => {
    if (tier.selected === "left" || tier.selected === "right") return tier;
    const side = byLv.get(tier.heroLevel);
    if (!side) return tier;
    return { ...tier, selected: side };
  });
  const dotsLearned = tiers.filter(
    (t) => t.selected === "left" || t.selected === "right"
  ).length;
  return { ...tree, tiers, dotsLearned };
}
