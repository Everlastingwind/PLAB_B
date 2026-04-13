import type {
  TeamTableMock,
  PlayerRowMock,
  AbilityBuildStep,
  SkillBuildStepUi,
  TalentPickUi,
  TalentTreeUi,
} from "../data/mockMatchPlayers";
import {
  abilityIconFallbackUrl,
  abilityIconUrl,
  dotaTalentsIconUrl,
  STEAM_CDN,
} from "../data/mockMatchPlayers";
import type { MatchHeaderData } from "../data/mockMatch";
import type { AbilityMapEntry, EntityMapsPayload } from "../types/entityMaps";
import type {
  SlimMatchJson,
  SlimPlayer,
  SlimAbilityStep,
  SlimSkillBuildStep,
  SlimTalentPick,
  SlimTalentTree,
} from "../types/slimMatch";
import { numOrZero, sanitizePlayerDisplayText } from "../lib/display";
import { kdaFromPlayerRecord } from "../lib/playerKda";
import { stripReplayRowFactionOutcomeNoise } from "../lib/playerDisplay";
import {
  buildSixPlusOneFinal,
  extractSixMainSlotItemIds,
  normalizeMainSixForDisplay,
} from "../lib/matchInventory";
import {
  computeScepterShardActive,
  scepterShardToBuffMode,
  stripConsumedAghanimsFromMainSlots,
} from "../lib/matchLoadoutAghanims";
import {
  applyTalentSelectionsToTree,
  parseTalentsArray,
} from "../lib/matchTalents";
import {
  compareByPlayerSlot,
  splitRadiantDirePlayers,
} from "../lib/matchGrouping";
import { isNoiseAbilityStep } from "../components/SkillBuildTimeline";
import abilityIdsJson from "../data/ability_ids.json";
import {
  buildTalentTreeUiFromBook,
  clampTalentTreeToHeroLevel,
  createTalentConstants,
  getTalentState,
  mergeTalentTreeWithAbilityIdState,
} from "../lib/getTalentState";

/** ability_id → internal key；entity_maps 缺新 id 时用其补 talentKeys / 排错 */
const ABILITY_NUM_ID_TO_KEY: Readonly<Record<string, string>> = (() => {
  const o: Record<string, string> = {};
  for (const [sid, vk] of Object.entries(
    abilityIdsJson as Record<string, string>
  )) {
    if (!vk || String(sid).includes(",")) continue;
    o[String(sid)] = vk;
  }
  return o;
})();

function heroKeyFromMaps(heroId: number, maps: EntityMapsPayload): string {
  const h = maps.heroes[String(heroId)];
  return h?.key || "unknown";
}

function mapPlayerInventory(
  p: SlimPlayer,
  maps: EntityMapsPayload
): PlayerRowMock["items"] {
  const raw = p as Record<string, unknown>;
  const six = buildSixPlusOneFinal(raw, p.items_slot ?? null, maps);
  return {
    main: normalizeMainSixForDisplay(six.main),
    backpack: [null, null, null] as PlayerRowMock["items"]["backpack"],
    neutral: null,
  };
}

function mapAbilitySteps(raw: unknown): AbilityBuildStep[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: AbilityBuildStep[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as SlimAbilityStep;
    const aid = numOrZero(o.ability_id);
    const key =
      o.ability_key == null || String(o.ability_key) === ""
        ? null
        : String(o.ability_key);
    const img = String(o.image_url ?? "").trim();
    out.push({
      time: o.time == null ? null : Number(o.time),
      abilityId: aid,
      abilityKey: key,
      abilityNameEn: String(o.ability_name_en ?? ""),
      abilityNameCn: String(o.ability_name_cn ?? ""),
      imageUrl: img || (key ? abilityIconUrl(key) : ""),
      isTalent: Boolean(o.is_talent),
      level: o.level != null ? numOrZero(o.level) : undefined,
    });
  }
  return out.length ? out : undefined;
}

function isTalentAbilityKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("special_bonus") || k.startsWith("ad_special_bonus");
}

/** 全属性加点：不参与天赋树左右档匹配 */
function isAttributeBonusAbilityKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return key.toLowerCase() === "special_bonus_attributes";
}

function mapSkillBuild(raw: unknown): SkillBuildStepUi[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: SkillBuildStepUi[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as SlimSkillBuildStep;
    const typ = o.type ?? o.kind ?? "ability";
    let kind: SkillBuildStepUi["kind"] =
      typ === "empty"
        ? "empty"
        : typ === "talent"
          ? "talent"
          : typ === "unknown"
            ? "unknown"
            : "ability";
    const ak =
      o.ability_key == null || String(o.ability_key) === ""
        ? null
        : String(o.ability_key);
    if (
      kind === "ability" &&
      ak &&
      isTalentAbilityKey(ak) &&
      !isAttributeBonusAbilityKey(ak)
    ) {
      kind = "talent";
    }
    const nameRaw = String(o.name ?? "").trim();
    const descRaw = String(o.desc ?? "").trim();
    const labelCn = String(o.label_cn ?? "").trim();
    const labelEn = String(o.label_en ?? "").trim();
    const desc =
      descRaw ||
      (kind === "talent" || kind === "unknown"
        ? nameRaw || labelCn || labelEn
        : "");
    let img = String(o.img ?? o.img_url ?? "").trim();
    if (!img) {
      if (kind === "ability" && ak) img = abilityIconUrl(ak);
      else if (kind === "talent") img = dotaTalentsIconUrl;
      else if (kind === "unknown") img = abilityIconFallbackUrl;
    }
    out.push({
      step: numOrZero(o.step),
      kind,
      level: o.level != null ? numOrZero(o.level) : undefined,
      abilityKey: ak,
      isTalent: Boolean(o.is_talent) || kind === "talent",
      img,
      labelEn,
      labelCn,
      ...(nameRaw ? { name: nameRaw } : {}),
      ...(desc ? { desc } : {}),
    });
  }
  return out.length ? out : undefined;
}

