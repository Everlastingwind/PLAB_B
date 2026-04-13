import { cn } from "../lib/cn";

interface DamageBarCellProps {
  value: number;
  maxInTeam: number;
  format?: "raw" | "k";
  valueClassName?: string;
}

function fmtVal(n: number, mode: "raw" | "k"): string {
  if (mode === "k") {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }
  return n.toLocaleString("zh-CN");
}

export function DamageBarCell({
  value,
  maxInTeam,
  format = "k",
  valueClassName,
}: DamageBarCellProps) {
  const pct = maxInTeam > 0 ? Math.min(100, (value / maxInTeam) * 100) : 0;

  return (
    <div
      className={cn(
        "relative min-h-[28px] w-full min-w-0 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] transition-colors duration-200 ease-in-out dark:border-slate-600 dark:bg-slate-900/50 dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)] sm:px-2"
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-2 inset-y-1.5 overflow-hidden rounded-[2px]"
        aria-hidden
      >
        <div className="h-full w-full bg-gray-200/90 transition-colors duration-200 ease-in-out dark:bg-slate-800/90" />
        <div
          className="absolute inset-y-0 left-0 bg-amber-500/25"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        className={cn(
          "relative z-[1] text-right font-mono text-[10px] font-bold tabular-nums text-gray-800 transition-colors duration-200 ease-in-out dark:text-slate-200 sm:text-sm",
          valueClassName
        )}
      >
        {fmtVal(value, format)}
      </div>
    </div>
  );
}
