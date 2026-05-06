import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { EntityMapsPayload } from "../types/entityMaps";
import type { ReplaySummary } from "../types/replaysIndex";
import type { SlimMatchJson } from "../types/slimMatch";
import {
  aggregateMetaGlobalItemStats,
  formatGameClockMmSs,
  normalizeMetaItemKey,
  type MetaGlobalItemAggRow,
} from "../lib/metaGlobalItemStats";
import {
  itemIconUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
} from "../data/mockMatchPlayers";
import { winRateTextClass } from "../lib/winRateTextClass";
import { loadCraftableItemKeySet } from "../lib/itemCraftableKeys";

type Props = {
  replays: readonly ReplaySummary[];
  maps: EntityMapsPayload;
  /** 父页面统一批量拉取 plan_b/slim；本组件禁止发起 loadSlimMatchJson* */
  slimByMatchId: Readonly<Record<number, SlimMatchJson | null | undefined>>;
  /** 父页面首次批量请求 plan_b 进行中 */
  slimLoading?: boolean;
  /** 每日快照预聚合（读 `/data/meta_site_snapshot.json`），不再现场扫 slim */
  precomputedItemAgg?: {
    rows: MetaGlobalItemAggRow[];
    matchesAnalyzed: number;
    totalHeroPlayerSlots: number;
    totalListed: number;
  };
};

type MetaItemSortColumn =
  | "purchaseRate"
  | "purchaseRateAfter45"
  | "averageTime"
  | "winRate";

type MetaItemSortState = {
  column: MetaItemSortColumn;
  order: "desc" | "asc";
};

function compareMetaItemRows(
  a: ReturnType<typeof aggregateMetaGlobalItemStats>["rows"][number],
  b: ReturnType<typeof aggregateMetaGlobalItemStats>["rows"][number],
  column: MetaItemSortColumn,
  order: "desc" | "asc"
): number {
  const dir = order === "desc" ? -1 : 1;

  const numOrNull = (
    row: ReturnType<typeof aggregateMetaGlobalItemStats>["rows"][number]
  ): number | null => {
    switch (column) {
      case "purchaseRate":
        return row.purchaseRatePct;
      case "purchaseRateAfter45":
        return row.purchaseRateAfter45Pct;
      case "averageTime":
        return row.averagePurchaseSec;
      case "winRate":
        return row.winRatePct;
      default:
        return null;
    }
  };

  const va = numOrNull(a);
  const vb = numOrNull(b);
  if (va == null && vb == null) return a.itemKey.localeCompare(b.itemKey);
  if (va == null) return 1;
  if (vb == null) return -1;
  const cmp = (va - vb) * dir;
  if (cmp !== 0) return cmp;
  return a.itemKey.localeCompare(b.itemKey);
}

