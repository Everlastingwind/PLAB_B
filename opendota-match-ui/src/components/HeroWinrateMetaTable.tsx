import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MouseEvent as ReactMouseEvent } from "react";
import { heroIconUrl, onDotaSteamAssetImgError, steamCdnImgDefer } from "../data/mockMatchPlayers";
import {
  gamesCountTextClass,
  metaEmphasisTextSizeClass,
  metaWinRateAfterGamesClass,
  winRateTextClass,
} from "../lib/winRateTextClass";
const ROLE_ORDER = [
  "carry",
  "mid",
  "offlane",
  "support(4)",
  "support(5)",
] as const;

/** 表头展示名（与排序 key 对应） */
const ROLE_HEADER_LABEL: Record<(typeof ROLE_ORDER)[number], string> = {
  carry: "carry",
  mid: "mid",
  offlane: "offlane",
  "support(4)": "pos4",
  "support(5)": "pos5",
};

/** 总胜率 / 总场次：可升序、降序 */
export type HeroWinrateMetaGlobalColumnSort =
  | { type: "winRate"; order: "desc" | "asc" }
  | { type: "games"; order: "desc" | "asc" };

/** 分路列：在「该路胜率」与「该路场次」间切换（均为降序） */
export type HeroWinrateMetaRoleColumnSort = {
  role: (typeof ROLE_ORDER)[number];
  by: "winRate" | "games";
};

export type HeroWinrateMetaSortMode =
  | HeroWinrateMetaGlobalColumnSort
  | HeroWinrateMetaRoleColumnSort;

export function isHeroMetaRoleColumnSort(
  m: HeroWinrateMetaSortMode
): m is HeroWinrateMetaRoleColumnSort {
  return typeof m === "object" && m !== null && "role" in m && "by" in m;
}

export function isHeroMetaGlobalWinRateSort(
  m: HeroWinrateMetaSortMode
): m is { type: "winRate"; order: "desc" | "asc" } {
  return (
    typeof m === "object" &&
    m !== null &&
    "type" in m &&
    m.type === "winRate"
  );
}

export function isHeroMetaGlobalGamesSort(
  m: HeroWinrateMetaSortMode
): m is { type: "games"; order: "desc" | "asc" } {
  return (
    typeof m === "object" &&
    m !== null &&
    "type" in m &&
    m.type === "games"
  );
}

export type HeroWinrateMetaRow = {
  heroId: number;
  heroKey: string;
  name: string;
  winRate: number;
  /** 去重后的有效场次（与累计序列长度一致） */
  games: number;
  /** 按时间顺序每场之后的累计胜率（%）；首点可为上一版本末期基线 */
  cumulativeWinRateSeries: number[];
  cumulativeSeriesIsBaseline?: boolean[];
  roleWinRate: Partial<
    Record<(typeof ROLE_ORDER)[number], { games: number; winRate: number }>
  >;
};

/** 英雄页 `?role=` 可读别名 */
function roleSearchParam(rk: (typeof ROLE_ORDER)[number]): string {
  if (rk === "support(4)") return "pos4";
  if (rk === "support(5)") return "pos5";
  return rk;
}

type SparkTipMeta =
  | { kind: "baseline"; rate: number }
  | { kind: "game"; rate: number; gameIndex: number };

type SeriesGeo = {
  lineD: string;
  areaD: string;
  w: number;
  h: number;
  pts: [number, number][];
  meta: SparkTipMeta[];
};

