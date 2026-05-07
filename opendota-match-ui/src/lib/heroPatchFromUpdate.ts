/**
 * 从 Supabase `dota2_updates.content`（官方 Datafeed JSON）中提取指定英雄的补丁说明行。
 */

function pickPatchDataRoot(parsed: Record<string, unknown>): Record<string, unknown> {
  const en = parsed.en;
  const zh = parsed.zh;
  if (
    en &&
    zh &&
    typeof en === "object" &&
    !Array.isArray(en) &&
    typeof zh === "object" &&
    !Array.isArray(zh)
  ) {
    return en as Record<string, unknown>;
  }
  return parsed;
}

function normalizeHeroTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function pushNoteRows(rows: unknown, out: string[]): void {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const n = o.note;
    if (typeof n === "string" && n.trim()) out.push(n.trim());
    const inf = o.info;
    if (typeof inf === "string" && inf.trim()) out.push(inf.trim());
  }
}

function collectHeroNoteStrings(hero: Record<string, unknown>): string[] {
  const out: string[] = [];
  pushNoteRows(hero.hero_notes, out);
  pushNoteRows(hero.talent_notes, out);
  const abilities = hero.abilities;
  if (!Array.isArray(abilities)) return out;
  for (const ab of abilities) {
    if (!ab || typeof ab !== "object") continue;
    pushNoteRows((ab as Record<string, unknown>).ability_notes, out);
  }
  return out;
}

export function extractVersionFromPatchJsonContent(
  content: string | null | undefined
): string {
  if (!content?.trim().startsWith("{")) return "";
  try {
    const j = JSON.parse(content.trim()) as Record<string, unknown>;
    const root = pickPatchDataRoot(j);
    const v = root.patch_number ?? root.patch_name ?? root.version;
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/**
 * @param heroNameEn 用于在 JSON 仅有英文名而无 id 时的兜底比对
 */
export function extractHeroPatchNotesFromUpdateContent(
  content: string | null | undefined,
  heroId: number,
  heroNameEn: string
): string[] {
  if (!content?.trim().startsWith("{")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const root = pickPatchDataRoot(parsed as Record<string, unknown>);
  const heroes = root.heroes;
  if (!Array.isArray(heroes)) return [];
  const nameNorm = normalizeHeroTitle(heroNameEn);
  const hero = heroes.find((h) => {
    if (!h || typeof h !== "object") return false;
    const o = h as Record<string, unknown>;
    const hid = Number(o.hero_id);
    if (Number.isFinite(hid) && hid > 0 && hid === heroId) return true;
    const hn = o.hero_name ?? o.name;
    if (typeof hn === "string" && normalizeHeroTitle(hn) === nameNorm)
      return true;
    return false;
  });
  if (!hero || typeof hero !== "object") return [];
  return collectHeroNoteStrings(hero as Record<string, unknown>);
}
