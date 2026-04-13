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
 * 职业选手显示注册 ID；否则用游戏内昵称（Steam 名等）；皆无则「匿名玩家」。
 * 详情页请传入 `fallbackName`（如 steamName），避免非职业玩家全部被标成匿名。
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