function abilityImgUrlFromMapEntry(entry: AbilityMapEntry | undefined): string {
  if (!entry) return "";
  const p = (entry.img || "").trim();
  if (p.startsWith("http://") || p.startsWith("https://")) return p.split("?")[0];
  if (p.startsWith("/")) return `${STEAM_CDN}${p}`;
  if (entry.key) return abilityIconUrl(entry.key);
  return "";
}

/** 与后端 resolve / 前端 skill_build 对齐，避免 ability_ 前缀或大小写导致左右判反 */
function normalizeTalentAbilityKey(k: string): string {
  return k.replace(/^ability_/i, "").trim().toLowerCase();
}

/**
 * 与 utils.dota_mapping._looks_like_interleaved_id_time 同思路：
 * 奇数位若全为「游戏秒」则前几手几乎总有 ≤400s；若奇数位最小值仍 >400，更像纯 ID 列表。
 */
function looksLikeOpenDotaInterleavedAbilityArr(raw: unknown[]): boolean {
  if (raw.length < 16 || raw.length % 2 !== 0) return false;
  const odds: number[] = [];
  for (let i = 1; i < raw.length; i += 2) {
    const n = Number(raw[i]);
    if (!Number.isFinite(n)) return false;
    odds.push(Math.floor(n));
  }
  if (odds.length < 8) return false;
  return Math.min(...odds) <= 400;
}

/** 用 entity_maps.abilities（dotaconstants）将 ability_upgrades_arr 转为时间轴步进 */
function skillBuildFromAbilityUpgradeArr(
  raw: unknown,
  maps: EntityMapsPayload
): SkillBuildStepUi[] | undefined {
  const dict = maps.abilities;
  if (!dict || typeof dict !== "object") return undefined;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const out: SkillBuildStepUi[] = [];
  const n = Math.min(raw.length, 25);
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    const idNum = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(idNum)) continue;
    const sid = String(Math.abs(Math.floor(idNum)));
    const entry: AbilityMapEntry | undefined = dict[sid];
    const stepNum = i + 1;
    if (!entry) {
      const hint = `未知技能 ID ${sid}`;
      out.push({
        step: stepNum,
        kind: "unknown",
        level: stepNum,
        abilityKey: null,
        isTalent: false,
        img: abilityIconFallbackUrl,
        labelEn: `#${sid}`,
        labelCn: hint,
        desc: hint,
      });
      continue;
    }
    const key = (entry.key || "").trim();
    const talent = key ? isTalentAbilityKey(key) : false;
    const nameEn = (entry.nameEn || key).trim();
    const nameCn = (entry.nameCn || "").trim();
    if (talent) {
      const desc = (nameCn || nameEn).trim();
      out.push({
        step: stepNum,
        kind: "talent",
        level: stepNum,
        abilityKey: key || null,
        isTalent: true,
        img: dotaTalentsIconUrl,
        labelEn: nameEn,
        labelCn: nameCn,
        ...(desc ? { desc } : {}),
      });
    } else {
      out.push({
        step: stepNum,
        kind: "ability",
        level: stepNum,
        abilityKey: key || null,
        isTalent: false,
        img: abilityImgUrlFromMapEntry(entry),
        labelEn: nameEn,
        labelCn: nameCn,
      });
    }
  }
  while (out.length < 25) {
    const s = out.length + 1;
    out.push({
      step: s,
      kind: "empty",
      abilityKey: null,
      isTalent: false,
      img: "",
      labelEn: "",
      labelCn: "",
    });
  }
  return out.slice(0, 25);
}

/** OpenDota 的 ability_upgrades：每项为一次真实加点，按 time 排序后即为加点顺序（非施法日志） */
function skillBuildFromOpenDotaAbilityUpgrades(
  ups: ReadonlyArray<{ ability?: number | string; time?: number }> | undefined,
  maps: EntityMapsPayload
): SkillBuildStepUi[] | undefined {
  if (!Array.isArray(ups) || ups.length === 0) return undefined;
  const dict = maps.abilities;
  if (!dict || typeof dict !== "object") return undefined;

  const sorted = [...ups]
    .filter((u) => u && typeof u === "object")
    .map((u) => {
      const o = u as { ability?: number | string; time?: number };
      const raw = o.ability;
      const aid =
        typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
      const t = o.time != null ? Number(o.time) : 0;
      return { aid, t: Number.isFinite(t) ? t : 0 };
    })
    .filter((x) => Number.isFinite(x.aid) && x.aid > 0)
    .sort((a, b) => a.t - b.t);

  const ids: number[] = [];
  for (const row of sorted) {
    if (ids.length >= 25) break;
    const sid = String(Math.abs(Math.floor(row.aid)));
    const entry: AbilityMapEntry | undefined = dict[sid];
    const key = (entry?.key || "").trim().toLowerCase();
    if (key) {
      const probe: SkillBuildStepUi = {
        step: ids.length + 1,
        kind: "ability",
        level: ids.length + 1,
        abilityKey: key,
        isTalent: false,
        img: "",
        labelEn: "",
        labelCn: "",
      };
      if (isNoiseAbilityStep(probe)) continue;
    }
    ids.push(Math.floor(row.aid));
  }

  if (ids.length === 0) return undefined;
  return skillBuildFromAbilityUpgradeArr(ids, maps);
}

function padSkillBuildEmptyTail(steps: SkillBuildStepUi[]): SkillBuildStepUi[] {
  const out = [...steps];
  while (out.length < 25) {
    const s = out.length + 1;
    out.push({
      step: s,
      kind: "empty",
      level: s,
      abilityKey: null,
      isTalent: false,
      img: "",
      labelEn: "",
      labelCn: "",
    });
  }
  return out.slice(0, 25);
}

