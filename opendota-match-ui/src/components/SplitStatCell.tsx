import type { ReactNode } from "react";
import { cn } from "../lib/cn";

interface SplitStatCellProps {
  parts: ReactNode[];
  className?: string;
  separator?: "bar" | "slash";
}

export function SplitStatCell({
  parts,
  className,
  separator = "bar",
}: SplitStatCellProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-0 font-mono text-[10px] font-bold tabular-nums tracking-tight text-gray-800 transition-colors duration-200 ease-in-out dark:text-slate-200 sm:text-sm",
        className
      )}
    >
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-0">
          {i > 0 &&
            (separator === "slash" ? (
              <span
                className="mx-1 text-gray-400 transition-colors duration-200 ease-in-out dark:text-slate-600"
                aria-hidden
              >
                /
              </span>
            ) : (
              <span
                className="mx-1.5 h-3 w-px shrink-0 bg-gray-300 transition-colors duration-200 ease-in-out dark:bg-slate-600"
                aria-hidden
              />
            ))}
          {p}
        </span>
      ))}
    </div>
  );
}
