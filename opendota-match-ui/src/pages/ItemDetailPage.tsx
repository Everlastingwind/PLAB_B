import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import type { FeedSelection } from "../components/FeedModeToggle";
import { fetchReplaysForFeedSelection } from "../lib/replaysApi";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";
import { SEOMeta } from "../components/SEOMeta";
import { loadSlimMatchJsonForDetails } from "../lib/loadSlimMatchJson";
import type { SlimMatchJson } from "../types/slimMatch";
import {
  computeItemDetailModel,
  ITEM_DETAIL_ROLE_ORDER,
  sampleReplaysForItemDetail,
  type ItemDetailHeroRow,
  type ItemDetailModel,
  type ItemDetailRoleKey,
} from "../lib/itemDetailStats";
import {
  formatGameClockMmSs,
  normalizeMetaItemKey,
} from "../lib/metaGlobalItemStats";
import {
  heroIconUrl,
  itemIconUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
} from "../data/mockMatchPlayers";
import { winRateTextClass } from "../lib/winRateTextClass";
import { cn } from "../lib/cn";

const DEFAULT_FEED: FeedSelection = { pub: true, pro: true };

type HeroSortCol = "lift" | "avgTime" | "after45" | "games";

type HeroSortState = { col: HeroSortCol; order: "desc" | "asc" } | null;

function cycleSort(prev: HeroSortState, col: Exclude<HeroSortCol, "games">): HeroSortState {
  if (prev?.col !== col) return { col, order: "desc" };
  if (prev.order === "desc") return { col, order: "asc" };
  return null;
}

/** 场次：仅在「多到少」↔「少到多」之间切换（默认视为多到少，首次点击为少到多） */
function cycleGamesSort(prev: HeroSortState): HeroSortState {
  if (prev?.col === "games") {
    return { col: "games", order: prev.order === "desc" ? "asc" : "desc" };
  }
  if (prev == null) return { col: "games", order: "asc" };
  return { col: "games", order: "desc" };
}

function sortLabelForState(s: HeroSortState, col: HeroSortCol): string {
  if (!s || s.col !== col) return "";
  return s.order === "desc" ? " ↓" : " ↑";
}

function compareNullable(
  a: number | null,
  b: number | null,
  order: "desc" | "asc"
): number {
  const dir = order === "desc" ? -1 : 1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

function sortHeroRows(
  rows: ItemDetailHeroRow[],
  sort: HeroSortState
): ItemDetailHeroRow[] {
  const copy = [...rows];
  if (!sort) {
    copy.sort((a, b) => b.gamesWithItem - a.gamesWithItem);
    return copy;
  }
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sort.col) {
      case "games":
        cmp =
          sort.order === "desc"
            ? b.gamesWithItem - a.gamesWithItem
            : a.gamesWithItem - b.gamesWithItem;
        break;
      case "lift":
        cmp = compareNullable(a.liftPct, b.liftPct, sort.order);
        break;
      case "avgTime":
        cmp = compareNullable(a.avgPurchaseSec, b.avgPurchaseSec, sort.order);
        break;
      case "after45":
        cmp = compareNullable(
          a.purchaseRateAfter45Pct,
          b.purchaseRateAfter45Pct,
          sort.order
        );
        break;
      default:
        break;
    }
    if (cmp !== 0) return cmp;
    return b.gamesWithItem - a.gamesWithItem;
  });
  return copy;
}

const TOP_PICKED_OPTIONS = [5, 10, 20, 40, 80] as const;

/** HeroMatchesPage `role` 查询参数（与 HeroMatchesPage 内解析一致） */
function heroMatchesRoleQuery(rk: ItemDetailRoleKey): string {
  if (rk === "support(4)") return "pos4";
  if (rk === "support(5)") return "pos5";
  return rk;
}