/** 合并各源中的 ability_id（去重），供天赋 key 反查与 getTalentState 并集 */
function allAbilityIdsForPlayer(p: SlimPlayer): number[] {
  const ids = new Set<number>();
  const addId = (raw: unknown) => {
    const id = numOrZero(raw);
    if (id > 0) ids.add(id);
  };
  if (Array.isArray(p.ability_upgrades_arr)) {
    for (const x of p.ability_upgrades_arr) addId(x);
  }
  if (Array.isArray(p.skill_build)) {
    for (const row of p.skill_build) {
      if (!row || typeof row !== "object") continue;
      addId((row as SlimSkillBuildStep).ability_id);
    }
  }
  const rawTwo = (p as { skill_build_two_step?: unknown }).skill_build_two_step;
  if (Array.isArray(rawTwo)) {
    for (const row of rawTwo) {
      if (!row || typeof row !== "object") continue;
      addId((row as { ability_id?: number }).ability_id);
    }
  }
  if (Array.isArray(p.ability_timeline)) {
    for (const row of p.ability_timeline) {
      if (!row || typeof row !== "object") continue;
      addId((row as SlimAbilityStep).ability_id);
    }
  }
  if (Array.isArray(p.talents_taken)) {
    for (const row of p.talents_taken) {
      if (!row || typeof row !== "object") continue;
      addId((row as SlimAbilityStep).ability_id);
    }
  }
  const odUps = (
    p as SlimPlayer & {
      ability_upgrades?: ReadonlyArray<{ ability?: unknown }>;
    }
  ).ability_upgrades;
  if (Array.isArray(odUps)) {
    for (const row of odUps) {
      if (!row || typeof row !== "object") continue;
      addId((row as { ability?: unknown }).ability);
    }
  }
  return [...ids];
}

function idsFromSkillBuildOrdered(p: SlimPlayer): number[] {
  const seq: number[] = [];
  if (Array.isArray(p.skill_build)) {
    for (const row of p.skill_build) {
      if (!row || typeof row !== "object") continue;
      const id = numOrZero((row as SlimSkillBuildStep).ability_id);
      if (id > 0) seq.push(id);
    }
  }
  return seq;
}

function idsFromAbilityTimelineOrdered(p: SlimPlayer): number[] {
  const seq: number[] = [];
  if (Array.isArray(p.ability_timeline)) {
    for (const row of p.ability_timeline) {
      if (!row || typeof row !== "object") continue;
      const id = numOrZero((row as SlimAbilityStep).ability_id);
      if (id > 0) seq.push(id);
    }
  }
  return seq;
}

function idsFromTwoStepOrdered(p: SlimPlayer): number[] {
  const seq: number[] = [];
  const rawTwo = (p as { skill_build_two_step?: unknown }).skill_build_two_step;
  if (Array.isArray(rawTwo)) {
    for (const row of rawTwo) {
      if (!row || typeof row !== "object") continue;
      const id = numOrZero((row as { ability_id?: number }).ability_id);
      if (id > 0) seq.push(id);
    }
  }
  return seq;
}

/**
 * 供 getTalentState：优先 ability_upgrades_arr；
 * 否则在 skill_build / ability_timeline / skill_build_two_step 中取**较长**的一条（管线有时只填其一且含天赋 ID）。
 */
function abilityUpgradeSequenceForTalents(p: SlimPlayer): number[] {
  if (Array.isArray(p.ability_upgrades_arr) && p.ability_upgrades_arr.length > 0) {
    return p.ability_upgrades_arr
      .map((x) => Math.floor(Math.abs(Number(x))))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  const candidates = [
    idsFromSkillBuildOrdered(p),
    idsFromAbilityTimelineOrdered(p),
    idsFromTwoStepOrdered(p),
  ].sort((a, b) => b.length - a.length);
  return candidates[0] ?? [];
}

function collectTalentKeysFromAbilityIds(
  ids: number[],
  maps: EntityMapsPayload
): Set<string> {
  const out = new Set<string>();
  const dict = maps.abilities;
  for (const raw of ids) {
    const sid = String(Math.floor(Math.abs(raw)));
    const entry =
      dict && typeof dict === "object"
        ? (dict[sid] as AbilityMapEntry | undefined)
        : undefined;
    let key = String(entry?.key ?? "").trim();
    if (!key) key = String(ABILITY_NUM_ID_TO_KEY[sid] ?? "").trim();
    if (!key || isAttributeBonusAbilityKey(key)) continue;
    if (isTalentAbilityKey(key)) out.add(key);
  }
  return out;
}

function collectTalentKeysFromSkillBuildSteps(
  steps: SkillBuildStepUi[] | undefined
): Set<string> {
  const out = new Set<string>();
  if (!steps?.length) return out;
  for (const s of steps) {
    if (!s.abilityKey) continue;
    if (isAttributeBonusAbilityKey(s.abilityKey)) continue;
    if (
      s.kind === "talent" ||
      s.isTalent ||
      isTalentAbilityKey(s.abilityKey)
    ) {
      out.add(s.abilityKey);
    }
  }
  return out;
}

/** 管线侧「按真实学习顺序」的加点列表（常与 25 格 skill_build 互补） */
function mapSkillBuildFromTwoStep(
  raw: unknown,
  maps: EntityMapsPayload
): SkillBuildStepUi[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: SkillBuildStepUi[] = [];
  let stepNum = 1;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as {
      type?: string;
      ability_key?: string | null;
      ability_id?: number;
      name_en?: string;
      name_cn?: string;
      img_url?: string;
    };
    const ak =
      o.ability_key == null || String(o.ability_key) === ""
        ? null
        : String(o.ability_key);
    if (!ak) continue;
    const probe = { abilityKey: ak } as SkillBuildStepUi;
    if (isNoiseAbilityStep(probe)) continue;

    const id = o.ability_id != null ? numOrZero(o.ability_id) : 0;
    const sid = id > 0 ? String(id) : "";
    const entry = sid ? maps.abilities?.[sid] : undefined;
    const typ = String(o.type ?? "").toLowerCase();
    let kind: SkillBuildStepUi["kind"] =
      typ === "talent"
        ? "talent"
        : typ === "empty" || typ === "unknown"
          ? "unknown"
          : "ability";
    if (
      kind === "ability" &&
      isTalentAbilityKey(ak) &&
      !isAttributeBonusAbilityKey(ak)
    ) {
      kind = "talent";
    }
    const nameEn = String(o.name_en ?? "").trim();
    const nameCn = String(o.name_cn ?? "").trim();
    const imgRaw = String(o.img_url ?? "").trim();
    let img = imgRaw;
    if (!img && kind === "ability" && ak) {
      img = abilityImgUrlFromMapEntry(entry) || abilityIconUrl(ak);
    }
    if (!img && kind === "talent") img = dotaTalentsIconUrl;
    if (!img && kind === "unknown") img = abilityIconFallbackUrl;
    const nm = (nameCn || nameEn).trim();
    out.push({
      step: stepNum,
      kind,
      level: stepNum,
      abilityKey: ak,
      isTalent: kind === "talent",
      img,
      labelEn: nameEn,
      labelCn: nameCn,
      ...(nm ? { name: nm } : {}),
    });
    stepNum++;
  }
  return out.length ? padSkillBuildEmptyTail(out) : undefined;
}

