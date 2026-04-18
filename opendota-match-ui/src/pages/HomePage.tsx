import { useEffect, useMemo, useState } from "react";
import { PageShell } from "../components/PageShell";
import { ReplayCard } from "../components/ReplayCard";
import type { FeedSelection } from "../components/FeedModeToggle";
import { fetchReplaysForFeedSelection, PAGE_SIZE } from "../lib/replaysApi";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";
import { SEOMeta } from "../components/SEOMeta";

export function HomePage() {
  const { maps, loading: mapsLoading, error: mapsErr } = useEntityMaps();
  const [feed, setFeed] = useState<FeedSelection>({ pub: true, pro: false });
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setPage(1);
    setIdxErr(null);
    fetchReplaysForFeedSelection(feed)
      .then((list) => {
        if (!cancelled) setReplays(list);
      })
      .catch((e) => {
        if (!cancelled)
          setIdxErr(e instanceof Error ? e.message : "索引加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [feed]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(replays.length / PAGE_SIZE)),
    [replays.length]
  );
  const visible = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return replays.slice(start, end);
  }, [replays, page]);

  const feedKey = `${feed.pub ? "p" : ""}${feed.pro ? "r" : ""}`;

  return (
    <>
      <SEOMeta title="PlanB - DOTA2 数据解析" />
      <PageShell
        centerSearch
        feedMode={feed}
        onFeedModeChange={setFeed}
      >
        <main className="mx-auto w-full max-w-[1400px] px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
          {idxErr ? (
            <p className="mb-4 text-sm text-amber-500/90">{idxErr}</p>
          ) : null}
          {mapsErr ? (
            <p className="mb-4 text-sm text-amber-500/90">{mapsErr}</p>
          ) : null}
          {!mapsLoading && maps ? (
            <div className="flex flex-col gap-2 sm:gap-3">
              {visible.map((r) => (
                <ReplayCard
                  key={`${feedKey}-${r.match_id}-${r.uploaded_at}-${r.source ?? ""}`}
                  replay={r}
                  maps={maps}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-skin-sub">加载中…</p>
          )}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              className="rounded border border-skin-line bg-skin-inset px-3 py-1.5 text-sm text-skin-ink disabled:cursor-not-allowed disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <p className="text-xs text-skin-sub">
              第 {page} / {totalPages} 页（每页 {PAGE_SIZE} 条）
            </p>
            <button
              type="button"
              className="rounded border border-skin-line bg-skin-inset px-3 py-1.5 text-sm text-skin-ink disabled:cursor-not-allowed disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一页
            </button>
          </div>
        </main>
      </PageShell>
    </>
  );
}
