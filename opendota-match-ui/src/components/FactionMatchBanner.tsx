import { cn } from "../lib/cn";

/** 满宽阵营分隔条：胜负由 `won` 绑定；战队名单独一行 */
export function FactionMatchBanner({
  side,
  won,
  teamName,
}: {
  side: "radiant" | "dire";
  won: boolean;
  teamName: string;
}) {
  const rad = side === "radiant";
  return (
    <div
      className={cn(
        "w-full px-3 py-2",
        rad
          ? "bg-emerald-200/50 dark:bg-emerald-950/45"
          : "bg-rose-200/45 dark:bg-rose-950/40"
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            "text-sm font-bold tracking-wide",
            rad
              ? "text-emerald-950 dark:text-emerald-100"
              : "text-rose-950 dark:text-rose-100"
          )}
        >
          {rad ? "天辉" : "夜魇"}{" "}
          <span className="font-semibold opacity-85">
            ({rad ? "Radiant" : "Dire"})
          </span>
        </span>
        <span className="select-none text-slate-500 dark:text-slate-500">
          ——
        </span>
        {won ? (
          <span
            className={cn(
              "text-sm font-bold",
              "text-emerald-700 dark:text-emerald-400",
              "drop-shadow-[0_0_10px_rgba(52,211,153,0.2)]"
            )}
          >
            胜利{" "}
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              (VICTORY)
            </span>
          </span>
        ) : (
          <span className="text-sm font-bold text-slate-600 dark:text-slate-400">
            失败{" "}
            <span className="font-semibold text-rose-800 dark:text-rose-400">
              (DEFEAT)
            </span>
          </span>
        )}
      </div>
      {teamName.trim() ? (
        <div
          className={cn(
            "mt-1 truncate text-xs font-bold tracking-wide",
            rad
              ? "text-emerald-900/90 dark:text-emerald-200/90"
              : "text-rose-900/90 dark:text-rose-200/90"
          )}
          title={teamName}
        >
          {teamName}
        </div>
      ) : null}
    </div>
  );
}