export function MetaGlobalItemStatsSection(props: Props) {
  const {
    replays,
    maps,
    slimByMatchId,
    slimLoading = false,
    precomputedItemAgg,
  } = props;
  const [itemSort, setItemSort] = useState<MetaItemSortState>({
    column: "purchaseRate",
    order: "desc",
  });
  const [craftableKeys, setCraftableKeys] = useState<ReadonlySet<string> | null>(
    null
  );
  const [craftableError, setCraftableError] = useState<string | null>(null);

  const matchIds = useMemo(
    () =>
      [...new Set(replays.map((r) => Number(r.match_id)).filter((id) => id > 0))],
    [replays]
  );

  const itemsByInternalKey = useMemo(() => {
    const m = new Map<
      string,
      { nameEn: string; nameCn: string; key: string }
    >();
    for (const e of Object.values(maps.items)) {
      if (e?.key) m.set(normalizeMetaItemKey(e.key), e);
    }
    return m;
  }, [maps]);

  useEffect(() => {
    if (precomputedItemAgg) {
      setCraftableKeys(new Set());
      setCraftableError(null);
      return;
    }
    let cancelled = false;
    void loadCraftableItemKeySet()
      .then((set) => {
        if (!cancelled) {
          setCraftableKeys(set);
          setCraftableError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCraftableKeys(new Set());
          setCraftableError(e instanceof Error ? e.message : "合成装名单加载失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [precomputedItemAgg]);

  const slimRecordForAgg = useMemo((): Record<number, SlimMatchJson | null> => {
    const out: Record<number, SlimMatchJson | null> = {};
    for (const id of matchIds) {
      const v = slimByMatchId[id];
      out[id] = v === undefined || v === null ? null : v;
    }
    return out;
  }, [matchIds, slimByMatchId]);

  const matchIdsKey = matchIds.join(",");

  const aggPack = useMemo(() => {
    if (precomputedItemAgg) {
      return {
        matchesAnalyzed: precomputedItemAgg.matchesAnalyzed,
        totalHeroPlayerSlots: precomputedItemAgg.totalHeroPlayerSlots,
        rows: precomputedItemAgg.rows,
      };
    }
    if (!craftableKeys || matchIds.length === 0) return null;
    return aggregateMetaGlobalItemStats(replays, slimRecordForAgg, craftableKeys);
  }, [
    craftableKeys,
    matchIdsKey,
    precomputedItemAgg,
    replays,
    slimRecordForAgg,
  ]);

  const rows = aggPack?.rows ?? [];
  const matchesAnalyzed = aggPack?.matchesAnalyzed ?? 0;
  const loading = precomputedItemAgg
    ? false
    : craftableKeys === null || slimLoading;
  const error = precomputedItemAgg ? null : craftableError;

  const sortedRows = useMemo(() => {
    if (rows.length === 0) return rows;
    const copy = [...rows];
    copy.sort((a, b) =>
      compareMetaItemRows(a, b, itemSort.column, itemSort.order)
    );
    return copy;
  }, [rows, itemSort.column, itemSort.order]);

  const totalListed = precomputedItemAgg?.totalListed ?? replays.length;

  const thBtn =
    "rounded px-1 py-0.5 font-semibold transition hover:bg-skin-inset/80";
  const thActive = "text-amber-700 dark:text-amber-300";
  const thIdle = "text-skin-sub";

  const setSortColumn = (col: MetaItemSortColumn) => {
    setItemSort((prev) => {
      if (prev.column === col) {
        return { column: col, order: prev.order === "desc" ? "asc" : "desc" };
      }
      return { column: col, order: "desc" };
    });
  };

  return (
    <section className="mt-6 rounded-lg border border-skin-line bg-skin-card p-3">
      <p className="mb-1 text-sm font-semibold text-skin-ink">全局装备购买</p>
      {loading ? (
        <p className="text-sm text-skin-sub">
          正在加载合成装名单与各局购买流水…
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">{error}</p>
      ) : null}
      {!loading && !error && matchesAnalyzed === 0 && totalListed > 0 ? (
        <p className="text-sm text-skin-sub">
          暂无可用 slim 录像（本地或云库），无法汇总购买。
        </p>
      ) : null}
      {!loading && !error && rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-skin-line bg-skin-inset/30">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-skin-line bg-skin-card/50 text-xs">
                  <th className="min-w-0 px-2 py-2.5 pl-3 font-semibold text-skin-sub">
                    装备
                  </th>
                  <th className="min-w-0 px-2 py-2.5 text-center">
                    <button
                      type="button"
                      title={
                        itemSort.column === "purchaseRate"
                          ? itemSort.order === "desc"
                            ? "当前从高到低；点击改为从低到高"
                            : "当前从低到高；点击改为从高到低"
                          : "点击按英雄购买率从高到低排序"
                      }
                      className={`${thBtn} w-full text-center ${itemSort.column === "purchaseRate" ? thActive : thIdle}`}
                      onClick={() => setSortColumn("purchaseRate")}
                    >
                      英雄购买率
                      {itemSort.column === "purchaseRate"
                        ? itemSort.order === "desc"
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </button>
                  </th>
                  <th className="min-w-0 px-2 py-2.5 text-center">
                    <button
                      type="button"
                      title={
                        itemSort.column === "purchaseRateAfter45"
                          ? itemSort.order === "desc"
                            ? "当前从高到低；点击改为从低到高"
                            : "当前从低到高；点击改为从高到低"
                          : "点击按45分后购买率从高到低排序"
                      }
                      className={`${thBtn} w-full text-center ${itemSort.column === "purchaseRateAfter45" ? thActive : thIdle}`}
                      onClick={() => setSortColumn("purchaseRateAfter45")}
                    >
                      45分后购买率
                      {itemSort.column === "purchaseRateAfter45"
                        ? itemSort.order === "desc"
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </button>
                  </th>
                  <th className="min-w-0 px-2 py-2.5 text-center">
                    <button
                      type="button"
                      title={
                        itemSort.column === "averageTime"
                          ? itemSort.order === "desc"
                            ? "当前平均时间从高到低；点击改为从低到高"
                            : "当前从低到高；点击改为从高到低"
                          : "点击按平均购买时间从高到低排序"
                      }
                      className={`${thBtn} w-full text-center ${itemSort.column === "averageTime" ? thActive : thIdle}`}
                      onClick={() => setSortColumn("averageTime")}
                    >
                      平均购买时间
                      {itemSort.column === "averageTime"
                        ? itemSort.order === "desc"
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </button>
                  </th>
                  <th className="min-w-0 px-2 py-2.5 text-center">
                    <button
                      type="button"
                      title={
                        itemSort.column === "winRate"
                          ? itemSort.order === "desc"
                            ? "当前从高到低；点击改为从低到高"
                            : "当前从低到高；点击改为从高到低"
                          : "点击按胜率从高到低排序"
                      }
                      className={`${thBtn} w-full text-center ${itemSort.column === "winRate" ? thActive : thIdle}`}
                      onClick={() => setSortColumn("winRate")}
                    >
                      胜率
                      {itemSort.column === "winRate"
                        ? itemSort.order === "desc"
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const mapEntry = itemsByInternalKey.get(
                    normalizeMetaItemKey(row.itemKey)
                  );
                  const label =
                    mapEntry?.nameCn ||
                    mapEntry?.nameEn ||
                    row.itemKey;
                  const iconKey = normalizeMetaItemKey(row.itemKey);
                  const pctLabel = `${row.purchaseRatePct.toFixed(1)}%`;
                  const pctAfter45Label = `${row.purchaseRateAfter45Pct.toFixed(1)}%`;
                  const timeLabel =
                    row.averagePurchaseSec != null
                      ? formatGameClockMmSs(Math.round(row.averagePurchaseSec))
                      : "—";
                  const wr =
                    row.winRatePct != null
                      ? `${row.winRatePct.toFixed(1)}%`
                      : "—";
                  return (
                    <tr
                      key={row.itemKey}
                      className="border-b border-skin-line/70 last:border-0 hover:bg-skin-inset/50"
                    >
                      <td className="min-w-0 px-2 py-2 align-middle">
                        <Link
                          to={`/item/${encodeURIComponent(row.itemKey)}`}
                          className="flex min-w-0 items-center gap-2 rounded-md outline-none transition hover:bg-skin-inset/50 focus-visible:ring-2 focus-visible:ring-amber-500/60"
                        >
                          <img
                            src={itemIconUrl(iconKey)}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded border border-skin-line bg-black/20 object-contain"
                            {...steamCdnImgDefer}
                            onError={onDotaSteamAssetImgError}
                          />
                          <span className="min-w-0 truncate font-medium text-skin-ink">
                            {label}
                          </span>
                        </Link>
                      </td>
                      <td className="min-w-0 px-2 py-2 text-center align-middle tabular-nums text-zinc-800 dark:text-white">
                        {pctLabel}
                      </td>
                      <td className="min-w-0 px-2 py-2 text-center align-middle tabular-nums text-zinc-800 dark:text-white">
                        {pctAfter45Label}
                      </td>
                      <td className="min-w-0 px-2 py-2 text-center align-middle tabular-nums text-skin-ink">
                        {timeLabel}
                      </td>
                      <td
                        className={`min-w-0 px-2 py-2 text-center align-middle tabular-nums font-semibold ${row.winRatePct != null ? winRateTextClass(row.winRatePct) : "text-skin-sub"}`}
                      >
                        {wr}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