function skillBuildHasRenderedSteps(steps: SkillBuildStepUi[] | undefined): boolean {
  if (!steps?.length) return false;
  return steps.some(
    (x) =>
      x.kind === "ability" || x.kind === "talent" || x.kind === "unknown"
  );
}

function normalizeTreeSideSelected(raw: unknown): "left" | "right" | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "left" || s === "l") return "left";
  if (s === "right" || s === "r") return "right";
  return null;
}

function mapTalentTree(raw: unknown): TalentTreeUi | null | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as SlimTalentTree;
  const tiers = Array.isArray(t.tiers) ? t.tiers : [];
  return {
    dotsLearned: numOrZero(t.dots_learned),
    tiers: tiers.map((row) => ({
      heroLevel: numOrZero(row.hero_level),
      left: {
        labelCn: String(row.left?.label_cn ?? ""),
        labelEn: String(row.left?.label_en ?? ""),
        abilityKey: String(row.left?.ability_key ?? "").trim(),
      },
      right: {
        labelCn: String(row.right?.label_cn ?? ""),
        labelEn: String(row.right?.label_en ?? ""),
        abilityKey: String(row.right?.ability_key ?? "").trim(),
      },
      selected: normalizeTreeSideSelected(row.selected),
    })),
  };
}

/** 用 d2vpkr `latest_talents_map.json` 的英文文案覆盖各档左右 labelEn（不改变 abilityKey / selected） */
function applyVpkrTalentLabelsToTree(
  tree: TalentTreeUi | null | undefined,
  maps: EntityMapsPayload
): TalentTreeUi | null | undefined {
  const tbl = maps.talentLabelsByKey;
  if (!tree?.tiers?.length || !tbl) return tree ?? null;

  // Hotfix: Primal Beast 7.41b 最新天赋文案（覆盖旧版/占位文本）
  const hardcodedOverrides: Record<string, string> = {
    special_bonus_unique_primal_beast_pulverize_duration: "+67% Pulverize Duration",
    special_bonus_unique_primal_beast_roar_dispells: "Basic Self-Dispel on Uproar Cast",
    special_bonus_unique_primal_beast_uproar_armor: "+6 Uproar Armor Per Stack",
    special_bonus_unique_primal_beast_trample_magic_resist:
      "+25% Magic Resistance During Trample",
    special_bonus_unique_primal_beast_colossal_trample:
      "Colossal 2x Bonuses During Trample",
    special_bonus_unique_primal_beast_trample_attack_damage:
      "+20% Trample Attack Multiplier",
    special_bonus_unique_primal_beast_trample_cooldown: "-5s Trample Cooldown",
  };

  const lookup = (abilityKey: string): string | undefined => {
    const k = abilityKey.trim();
    if (!k) return undefined;
    const override = hardcodedOverrides[k] ?? hardcodedOverrides[k.toLowerCase()];
    if (override) return override;
    const row = tbl[k] ?? tbl[k.toLowerCase()];
    const en = row?.labelEn?.trim();
    return en || undefined;
  };

  const patchSide = (side: TalentTreeUi["tiers"][number]["left"]) => {
    const ak = (side.abilityKey || "").trim();
    if (!ak) return side;
    const isPrimalTree =
      tree.tiers.some(
        (t) =>
          t.left?.abilityKey?.startsWith("special_bonus_unique_primal_beast_") ||
          t.right?.abilityKey?.startsWith("special_bonus_unique_primal_beast_")
      ) ?? false;
    const en = lookup(ak);
    if (!en) {
      // Primal Beast 10级右侧通用攻击天赋在 7.41b 为 +25 Damage（旧数据常残留 +30）
      if (isPrimalTree && ak === "special_bonus_attack_damage_25") {
        return { ...side, labelEn: "+25 Damage", labelCn: "+25 Damage" };
      }
      return side;
    }
    // Tooltip prioritizes labelCn first; for Primal Beast overrides force both fields
    // to prevent stale/legacy text (e.g. "Primal Beast Colossal Trample") from winning.
    if (ak.startsWith("special_bonus_unique_primal_beast_")) {
      return { ...side, labelEn: en, labelCn: en };
    }
    return { ...side, labelEn: en };
  };

  const tiers = tree.tiers.map((tier) => ({
    ...tier,
    left: patchSide(tier.left),
    right: patchSide(tier.right),
  }));

  // Final fallback: hard align Primal Beast talent text to official 7.41b rows.
  // This avoids stale upstream labels when abilityKey is empty or generic.
  const primalSignal = tiers.some((tier) => {
    const keys = [tier.left?.abilityKey ?? "", tier.right?.abilityKey ?? ""]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const labels = [tier.left?.labelEn ?? "", tier.right?.labelEn ?? "", tier.left?.labelCn ?? "", tier.right?.labelCn ?? ""]
      .map((s) => s.trim().toLowerCase());
    return (
      keys.some((k) => k.includes("special_bonus_unique_primal_beast_")) ||
      labels.some(
        (t) =>
          t.includes("pulverize") ||
          t.includes("uproar") ||
          t.includes("trample") ||
          t.includes("colossal")
      )
    );
  });

  if (!primalSignal) return { ...tree, tiers };

  const primalByLevel: Record<
    number,
    { left: string; right: string }
  > = {
    25: {
      left: "+67% Pulverize Duration",
      right: "Colossal 2x Bonuses During Trample",
    },
    20: {
      left: "Basic Self-Dispel on Uproar Cast",
      right: "+20% Trample Attack Multiplier",
    },
    15: {
      left: "+6 Uproar Armor Per Stack",
      right: "-5s Trample Cooldown",
    },
    10: {
      left: "+25% Magic Resistance During Trample",
      right: "+25 Damage",
    },
  };

  const hardAligned = tiers.map((tier) => {
    const row = primalByLevel[tier.heroLevel];
    if (!row) return tier;
    return {
      ...tier,
      left: { ...tier.left, labelEn: row.left, labelCn: row.left },
      right: { ...tier.right, labelEn: row.right, labelCn: row.right },
    };
  });
  return { ...tree, tiers: hardAligned };
}

