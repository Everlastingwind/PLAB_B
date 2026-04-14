import { cn } from "../lib/cn";
import type { FeedSelection } from "../lib/replaysApi";

export type { FeedSelection };

export function FeedModeToggle({
  selection,
  onChange,
}: {
  selection: FeedSelection;
  onChange: (s: FeedSelection) => void;
}) {
  const togglePub = () => {
    const next = { ...selection, pub: !selection.pub };
    if (!next.pub && !next.pro) next.pub = true;
    onChange(next);
  };
  const togglePro = () => {
    const next = { ...selection, pro: !selection.pro };
    if (!next.pub && !next.pro) next.pro = true;
    onChange(next);
  };

  return (
    <div
      className="flex shrink-0 rounded-lg border border-skin-line bg-skin-inset p-0.5 text-xs font-bold shadow-inner dark:border-slate-600 dark:bg-slate-800/80"
      role="group"
      aria-label="录像来源（可同时选择 PUB 与 PRO）"
    >
      <button
        type="button"
        aria-pressed={selection.pub}
        className={cn(
          "rounded px-2.5 py-1.5 transition",
          selection.pub
            ? "bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-500/25 dark:text-amber-300"
            : "text-skin-sub hover:text-skin-ink dark:text-slate-500 dark:hover:text-slate-200"
        )}
        onClick={togglePub}
      >
        PUB
      </button>
      <button
        type="button"
        aria-pressed={selection.pro}
        className={cn(
          "rounded px-2.5 py-1.5 transition",
          selection.pro
            ? "bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-500/25 dark:text-amber-300"
            : "text-skin-sub hover:text-skin-ink dark:text-slate-500 dark:hover:text-slate-200"
        )}
        onClick={togglePro}
      >
        PRO
      </button>
    </div>
  );
}
