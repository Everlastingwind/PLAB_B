import { useEffect, useMemo, useState } from "react";
import { PageShell } from "../components/PageShell";
import { ReplayCard } from "../components/ReplayCard";
import type { FeedMode } from "../components/FeedModeToggle";
import {
  fetchReplaysIndex,
  fetchProReplaysIndex,
  PAGE_SIZE,
} from "../lib/replaysApi";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";

export function HomePage() {
  const { maps, loading: mapsLoading, error: mapsErr } = useEntityMaps();
  const [feed, setFeed] = useState<FeedMode>("pub");
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    setIdxErr(null);
    const load =
      feed === "pub" ? fetchReplaysIndex : fetchProReplaysIndex;
    load()
      .then((idx) => setReplays(idx.replays))
      .catch((e) =>
        setIdxErr(e instanceof Error ? e.message : "索引加载失败")
      );
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

  return (
    <PageShell
      centerSearch
      feedMode={feed}
      onFeedModeChange={setFeed}
    >
      <main className="mx-auto w-full max-w-[1400px] px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
        {feed === "pro" ? (
          <p className="mb-6 text-xs leading-relaxed text-skin-sub">
            PRO：OpenDota 职业比赛索引（战队 ID 见{" "}
            <span className="font-mono text-skin-ink">liquipedia_top20_team_ids.json</span>
            ）；建议每日 9:20 运行{" "}
            <span className="font-mono text-skin-ink">scripts/fetch_pro_replays_index.py</span>{" "}
            更新。
          </p>
        ) : null}
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
                key={`${feed}-${r.match_id}-${r.uploaded_at}`}
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
  );
}
