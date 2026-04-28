import { Link } from "react-router-dom";
import type { MouseEvent, ReactNode } from "react";
import { cn } from "../lib/cn";

interface AppHeaderProps {
  /** 中间区域：主页放英雄搜索 */
  center?: ReactNode;
  /** 右侧：比赛页放编号等 */
  trailing?: ReactNode;
}

export function AppHeader({ center, trailing }: AppHeaderProps) {
  const goHomeHard = (e: MouseEvent<HTMLAnchorElement>) => {
    // 某些路由状态下 Link 可能被中间态拦截，强制回首页兜底。
    e.preventDefault();
    window.location.assign("/");
  };

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
        <div className={cn("flex shrink-0 items-center", Boolean(center) && "mt-1")}>
          <Link to="/" aria-label="返回首页" onClick={goHomeHard}>
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
        </div>
        <div className="flex min-w-0 flex-1 basis-0 flex-row items-center justify-start sm:justify-center">
          {center}
        </div>
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      </div>
    </header>
  );
}