/** 汇总「本局已点天赋」ability_key；排除全属性点，避免干扰天赋树匹配 */
function collectTalentAbilityKeys(
  skillBuild: SkillBuildStepUi[] | undefined,
  abilityTimeline: AbilityBuildStep[] | undefined,
  talentsTaken: AbilityBuildStep[] | undefined,
  talentPickKeys: string[] | undefined
): Set<string> {
  const keys = new Set<string>();
  for (const s of skillBuild ?? []) {
    if (!s.abilityKey) continue;
    if (isAttributeBonusAbilityKey(s.abilityKey)) continue;
    if (
      s.kind === "talent" ||
      s.isTalent ||
      isTalentAbilityKey(s.abilityKey)
    ) {
      keys.add(s.abilityKey);
    }
  }
  for (const s of abilityTimeline ?? []) {
    if (!s.isTalent || !s.abilityKey) continue;
    if (isAttributeBonusAbilityKey(s.abilityKey)) continue;
    keys.add(s.abilityKey);
  }
  for (const s of talentsTaken ?? []) {
    if (!s.isTalent || !s.abilityKey) continue;
    if (isAttributeBonusAbilityKey(s.abilityKey)) continue;
    keys.add(s.abilityKey);
  }
  for (const k of talentPickKeys ?? []) {
    const t = String(k).trim();
    if (t && !isAttributeBonusAbilityKey(t)) keys.add(t);
  }
  return keys;
}

/** 录像/API 与天赋树槽位 ability_key 不一致时，补全等价 key（与 utils/dota_pipeline.TALENT_UPGRADE_ALTERNATE_KEYS 对齐） */
function expandTalentKeyAliases(keys: Set<string>, heroNpc: string): void {
  if (heroNpc !== "npc_dota_hero_doom_bringer") return;
  if (keys.has("special_bonus_magic_resistance_10")) {
    keys.add("special_bonus_unique_doom_3");
  }
  if (keys.has("special_bonus_unique_doom_3")) {
    keys.add("special_bonus_magic_resistance_10");
  }
}

/** 用天赋 ability_key 集合填充 tiers[].selected / dots_learned（JSON 里常为 null 时） */
function mergeTalentTreeWithKeys(
  tree: TalentTreeUi | null | undefined,
  keys: Set<string>
): TalentTreeUi | null | undefined {
  if (!tree?.tiers?.length) return tree ?? null;
  if (keys.size === 0) return tree;

  const treeNormKeys = new Set<string>();
  for (const t of tree.tiers) {
    const lk = (t.left.abilityKey || "").trim();
    const rk = (t.right.abilityKey || "").trim();
    if (lk) treeNormKeys.add(normalizeTalentAbilityKey(lk));
    if (rk) treeNormKeys.add(normalizeTalentAbilityKey(rk));
  }
  const pickedNorm = new Set(
    [...keys]
      .map((k) => normalizeTalentAbilityKey(k))
      .filter((k) => k && treeNormKeys.has(k))
  );

  const tiers = tree.tiers.map((tier) => {
    if (tier.selected === "left" || tier.selected === "right") return tier;
    const lk = (tier.left.abilityKey || "").trim();
    const rk = (tier.right.abilityKey || "").trim();
    const ln = lk ? normalizeTalentAbilityKey(lk) : "";
    const rn = rk ? normalizeTalentAbilityKey(rk) : "";
    const leftHit = Boolean(ln && pickedNorm.has(ln));
    const rightHit = Boolean(rn && pickedNorm.has(rn));
    if (leftHit && !rightHit) return { ...tier, selected: "left" as const };
    if (rightHit && !leftHit) return { ...tier, selected: "right" as const };
    return tier;
  });
  const dotsLearned = tiers.filter(
    (x) => x.selected === "left" || x.selected === "right"
  ).length;
  return { ...tree, tiers, dotsLearned };
}

/** 解析器 talent_picks：按 level + direction 写入 tiers[].selected，可选覆盖该侧展示名 */
function mergeTalentTreeWithParserPicks(
  tree: TalentTreeUi | null | undefined,
  picks: SlimTalentPick[] | undefined
): TalentTreeUi | null | undefined {
  if (!tree?.tiers?.length || !picks?.length) return tree ?? null;

  const byLevel = new Map<number, "left" | "right">();
  const nameByLevel = new Map<number, { side: "left" | "right"; name: string }>();

  for (const p of picks) {
    const lv = Number(
      p.level ?? (p as { hero_level?: number }).hero_level ?? NaN
    );
    if (!Number.isFinite(lv) || ![10, 15, 20, 25].includes(lv)) continue;
    const d = String(p.direction ?? "").trim().toLowerCase();
    const side =
      d === "left" || d === "l" || d === "0"
        ? ("left" as const)
        : d === "right" || d === "r" || d === "1"
          ? ("right" as const)
          : null;
    if (!side) continue;
    byLevel.set(lv, side);
    const nm = String(
      p.talent_name ?? (p as { name?: string }).name ?? ""
    ).trim();
    if (nm) nameByLevel.set(lv, { side, name: nm });
  }

  if (byLevel.size === 0) return tree;

  const tiers = tree.tiers.map((tier) => {
    const lv = tier.heroLevel;
    const pick = byLevel.get(lv);
    if (!pick) return tier;
    if (tier.selected === "left" || tier.selected === "right") return tier;
    const next = { ...tier, selected: pick };
    const overlay = nameByLevel.get(lv);
    if (overlay) {
      if (overlay.side === "left") {
        next.left = { ...tier.left, labelCn: overlay.name };
      } else {
        next.right = { ...tier.right, labelCn: overlay.name };
      }
    }
    return next;
  });
  const dotsLearned = tiers.filter(
    (t) => t.selected === "left" || t.selected === "right"
  ).length;
  return { ...tree, tiers, dotsLearned };
}