function sparklineGeometryFromSeries(
  series: readonly number[],
  baselineFlags?: readonly boolean[]
): SeriesGeo | null {
  const W = 100;
  const H = 36;
  const n = series.length;
  if (n === 0) return null;
  const rates = [...series];
  const minR = Math.min(...rates) - 2;
  const maxR = Math.max(...rates) + 2;
  const span = Math.max(maxR - minR, 1e-6);
  let patchGameIdx = 0;
  const meta: SparkTipMeta[] = rates.map((rate, i) => {
    if (baselineFlags?.[i]) {
      return { kind: "baseline" as const, rate };
    }
    patchGameIdx += 1;
    return {
      kind: "game" as const,
      rate,
      gameIndex: patchGameIdx,
    };
  });
  const pts: [number, number][] = rates.map((r, i) => {
    const x = n <= 1 ? W / 2 : (i / (n - 1)) * W;
    const y = H - ((r - minR) / span) * (H - 4) - 2;
    return [x, y];
  });
  const lineD = pts
    .map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`))
    .join(" ");
  const last = pts[pts.length - 1];
  const first = pts[0];
  const areaD = `${lineD} L ${last[0]} ${H} L ${first[0]} ${H} Z`;
  return { lineD, areaD, w: W, h: H, pts, meta };
}

function WinRateSparklineHover(props: {
  series: readonly number[];
  cumulativeSeriesIsBaseline?: readonly boolean[];
  baselineTooltipTitle: string;
}) {
  const { series, cumulativeSeriesIsBaseline, baselineTooltipTitle } = props;
  const geo = useMemo(
    () => sparklineGeometryFromSeries(series, cumulativeSeriesIsBaseline),
    [series, cumulativeSeriesIsBaseline]
  );
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tipFixed, setTipFixed] = useState({ x: 0, y: 0 });

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!geo) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / Math.max(rect.width, 1);
    const svgX = rx * geo.w;
    let best = 0;
    let bestD = Infinity;
    geo.pts.forEach((p, i) => {
      const d = Math.abs(p[0] - svgX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHoverIdx(best);
    setTipFixed({ x: e.clientX, y: e.clientY });
  };

  const onLeave = () => setHoverIdx(null);

  const hi =
    geo && hoverIdx != null ? geo.meta[hoverIdx] : null;
  const showAllDots = geo ? geo.pts.length <= 56 : false;

  if (!geo) {
    return (
      <span className="text-xs text-skin-sub" aria-hidden>
        —
      </span>
    );
  }

  return (
    <div className="relative inline-flex">
      <svg
        width={geo.w}
        height={geo.h}
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        className="shrink-0 cursor-crosshair overflow-visible opacity-90"
        aria-hidden
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <path
          d={geo.areaD}
          className="fill-amber-500/15 dark:fill-amber-400/12"
          stroke="none"
        />
        <path
          d={geo.lineD}
          fill="none"
          className="stroke-amber-600/80 dark:stroke-amber-400/85"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {showAllDots
          ? geo.pts.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={hoverIdx === i ? 3.5 : 2.25}
                className={
                  hoverIdx === i
                    ? "fill-amber-600 stroke-white dark:fill-amber-400 dark:stroke-zinc-900"
                    : "fill-amber-600/50 stroke-amber-900/20 dark:fill-amber-400/45 dark:stroke-amber-100/25"
                }
                strokeWidth={1}
              />
            ))
          : hoverIdx != null && geo.pts[hoverIdx] ? (
              <circle
                cx={geo.pts[hoverIdx][0]}
                cy={geo.pts[hoverIdx][1]}
                r={3.5}
                className="fill-amber-600 stroke-white dark:fill-amber-400 dark:stroke-zinc-900"
                strokeWidth={1}
              />
            ) : null}
      </svg>
      {hi && hoverIdx != null ? (
        <div
          className="pointer-events-none fixed z-[200] min-w-[9rem] rounded-md border border-skin-line bg-skin-card px-2 py-1.5 text-[11px] leading-snug shadow-md"
          style={{
            left: tipFixed.x,
            top: tipFixed.y,
            transform: "translate(-50%, calc(-100% - 8px))",
          }}
        >
          {hi.kind === "baseline" ? (
            <p className="font-semibold text-skin-ink">
              {baselineTooltipTitle}
            </p>
          ) : (
            <p className="font-semibold text-skin-ink">
              第 <span className="tabular-nums">{hi.gameIndex}</span> 场后
            </p>
          )}
          <p className="mt-0.5 text-skin-sub">
            累计胜率{" "}
            <span
              className={`tabular-nums font-semibold ${winRateTextClass(hi.rate)}`}
            >
              {hi.rate.toFixed(1)}%
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  rows: readonly HeroWinrateMetaRow[];
  sortMode: HeroWinrateMetaSortMode;
  onSortByWinRate: () => void;
  onSortByGames: () => void;
  onSortByRole: (rk: (typeof ROLE_ORDER)[number]) => void;
  /** 上一版本封盘锚点 Tooltip（含补丁号） */
  baselineTooltipTitle: string;
};

export function HeroWinrateMetaTable(props: Props) {
  const {
    rows,
    sortMode,
    onSortByWinRate,
    onSortByGames,
    onSortByRole,
    baselineTooltipTitle,
  } = props;
  if (rows.length === 0) return null;

  const thBtn =
    "rounded px-1 py-0.5 text-left font-semibold transition hover:bg-skin-inset/80";
  const thActive = "text-amber-700 dark:text-amber-300";
  const thIdle = "text-skin-sub";

  return (
    <div className="overflow-x-auto rounded-lg border border-skin-line bg-skin-inset/30">
      <table className="w-full min-w-[900px] table-fixed border-collapse text-left text-sm">
        <colgroup>
          <col className="w-[13%]" />
          <col className="w-[15%]" />
          <col className="w-[8%]" />
          <col className="w-[12.8%]" />
          <col className="w-[12.8%]" />
          <col className="w-[12.8%]" />
          <col className="w-[12.8%]" />
          <col className="w-[12.8%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-skin-line bg-skin-card/50 text-xs">
            <th className="min-w-0 px-2 py-2.5 pl-3 font-semibold text-skin-sub">
              英雄
            </th>
            <th className="min-w-0 px-2 py-2.5">
              <button
                type="button"
                title={
                  isHeroMetaGlobalWinRateSort(sortMode)
                    ? sortMode.order === "desc"
                      ? "当前总胜率从高到低；再点从低到高"
                      : "当前总胜率从低到高；再点从高到低"
                    : "点击总胜率从高到低；再点从低到高"
                }
                className={`${thBtn} ${isHeroMetaGlobalWinRateSort(sortMode) ? thActive : thIdle}`}
                onClick={onSortByWinRate}
              >
                胜率
                {isHeroMetaGlobalWinRateSort(sortMode)
                  ? sortMode.order === "desc"
                    ? " ↓"
                    : " ↑"
                  : ""}
              </button>
            </th>
            <th className="min-w-0 px-2 py-2.5 text-center tabular-nums">
              <button
                type="button"
                title={
                  isHeroMetaGlobalGamesSort(sortMode)
                    ? sortMode.order === "desc"
                      ? "当前总场次从高到低；再点从低到高"
                      : "当前总场次从低到高；再点从高到低"
                    : "点击总场次从高到低；再点从低到高"
                }
                className={`${thBtn} ${isHeroMetaGlobalGamesSort(sortMode) ? thActive : thIdle}`}
                onClick={onSortByGames}
              >
                场次
                {isHeroMetaGlobalGamesSort(sortMode)
                  ? sortMode.order === "desc"
                    ? " ↓"
                    : " ↑"
                  : ""}
              </button>
            </th>
            {ROLE_ORDER.map((rk) => {
              const roleActive =
                isHeroMetaRoleColumnSort(sortMode) && sortMode.role === rk;
              const roleTitle = roleActive
                ? sortMode.by === "games"
                  ? "当前按该分路场次降序；再点按该分路胜率"
                  : "当前按该分路胜率降序；再点按该分路场次"
                : "点击按该分路胜率降序；再点按该分路场次";
              return (
                <th key={rk} className="min-w-0 px-2 py-2.5 text-center">
                  <button
                    type="button"
                    title={roleTitle}
                    className={`${thBtn} w-full text-center ${roleActive ? thActive : thIdle}`}
                    onClick={() => onSortByRole(rk)}
                  >
                    {ROLE_HEADER_LABEL[rk]}
                    {roleActive ? " ↓" : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.heroId}
              className="border-b border-skin-line/70 last:border-0 hover:bg-skin-inset/50"
            >
              <td className="min-w-0 px-2 py-2 align-middle">
                <Link
                  to={`/hero/${encodeURIComponent(row.heroKey)}`}
                  className="group flex min-w-0 items-center gap-2"
                >
                  <img
                    src={heroIconUrl(row.heroKey)}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-md border border-skin-line object-cover"
                    {...steamCdnImgDefer}
                    onError={onDotaSteamAssetImgError}
                  />
                  <span
                    className={`min-w-0 truncate font-semibold ${metaEmphasisTextSizeClass} text-skin-ink group-hover:text-amber-600 group-hover:underline dark:group-hover:text-amber-300`}
                  >
                    {row.name}
                  </span>
                </Link>
              </td>
              <td className="min-w-0 px-2 py-2 align-middle">
                <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${winRateTextClass(row.winRate)}`}
                  >
                    {row.winRate.toFixed(1)}%
                  </span>
                  <span className="min-w-0 shrink">
                    <WinRateSparklineHover
                      series={row.cumulativeWinRateSeries}
                      cumulativeSeriesIsBaseline={row.cumulativeSeriesIsBaseline}
                      baselineTooltipTitle={baselineTooltipTitle}
                    />
                  </span>
                </div>
              </td>
              <td
                className={`min-w-0 px-2 py-2 text-center align-middle ${gamesCountTextClass}`}
              >
                {row.games}
              </td>
              {ROLE_ORDER.map((rk) => {
                const s = row.roleWinRate[rk];
                const href = `/hero/${encodeURIComponent(row.heroKey)}?role=${encodeURIComponent(roleSearchParam(rk))}`;
                return (
                  <td
                    key={rk}
                    className="min-w-0 px-2 py-2 align-middle text-center text-[11px]"
                  >
                    {s && s.games > 0 ? (
                      <Link
                        to={href}
                        className="block whitespace-nowrap rounded-md border border-transparent px-1 py-1.5 text-center tabular-nums transition hover:border-skin-line hover:bg-skin-inset/70"
                      >
                        <span className={gamesCountTextClass}>{s.games}场</span>
                        <span
                          className={metaWinRateAfterGamesClass(s.winRate)}
                        >
                          （{s.winRate.toFixed(0)}%）
                        </span>
                      </Link>
                    ) : (
                      <span className="text-skin-sub">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