export function ItemDetailPage() {
  const rawParam = useParams<{ itemKey: string }>().itemKey ?? "";
  const itemKey = decodeURIComponent(rawParam);
  const normKey = normalizeMetaItemKey(itemKey);

  const { maps, loading: mapsLoading } = useEntityMaps();
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [slimByMatchId, setSlimByMatchId] = useState<
    Readonly<Record<number, SlimMatchJson | null>>
  >({});
  const [idxErr, setIdxErr] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [slimLoading, setSlimLoading] = useState(false);
  const [topPicked, setTopPicked] = useState<number>(20);
  const [sortByRole, setSortByRole] = useState<
    Record<ItemDetailRoleKey, HeroSortState>
  >(() => ({
    carry: null,
    mid: null,
    offlane: null,
    "support(4)": null,
    "support(5)": null,
  }));
  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    setIdxErr(null);
    void fetchReplaysForFeedSelection(DEFAULT_FEED)
      .then(({ replays: rows, cloudIndexError }) => {
        if (cancelled) return;
        if (cloudIndexError) console.warn(cloudIndexError);
        setReplays(rows);
        setFeedLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setFeedLoading(false);
          setReplays([]);
          setIdxErr(e instanceof Error ? e.message : "索引加载失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const replaysForStats = useMemo(
    () => sampleReplaysForItemDetail(replays),
    [replays]
  );

  const matchIds = useMemo(
    () =>
      [
        ...new Set(
          replaysForStats.map((r) => Number(r.match_id)).filter((id) => id > 0)
        ),
      ],
    [replaysForStats]
  );

  useEffect(() => {
    if (matchIds.length === 0) {
      setSlimByMatchId({});
      setSlimLoading(false);
      return;
    }
    let cancelled = false;
    setSlimLoading(true);
    void loadSlimMatchJsonForDetails(matchIds, { preferCloud: true }).then(
      (m) => {
        if (!cancelled) {
          setSlimByMatchId(m);
          setSlimLoading(false);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [matchIds]);

  const model: ItemDetailModel | null = useMemo(() => {
    if (!normKey || replaysForStats.length === 0) return null;
    return computeItemDetailModel(normKey, replaysForStats, slimByMatchId);
  }, [normKey, replaysForStats, slimByMatchId]);

  const itemsByInternalKey = useMemo(() => {
    const m = new Map<
      string,
      { nameEn: string; nameCn: string; key: string }
    >();
    if (!maps) return m;
    for (const e of Object.values(maps.items)) {
      if (e?.key) m.set(normalizeMetaItemKey(e.key), e);
    }
    return m;
  }, [maps]);

  const itemLabel =
    itemsByInternalKey.get(normKey)?.nameCn ||
    itemsByInternalKey.get(normKey)?.nameEn ||
    normKey ||
    itemKey;

  const heroLabel = useCallback(
    (heroId: number) => {
      const h = maps?.heroes[String(heroId)];
      return h?.nameCn || h?.nameEn || `#${heroId}`;
    },
    [maps]
  );

  const heroKeyForId = useCallback(
    (heroId: number) => maps?.heroes[String(heroId)]?.key ?? "unknown",
    [maps]
  );

  const loading =
    mapsLoading || feedLoading || (matchIds.length > 0 && slimLoading);

  const badge = "rounded-md border border-skin-line bg-skin-inset/60 px-2 py-0.5 text-xs tabular-nums";

  return (
    <>
      <SEOMeta title={`${itemLabel} · 装备统计`} />
      <PageShell>
        <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4">
          {!normKey ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">无效的装备路径。</p>
          ) : null}

          {idxErr ? (
            <p className="mb-2 text-sm text-amber-600 dark:text-amber-400">{idxErr}</p>
          ) : null}

          {loading ? (
            <p className="text-sm text-skin-sub">加载中</p>
          ) : null}

          {!loading && model && maps ? (
            <>
              <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                <div className="flex min-w-0 items-center gap-4">
                  <img
                    src={itemIconUrl(normKey)}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-lg border border-skin-line bg-black/30 object-contain sm:h-20 sm:w-20"
                    {...steamCdnImgDefer}
                    onError={onDotaSteamAssetImgError}
                  />
                  <div className="min-w-0">
                    <h1 className="truncate text-xl font-bold tracking-tight text-skin-ink sm:text-2xl">
                      {itemLabel}
                    </h1>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={badge}>
                    <span className="text-skin-sub">PR </span>
                    <span className="font-semibold text-skin-ink">
                      {model.purchaseRatePct.toFixed(1)}%
                    </span>
                  </span>
                  <span className={badge}>
                    <span className="text-skin-sub">WR </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        model.wrFirstBuyerPct != null
                          ? winRateTextClass(model.wrFirstBuyerPct)
                          : "text-skin-sub"
                      )}
                    >
                      {model.wrFirstBuyerPct != null
                        ? `${model.wrFirstBuyerPct.toFixed(1)}%`
                        : "—"}
                    </span>
                  </span>
                  <span className={badge}>
                    <span className="text-skin-sub">LIFT </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        model.liftVs50Pct != null
                          ? model.liftVs50Pct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                          : "text-skin-sub"
                      )}
                    >
                      {model.liftVs50Pct != null
                        ? `${model.liftVs50Pct >= 0 ? "+" : ""}${model.liftVs50Pct.toFixed(1)}%`
                        : "—"}
                    </span>
                  </span>
                </div>
              </header>

              <section className="mb-8 grid gap-3 sm:grid-cols-3">
                <InsightCard title="最常出（样本内）">
                  {model.mostPicked.map((r) => (
                    <HeroInsightRow
                      key={r.heroId}
                      heroId={r.heroId}
                      heroLabel={heroLabel(r.heroId)}
                      heroKey={heroKeyForId(r.heroId)}
                      right={`${r.gamesWithItem} 场`}
                      subRight={
                        r.liftPct != null
                          ? `${r.liftPct >= 0 ? "+" : ""}${r.liftPct.toFixed(1)}%`
                          : "—"
                      }
                      subClass={
                        r.liftPct != null
                          ? r.liftPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                          : "text-skin-sub"
                      }
                    />
                  ))}
                </InsightCard>
                <InsightCard title="Best On（Lift，≥10 场）">
                  {model.bestLift.map((r) => (
                    <HeroInsightRow
                      key={r.heroId}
                      heroId={r.heroId}
                      heroLabel={heroLabel(r.heroId)}
                      heroKey={heroKeyForId(r.heroId)}
                      right={
                        r.liftPct != null
                          ? `${r.liftPct >= 0 ? "+" : ""}${r.liftPct.toFixed(1)}%`
                          : "—"
                      }
                      subRight={`${r.gamesWithItem} 场`}
                      rightClass={
                        r.liftPct != null
                          ? r.liftPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                          : "text-skin-sub"
                      }
                    />
                  ))}
                </InsightCard>
                <InsightCard title="Worst On（Lift，≥10 场）">
                  {model.worstLift.map((r) => (
                    <HeroInsightRow
                      key={r.heroId}
                      heroId={r.heroId}
                      heroLabel={heroLabel(r.heroId)}
                      heroKey={heroKeyForId(r.heroId)}
                      right={
                        r.liftPct != null
                          ? `${r.liftPct >= 0 ? "+" : ""}${r.liftPct.toFixed(1)}%`
                          : "—"
                      }
                      subRight={`${r.gamesWithItem} 场`}
                      rightClass={
                        r.liftPct != null
                          ? r.liftPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                          : "text-skin-sub"
                      }
                    />
                  ))}
                </InsightCard>
              </section>

              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-sm font-semibold text-skin-ink">分路统计</h2>
                <label className="flex items-center gap-2 text-xs text-skin-sub">
                  <span>列表长度</span>
                  <select
                    value={topPicked}
                    onChange={(e) => setTopPicked(Number(e.target.value))}
                    className="rounded-md border border-skin-line bg-skin-card px-2 py-1 text-skin-ink"
                  >
                    {TOP_PICKED_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        Top {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
                {ITEM_DETAIL_ROLE_ORDER.map((rk) => {
                  const block = model.roles.find((b) => b.role === rk);
                  if (!block) return null;
                  const sorted = sortHeroRows(block.heroes, sortByRole[rk]);
                  const shown = sorted.slice(0, topPicked);
                  const sort = sortByRole[rk];
                  const thBtn =
                    "w-full rounded px-1 py-0.5 text-left text-xs font-semibold transition hover:bg-skin-inset/80";
                  const thActive = "text-amber-700 dark:text-amber-300";
                  const thIdle = "text-skin-sub";

                  return (
                    <article
                      key={rk}
                      className="flex min-h-0 min-w-0 flex-col rounded-lg border border-skin-line bg-skin-card p-2.5"
                    >
                      <div className="mb-2 border-b border-skin-line pb-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-skin-sub">
                          {block.label}
                        </p>
                        <div className="mt-2 space-y-1 text-xs tabular-nums">
                          <div className="flex justify-between gap-2">
                            <span className="text-skin-sub">WR</span>
                            <span
                              className={cn(
                                "font-semibold",
                                block.wrWithItemPct != null
                                  ? winRateTextClass(block.wrWithItemPct)
                                  : "text-skin-sub"
                              )}
                            >
                              {block.wrWithItemPct != null
                                ? `${block.wrWithItemPct.toFixed(1)}%`
                                : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-skin-sub">Pick</span>
                            <span className="font-medium text-skin-ink">
                              {block.pickRatePct.toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <div className="flex justify-between gap-2">
                              <span className="text-skin-sub">Role share</span>
                              <span className="font-medium text-skin-ink">
                                {block.roleSharePct.toFixed(1)}%
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-skin-inset">
                              <div
                                className="h-full rounded-full bg-emerald-600/80 dark:bg-emerald-500/70"
                                style={{
                                  width: `${Math.min(100, block.roleSharePct)}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-x-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-skin-line text-skin-sub">
                              <th className="py-1.5 pr-1 pl-0.5 font-semibold">英雄</th>
                              <th className="py-1.5 pr-1 text-right">
                                <button
                                  type="button"
                                  title="场次：多到少 ↔ 少到多"
                                  className={cn(
                                    thBtn,
                                    sort?.col === "games" ? thActive : thIdle,
                                    "font-semibold"
                                  )}
                                  onClick={() =>
                                    setSortByRole((prev) => ({
                                      ...prev,
                                      [rk]: cycleGamesSort(prev[rk]),
                                    }))
                                  }
                                >
                                  场次
                                  {sortLabelForState(sort, "games")}
                                </button>
                              </th>
                              <th className="py-1.5 text-right">
                                <button
                                  type="button"
                                  title="Lift：点按 降序 → 升序 → 默认"
                                  className={cn(
                                    thBtn,
                                    sort?.col === "lift" ? thActive : thIdle
                                  )}
                                  onClick={() =>
                                    setSortByRole((prev) => ({
                                      ...prev,
                                      [rk]: cycleSort(prev[rk], "lift"),
                                    }))
                                  }
                                >
                                  Lift
                                  {sortLabelForState(sort, "lift")}
                                </button>
                              </th>
                              <th className="py-1.5 text-right">
                                <button
                                  type="button"
                                  title="平均购买时间（对局内时钟）：点按 降序 → 升序 → 默认"
                                  className={cn(
                                    thBtn,
                                    sort?.col === "avgTime" ? thActive : thIdle
                                  )}
                                  onClick={() =>
                                    setSortByRole((prev) => ({
                                      ...prev,
                                      [rk]: cycleSort(prev[rk], "avgTime"),
                                    }))
                                  }
                                >
                                  Time
                                  {sortLabelForState(sort, "avgTime")}
                                </button>
                              </th>
                              <th className="py-1.5 text-right">
                                <button
                                  type="button"
                                  title="≥45:00 后至少买过 1 次的占比：点按 降序 → 升序 → 默认"
                                  className={cn(
                                    thBtn,
                                    sort?.col === "after45" ? thActive : thIdle
                                  )}
                                  onClick={() =>
                                    setSortByRole((prev) => ({
                                      ...prev,
                                      [rk]: cycleSort(prev[rk], "after45"),
                                    }))
                                  }
                                >
                                  {">45m"}
                                  {sortLabelForState(sort, "after45")}
                                </button>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {shown.map((r) => {
                              const hk = heroKeyForId(r.heroId);
                              const timeLabel =
                                r.avgPurchaseSec != null
                                  ? formatGameClockMmSs(
                                      Math.round(r.avgPurchaseSec)
                                    )
                                  : "—";
                              const after45 =
                                r.purchaseRateAfter45Pct != null
                                  ? `${r.purchaseRateAfter45Pct.toFixed(0)}%`
                                  : "—";
                              return (
                                <tr
                                  key={r.heroId}
                                  className="border-b border-skin-line/60 last:border-0"
                                >
                                  <td className="py-2 pr-1 align-middle">
                                    <Link
                                      to={`/hero/${encodeURIComponent(hk)}`}
                                      className="flex min-w-0 items-center gap-1.5 hover:underline"
                                    >
                                      <img
                                        src={heroIconUrl(hk)}
                                        alt=""
                                        className="h-6 w-6 shrink-0 rounded border border-skin-line/60 object-cover sm:h-7 sm:w-7"
                                        {...steamCdnImgDefer}
                                        onError={onDotaSteamAssetImgError}
                                      />
                                      <span className="min-w-0 truncate text-sm font-medium leading-snug text-skin-ink">
                                        {heroLabel(r.heroId)}
                                      </span>
                                    </Link>
                                  </td>
                                  <td className="py-2 pr-1 text-right align-middle tabular-nums">
                                    <Link
                                      to={`/hero/${encodeURIComponent(hk)}?role=${encodeURIComponent(heroMatchesRoleQuery(rk))}`}
                                      className="text-sm font-semibold text-skin-ink hover:underline"
                                    >
                                      {r.gamesWithItem}
                                    </Link>
                                  </td>
                                  <td
                                    className={cn(
                                      "py-2 text-right tabular-nums text-sm font-semibold",
                                      r.liftPct != null
                                        ? r.liftPct >= 0
                                          ? "text-emerald-600 dark:text-emerald-400"
                                          : "text-red-600 dark:text-red-400"
                                        : "text-skin-sub"
                                    )}
                                  >
                                    {r.liftPct != null
                                      ? `${r.liftPct >= 0 ? "+" : ""}${r.liftPct.toFixed(1)}%`
                                      : "—"}
                                  </td>
                                  <td className="py-2 text-right tabular-nums text-sm text-skin-ink">
                                    {timeLabel}
                                  </td>
                                  <td className="py-2 text-right tabular-nums text-sm text-skin-ink">
                                    {after45}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}

          {!loading && normKey && !model && maps ? (
            <p className="text-sm text-skin-sub">
              当前样本中无法汇总该装备（或暂无解析成功的录像）。
            </p>
          ) : null}
        </main>
      </PageShell>
    </>
  );
}

function InsightCard(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-skin-line bg-skin-card p-3">
      <p className="mb-2 text-xs font-semibold text-skin-ink">{props.title}</p>
      <ul className="space-y-2">{props.children}</ul>
    </div>
  );
}

function HeroInsightRow(props: {
  heroId: number;
  heroLabel: string;
  heroKey: string;
  right: string;
  subRight: string;
  rightClass?: string;
  subClass?: string;
}) {
  const {
    heroKey,
    heroLabel,
    right,
    subRight,
    rightClass = "text-skin-ink font-semibold tabular-nums",
    subClass = "text-skin-sub text-[11px]",
  } = props;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Link
        to={`/hero/${encodeURIComponent(heroKey)}`}
        className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
      >
        <img
          src={heroIconUrl(heroKey)}
          alt=""
          className="h-8 w-8 shrink-0 rounded border border-skin-line object-cover"
          {...steamCdnImgDefer}
          onError={onDotaSteamAssetImgError}
        />
        <span className="min-w-0 truncate font-medium text-skin-ink">
          {heroLabel}
        </span>
      </Link>
      <div className="shrink-0 text-right">
        <div className={rightClass}>{right}</div>
        <div className={subClass}>{subRight}</div>
      </div>
    </li>
  );
}