function collectNormKeysFromTalentTree(
  tree: TalentTreeUi | null | undefined
): Set<string> {
  const s = new Set<string>();
  for (const t of tree?.tiers ?? []) {
    const lk = (t.left.abilityKey || "").trim();
    const rk = (t.right.abilityKey || "").trim();
    if (lk) s.add(normalizeTalentAbilityKey(lk));
    if (rk) s.add(normalizeTalentAbilityKey(rk));
  }
  return s;
}

/**
 * 收集本局「已学 special_bonus」类 internal key（含录像 valuename 等松散字段），
 * 用于与 talent_tree 槽位比对；value 为便于日志展示的文案。
 */
function collectLearnedSpecialBonusDisplayMap(
  p: SlimPlayer,
  maps: EntityMapsPayload
): Map<string, string> {
  const out = new Map<string, string>();

  const addKey = (rawKey: string | null | undefined, disp: string) => {
    const k = String(rawKey ?? "").trim();
    if (!k || !isTalentAbilityKey(k) || isAttributeBonusAbilityKey(k)) return;
    const nk = normalizeTalentAbilityKey(k);
    if (!out.has(nk)) out.set(nk, disp.trim() || k);
  };

  const addId = (id: number, disp: string) => {
    if (id <= 0) return;
    const sid = String(Math.floor(Math.abs(id)));
    const ak =
      String(maps.abilities?.[sid]?.key ?? "").trim() ||
      String(ABILITY_NUM_ID_TO_KEY[sid] ?? "").trim();
    if (ak) addKey(ak, disp || ak);
    else if (disp) addKey(`#${sid}`, disp);
  };

  const walkSteps = (rows: readonly unknown[] | undefined, label: string) => {
    if (!rows?.length) return;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const ak = o.ability_key ?? o.abilityKey;
      if (typeof ak === "string" && ak) addKey(ak, label);
      const id = numOrZero(o.ability_id);
      if (id > 0) addId(id, label);
    }
  };

  walkSteps(p.skill_build, "skill_build");
  walkSteps(p.ability_timeline, "ability_timeline");
  walkSteps(p.talents_taken, "talents_taken");
  const rawTwo = (p as { skill_build_two_step?: unknown }).skill_build_two_step;
  walkSteps(Array.isArray(rawTwo) ? rawTwo : undefined, "skill_build_two_step");

  const pRec = p as Record<string, unknown>;
  for (const v of Object.values(pRec)) {
    if (!Array.isArray(v)) continue;
    for (const row of v) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const vn = o.valuename ?? o.valueName;
      const al = o.abilitylevel ?? o.abilityLevel;
      if (typeof vn !== "string" || !vn.toLowerCase().includes("special_bonus"))
        continue;
      const lv = Number(al);
      if (!Number.isFinite(lv) || lv <= 0) continue;
      addKey(vn, vn);
    }
  }

  return out;
}

/** 有加点数据但 talent_tree 上无对应槽位时告警，便于补 entity_maps / 天赋书 */
function warnUnmatchedTalentLearnings(
  p: SlimPlayer,
  tree: TalentTreeUi | null | undefined,
  maps: EntityMapsPayload,
  heroId: number
): void {
  if (typeof console === "undefined" || typeof console.warn !== "function")
    return;
  const learned = collectLearnedSpecialBonusDisplayMap(p, maps);
  if (learned.size === 0) return;

  const slotNorms = collectNormKeysFromTalentTree(tree);
  const heroLabel =
    String(p.hero_name_cn ?? "").trim() ||
    String(p.hero_name_en ?? "").trim() ||
    maps.heroes[String(heroId)]?.key ||
    `hero_id=${heroId}`;

  if (slotNorms.size === 0) {
    for (const [, disp] of learned) {
      console.warn("未匹配的天赋:", heroLabel, disp);
    }
    return;
  }

  for (const [norm, disp] of learned) {
    if (slotNorms.has(norm)) continue;
    console.warn("未匹配的天赋:", heroLabel, disp);
  }
}

