import { seededProNameForAccount } from "../data/proPlayers";
import { sanitizePlayerDisplayText } from "./display";

const ROW_NOISE = new Set([
  "radiant",
  "dire",
  "win",
  "loss",
  "victory",
  "defeat",
]);

/** 解析结果里偶发的阵营/胜负后缀；全局由 FactionMatchBanner 展示 */
export function stripReplayRowFactionOutcomeNoise(raw: string): string {
  const cleaned = sanitizePlayerDisplayText(raw);
  if (!cleaned) return "";
  const parts = cleaned
    .split(/[|｜]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && !ROW_NOISE.has(x.toLowerCase()));
  let t = parts.join(" ").replace(/\s+/g, " ").trim();
  t = t
    .replace(/\b(radiant|dire|win|loss|victory|defeat)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

/**
 * 职业选手显示注册 ID；否则用 `fallbackName`（如 Steam 昵称）。皆无则「匿名玩家」。
 * 路人隐私场景请用 `privacyMaskedPlayerDisplayName`（不透出 Steam 名）。
 */
export function displayPlayerLabel(
  proName: string | null | undefined,
  fallbackName?: string | null | undefined
): string {
  const pro = stripReplayRowFactionOutcomeNoise(
    sanitizePlayerDisplayText(String(proName ?? ""))
  );
  if (pro.length > 0) return pro;
  const fb = stripReplayRowFactionOutcomeNoise(
    sanitizePlayerDisplayText(String(fallbackName ?? ""))
  );
  return fb.length > 0 ? fb : "匿名玩家";
}

/** 有 OpenDota `pro_name` 或命中种子职业名单时视为可公示 ID；否则为路人（展示「匿名」） */
export function isRecognizedProForPrivacy(
  accountId: unknown,
  proName: string | null | undefined
): boolean {
  const cleaned = stripReplayRowFactionOutcomeNoise(
    sanitizePlayerDisplayText(String(proName ?? ""))
  );
  if (cleaned.length > 0) return true;
  const aid = Number(accountId);
  if (!Number.isFinite(aid) || aid <= 0) return false;
  return Boolean(seededProNameForAccount(aid));
}

/** 非职业选手不透出 Steam 昵称，统一「匿名」；职业名优先于种子名单。 */
export function privacyMaskedPlayerDisplayName(
  accountId: unknown,
  proName: string | null | undefined
): string {
  if (!isRecognizedProForPrivacy(accountId, proName)) return "匿名";
  const seeded = String(seededProNameForAccount(Number(accountId)) ?? "").trim();
  const rawPro = String(proName ?? "").trim();
  const label = rawPro || seeded;
  const pretty = stripReplayRowFactionOutcomeNoise(
    sanitizePlayerDisplayText(label)
  );
  return pretty.length > 0 ? pretty : "匿名";
}

/** 主页/英雄页索引行：与详情页一致的隐私展示 */
export function replayIndexPlayerDisplayLabel(
  accountId: number,
  proNameFromIndex: string | null | undefined
): string {
  return privacyMaskedPlayerDisplayName(accountId, proNameFromIndex);
}

/** 索引行是否可链到 `/player/:id`：仅限已识别职业选手 */
export function replayIndexCanLinkProPlayer(
  accountId: number,
  proNameFromIndex: string | null | undefined
): boolean {
  const aid = Number(accountId);
  if (!Number.isFinite(aid) || aid <= 0) return false;
  return isRecognizedProForPrivacy(aid, proNameFromIndex);
}

/** 索引侧「有效职业名字符串」（无 display 清洗），用于与 slim 适配器 `proName` 粗匹配 */
export function replayIndexEffectiveProRaw(
  accountId: number,
  proNameFromIndex: string | null | undefined
): string {
  const t = String(proNameFromIndex ?? "").trim();
  if (t.length > 0) return t;
  return String(seededProNameForAccount(accountId) ?? "").trim();
}
