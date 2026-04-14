import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

interface AppHeaderProps {
  /** 中间区域：主页放英雄搜索 */
  center?: ReactNode;
  /** 右侧：比赛页放编号等 */
  trailing?: ReactNode;
}

export function AppHeader({ center, trailing }: AppHeaderProps) {
  return (
    <header
      className={cn(
        "relative z-50 border-b border-slate-700/80 bg-skin-header/95 text-slate-100 backdrop-blur-md transition-colors",
        "supports-[backdrop-filter]:bg-skin-header/90",
        "shadow-[0_4px_18px_rgba(0,0,0,0.25)] dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 supports-[backdrop-filter]:dark:bg-slate-900/90"
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1400px] gap-2 px-4 py-3 sm:gap-3 sm:px-6 lg:px-8",
          center ? "items-start" : "items-center"
        )}
      >
        <div className={cn("flex shrink-0 items-center gap-3", Boolean(center) && "mt-1")}>
          <Link to="/" aria-label="返回首页">
            <span
              className="flex h-10 items-center gap-0.5 font-sans text-[28px] font-semibold leading-none tracking-[0.04em]"
              style={{ color: "#000000" }}
            >
              <span>PL</span>
              <span
                aria-hidden
                className="inline-block h-7 w-7 bg-[url('/dota-a-mark.png')] bg-contain bg-center bg-no-repeat align-middle"
              />
              <span>NB</span>
            </span>
          </Link>
          <Link
            to="/pros"
            className="whitespace-nowrap text-[11px] font-semibold text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline sm:text-xs dark:text-slate-400 dark:hover:text-slate-200"
          >
            职业选手
          </Link>
        </div>
        <div className="flex min-w-0 flex-1 basis-0 flex-row items-center justify-start sm:justify-center">
          {center}
        </div>
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      </div>
    </header>
  );
}