function slimPlayerToRow(p: SlimPlayer, maps: EntityMapsPayload): PlayerRowMock {
  const heroId = numOrZero(p.hero_id);
  const key = heroKeyFromMaps(heroId, maps);
  const kda = kdaFromPlayerRecord(p as Record<string, unknown>);

  /** 天赋档 10/15/20/25 须 hero level ≥ 档；用于纠偏 learned id 过宽 */
  const talentLevelCap = (() => {
    const v = p.level;
    if (v === undefined || v === null) return null;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n <= 0 || n > 50) return null;
    return n;
  })();

  const pick = (v: unknown): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };

  const abilityTimeline = mapAbilitySteps(p.ability_timeline);
  const talentsFromJson = mapAbilitySteps(p.talents_taken);
  const talentsTaken =
    talentsFromJson && talentsFromJson.length > 0
      ? talentsFromJson
      : abilityTimeline?.filter((x) => x.isTalent);
  const heroNameCnRaw = String(p.hero_name_cn ?? "").trim();
  const pipelineSkillBuild = mapSkillBuild(p.skill_build);
  const opendotaUps = (
    p as { ability_upgrades?: ReadonlyArray<{ ability?: number | string; time?: number }> }
  ).ability_upgrades;
  const openDotaSkillBuild = skillBuildFromOpenDotaAbilityUpgrades(
    opendotaUps,
    maps
  );

  let skillBuild: SkillBuildStepUi[] | undefined;
  const rawUpgradeArr = p.ability_upgrades_arr;
  if (
    Array.isArray(rawUpgradeArr) &&
    rawUpgradeArr.length > 0 &&
    !looksLikeOpenDotaInterleavedAbilityArr(rawUpgradeArr)
  ) {
    const fromArr = skillBuildFromAbilityUpgradeArr(rawUpgradeArr, maps);
    if (skillBuildHasRenderedSteps(fromArr)) {
      skillBuild = fromArr;
    }
  }
  if (!skillBuild && skillBuildHasRenderedSteps(openDotaSkillBuild)) {
    skillBuild = openDotaSkillBuild;
  } else if (!skillBuild && skillBuildHasRenderedSteps(pipelineSkillBuild)) {
    skillBuild = pipelineSkillBuild;
  } else if (
    !skillBuild &&
    Array.isArray(rawUpgradeArr) &&
    rawUpgradeArr.length > 0
  ) {
    skillBuild = skillBuildFromAbilityUpgradeArr(rawUpgradeArr, maps);
  }

  const skillBuildForTalentKeys = pipelineSkillBuild ?? skillBuild;
  const skillBuildTwoStep = mapSkillBuildFromTwoStep(
    (p as { skill_build_two_step?: unknown }).skill_build_two_step,
    maps
  );
  // skill_build_two_step 与 ability_upgrades_arr 同源时易混入噪声；仅当管线 skill_build 完全无展示内容时再回退
  if (
    !skillBuildHasRenderedSteps(pipelineSkillBuild) &&
    skillBuildTwoStep &&
    skillBuildHasRenderedSteps(skillBuildTwoStep) &&
    !skillBuildHasRenderedSteps(skillBuild)
  ) {
    skillBuild = skillBuildTwoStep;
  }
  const pickKeys = Array.isArray(p.talent_pick_keys) ? p.talent_pick_keys : undefined;
  const talentKeys = collectTalentAbilityKeys(
    skillBuildForTalentKeys,
    abilityTimeline,
    talentsTaken,
    pickKeys
  );
  for (const k of collectTalentKeysFromAbilityIds(
    allAbilityIdsForPlayer(p),
    maps
  )) {
    talentKeys.add(k);
  }
  for (const k of collectTalentKeysFromSkillBuildSteps(skillBuildTwoStep)) {
    talentKeys.add(k);
  }
  const heroNpc =
    String((p as { hero_internal_name?: string }).hero_internal_name ?? "") ||
    (key !== "unknown" ? `npc_dota_hero_${key}` : "");
  expandTalentKeyAliases(talentKeys, heroNpc);
  let talentTree: TalentTreeUi | null | undefined = mapTalentTree(p.talent_tree);
  if (!talentTree?.tiers?.length) {
    const fromBook = buildTalentTreeUiFromBook(heroId, maps);
    if (fromBook) talentTree = fromBook;
  }
  const parserPicks = Array.isArray(p.talent_picks)
    ? (p.talent_picks as SlimTalentPick[])
    : undefined;

  let talentPicksUi: TalentPickUi[] | undefined;
  if (parserPicks?.length) {
    const rows: TalentPickUi[] = [];
    for (const x of parserPicks) {
      const lv = Number(
        x.level ?? (x as { hero_level?: number }).hero_level ?? NaN
      );
      if (!Number.isFinite(lv) || ![10, 15, 20, 25].includes(lv)) continue;
      const nm = String(
        x.talent_name ?? (x as { name?: string }).name ?? ""
      ).trim();
      rows.push({
        level: lv,
        direction: String(x.direction ?? ""),
        ...(nm ? { talent_name: nm, name: nm } : {}),
      });
    }
    if (rows.length) talentPicksUi = rows;
  }

  const tierFromTalentsArr = parseTalentsArray(p.talents);
  if (tierFromTalentsArr.length && !talentPicksUi?.length) {
    talentPicksUi = tierFromTalentsArr.map((t) => ({
      level: t.heroLevel,
      direction: t.side,
    }));
  }

  const mergedParserPicks: SlimTalentPick[] | undefined = (() => {
    const base: SlimTalentPick[] = [...(parserPicks ?? [])];
    const seen = new Set(
      base.map((x) =>
        Number(x.level ?? (x as { hero_level?: number }).hero_level ?? 0)
      )
    );
    for (const t of tierFromTalentsArr) {
      if (seen.has(t.heroLevel)) continue;
      seen.add(t.heroLevel);
      base.push({
        level: t.heroLevel,
        direction: t.side,
      } as SlimTalentPick);
    }
    return base.length ? base : undefined;
  })();

  talentTree =
    mergeTalentTreeWithParserPicks(talentTree, mergedParserPicks) ?? talentTree;
  if (tierFromTalentsArr.length) {
    talentTree = applyTalentSelectionsToTree(talentTree, tierFromTalentsArr);
  }
  const upgradeArrForTalents = (() => {
    if (Array.isArray(p.ability_upgrades_arr) && p.ability_upgrades_arr.length > 0) {
      return p.ability_upgrades_arr;
    }
    return abilityUpgradeSequenceForTalents(p);
  })();
  const learnedAbilityIdUnion = allAbilityIdsForPlayer(p);
  talentTree = mergeTalentTreeWithAbilityIdState(
    talentTree,
    getTalentState(
      {
        hero_id: heroId,
        hero_level: talentLevelCap ?? undefined,
        ability_upgrades_arr: upgradeArrForTalents.length ? upgradeArrForTalents : null,
        ability_upgrades: Array.isArray(opendotaUps) ? opendotaUps : null,
        learned_ability_id_union:
          learnedAbilityIdUnion.length > 0 ? learnedAbilityIdUnion : null,
      },
      createTalentConstants(maps.heroes)
    )
  );
  /** 有序推断后仍有无档位的，用已收集的 talent key 仅填补未选 tier（不覆盖已有 left/right） */
  talentTree = mergeTalentTreeWithKeys(talentTree, talentKeys) ?? talentTree;
  /** 须在 key 合并之后：learned 集合过宽时 key 会误点亮高档位，须按终局等级再裁掉 */
  talentTree = clampTalentTreeToHeroLevel(talentTree, talentLevelCap);
  talentTree = applyVpkrTalentLabelsToTree(talentTree, maps) ?? talentTree;
  warnUnmatchedTalentLearnings(p, talentTree, maps, heroId);
  if (talentPicksUi?.length && talentLevelCap != null) {
    talentPicksUi = talentPicksUi.filter(
      (x) => Number(x.level) <= talentLevelCap
    );
    if (talentPicksUi.length === 0) talentPicksUi = undefined;
  }
  const proNameRaw = p.pro_name;
  const proName =
    proNameRaw === null || proNameRaw === undefined
      ? undefined
      : stripReplayRowFactionOutcomeNoise(
          sanitizePlayerDisplayText(String(proNameRaw))
        ) || undefined;
  const accountIdRaw = Number(p.account_id ?? 0);
  const accountId =
    Number.isFinite(accountIdRaw) && accountIdRaw > 0
      ? accountIdRaw
      : undefined;
  const lbRaw = (p as { leaderboard_rank?: unknown }).leaderboard_rank;
  const leaderboardRank = (() => {
    const n = numOrZero(lbRaw);
    return n > 0 ? n : undefined;
  })();
  const rawPlayer = p as Record<string, unknown>;
  let items = mapPlayerInventory(p, maps);
  const mainItemIds = extractSixMainSlotItemIds(rawPlayer, p.items_slot ?? null);
  const scepterShardBuff = computeScepterShardActive({
    raw: rawPlayer,
    main: items.main,
    mainItemIds,
  });
  items = {
    ...items,
    main: stripConsumedAghanimsFromMainSlots(
      items.main,
      mainItemIds,
      scepterShardBuff
    ),
  };
  const scepterActive = scepterShardBuff.scepter;
  const shardActive = scepterShardBuff.shard;
  return {
    slot: numOrZero(p.player_slot),
    heroId: heroId || undefined,
    heroKey: key,
    heroNameCn: heroNameCnRaw || undefined,
    proName,
    accountId,
    steamName: stripReplayRowFactionOutcomeNoise(
      sanitizePlayerDisplayText(String(p.personaname || p.name || "-"))
    ),
    rankLabel: "",
    rankColorClass: "text-zinc-500",
    leaderboardRank,
    level: numOrZero(p.level),
    kills: kda.kills,
    deaths: kda.deaths,
    assists: kda.assists,
    lastHits: numOrZero(p.last_hits),
    denies: numOrZero(p.denies),
    netWorth: pick(p.net_worth),
    gpm: numOrZero(p.gold_per_min),
    xpm: numOrZero(p.xp_per_min),
    heroDamage: numOrZero(p.hero_damage),
    towerDamage: numOrZero(p.tower_damage),
    heroHeal: pick(p.hero_healing),
    items,
    scepterActive,
    shardActive,
    buffs: {
      aghanims: scepterShardToBuffMode(scepterActive, shardActive),
      moonShard: false,
    },
    neutralImg: null,
    talentTree: talentTree ?? null,
    talentPicks: talentPicksUi,
    skillBuild,
    abilityTimeline,
    talentsTaken: talentsTaken?.length ? talentsTaken : undefined,
  };
}

