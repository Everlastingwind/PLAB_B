import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { ReplayCard } from "../components/ReplayCard";
import { ViewportMountRow } from "../components/ViewportMountRow";
import type { FeedSelection } from "../components/FeedModeToggle";
import {
  MATCH_LIST_LOAD_STEP,
  cloudPackToIndexError,
  fetchCloudPubReplaySummariesForAnalyticsMerge,
  fetchCloudPubReplaySummariesPage,
  fetchStaticFeedOnly,
  mergeReplaySummariesByMatchId,
  normalizeReplaySource,
  replayMatchesLatestPatch,
} from "../lib/replaysApi";
import { applyProDisplayOverridesToReplaySummaries } from "../lib/proAccountDisplayOverrides";
import { fetchDeployedDataJson } from "../lib/fetchStaticJson";
import {
  buildCloudAggFromReplays,
  buildTopHeroByRole,
  buildTopHeroOverall,
  pickMetaCloudAgg,
  pickMetaHeroOverall,
  pickMetaTopHeroByRole,
  type MetaSiteSnapshotCloudAgg,
  type MetaSiteSnapshotPayload,
} from "../lib/metaSiteAggregate";
import { fetchPlanBAggregateMatchStats, fetchPlanBSlimPayloadBatch } from "../lib/supabasePlanB";
import { topKillMatchIdsForSlim } from "../lib/topKillMatchIds";
import type { ReplaySummary } from "../types/replaysIndex";
import type { SlimMatchJson } from "../types/slimMatch";
import { useEntityMaps } from "../hooks/useEntityMaps";
import { SEOMeta } from "../components/SEOMeta";
import { MetaGlobalItemStatsSection } from "../components/MetaGlobalItemStatsSection";
import { MetaTopKillGamesSection } from "../components/MetaTopKillGamesSection";
import {
  HeroWinrateMetaTable,
  isHeroMetaGlobalGamesSort,
  isHeroMetaGlobalWinRateSort,
  isHeroMetaRoleColumnSort,
  type HeroWinrateMetaSortMode,
} from "../components/HeroWinrateMetaTable";
import { heroIconUrl, onDotaSteamAssetImgError, steamCdnImgDefer } from "../data/mockMatchPlayers";
import {
  homeAnchorStorageKey,
  homeScrollStorageKey,
  readDocumentScrollY,
  scrollDocumentToY,
} from "../lib/documentScroll";
import {
  gamesCountTextClass,
  metaEmphasisTextSizeClass,
  metaWinRateAfterGamesClass,
} from "../lib/winRateTextClass";
import { useSitePatch } from "../contexts/SitePatchContext";
import {
  patchNavDisplayLabel,
  patchNotesRoutePath,
} from "../lib/dota2UpdatesApi";
import { heroTrendBaselineTooltipTitle } from "../lib/heroTrendSeries";

/** Items 出装聚合：合并索引全站来源，但单场须拉 slim，此处为单场数量上限 */
const ITEMS_TAB_SLIM_SAMPLE_CAP = 200;

