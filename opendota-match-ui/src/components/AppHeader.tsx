import { Link } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "../lib/cn";

interface AppHeaderProps {
  /** 中间区域：主页放英雄搜索 */
  center?: ReactNode;
  /** 右侧：比赛页放编号等 */
  trailing?: ReactNode;
  /** 手机端：LOGO 下方的「支持一下」触发器（由 PageShell 在 centerSearch 时传入） */
  supportMobileSlot?: ReactNode;
}

const THEME_STORAGE_KEY = "plab-theme";

function readInitialDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark") return true;
  if (saved === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function AppHeader({ center, trailing, supportMobileSlot }: AppHeaderProps) {
  const [isDark, setIsDark] = useState<boolean>(() => readInitialDarkMode());

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    window.localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
  }, [isDark]);

  return (
    <header
      className={cn(
        "relative z-50 border-b border-slate-700/80 bg-skin-header/95 text-slate-100 backdrop-blur-md transition-colors",
        "supports-[backdrop-filter]:bg-skin-header/90",
        "shadow-[0_4px_18px_rgba(0,0,0,0.25)] dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200 supports-[backdrop-filter]:dark:bg-zinc-900/90"
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1400px] gap-2 px-4 py-3 sm:gap-3 sm:px-6 lg:px-8",
          center ? "items-start" : "items-center"
        )}
      >
        <div
          className={cn(
            "flex shrink-0",
            supportMobileSlot
              ? "flex-col items-start gap-1.5"
              : "items-center",
            Boolean(center) && "mt-1"
          )}
        >
          <Link to="/" aria-label="返回首页">
            <span
              className="flex h-10 items-center gap-0.5 font-sans text-[28px] font-semibold leading-none tracking-[0.04em]"
              style={{ color: isDark ? "#ffffff" : "#000000" }}
            >
              <span>PL</span>
              <span
                aria-hidden
                className="inline-block h-7 w-7 bg-[url('/dota-a-mark.png')] bg-contain bg-center bg-no-repeat align-middle"
              />
              <span>NB</span>
            </span>
          </Link>
          {supportMobileSlot}
        </div>
        <div className="flex min-w-0 flex-1 basis-0 flex-row items-center justify-start sm:justify-center">
          {center}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {trailing}
          <button
            type="button"
            onClick={() => setIsDark((v) => !v)}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-full border",
              "border-skin-line bg-skin-card/90 text-skin-ink shadow-sm transition-colors hover:bg-skin-raised"
            )}
            aria-label={isDark ? "切换为亮色模式" : "切换为关灯模式"}
            title={isDark ? "亮色模式" : "关灯模式"}
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </header>
  );
}
