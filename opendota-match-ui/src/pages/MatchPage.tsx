import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { Copy } from "lucide-react";
import { MatchVerticalBoard } from "../components/MatchVerticalBoard";
import { useMatchData } from "../hooks/useMatchData";
import { isNaviOpenDotaLiveRoute } from "../lib/fetchNaviLatestOpenDotaMatch";
import { PageShell } from "../components/PageShell";
import { cn } from "../lib/cn";

export function MatchPage() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const { loading, error, header, radiant, dire, fromLiveJson } =
    useMatchData(matchId);

  const handleCopyId = useCallback(() => {
    void navigator.clipboard.writeText(header.matchId);
  }, [header.matchId]);

  const trailing = !loading ? (
    <div className="flex items-center gap-2 sm:gap-2.5">
      <span className="hidden text-xs font-medium text-gray-700 dark:text-slate-300 sm:inline">
        比赛编号
      </span>
      <div className="flex items-center gap-2">
        <span className="font-sans text-sm font-semibold tabular-nums tracking-normal text-gray-800 dark:text-slate-200 sm:text-base">
          {header.matchId}
        </span>
        <button
          type="button"
          onClick={handleCopyId}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
          title="复制比赛编号"
          aria-label="复制比赛编号"
        >
          <Copy className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  ) : (
    <span className="text-xs text-gray-600 dark:text-slate-400">加载中…</span>
  );

  return (
    <PageShell centerSearch trailing={trailing}>
      {loading && (
        <div
          className={cn(
            "border-b border-skin-line py-2 text-center text-xs text-skin-sub",
            "bg-skin-muted/80 dark:bg-slate-800/80"
          )}
        >
          {isNaviOpenDotaLiveRoute(matchId)
            ? "正在从 OpenDota 加载 Na'Vi 最近一场…"
            : `正在加载比赛 ${matchId} …`}
        </div>
      )}
      {error && !loading && (
        <div
          className={cn(
            "border-b border-skin-line py-2 text-center text-xs text-amber-600 dark:text-amber-500/90",
            "bg-skin-inset dark:bg-slate-800"
          )}
        >
          数据加载失败（{error}）
          {fromLiveJson ? null : "，已使用本地 mock。"}
        </div>
      )}

      <main className="min-w-0 overflow-x-hidden px-3 py-2 sm:px-4 lg:px-6">
        <div className="mx-auto w-full max-w-[1600px] flex flex-col">
          {loading ? (
            <div
              className={cn(
                "flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-skin-line bg-skin-card/40 px-4 py-12 text-sm text-skin-sub",
                "dark:bg-slate-900/30"
              )}
              aria-busy
            >
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-skin-line border-t-amber-500/80" />
              <p>正在加载本场对局数据…</p>
            </div>
          ) : (
            <MatchVerticalBoard
              radiant={radiant}
              dire={dire}
              matchMeta={header}
            />
          )}
        </div>
      </main>
    </PageShell>
  );
}
