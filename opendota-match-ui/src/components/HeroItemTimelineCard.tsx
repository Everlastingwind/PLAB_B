import { useEffect, useMemo, useState } from "react";
import {
  heroIconUrl,
  itemIconUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
  steamCdnImgHero,
} from "../data/mockMatchPlayers";
import type { SlimMatchJson } from "../types/slimMatch";
import {
  buildHeroPurchaseTimelineFromSlims,
  type HeroItemTimelinePayload,
} from "../lib/heroPurchaseTimelineFromSlims";

export type { HeroItemTimelinePayload };

type HeroItemTimelineCardProps = {
  heroId: number;
  heroKey: string;
  heroName: string;
  fallbackMatchIds?: number[];
  /**
   * 父页面批量 plan_b/slim；用于 API 无 purchase_data 时同步回退计算。
   * 禁止在本组件内调用 loadSlimMatchJson* / Supabase。
   */
  slimByMatchForFallback?: Readonly<
    Record<number, SlimMatchJson | null | undefined>
  >;
};

export function HeroItemTimelineCard(props: HeroItemTimelineCardProps) {
  const { heroId, heroKey, heroName } = props;
  const fallbackMatchIds = props.fallbackMatchIds || [];
  const slimByMatchForFallback = props.slimByMatchForFallback;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMinute, setSelectedMinute] = useState(20);
  const [payload, setPayload] = useState<HeroItemTimelinePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    void fetch(`/api/hero-item-timeline?hero_id=${heroId}`)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status >= 500) {
            throw new Error("后端服务暂不可用（请确认 8000 端口 API 已启动）");
          }
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as HeroItemTimelinePayload;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        const maxMinuteInData = Math.max(
          0,
          ...((data.purchase_data || []).map((x) => Number(x.minute) || 0))
        );
        setSelectedMinute(Math.min(20, Math.max(0, maxMinuteInData || 60)));
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "加载失败";
        if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)) {
          setError("无法连接后端 API（请确认 127.0.0.1:8000 已运行）");
          return;
        }
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [heroId]);

  const computedFromSlims = useMemo(() => {
    if (!slimByMatchForFallback || fallbackMatchIds.length === 0) return null;
    return buildHeroPurchaseTimelineFromSlims(
      heroId,
      payload?.hero_name || heroName,
      slimByMatchForFallback,
      fallbackMatchIds
    );
  }, [
    slimByMatchForFallback,
    fallbackMatchIds,
    heroId,
    heroName,
    payload?.hero_name,
  ]);

  const effectivePayload = useMemo(() => {
    if (payload?.purchase_data?.length) return payload;
    if (computedFromSlims?.purchase_data?.length) return computedFromSlims;
    return payload;
  }, [payload, computedFromSlims]);

  const minuteMax = useMemo(() => {
    const dataMax = Math.max(
      0,
      ...((effectivePayload?.purchase_data || []).map((x) => Number(x.minute) || 0))
    );
    return Math.max(60, dataMax);
  }, [effectivePayload]);

  const topItemsAtMinute = useMemo(() => {
    if (!effectivePayload?.purchase_data?.length || effectivePayload.total_matches_for_hero <= 0)
      return [];
    return effectivePayload.purchase_data
      .filter((x) => Number(x.minute) === selectedMinute)
      .map((x) => ({
        ...x,
        pct: (Number(x.count) / Number(effectivePayload.total_matches_for_hero)) * 100,
      }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);
  }, [effectivePayload, selectedMinute]);

  return (
    <section className="mb-6 rounded-lg border border-skin-line bg-skin-card p-4">
      <div className="mb-3 flex items-center gap-3">
        <img
          src={heroIconUrl(heroKey || "invoker")}
          alt={heroName}
          className="h-12 w-12 rounded object-cover"
          {...steamCdnImgHero}
          onError={onDotaSteamAssetImgError}
        />
        <div>
          <p className="text-sm font-semibold text-skin-ink">{heroName}</p>
          <p className="text-xs text-skin-sub">典型出装时间线（全局样本）</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-skin-sub">时间线数据加载中…</p>
      ) : error ? (
        <p className="text-sm text-rose-400">时间线加载失败：{error}</p>
      ) : !effectivePayload ? (
        <p className="text-sm text-skin-sub">暂无可用数据。</p>
      ) : effectivePayload.purchase_data.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-skin-sub">
            当前统计库暂无购买时间线数据（仅有样本局数）。
          </p>
          <p className="text-[11px] text-skin-sub">
            需要后端写入玩家级 `purchase_history` 后，此卡片才会按分钟展示典型物品；或由父页面传入 slim 后从明细聚合。
          </p>
          <p className="text-[11px] text-skin-sub">
            样本局数：{effectivePayload.total_matches_for_hero}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-xs text-skin-sub">
              <span>时间轴（分钟）</span>
              <span className="font-mono text-skin-ink">{selectedMinute}:00</span>
            </div>
            <input
              type="range"
              min={0}
              max={minuteMax}
              step={1}
              value={selectedMinute}
              onChange={(e) => setSelectedMinute(Number(e.target.value) || 0)}
              className="w-full accent-amber-500"
            />
            <p className="mt-1 text-[11px] text-skin-sub">
              样本局数：{effectivePayload.total_matches_for_hero}
            </p>
          </div>

          {topItemsAtMinute.length === 0 ? (
            <p className="text-sm text-skin-sub">该时间段无典型物品。</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {topItemsAtMinute.map((it) => {
                const iconKey = String(it.item_name || "").replace(/^item_/, "");
                return (
                  <div
                    key={`${it.minute}-${it.item_id}-${it.item_name}`}
                    className="flex items-center gap-2 rounded border border-slate-500/35 bg-slate-200/35 px-2 py-1.5 dark:border-slate-500/45 dark:bg-slate-700/35"
                  >
                    <img
                      src={itemIconUrl(iconKey)}
                      alt={it.item_name}
                      className="h-8 w-8 rounded object-cover"
                      {...steamCdnImgDefer}
                      onError={onDotaSteamAssetImgError}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-skin-ink">
                        {it.item_name}
                      </p>
                      <p className="text-[11px] text-skin-sub">
                        {it.pct.toFixed(1)}% 玩家购买
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