/** 路人/本地录像等：不展示「天辉/夜魇」横幅下的职业战队名；有联赛 id 或非占位联赛名时展示。 */
const PLACEHOLDER_LEAGUE_NAMES = new Set(["—", "-", "本地录像"]);

function shouldShowFactionTeamNames(slim: SlimMatchJson): boolean {
  const rec = slim as Record<string, unknown>;
  const lid = Number(rec["league_id"] ?? rec["leagueid"] ?? slim.league_id ?? 0);
  if (Number.isFinite(lid) && lid > 0) return true;
  const ln = String(slim.league_name ?? "").trim();
  if (!ln || PLACEHOLDER_LEAGUE_NAMES.has(ln)) return false;
  return true;
}

function majorityTeamName(players: SlimPlayer[]): string | undefined {
  const counts = new Map<string, number>();
  for (const p of players) {
    const t = String(p.team_name ?? "").trim();
    if (!t || t === "—" || t === "-") continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [name, n] of counts.entries()) {
    if (n > bestN) {
      bestN = n;
      best = name;
    }
  }
  return best;
}

export function buildUiFromSlim(
  slim: SlimMatchJson,
  maps: EntityMapsPayload,
  defaults: {
    radiantName: string;
    direName: string;
  }
): {
  header: MatchHeaderData;
  radiant: TeamTableMock;
  dire: TeamTableMock;
} {
  const players = slim.players || [];
  /** 与 ReplayCard / 后端一致：槽位优先（0–4 天辉；5–9 与 128–132 夜魇），勿用「slot&lt;128」兜底（会误判 5–9）。 */
  const { radiantPlayers: rad, direPlayers: dire } =
    splitRadiantDirePlayers(players);
  rad.sort(compareByPlayerSlot);
  dire.sort(compareByPlayerSlot);

  const showFactionTeams = shouldShowFactionTeamNames(slim);
  const radiantTeamName = showFactionTeams
    ? majorityTeamName(rad) ?? defaults.radiantName
    : "";
  const direTeamName = showFactionTeams
    ? majorityTeamName(dire) ?? defaults.direName
    : "";

  const rw = slim.radiant_win === true;
  const header: MatchHeaderData = {
    winnerSide: rw ? "radiant" : "dire",
    winnerTeamName: showFactionTeams
      ? rw
        ? radiantTeamName
        : direTeamName
      : "",
    winnerLabel: "胜利",
    scoreRadiant: numOrZero(slim.radiant_score),
    scoreDire: numOrZero(slim.dire_score),
    gameMode: "队长模式",
    duration: formatDur(slim.duration),
    endedAgo: "结束于 — 之前",
    leagueLabel: "LEAGUE",
    leagueName: String(slim.league_name || "—"),
    matchId: String(slim.match_id ?? slim._meta?.match_id ?? "—"),
  };

  const radiant: TeamTableMock = {
    teamName: radiantTeamName,
    factionLabel: "天辉 · Radiant",
    side: "radiant",
    won: rw,
    players: rad.map((p) => slimPlayerToRow(p, maps)),
  };
  const direTeam: TeamTableMock = {
    teamName: direTeamName,
    factionLabel: "夜魇 · Dire",
    side: "dire",
    won: !rw,
    players: dire.map((p) => slimPlayerToRow(p, maps)),
  };

  return { header, radiant, dire: direTeam };
}

function formatDur(sec: unknown): string {
  const s = numOrZero(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** 若清洗结果缺少队名，可用占位 */
export const DEFAULT_TEAM_NAMES = {
  radiantName: "Radiant",
  direName: "Dire",
};
