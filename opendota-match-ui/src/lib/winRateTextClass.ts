/** 胜率数字分档着色（相对 50% 优劣），与 Meta 表一致 */
export function winRateTextClass(pct: number): string {
  if (pct >= 54) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (pct >= 50.5) {
    return "text-teal-600 dark:text-teal-400";
  }
  if (pct >= 48) {
    return "text-amber-600 dark:text-amber-400";
  }
  if (pct >= 45) {
    return "text-orange-600 dark:text-orange-400";
  }
  return "text-rose-600 dark:text-rose-400";
}

/** Meta 全英雄表 / 分位置卡片：英雄名与场次同级字号 */
export const metaEmphasisTextSizeClass = "text-base";

/** 场次后括号胜率：略小于场次，便于区分层级 */
export const metaWinRateBracketTextSizeClass = "text-sm";

/** 场次数字：加粗、略大于表体；亮色主题为深灰，暗色主题为亮白 */
export const gamesCountTextClass =
  `${metaEmphasisTextSizeClass} font-bold tabular-nums text-zinc-800 dark:text-white`;

/** 紧随场次后的「（xx%）」：字号略小于场次 + 分档着色 */
export function metaWinRateAfterGamesClass(pct: number): string {
  return `${metaWinRateBracketTextSizeClass} font-semibold tabular-nums ${winRateTextClass(pct)}`;
}
