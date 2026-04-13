import { cn } from "../lib/cn";

export type FeedMode = "pub" | "pro";

export function FeedModeToggle({
  mode,
  onChange,
}: {
  mode: FeedMode;
  onChange: (m: FeedMode) => void;
}) {
  return (
    <div
      className="flex shrink-0 rounded-lg border border-skin-line bg-skin-inset p-0.5 text-xs font-bold shadow-inner dark:border-slate-600 dark:bg-slate-800/80"
      role="group"
      aria-label="录像来源"
    >
      <button
        type="button"
        className={cn(
          "rounded px-2.5 py-1.5 transition",
          mode === "pub"
            ? "bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-500/25 dark:text-amber-300"
            : "text-skin-sub hover:text-skin-ink dark:text-slate-500 dark:hover:text-slate-200"
        )}
        onClick={() => onChange("pub")}
      >
        PUB
      </button>
      <button
        type="button"
        className={cn(
          "rounded px-2.5 py-1.5 transition",
          mode === "pro"
            ? "bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-500/25 dark:text-amber-300"
            : "text-skin-sub hover:text-skin-ink dark:text-slate-500 dark:hover:text-slate-200"
        )}
        onClick={() => onChange("pro")}
      >
        PRO
      </button>
    </div>
  );
}
