/**
 * 60-30-10：浅色为灰白底 + 细线；深色为 slate（.dark）。
 * 主文字见 --app-text（浅 #1F2937 / 深 slate-200）。
 */

/** 单行玩家 */
export const MECHA_ROW =
  "border-b border-skin-line bg-skin-muted/90 dark:bg-slate-800 transition-colors hover:bg-neutral-100/95 dark:hover:bg-slate-800/95";

/** 表格外壳 */
export const MECHA_FRAME =
  "overflow-hidden rounded-b-lg border border-skin-line border-t-0 bg-skin-frame dark:bg-slate-900";

/**
 * 微凸起块
 */
export const MECHA_RAISED =
  "rounded-md border border-skin-line bg-white/95 shadow-sm dark:border-slate-700 dark:bg-slate-800/90 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]";

/**
 * 凹槽区
 */
export const MECHA_INSET =
  "rounded-md border border-skin-line bg-skin-inset shadow-[inset_1px_1px_8px_rgba(0,0,0,0.05)] dark:border-slate-700 dark:bg-slate-900/55 dark:shadow-[inset_2px_2px_12px_rgba(0,0,0,0.4)]";

export const clipMechaCorner =
  "[clip-path:polygon(0_0,calc(100%-5px)_0,100%_5px,100%_100%,0_100%)]";

/** 10% 强调：天赋点亮 */
export const ACCENT_TALENT_GLOW =
  "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]";
