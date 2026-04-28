import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { ReplayCard } from "../components/ReplayCard";
import { ViewportMountRow } from "../components/ViewportMountRow";
import type { FeedSelection } from "../components/FeedModeToggle";
import {
  PAGE_SIZE,
  fetchCloudPubReplaySummaries,
  fetchReplaysForFeedSelection,
  fetchStaticFeedOnly,
  mergeCloudIntoStaticFeed,
} from "../lib/replaysApi";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";
import { SEOMeta } from "../components/SEOMeta";
import { applyProDisplayOverridesToReplaySummaries } from "../lib/proAccountDisplayOverrides";
import { heroIconUrl, onDotaSteamAssetImgError, steamCdnImgDefer } from "../data/mockMatchPlayers";
import {
  homeAnchorStorageKey,
  homeScrollStorageKey,
  readDocumentScrollY,
  scrollDocumentToY,
} from "../lib/documentScroll";

export function HomePage() {
  const ROLE_KEYS = ["carry", "mid", "offlane", "support(4)", "support(5)"] as const;
  const ROLE_LABEL: Record<(typeof ROLE_KEYS)[number], string> = {
    carry: "Carry",
    mid: "Mid",
    offlane: "Offlane",
    "support(4)": "Pos4",
    "support(5)": "Pos5",
  };
  const { maps, loading: mapsLoading, error: mapsErr } = useEntityMaps();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [feed, setFeed] = useState<FeedSelection>({ pub: true, pro: false });
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [feedListLoading, setFeedListLoading] = useState(true);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  const [roleTab, setRoleTab] = useState<"carry" | "mid" | "offlane" | "support(4)" | "support(5)">("carry");
  const [homeView, setHomeView] = useState<"matches" | "meta">("matches");
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
    setIdxErr(null);
    setFeedListLoading(true);
    // 首屏优先：先返回静态列表，云索引后台补齐，避免首页长时间空白等待。
    void (async () => {
      try {
        if (!feed.pub) {
          const { replays: list, cloudIndexError } = await fetchReplaysForFeedSelection(feed);
          if (cancelled) return;
          setReplays(list);
          setIdxErr(cloudIndexError);
          setFeedListLoading(false);
          return;
        }

        const snap = await fetchStaticFeedOnly(feed);
        const initialRows = await applyProDisplayOverridesToReplaySummaries(snap.replays);
        if (cancelled) return;
        setReplays(initialRows);
        setFeedListLoading(false);

        const cloudPack = await fetchCloudPubReplaySummaries();
        if (cancelled) return;
        const merged = mergeCloudIntoStaticFeed(snap, cloudPack);
        const mergedRows = await applyProDisplayOverridesToReplaySummaries(merged.replays);
        if (cancelled) return;
        setReplays(mergedRows);
        setIdxErr(merged.cloudIndexError);
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
  }, [feed]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(replays.length / PAGE_SIZE)),
    [replays.length]
  );
  const pageFromQuery = (() => {
    const n = Number(searchParams.get("page") || 1);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  })();
  const page = Math.max(pageFromQuery, 1);
  const pageForSlice = Math.min(page, totalPages);
  const visible = useMemo(() => {
    const start = (pageForSlice - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return replays.slice(start, end);
  }, [replays, pageForSlice]);
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
  }, [scrollKey, visible.length, mapsLoading, maps, restoreHomeListScroll, shouldRestoreScroll]);

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
  }, [mapsLoading, maps, restoreHomeListScroll, visible.length, shouldRestoreScroll]);

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
    for (const r of replays) {
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
  }, [replays, roleTab, maps, normalizeRole]);

  const topHeroOverall = useMemo(() => {
    if (!maps) return [] as Array<{
      heroId: number;
      games: number;
      winRate: number;
      roleWinRate: Partial<Record<(typeof ROLE_KEYS)[number], { games: number; winRate: number }>>;
    }>;
    const agg = new Map<number, {
      games: number;
      wins: number;
      role: Record<(typeof ROLE_KEYS)[number], { games: number; wins: number }>;
    }>();
    for (const r of replays) {
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
        const won = Boolean(p.is_radiant) === Boolean(r.radiant_win);
        if (won) row.wins += 1;
        const role = normalizeRole(p.role_early);
        if (role) {
          row.role[role].games += 1;
          if (won) row.role[role].wins += 1;
        }
        agg.set(hid, row);
      }
    }
    return Array.from(agg.entries())
      .map(([heroId, s]) => ({
        heroId,
        games: s.games,
        winRate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
        roleWinRate: ROLE_KEYS.reduce((acc, rk) => {
          const g = s.role[rk].games;
          if (g <= 0) return acc;
          acc[rk] = {
            games: g,
            winRate: (s.role[rk].wins / g) * 100,
          };
          return acc;
        }, {} as Partial<Record<(typeof ROLE_KEYS)[number], { games: number; winRate: number }>>),
      }))
      .filter((x) => x.games >= 100)
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
  }, [replays, maps, normalizeRole]);

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
              </div>
              {homeView === "matches" ? (
                feedListLoading ? (
                  <p className="text-sm text-skin-sub">加载录像列表…</p>
                ) : (
                  <div className="flex flex-col gap-2 sm:gap-3">
                    {visible.map((r, i) => (
                      <ViewportMountRow
                        key={`${feedKey}-${r.match_id}-${r.uploaded_at}-${r.source ?? ""}`}
                        index={i}
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
              <p className="text-xs text-skin-sub">
                第 {page} / {totalPages} 页
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
              <p className="mb-2 text-xs font-semibold text-skin-sub">分位置胜率 Top 5（出场 ≥50 局）</p>
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
                    className={`rounded border px-2 py-1 text-[11px] font-semibold ${roleTab === id
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
                        className="rounded border border-slate-500/35 bg-slate-200/30 p-2 dark:border-slate-500/45 dark:bg-slate-700/30"
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
                            <p className="truncate text-xs font-semibold text-skin-ink">
                              {hero?.nameCn || hero?.nameEn || heroKey}
                            </p>
                            <p className="text-[11px] text-skin-sub">
                              胜率 {row.winRate.toFixed(1)}%
                            </p>
                            <p className="text-[11px] text-skin-sub">
                              场次 {row.games}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-skin-sub">
                  当前 {roleTab} 位置暂无出场 ≥50 局的英雄。
                </p>
              )}

              <div className="mt-4 rounded border border-skin-line p-3">
                <p className="mb-2 text-xs font-semibold text-skin-sub">全英雄总胜率（出场 ≥100 局）</p>
                {topHeroOverall.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {topHeroOverall.map((row) => {
                      const hero = maps.heroes[String(row.heroId)];
                      const heroKey = hero?.key || "invoker";
                      const roleStats = ROLE_KEYS.map((rk) => ({
                        key: rk,
                        label: ROLE_LABEL[rk],
                        stat: row.roleWinRate[rk],
                      }));
                      const maxRoleWinRate = roleStats.reduce((acc, item) => {
                        if (!item.stat) return acc;
                        return Math.max(acc, item.stat.winRate);
                      }, -1);
                      return (
                        <Link
                          key={`overall-${row.heroId}`}
                          to={`/hero/${encodeURIComponent(heroKey)}`}
                          className="rounded border border-slate-500/35 bg-slate-200/30 p-2 dark:border-slate-500/45 dark:bg-slate-700/30"
                        >
                          <div className="flex items-start gap-2">
                            <img
                              src={heroIconUrl(heroKey)}
                              alt={hero?.nameEn || heroKey}
                              className="h-9 w-9 rounded object-cover"
                              {...steamCdnImgDefer}
                              onError={onDotaSteamAssetImgError}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-skin-ink">
                                {hero?.nameCn || hero?.nameEn || heroKey}
                              </p>
                              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-skin-sub">
                                <span>胜率 {row.winRate.toFixed(1)}%</span>
                                <span>场次 {row.games}</span>
                              </div>
                              <div className="mt-1 grid grid-cols-2 gap-1">
                                {roleStats.map(({ key, label, stat }) => {
                                  const isBestRole =
                                    !!stat && maxRoleWinRate >= 0 && stat.winRate === maxRoleWinRate;
                                  return (
                                    <span
                                      key={`${row.heroId}-${key}`}
                                      className="rounded border border-slate-500/35 px-1 py-0.5 text-[10px] dark:border-slate-500/45"
                                    >
                                      <span className="text-skin-sub">{label} </span>
                                      <span
                                        className={
                                          isBestRole
                                            ? "font-semibold text-red-600 dark:text-red-400"
                                            : "text-skin-sub"
                                        }
                                      >
                                        {stat ? `${stat.winRate.toFixed(0)}%(${stat.games})` : "-"}
                                      </span>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-skin-sub">暂无出场 ≥100 局的全英雄总胜率数据。</p>
                )}
              </div>
            </section>
          ) : null}
        </main>
      </PageShell>
    </>
  );
}