export function HomePage() {
  const { patch } = useSitePatch();
  if (!patch) return null;

  const { maps, loading: mapsLoading, error: mapsErr } = useEntityMaps();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  /** 只用字符串参与 effect 依赖，避免 `URLSearchParams` 引用变化触发无限重新请求 */
  const pageQueryParam = searchParams.get("page") ?? "1";
  const [feed, setFeed] = useState<FeedSelection>({ pub: true, pro: false });
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [feedListLoading, setFeedListLoading] = useState(true);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  /** 服务端分页时 Supabase 返回的总行数（仅 Matches + 仅 PUB） */
  const [pagedTotalRows, setPagedTotalRows] = useState<number | null>(null);
  /**
   * Meta / TOP：遍历「全站」合并索引（静态 pub/pro JSON + 云库 plan_b 多页合并后按 match 去重）。
   * 与 Matches 列表分页那条无关。出装(Items)需 slim，样本上限见模块常量 ITEMS_TAB_SLIM_SAMPLE_CAP。
   */
  const [analyticsReplays, setAnalyticsReplays] = useState<
    ReplaySummary[]
  >([]);
  const [roleTab, setRoleTab] = useState<"carry" | "mid" | "offlane" | "support(4)" | "support(5)">("carry");
  const [homeView, setHomeView] = useState<"matches" | "meta" | "items" | "top">(
    "matches"
  );
  const [cloudAggApi, setCloudAggApi] = useState<MetaSiteSnapshotCloudAgg | null>(
    null
  );
  const [cloudAggApiErr, setCloudAggApiErr] = useState<string | null>(null);
  const [snapshotFetchDone, setSnapshotFetchDone] = useState(false);
  const [metaSnapshot, setMetaSnapshot] = useState<MetaSiteSnapshotPayload | null>(
    null
  );
  const useMetaSnapshot = Boolean(
    feed.pub && metaSnapshot && metaSnapshot.version >= 1
  );
  /** Meta + Items + TOP 均读 `meta_site_snapshot.json`（version 2） */
  const useFullSnapshot = Boolean(
    feed.pub &&
      metaSnapshot &&
      metaSnapshot.version >= 2 &&
      metaSnapshot.itemsMeta &&
      metaSnapshot.topSection
  );
  /** Items 依赖每日快照 v2；TOP 由 analyticsReplays 实时重算 */
  const homeMetaSlimByMatch: Record<number, SlimMatchJson | undefined> = {};
  const homeMetaSlimLoading = false;
  const [topTabSlimByMatch, setTopTabSlimByMatch] = useState<
    Record<number, SlimMatchJson | null | undefined>
  >({});
  const [topTabSlimLoading, setTopTabSlimLoading] = useState(false);
  /** 全英雄表排序：总胜率/总场次（可升降序）或按分路 */
  const [heroMetaSort, setHeroMetaSort] = useState<HeroWinrateMetaSortMode>({
    type: "winRate",
    order: "desc",
  });
  const scrollKey = homeScrollStorageKey(location.pathname, location.search);
  const anchorKey = homeAnchorStorageKey(location.pathname, location.search);
  const mainRef = useRef<HTMLElement | null>(null);

  const handleFeedModeChange = useCallback((nextFeed: FeedSelection) => {
    setFeed(nextFeed);
    const next = new URLSearchParams(searchParams);
    next.delete("page");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await fetchDeployedDataJson<unknown>(
          "/data/meta_site_snapshot.json"
        );
        if (cancelled || !raw || typeof raw !== "object") return;
        const d = raw as MetaSiteSnapshotPayload;
        if (d.version !== 1 && d.version !== 2) return;
        if (
          !d.cloudAgg ||
          !d.topHeroByRole ||
          !d.heroOverall ||
          typeof d.cloudAgg.decidedMatches !== "number"
        )
          return;
        if (d.version === 2 && (!d.itemsMeta || !d.topSection)) return;
        setMetaSnapshot(d);
      } catch {
        /* 可选静态文件 */
      } finally {
        if (!cancelled) setSnapshotFetchDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!snapshotFetchDone) return;
      const [snap, cloudAggMerge] = await Promise.all([
        fetchStaticFeedOnly(feed),
        feed.pub
          ? fetchCloudPubReplaySummariesForAnalyticsMerge()
          : Promise.resolve({ replays: [], error: null }),
      ]);
      if (cancelled) return;
      const staticFiltered = snap.replays.filter((r) => {
        if (normalizeReplaySource(r, "pub") === "pro") return true;
        return replayMatchesLatestPatch(r, patch.currentPatch);
      });
      setAnalyticsReplays(
        mergeReplaySummariesByMatchId(staticFiltered, cloudAggMerge.replays)
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [feed, snapshotFetchDone, patch.currentPatch]);

  useEffect(() => {
    if (!feed.pub || !patch.currentPatch) {
      setCloudAggApi(null);
      setCloudAggApiErr(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const pack = await fetchPlanBAggregateMatchStats();
      if (cancelled) return;
      if (pack.error) {
        setCloudAggApiErr(pack.error);
        setCloudAggApi(null);
        return;
      }
      setCloudAggApiErr(null);
      setCloudAggApi({
        decidedMatches: pack.decidedMatches,
        radiantWins: pack.radiantWins,
        direWins: pack.direWins,
        durationSamples: pack.durationSamples,
        avgDurationSec: pack.avgDurationSec,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [feed.pub, patch.currentPatch]);

  const cloudAggFromReplays = useMemo(
    () => buildCloudAggFromReplays(analyticsReplays, patch.currentPatch),
    [analyticsReplays, patch.currentPatch]
  );

  const { agg: cloudAgg, error: cloudAggErr } = useMemo(
    () =>
      feed.pub
        ? pickMetaCloudAgg(cloudAggApi, cloudAggApiErr, cloudAggFromReplays)
        : { agg: null, error: null as string | null },
    [feed.pub, cloudAggApi, cloudAggApiErr, cloudAggFromReplays]
  );

  useEffect(() => {
    let cancelled = false;
    setIdxErr(null);
    setFeedListLoading(true);
    const pubOnlyMatches =
      homeView === "matches" && feed.pub && !feed.pro;

    void (async () => {
      try {
        if (pubOnlyMatches) {
          const pageRaw = Number(pageQueryParam || 1);
          const currentPage =
            Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
          const pack = await fetchCloudPubReplaySummariesPage(
            currentPage,
            MATCH_LIST_LOAD_STEP
          );
          if (cancelled) return;
          setIdxErr(cloudPackToIndexError(pack));
          setPagedTotalRows(pack.totalRows);
          const list = await applyProDisplayOverridesToReplaySummaries(
            pack.replays
          );
          setReplays(list);
          setFeedListLoading(false);
          return;
        }

        const snap = await fetchStaticFeedOnly(feed);
        const list = await applyProDisplayOverridesToReplaySummaries(
          snap.replays.filter((r) => {
            if (normalizeReplaySource(r, "pub") === "pro") return true;
            return replayMatchesLatestPatch(r, patch.currentPatch);
          })
        );
        if (cancelled) return;

        setPagedTotalRows(null);
        setReplays(list);
        setFeedListLoading(false);
      } catch (e) {
        if (!cancelled) {
          setFeedListLoading(false);
          setIdxErr(e instanceof Error ? e.message : "索引加载失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feed, homeView, pageQueryParam, patch.currentPatch]);

  const totalPages = useMemo(() => {
    if (
      homeView === "matches" &&
      feed.pub &&
      !feed.pro &&
      pagedTotalRows != null
    ) {
      return Math.max(
        1,
        Math.ceil(pagedTotalRows / MATCH_LIST_LOAD_STEP)
      );
    }
    return Math.max(1, Math.ceil(replays.length / MATCH_LIST_LOAD_STEP));
  }, [
    homeView,
    feed.pub,
    feed.pro,
    pagedTotalRows,
    replays.length,
  ]);
  const pageFromQuery = (() => {
    const n = Number(searchParams.get("page") || 1);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  })();
  const page = Math.max(pageFromQuery, 1);
  const pageForSlice = Math.min(page, totalPages);
  const visible = useMemo(() => {
    if (homeView === "matches" && feed.pub && !feed.pro) {
      return replays;
    }
    const start = (pageForSlice - 1) * MATCH_LIST_LOAD_STEP;
    const end = start + MATCH_LIST_LOAD_STEP;
    return replays.slice(start, end);
  }, [homeView, feed.pub, feed.pro, replays, pageForSlice]);

  const shouldRestoreScroll = useMemo(() => {
    const anchorRaw = sessionStorage.getItem(anchorKey)?.trim();
    if (anchorRaw) return true;
    const raw = sessionStorage.getItem(scrollKey);
    if (raw == null) return false;
    const y = Number(raw);
    return Number.isFinite(y) && y > 0;
  }, [anchorKey, scrollKey]);

  const restoreHomeListScroll = useCallback(() => {
    if (mapsLoading || !maps) return;

    const anchorRaw = sessionStorage.getItem(anchorKey)?.trim();
    if (anchorRaw) {
      const inPage = visible.some((r) => String(r.match_id) === anchorRaw);
      if (!inPage) {
        sessionStorage.removeItem(anchorKey);
      } else {
        try {
          const el = document.querySelector(
            `[data-home-match-id="${CSS.escape(anchorRaw)}"]`
          );
          if (el instanceof HTMLElement) {
            el.scrollIntoView({ block: "nearest", behavior: "auto" });
            return;
          }
        } catch {
          sessionStorage.removeItem(anchorKey);
        }
      }
    }

    const raw = sessionStorage.getItem(scrollKey);
    if (raw == null) return;
    const y = Number(raw);
    if (!Number.isFinite(y) || y < 0) return;
    // 最大化/宽屏下常存成 0；有锚点时不要再用 0 把视图打回顶部
    if (y === 0) return;
    scrollDocumentToY(y);
  }, [anchorKey, maps, mapsLoading, scrollKey, visible]);

  useLayoutEffect(() => {
    if (mapsLoading || !maps || !shouldRestoreScroll) return;

    restoreHomeListScroll();
    const timers: number[] = [80, 220, 450, 900, 1400].map((delayMs) =>
      window.setTimeout(restoreHomeListScroll, delayMs)
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [
    scrollKey,
    visible.length,
    mapsLoading,
    maps,
    restoreHomeListScroll,
    shouldRestoreScroll,
  ]);

  /** Edge 等：最大化后布局/视口变化会把滚动打回顶部，内容高度变化时再跑一次 */
  useEffect(() => {
    if (mapsLoading || !maps || !shouldRestoreScroll) return;
    const el = mainRef.current;
    if (!el) return;

    let debounceTimer: number | null = null;
    let stopAfter: number | null = null;
    let active = true;

    const schedule = () => {
      if (!active) return;
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        if (active) restoreHomeListScroll();
      }, 120);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule);

    stopAfter = window.setTimeout(() => {
      active = false;
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    }, 5000);

    return () => {
      active = false;
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      if (stopAfter != null) window.clearTimeout(stopAfter);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [
    mapsLoading,
    maps,
    restoreHomeListScroll,
    visible.length,
    shouldRestoreScroll,
  ]);

  useEffect(() => {
    let ticking = false;
    let timer: number | null = null;
    let lastWrite = 0;
    const persist = () => {
      lastWrite = Date.now();
      sessionStorage.setItem(scrollKey, String(readDocumentScrollY()));
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      const now = Date.now();
      const due = now - lastWrite >= 180;
      if (due) {
        ticking = true;
        window.requestAnimationFrame(persist);
        return;
      }
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(persist);
      }, 180);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
    };
  }, [scrollKey]);

  const feedKey = `${feed.pub ? "p" : ""}${feed.pro ? "r" : ""}`;

  /** Items / TOP：仅当前补丁录像 */
  const analyticsReplaysLatestOnly = useMemo(
    () =>
      analyticsReplays.filter((r) =>
        replayMatchesLatestPatch(r, patch.currentPatch)
      ),
    [analyticsReplays, patch.currentPatch]
  );

  /** TOP 单人击杀卡：仅为 Top5 拉 slim 出装，不依赖过期快照 */
  useEffect(() => {
    if (homeView !== "top" || !feed.pub) {
      setTopTabSlimByMatch({});
      setTopTabSlimLoading(false);
      return;
    }
    const ids = topKillMatchIdsForSlim(analyticsReplaysLatestOnly, 5);
    if (!ids.length) {
      setTopTabSlimByMatch({});
      setTopTabSlimLoading(false);
      return;
    }
    let cancelled = false;
    setTopTabSlimLoading(true);
    void fetchPlanBSlimPayloadBatch(ids)
      .then((map) => {
        if (cancelled) return;
        const next: Record<number, SlimMatchJson | null> = {};
        for (const id of ids) {
          const raw = map.get(id);
          next[id] =
            raw && typeof raw === "object" && !Array.isArray(raw)
              ? (raw as SlimMatchJson)
              : null;
        }
        setTopTabSlimByMatch(next);
      })
      .catch(() => {
        if (!cancelled) setTopTabSlimByMatch({});
      })
      .finally(() => {
        if (!cancelled) setTopTabSlimLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [homeView, feed.pub, analyticsReplaysLatestOnly]);

  const replaysSampleForItemMeta = useMemo(
    () =>
      analyticsReplaysLatestOnly.slice(0, ITEMS_TAB_SLIM_SAMPLE_CAP),
    [analyticsReplaysLatestOnly]
  );

  const topHeroByRoleLive = useMemo(
    () =>
      buildTopHeroByRole(
        analyticsReplays,
        roleTab,
        50,
        patch.currentPatch
      ),
    [analyticsReplays, roleTab, patch.currentPatch]
  );

  const topHeroOverallLive = useMemo(
    () =>
      buildTopHeroOverall(
        analyticsReplays,
        100,
        patch.currentPatch,
        patch.previousPatch
      ),
    [analyticsReplays, patch.currentPatch, patch.previousPatch]
  );

  const topHeroByRole = useMemo(() => {
    if (!maps) return [];
    return pickMetaTopHeroByRole(
      topHeroByRoleLive,
      useMetaSnapshot && metaSnapshot
        ? metaSnapshot.topHeroByRole[roleTab]
        : undefined
    );
  }, [
    maps,
    useMetaSnapshot,
    metaSnapshot,
    roleTab,
    topHeroByRoleLive,
  ]);

  const topHeroOverall = useMemo(() => {
    if (!maps) return [];
    return pickMetaHeroOverall(
      topHeroOverallLive,
      useMetaSnapshot && metaSnapshot ? metaSnapshot.heroOverall : undefined
    );
  }, [maps, useMetaSnapshot, metaSnapshot, topHeroOverallLive]);

  const heroMetaTableRows = useMemo(() => {
    if (!maps) return [];
    const list = topHeroOverall.map((row) => {
      const hero = maps.heroes[String(row.heroId)];
      const heroKey = hero?.key || "invoker";
      return {
        heroId: row.heroId,
        heroKey,
        name: hero?.nameCn || hero?.nameEn || heroKey,
        winRate: row.winRate,
        games: row.games,
        cumulativeWinRateSeries: row.cumulativeWinRateSeries,
        cumulativeSeriesIsBaseline: row.cumulativeSeriesIsBaseline,
        roleWinRate: row.roleWinRate,
      };
    });
    const copy = [...list];
    copy.sort((a, b) => {
      if (isHeroMetaGlobalGamesSort(heroMetaSort)) {
        const gCmp =
          heroMetaSort.order === "desc"
            ? b.games - a.games
            : a.games - b.games;
        if (gCmp !== 0) return gCmp;
        return b.winRate - a.winRate;
      }
      if (isHeroMetaGlobalWinRateSort(heroMetaSort)) {
        const wCmp =
          heroMetaSort.order === "desc"
            ? b.winRate - a.winRate
            : a.winRate - b.winRate;
        if (wCmp !== 0) return wCmp;
        return b.games - a.games;
      }
      if (isHeroMetaRoleColumnSort(heroMetaSort)) {
        const rk = heroMetaSort.role;
        const ga = a.roleWinRate[rk]?.games ?? 0;
        const gb = b.roleWinRate[rk]?.games ?? 0;
        const wa = ga > 0 ? a.roleWinRate[rk]!.winRate : -1;
        const wb = gb > 0 ? b.roleWinRate[rk]!.winRate : -1;
        if (heroMetaSort.by === "winRate") {
          if (wb !== wa) return wb - wa;
          if (gb !== ga) return gb - ga;
          return b.winRate - a.winRate;
        }
        if (gb !== ga) return gb - ga;
        if (wb !== wa) return wb - wa;
        return b.winRate - a.winRate;
      }
      return 0;
    });
    return copy;
  }, [topHeroOverall, maps, heroMetaSort]);

  return (
    <>
      <SEOMeta title="PlanB - DOTA2 数据解析" />
      <PageShell
        centerSearch
        feedMode={feed}
        onFeedModeChange={handleFeedModeChange}
      >
        <main
          ref={mainRef}
          className="mx-auto w-full max-w-[1400px] px-4 py-4 sm:px-6 sm:py-8 lg:px-8"
        >
          <h1 className="sr-only">
            PlanB - 职业选手都在用的顶分局数据平台
          </h1>
          {idxErr ? (
            <p className="mb-4 text-sm text-amber-500/90">{idxErr}</p>
          ) : null}
          {mapsErr ? (
            <p className="mb-4 text-sm text-amber-500/90">{mapsErr}</p>
          ) : null}
          {!mapsLoading && maps ? (
            <>
              <div className="mb-4 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHomeView("matches")}
                  className={`rounded border px-3 py-1.5 text-sm font-semibold ${homeView === "matches"
                    ? "border-amber-500/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-slate-500/35 bg-slate-200/35 text-skin-sub hover:bg-slate-300/35 dark:border-slate-500/45 dark:bg-slate-700/35 dark:hover:bg-slate-700/55"
                    }`}
                >
                  Matches
                </button>
                <button
                  type="button"
                  title="全站：静态索引 JSON（与每日 meta_site_snapshot 同源合并逻辑）"
                  onClick={() => setHomeView("meta")}
                  className={`rounded border px-3 py-1.5 text-sm font-semibold ${homeView === "meta"
                    ? "border-amber-500/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-slate-500/35 bg-slate-200/35 text-skin-sub hover:bg-slate-300/35 dark:border-slate-500/45 dark:bg-slate-700/35 dark:hover:bg-slate-700/55"
                    }`}
                >
                  Meta
                </button>
                <button
                  type="button"
                  title={`全站合并索引；出装统计依赖每场 slim，默认最多分析 ${ITEMS_TAB_SLIM_SAMPLE_CAP} 场`}
                  onClick={() => setHomeView("items")}
                  className={`rounded border px-3 py-1.5 text-sm font-semibold ${homeView === "items"
                    ? "border-amber-500/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-slate-500/35 bg-slate-200/35 text-skin-sub hover:bg-slate-300/35 dark:border-slate-500/45 dark:bg-slate-700/35 dark:hover:bg-slate-700/55"
                    }`}
                >
                  Items
                </button>
                <button
                  type="button"
                  title="全站：每日快照 meta_site_snapshot.json 中的 TOP 榜单"
                  onClick={() => setHomeView("top")}
                  className={`rounded border px-3 py-1.5 text-sm font-semibold ${homeView === "top"
                    ? "border-amber-500/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-slate-500/35 bg-slate-200/35 text-skin-sub hover:bg-slate-300/35 dark:border-slate-500/45 dark:bg-slate-700/35 dark:hover:bg-slate-700/55"
                    }`}
                >
                  TOP
                </button>
                <Link
                  to={patchNotesRoutePath(patch.currentPatch)}
                  className="inline-flex rounded border border-slate-500/35 bg-slate-200/35 px-3 py-1.5 text-sm font-semibold text-skin-sub hover:bg-slate-300/35 dark:border-slate-500/45 dark:bg-slate-700/35 dark:hover:bg-slate-700/55"
                >
                  {patchNavDisplayLabel(patch.currentPatch)}
                </Link>
                </div>
              </div>
              {homeView === "matches" ? (
                feedListLoading ? (
                  <div
                    className="flex flex-col gap-2 sm:gap-3"
                    aria-busy="true"
                    aria-label="对局列表加载中"
                  >
                    {Array.from({ length: 5 }).map((_, s) => (
                      <div
                        key={`sk-${s}`}
                        className="min-h-[5.25rem] animate-pulse rounded-xl border border-skin-line bg-slate-200/50 dark:bg-slate-800/50 sm:min-h-[6.25rem]"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:gap-3">
                    {visible.map((r, i) => (
                      <ViewportMountRow
                        key={`${feedKey}-${r.match_id}-${r.uploaded_at}-${r.source ?? ""}`}
                        index={i}
                        forceMountCount={1}
                        rootMargin="48px 0px"
                        skeleton={
                          <div
                            aria-hidden
                            className="min-h-[5.25rem] rounded-xl border border-skin-line bg-skin-inset/50 sm:min-h-[6.25rem]"
                          />
                        }
                      >
                        <ReplayCard
                          replay={r}
                          maps={maps}
                          eagerHeroPortraits={i < 1}
                        />
                      </ViewportMountRow>
                    ))}
                  </div>
                )
              ) : null}
            </>
          ) : (
            <p className="text-sm text-skin-sub">加载中…</p>
          )}
          {homeView === "matches" ? (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                className="rounded border border-skin-line bg-skin-inset px-3 py-1.5 text-sm text-skin-ink disabled:cursor-not-allowed disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  const target = Math.max(1, page - 1);
                  if (target <= 1) next.delete("page");
                  else next.set("page", String(target));
                  setSearchParams(next);
                }}
              >
                上一页
              </button>
              <p className="text-xs text-skin-sub tabular-nums">
                第 {pageForSlice} / {totalPages} 页
                {homeView === "matches" && feed.pub && !feed.pro && pagedTotalRows != null
                  ? `（共 ${pagedTotalRows} 场）`
                  : homeView === "matches"
                    ? `（共 ${replays.length} 场）`
                    : null}
              </p>
              <button
                type="button"
                className="rounded border border-skin-line bg-skin-inset px-3 py-1.5 text-sm text-skin-ink disabled:cursor-not-allowed disabled:opacity-40"
                disabled={pageForSlice >= totalPages}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  const target = Math.min(totalPages, pageForSlice + 1);
                  if (target <= 1) next.delete("page");
                  else next.set("page", String(target));
                  setSearchParams(next);
                }}
              >
                下一页
              </button>
            </div>
          ) : null}
          {homeView === "meta" && !mapsLoading && maps ? (
            <section className="mt-6 rounded-lg border border-skin-line bg-skin-card p-3">
              <p className="meta-major-title mb-2">全站对局</p>
              {cloudAggErr ? (
                <p className="mb-4 text-sm text-amber-500/90">{cloudAggErr}</p>
              ) : null}
              {cloudAgg ? (
                <div className="mb-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded border border-emerald-500/45 bg-emerald-500/[0.09] p-3 dark:border-emerald-400/40 dark:bg-emerald-500/15">
                    <p className="text-xs font-semibold text-emerald-800/90 dark:text-emerald-300/90">
                      天辉胜率
                    </p>
                    <p className="mt-1 text-lg font-bold text-emerald-950 dark:text-emerald-200">
                      {cloudAgg.decidedMatches > 0
                        ? `${((cloudAgg.radiantWins / cloudAgg.decidedMatches) * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded border border-rose-500/45 bg-rose-500/[0.09] p-3 dark:border-rose-400/40 dark:bg-rose-500/15">
                    <p className="text-xs font-semibold text-rose-800/90 dark:text-rose-300/90">
                      夜魇胜率
                    </p>
                    <p className="mt-1 text-lg font-bold text-rose-950 dark:text-rose-200">
                      {cloudAgg.decidedMatches > 0
                        ? `${((cloudAgg.direWins / cloudAgg.decidedMatches) * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded border border-sky-500/45 bg-sky-500/[0.09] p-3 dark:border-sky-400/40 dark:bg-sky-500/15">
                    <p className="text-xs font-semibold text-sky-800/90 dark:text-sky-300/90">
                      平均比赛时长
                    </p>
                    <p className="mt-1 text-lg font-bold text-sky-950 dark:text-sky-200">
                      {cloudAgg.durationSamples > 0
                        ? `${Math.floor(cloudAgg.avgDurationSec / 60)}:${String(
                            Math.floor(cloudAgg.avgDurationSec % 60)
                          ).padStart(2, "0")}`
                        : "—"}
                    </p>
                  </div>
                </div>
              ) : null}
              <p className="meta-major-title mb-2">胜率统计</p>
              <p className="mb-2 text-sm font-semibold text-skin-sub">
                分位置胜率 Top 5
              </p>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {([
                  ["carry", "Carry"],
                  ["mid", "Mid"],
                  ["offlane", "Offlane"],
                  ["support(4)", "Pos4"],
                  ["support(5)", "Pos5"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRoleTab(id)}
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${roleTab === id
                      ? "border-amber-500/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-300"
                      : "border-slate-500/35 bg-slate-200/35 text-skin-sub hover:bg-slate-300/35 dark:border-slate-500/45 dark:bg-slate-700/35 dark:hover:bg-slate-700/55"
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {topHeroByRole.length ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {topHeroByRole.map((row) => {
                    const hero = maps.heroes[String(row.heroId)];
                    const heroKey = hero?.key || "invoker";
                    return (
                      <Link
                        key={`${roleTab}-${row.heroId}`}
                        to={`/hero/${encodeURIComponent(heroKey)}`}
                        className="rounded border border-skin-line bg-skin-inset/40 p-2 transition hover:bg-skin-inset/70"
                      >
                        <div className="flex items-center gap-2">
                          <img
                            src={heroIconUrl(heroKey)}
                            alt={hero?.nameEn || heroKey}
                            className="h-9 w-9 rounded object-cover"
                            {...steamCdnImgDefer}
                            onError={onDotaSteamAssetImgError}
                          />
                          <div className="min-w-0">
                            <p
                              className={`truncate font-semibold ${metaEmphasisTextSizeClass} text-skin-ink`}
                            >
                              {hero?.nameCn || hero?.nameEn || heroKey}
                            </p>
                            <p className="mt-0.5 whitespace-nowrap text-[11px] leading-snug">
                              <span className={gamesCountTextClass}>
                                {row.games}场
                              </span>
                              <span
                                className={metaWinRateAfterGamesClass(row.winRate)}
                              >
                                （{row.winRate.toFixed(1)}%）
                              </span>
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-skin-sub">
                  当前 {roleTab} 位置暂无出场 ≥50 局的英雄。
                </p>
              )}
              <div className="mt-4 rounded border border-skin-line p-3">
                <p className="mb-3 text-sm font-semibold text-skin-sub">
                  全英雄总胜率
                </p>
                {topHeroOverall.length ? (
                  <HeroWinrateMetaTable
                    rows={heroMetaTableRows}
                    sortMode={heroMetaSort}
                    baselineTooltipTitle={heroTrendBaselineTooltipTitle(
                      patch.previousPatch
                    )}
                    onSortByWinRate={() => {
                      setHeroMetaSort((prev) => {
                        if (isHeroMetaGlobalWinRateSort(prev)) {
                          return {
                            type: "winRate",
                            order: prev.order === "desc" ? "asc" : "desc",
                          };
                        }
                        return { type: "winRate", order: "desc" };
                      });
                    }}
                    onSortByGames={() => {
                      setHeroMetaSort((prev) => {
                        if (isHeroMetaGlobalGamesSort(prev)) {
                          return {
                            type: "games",
                            order: prev.order === "desc" ? "asc" : "desc",
                          };
                        }
                        return { type: "games", order: "desc" };
                      });
                    }}
                    onSortByRole={(rk) => {
                      setHeroMetaSort((prev) => {
                        if (isHeroMetaRoleColumnSort(prev) && prev.role === rk) {
                          return {
                            role: rk,
                            by: prev.by === "winRate" ? "games" : "winRate",
                          };
                        }
                        return { role: rk, by: "winRate" };
                      });
                    }}
                  />
                ) : (
                  <p className="text-sm text-skin-sub">
                    暂无去重后满 100 场以上的英雄数据。
                  </p>
                )}
              </div>
            </section>
          ) : null}
          {homeView === "items" && !mapsLoading && maps ? (
            <MetaGlobalItemStatsSection
              replays={useFullSnapshot ? [] : replaysSampleForItemMeta}
              maps={maps}
              slimByMatchId={homeMetaSlimByMatch}
              slimLoading={homeMetaSlimLoading}
              precomputedItemAgg={
                useFullSnapshot && metaSnapshot
                  ? metaSnapshot.itemsMeta
                  : undefined
              }
            />
          ) : null}
          {homeView === "top" && !mapsLoading && maps ? (
            <section className="mt-6 rounded-lg border border-skin-line bg-skin-card p-3">
              <MetaTopKillGamesSection
                replays={analyticsReplaysLatestOnly}
                maps={maps}
                listLoading={feedListLoading}
                slimByMatchId={topTabSlimByMatch}
                slimLoading={topTabSlimLoading}
              />
            </section>
          ) : null}
        </main>
      </PageShell>
    </>
  );
}
