import { cn } from "../lib/cn";
import type { NavTabId, NavTabItem } from "../data/mockMatch";

interface MatchNavTabsProps {
  tabs: NavTabItem[];
  activeId: NavTabId;
  onChange?: (id: NavTabId) => void;
}

export function MatchNavTabs({ tabs, activeId, onChange }: MatchNavTabsProps) {
  return (
    <nav
      className="border-b border-skin-line bg-skin-header/95 backdrop-blur-sm dark:border-slate-800/90 dark:bg-surface-deep/95"
      aria-label="比赛数据分类"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10">
        <div className="tabs-scroll flex gap-1 overflow-x-auto pb-px pt-1 sm:gap-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChange?.(tab.id)}
                className={cn(
                  "group relative flex min-w-[4.5rem] shrink-0 flex-col items-center gap-1 px-2 py-2.5 transition sm:min-w-[5rem] sm:px-3",
                  active
                    ? "text-accent-cyan"
                    : "text-skin-sub hover:text-skin-ink dark:text-zinc-500 dark:hover:text-zinc-300"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]",
                    active
                      ? "text-accent-cyan"
                      : "text-neutral-500 group-hover:text-neutral-700 dark:text-zinc-600 dark:group-hover:text-zinc-400"
                  )}
                  strokeWidth={active ? 2 : 1.5}
                />
                <span
                  className={cn(
                    "whitespace-nowrap text-[10px] font-medium leading-none sm:text-xs",
                    active && "font-semibold"
                  )}
                >
                  {tab.label}
                </span>
                {/* 激活：青色下划线 */}
                <span
                  className={cn(
                    "absolute bottom-0 left-2 right-2 h-0.5 rounded-full transition sm:left-3 sm:right-3",
                    active ? "bg-accent-cyan shadow-[0_0_12px_rgba(34,211,238,0.45)]" : "bg-transparent"
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
