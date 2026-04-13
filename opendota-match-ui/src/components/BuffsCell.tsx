import { cn } from "../lib/cn";
import type { PlayerBuffsMock } from "../data/mockMatchPlayers";

/** A 杖 / 魔晶 / 银月 占位图标（CSS 示意，可换真实图） */
export function BuffsCell({ buffs }: { buffs: PlayerBuffsMock }) {
  const hasScepter =
    buffs.aghanims === "scepter" || buffs.aghanims === "both";
  const hasShard =
    buffs.aghanims === "shard" || buffs.aghanims === "both";

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 px-1">
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded border text-[10px] font-bold",
          hasScepter
            ? "border-amber-500/60 bg-amber-950/50 text-amber-200"
            : "border-skin-line/80 bg-skin-inset text-zinc-600 dark:border-slate-700/50 dark:bg-slate-900/50"
        )}
        title="阿哈利姆神杖"
      >
        A
      </div>
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded border text-[10px] font-bold",
          hasShard
            ? "border-emerald-500/60 bg-emerald-950/50 text-emerald-200"
            : "border-skin-line/80 bg-skin-inset text-zinc-600 dark:border-slate-700/50 dark:bg-slate-900/50"
        )}
        title="阿哈利姆魔晶"
      >
        魔
      </div>
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded border text-[10px]",
          buffs.moonShard
            ? "border-violet-500/60 bg-violet-950/50 text-violet-200"
            : "border-skin-line/80 bg-skin-inset text-zinc-600 dark:border-slate-700/50 dark:bg-slate-900/50"
        )}
        title="银月之晶"
      >
        🌙
      </div>
    </div>
  );
}
