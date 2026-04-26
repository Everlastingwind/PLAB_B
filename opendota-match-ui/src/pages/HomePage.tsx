import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { ReplayCard } from "../components/ReplayCard";
import { ViewportMountRow } from "../components/ViewportMountRow";
import type { FeedSelection } from "../components/FeedModeToggle";
import { fetchReplaysForFeedSelection, PAGE_SIZE } from "../lib/replaysApi";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";
import { SEOMeta } from "../components/SEOMeta";
import {
  homeAnchorStorageKey,
  homeScrollStorageKey,
  readDocumentScrollY,
  scrollDocumentToY,
} from "../lib/documentScroll";

export function HomePage() {
  const { maps, loading: mapsLoading, error: mapsErr } = useEntityMaps();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [feed, setFeed] = useState<FeedSelection>({ pub: true, pro: false });
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [feedListLoading, setFeedListLoading] = useState(true);
  const [idxErr, setIdxErr] = useState<string | null>(null);
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
    setReplays([]);
    void fetchReplaysForFeedSelection(feed)
      .then(({ replays: list, cloudIndexError }) => {
        if (cancelled) return;
        setReplays(list);
        setIdxErr(cloudIndexError);
        setFeedListLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setFeedListLoading(false);
          setIdxErr(e instanceof Error ? e.message : "索引加载失败");
        }
      });
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
    if (mapsLoading || !maps) return;

    restoreHomeListScroll();
    const timers: number[] = [80, 220, 450, 900, 1400].map((delayMs) =>
      window.setTimeout(restoreHomeListScroll, delayMs)
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [scrollKey, visible.length, mapsLoading, maps, restoreHomeListScroll]);

  /** Edge 等：最大化后布局/视口变化会把滚动打回顶部，内容高度变化时再跑一次 */
  useEffect(() => {
    if (mapsLoading || !maps) return;
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
  }, [mapsLoading, maps, restoreHomeListScroll, visible.length]);

  useEffect(() => {
    let ticking = false;
    const persist = () => {
      sessionStorage.setItem(scrollKey, String(readDocumentScrollY()));
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(persist);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("pagehide", persist);
    };
  }, [scrollKey]);

  const feedKey = `${feed.pub ? "p" : ""}${feed.pro ? "r" : ""}`;

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
                      eagerHeroPortraits={i < 2}
                    />
                  </ViewportMountRow>
                ))}
              </div>
            )
          ) : (
            <p className="text-sm text-skin-sub">加载中…</p>
          )}
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
              第 {page} / {totalPages} 页（每页 {PAGE_SIZE} 条）
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
        </main>
      </PageShell>
    </>
  );
}
