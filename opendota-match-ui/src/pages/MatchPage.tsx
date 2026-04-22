import { lazy, Suspense, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Copy } from "lucide-react";
import { useMatchData } from "../hooks/useMatchData";
import { isNaviOpenDotaLiveRoute } from "../lib/fetchNaviLatestOpenDotaMatch";
import { PageShell } from "../components/PageShell";
import { cn } from "../lib/cn";
import { SEO } from "../components/SEO";

const MatchVerticalBoard = lazy(() =>
  import("../components/MatchVerticalBoard").then((m) => ({
    default: m.MatchVerticalBoard,
  }))
);

export function MatchPage() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const { loading, error, header, radiant, dire } = useMatchData(matchId);

  const handleCopyId = useCallback(() => {
    void navigator.clipboard.writeText(header.matchId);
  }, [header.matchId]);

  const { seoTitle, seoDescription, seoKeywords } = useMemo(() => {
    const id = (matchId || header.matchId || "").trim() || "详情";
    const baseDesc = () =>
      `查看比赛 #${id} 的阵容对位、经济曲线与关键团战，快速定位高分局胜负手。`;
    if (loading) {
      return {
        seoTitle: `比赛 #${id} 数据解析 - PlanB`,
        seoDescription: baseDesc(),
        seoKeywords: `DOTA2比赛详情,${id},高分局复盘`,
      };
    }
    if (error) {
      return {
        seoTitle: `比赛 #${id} 数据暂不可用 - PlanB`,
        seoDescription: `无法加载比赛 #${id} 的数据，请稍后再试。`,
        seoKeywords: `DOTA2比赛详情,${id},高分局复盘`,
      };
    }
    const league = (header.leagueName || "DOTA2 对局").trim();
    const leagueShort = league.length > 48 ? `${league.slice(0, 47)}…` : league;
    return {
      seoTitle: `${leagueShort} #${header.matchId} | ${header.scoreRadiant} : ${header.scoreDire} 比赛复盘 - PlanB`,
      seoDescription: `联赛/赛事：${header.leagueName}，比分 Radiant ${header.scoreRadiant} - ${header.scoreDire} Dire，赛时 ${header.duration}。${baseDesc()}`,
      seoKeywords: `DOTA2比赛详情,${header.matchId},高分局复盘,${header.leagueName || ""}`,
    };
  }, [loading, error, matchId, header]);

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
    <>
      <SEO
        fullTitle
        title={seoTitle}
        description={seoDescription}
        keywords={seoKeywords}
      />
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
            ) : error ? (
              <div
                className={cn(
                  "flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-skin-line bg-skin-card/40 px-4 py-10 text-sm text-skin-sub",
                  "dark:bg-slate-900/30"
                )}
              >
                <p className="text-center font-medium text-skin-ink">无法加载本场数据</p>
                <p className="max-w-md text-center text-xs leading-relaxed text-skin-sub">
                  {error}
                </p>
              </div>
            ) : (
              <Suspense
                fallback={
                  <div
                    className={cn(
                      "flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-skin-line bg-skin-card/40 px-4 py-10",
                      "dark:bg-slate-900/30"
                    )}
                    aria-busy
                  >
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-skin-line border-t-amber-500/80" />
                    <p className="text-xs text-skin-sub">加载对阵板…</p>
                  </div>
                }
              >
                <MatchVerticalBoard
                  radiant={radiant}
                  dire={dire}
                  matchMeta={header}
                />
              </Suspense>
            )}
          </div>
        </main>
      </PageShell>
    </>
  );
}
