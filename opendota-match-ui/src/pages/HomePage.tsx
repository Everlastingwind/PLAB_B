import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { ReplayCard } from "../components/ReplayCard";
import { ViewportMountRow } from "../components/ViewportMountRow";
import type { FeedSelection } from "../components/FeedModeToggle";
import {
  MATCH_LIST_LOAD_STEP,
  cloudPackToIndexError,
  fetchCloudPubReplaySummariesPage,
  fetchReplaysForFeedSelection,
  fetchStaticFeedOnly,
} from "../lib/replaysApi";
import { fetchPlanBAggregateMatchStats } from "../lib/supabasePlanB";
import { loadSlimMatchJsonForDetails } from "../lib/loadSlimMatchJson";
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

export function HomePage() {
  const ROLE_KEYS = ["carry", "mid", "offlane", "support(4)", "support(5)"] as const;
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
  /** Meta / Items / TOP：仅用静态 JSON，避免依赖对局列表那条（可能仅 15 条） */
  const [analyticsReplays, setAnalyticsReplays] = useState<
    ReplaySummary[]
  >([]);
  const [roleTab, setRoleTab] = useState<"carry" | "mid" | "offlane" | "support(4)" | "support(5)">("carry");
  const [homeView, setHomeView] = useState<"matches" | "meta" | "items" | "top">(
    "matches"
  );
  const [cloudAgg, setCloudAgg] = useState<{
    decidedMatches: number;
    radiantWins: number;
    direWins: number;
    durationSamples: number;
    avgDurationSec: number;
  } | null>(null);
  const [cloudAggLoading, setCloudAggLoading] = useState(false);
  const [cloudAggErr, setCloudAggErr] = useState<string | null>(null);
  const cloudAggFetchedOk = useRef(false);
  /** Items / TOP 子区块用：由本页统一批量拉 plan_b/slim，禁止在子组件内再请求 */
  const [homeMetaSlimByMatch, setHomeMetaSlimByMatch] = useState<
    Record<number, SlimMatchJson | undefined>
  >({});
  const [homeMetaSlimLoading, setHomeMetaSlimLoading] = useState(false);
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
    void fetchStaticFeedOnly(feed).then((snap) => {
      if (!cancelled) setAnalyticsReplays(snap.replays);
    });
    return () => {
      cancelled = true;
    };
  }, [feed]);

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
          setReplays(pack.replays);
          setPagedTotalRows(Math.max(0, pack.totalRows));
          setIdxErr(
            pack.error
              ? cloudPackToIndexError({
                  replays: pack.replays,
                  error: pack.error,
                })
              : null
          );
          setFeedListLoading(false);
          return;
        }

        setPagedTotalRows(null);
        const { replays: list, cloudIndexError } =
          await fetchReplaysForFeedSelection(feed);
        if (cancelled) return;
        setReplays(list);
        setIdxErr(cloudIndexError);
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
  }, [feed, homeView, pageQueryParam]);

  useEffect(() => {
    if (homeView !== "meta") return;
    if (cloudAggFetchedOk.current) return;
    let cancelled = false;
    void (async () => {
      setCloudAggLoading(true);
      setCloudAggErr(null);
      const pack = await fetchPlanBAggregateMatchStats();
      if (cancelled) return;
      if (pack.error) {
        setCloudAggErr(pack.error);
        setCloudAgg(null);
      } else {
        cloudAggFetchedOk.current = true;
        setCloudAgg({
          decidedMatches: pack.decidedMatches,
          radiantWins: pack.radiantWins,
          direWins: pack.direWins,
          durationSamples: pack.durationSamples,
          avgDurationSec: pack.avgDurationSec,
        });
      }
      setCloudAggLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [homeView]);

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

  /** Items 页全局出装统计：限制样本量，避免对数百 match 发起 slim 拉取 */
  const replaysSampleForItemMeta = useMemo(
    () => analyticsReplays.slice(0, 48),
    [analyticsReplays]
  );

  const metaTabSlimIds = useMemo((): number[] => {
    if (homeView === "items") {
      const raw = replaysSampleForItemMeta
        .map((r) => Number(r.match_id))
        .filter((id) => Number.isFinite(id) && id > 0);
      return [...new Set(raw)].sort((a, b) => a - b);
    }
    if (homeView === "top") {
      return topKillMatchIdsForSlim(analyticsReplays, 5);
    }
    return [];
  }, [homeView, replaysSampleForItemMeta, analyticsReplays]);

  const metaTabSlimIdsKey = metaTabSlimIds.join(",");

  useEffect(() => {
    let cancelled = false;
    if (!maps || metaTabSlimIds.length === 0) {
      setHomeMetaSlimLoading(false);
      return;
    }
    setHomeMetaSlimLoading(true);
    void loadSlimMatchJsonForDetails(metaTabSlimIds, { preferCloud: true })
      .then((batch) => {
        if (cancelled) return;
        setHomeMetaSlimByMatch((prev) => {
          const next = { ...prev };
          for (const mid of metaTabSlimIds) {
            const j = batch[mid];
            if (j) next[mid] = j;
          }
          return next;
        });
        setHomeMetaSlimLoading(false);
      })
      .catch(() => {
        if (!cancelled) setHomeMetaSlimLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metaTabSlimIdsKey, maps]);

  const normalizeRole = useCallback((raw: unknown): "carry" | "mid" | "offlane" | "support(4)" | "support(5)" | null => {
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "carry") return "carry";
    if (s === "mid") return "mid";
    if (s === "offlane") return "offlane";
    if (s === "support4" || s === "support 4" || s === "support(4)") return "support(4)";
    if (s === "support5" || s === "support 5" || s === "support(5)") return "support(5)";
    return null;
  }, []);

  const topHeroByRole = useMemo(() => {
    if (!maps) return [] as Array<{ heroId: number; games: number; winRate: number }>;
    const agg = new Map<number, { games: number; wins: number }>();
    for (const r of analyticsReplays) {
      for (const p of r.players || []) {
        const role = normalizeRole(p.role_early);
        if (role !== roleTab) continue;
        const hid = Number(p.hero_id || 0);
        if (!Number.isFinite(hid) || hid <= 0) continue;
        const row = agg.get(hid) || { games: 0, wins: 0 };
        row.games += 1;
        const won = Boolean(p.is_radiant) === Boolean(r.radiant_win);
        if (won) row.wins += 1;
        agg.set(hid, row);
      }
    }
    return Array.from(agg.entries())
      .map(([heroId, s]) => ({
        heroId,
        games: s.games,
        winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
      }))
      .filter((x) => x.games >= 50)
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
      .slice(0, 5);
  }, [analyticsReplays, roleTab, maps, normalizeRole]);

  const topHeroOverall = useMemo(() => {
    if (!maps) return [] as Array<{
      heroId: number;
      games: number;
      winRate: number;
      /** 按录像时间排序后，每场之后的累计胜率（%），长度与有效场次一致 */
      cumulativeWinRateSeries: number[];
      roleWinRate: Partial<Record<(typeof ROLE_KEYS)[number], { games: number; winRate: number }>>;
    }>;
    const agg = new Map<number, {
      games: number;
      wins: number;
      role: Record<(typeof ROLE_KEYS)[number], { games: number; wins: number }>;
    }>();
    /** 每场录像一条，用于按时间累计胜率（同 match_id 取较晚入库的一条） */
    const heroMatchBest = new Map<
      number,
      Map<number, { t: number; won: boolean }>
    >();

    for (const r of analyticsReplays) {
      const t = Date.parse(String(r.uploaded_at ?? "")) || 0;
      const rw = Boolean(r.radiant_win);
      const mid = Number(r.match_id) || 0;
      for (const p of r.players || []) {
        const hid = Number(p.hero_id || 0);
        if (!Number.isFinite(hid) || hid <= 0) continue;
        const row = agg.get(hid) || {
          games: 0,
          wins: 0,
          role: {
            carry: { games: 0, wins: 0 },
            mid: { games: 0, wins: 0 },
            offlane: { games: 0, wins: 0 },
            "support(4)": { games: 0, wins: 0 },
            "support(5)": { games: 0, wins: 0 },
          },
        };
        row.games += 1;
        const won = Boolean(p.is_radiant) === rw;
        if (won) row.wins += 1;
        const role = normalizeRole(p.role_early);
        if (role) {
          row.role[role].games += 1;
          if (won) row.role[role].wins += 1;
        }
        agg.set(hid, row);

        let mm = heroMatchBest.get(hid);
        if (!mm) {
          mm = new Map();
          heroMatchBest.set(hid, mm);
        }
        const prev = mm.get(mid);
        if (!prev || t >= prev.t) {
          mm.set(mid, { t, won });
        }
      }
    }

    return Array.from(agg.entries())
      .map(([heroId, s]) => {
        const roleWinRate = ROLE_KEYS.reduce((acc, rk) => {
          const g = s.role[rk].games;
          if (g <= 0) return acc;
          acc[rk] = {
            games: g,
            winRate: (s.role[rk].wins / g) * 100,
          };
          return acc;
        }, {} as Partial<Record<(typeof ROLE_KEYS)[number], { games: number; winRate: number }>>);
        const mm = heroMatchBest.get(heroId);
        const cumulativeWinRateSeries: number[] = [];
        if (mm && mm.size > 0) {
          const events = Array.from(mm.entries())
            .map(([matchId, ev]) => ({
              matchId,
              t: ev.t,
              won: ev.won,
            }))
            .sort((a, b) => a.t - b.t || a.matchId - b.matchId);
          let winsRun = 0;
          for (let i = 0; i < events.length; i++) {
            if (events[i].won) winsRun += 1;
            cumulativeWinRateSeries.push((winsRun / (i + 1)) * 100);
          }
        }

        const uniqueG = cumulativeWinRateSeries.length;
        const winRateFinal =
          uniqueG > 0
            ? cumulativeWinRateSeries[uniqueG - 1]
            : s.games > 0
              ? (s.wins / s.games) * 100
              : 0;

        return {
          heroId,
          games: uniqueG > 0 ? uniqueG : s.games,
          winRate: winRateFinal,
          cumulativeWinRateSeries,
          roleWinRate,
        };
      })
      .filter((x) => x.cumulativeWinRateSeries.length >= 100);
  }, [analyticsReplays, maps, normalizeRole]);

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
          {idxErr ? (
            <p className="mb-4 text-sm text-amber-500/90">{idxErr}</p>
          ) : null}
          {mapsErr ? (
            <p className="mb-4 text-sm text-amber-500/90">{mapsErr}</p>
          ) : null}
          {!mapsLoading && maps ? (
            <>
              <div className="mb-4 flex items-center gap-2">
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
                  onClick={() => setHomeView("top")}
                  className={`rounded border px-3 py-1.5 text-sm font-semibold ${homeView === "top"
                    ? "border-amber-500/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-slate-500/35 bg-slate-200/35 text-skin-sub hover:bg-slate-300/35 dark:border-slate-500/45 dark:bg-slate-700/35 dark:hover:bg-slate-700/55"
                    }`}
                >
                  TOP
                </button>
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
              <p className="meta-major-title mb-2">全站对局（Supabase）</p>
              {cloudAggLoading ? (
                <p className="mb-4 text-sm text-skin-sub">正在统计云库比赛数据…</p>
              ) : null}
              {cloudAggErr ? (
                <p className="mb-4 text-sm text-amber-500/90">{cloudAggErr}</p>
              ) : null}
              {cloudAgg && !cloudAggErr ? (
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
                分位置胜率 Top 5（出场 ≥50 局）
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
                  全英雄总胜率（同 match 去重后 ≥100 场）
                </p>
                {topHeroOverall.length ? (
                  <HeroWinrateMetaTable
                    rows={heroMetaTableRows}
                    sortMode={heroMetaSort}
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
              replays={replaysSampleForItemMeta}
              maps={maps}
              slimByMatchId={homeMetaSlimByMatch}
              slimLoading={homeMetaSlimLoading}
            />
          ) : null}
          {homeView === "top" && !mapsLoading && maps ? (
            <section className="mt-6 rounded-lg border border-skin-line bg-skin-card p-3">
              <MetaTopKillGamesSection
                replays={analyticsReplays}
                maps={maps}
                listLoading={feedListLoading}
                slimByMatchId={homeMetaSlimByMatch}
                slimLoading={homeMetaSlimLoading}
              />
            </section>
          ) : null}
        </main>
      </PageShell>
    </>
  );
}
