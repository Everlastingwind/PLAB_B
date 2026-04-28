import { memo, useMemo, type MouseEvent } from "react";
import {
  heroIconUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
  steamCdnImgHero,
} from "../data/mockMatchPlayers";
import type { EntityMapsPayload } from "../types/entityMaps";
import type { ReplayPlayerSummary, ReplaySummary } from "../types/replaysIndex";
import { replayIndexPlayerDisplayLabel } from "../lib/playerDisplay";
import { heroKeyFromId } from "../lib/replaysApi";
import { cn } from "../lib/cn";
import { persistHomeListScrollBeforeNavigate } from "../lib/documentScroll";
import { compareByPlayerSlot, partitionReplayRowPlayers } from "../lib/matchGrouping";
import { kdaFromPlayerRecord } from "../lib/playerKda";

function sumKills(players: ReplayPlayerSummary[]): number {
  return players.reduce(
    (s, p) => s + kdaFromPlayerRecord(p as unknown as Record<string, unknown>).kills,
    0
  );
}

function HeroCells({
  players,
  maps,
  side,
  heroImgProps,
}: {
  players: ReplayPlayerSummary[];
  maps: EntityMapsPayload;
  side: "radiant" | "dire";
  heroImgProps: typeof steamCdnImgDefer | typeof steamCdnImgHero;
}) {
  const sorted = useMemo(
    () => [...players].sort(compareByPlayerSlot),
    [players]
  );
  return (
    <div className="flex max-sm:min-w-0 max-sm:flex-1 max-sm:justify-evenly flex-nowrap items-center justify-center gap-0 sm:gap-2">
      {sorted.map((p) => {
        const key = heroKeyFromId(p.hero_id, maps);
        const displayLabel = replayIndexPlayerDisplayLabel(
          p.account_id,
          p.pro_name
        );
        const isAnonymous = displayLabel === "匿名玩家";
        return (
          <div
            key={p.player_slot}
            className="flex w-[30px] shrink-0 flex-col items-center gap-0 sm:w-[62px] sm:gap-1 lg:w-[72px]"
          >
            <a
              href={`/hero/${encodeURIComponent(key)}`}
              data-no-match-nav="1"
              className={cn(
                "pointer-events-auto block overflow-hidden rounded-sm p-0",
                "ring-1 ring-slate-200 shadow-sm dark:ring-slate-950/60 dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.55)]",
                "transition-[box-shadow] duration-200",
                side === "radiant"
                  ? "hover:ring-emerald-400/60 dark:hover:ring-emerald-500/35"
                  : "hover:ring-rose-400/60 dark:hover:ring-rose-500/35",
                "dark:hover:shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
              )}
              title="按英雄筛选对局"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClickCapture={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <img
                src={heroIconUrl(key === "unknown" ? "invoker" : key)}
                alt=""
                className="h-6 w-6 rounded-sm object-cover sm:h-9 sm:w-9 lg:h-10 lg:w-10"
                {...heroImgProps}
                onError={onDotaSteamAssetImgError}
              />
            </a>
            <a
              href={`/player/${p.account_id}`}
              data-no-match-nav="1"
              className={cn(
                "pointer-events-auto w-full max-w-full truncate text-center text-[8px] leading-none underline-offset-2 transition-colors sm:whitespace-normal sm:break-all sm:text-[11px] sm:leading-tight",
                isAnonymous
                  ? "text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-400"
                  : cn(
                      "hover:underline",
                      side === "radiant"
                        ? "text-slate-600 hover:text-emerald-800 dark:text-slate-400 dark:hover:text-emerald-300"
                        : "text-slate-600 hover:text-rose-800 dark:text-slate-400 dark:hover:text-rose-300"
                    )
              )}
              title="该选手对局"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClickCapture={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {isAnonymous ? "匿名" : displayLabel}
            </a>
          </div>
        );
      })}
    </div>
  );
}

const ReplayCardImpl = ({
  replay,
  maps,
  eagerHeroPortraits = false,
}: {
  replay: ReplaySummary;
  maps: EntityMapsPayload;
  /** 首屏前几卡：英雄头像 eager + 高 fetchPriority，减轻全 lazy 的长尾 */
  eagerHeroPortraits?: boolean;
}) => {
  const heroImgProps = eagerHeroPortraits ? steamCdnImgHero : steamCdnImgDefer;
  const { radiantPlayers: rad, direPlayers: dire } = useMemo(
    () => partitionReplayRowPlayers(replay.players),
    [replay.players]
  );
  const radWon = replay.radiant_win;

  const radKills = sumKills(rad);
  const direKills = sumKills(dire);
  const rawRs = replay.radiant_score;
  const rawDs = replay.dire_score;
  // 主页索引里偶发写成 0:0（占位）；此时回退到玩家击杀汇总，避免长期显示假比分。
  const hasValidIndexedScore =
    (rawRs !== undefined && rawRs !== null && rawRs > 0) ||
    (rawDs !== undefined && rawDs !== null && rawDs > 0);
  const rs = hasValidIndexedScore ? (rawRs ?? radKills) : radKills;
  const ds = hasValidIndexedScore ? (rawDs ?? direKills) : direKills;

  const matchPath = `/match/${replay.match_id}`;
  const srcTag = replay.source === "pro" ? "PRO" : "PUB";
  const srcCls =
    replay.source === "pro"
      ? "border-sky-300/70 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-300"
      : "border-amber-300/70 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300";

  const handleCopyMatchId = async (
    e: MouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(replay.match_id));
    } catch {
      // ignore clipboard failure
    }
  };
  const jumpToMatch = () => {
    try {
      persistHomeListScrollBeforeNavigate(replay.match_id);
    } catch {
      // ignore session persistence failure
    }
    // 路由中间态异常时用硬跳转兜底，保证一定能进入详情页。
    window.location.assign(matchPath);
  };
  const handleCardClick = (e: MouseEvent<HTMLElement>) => {
    const t = e.target;
    if (t instanceof Element) {
      if (t.closest('[data-no-match-nav="1"]')) return;
      const interactive = t.closest("a,button,input,select,textarea,label");
      if (interactive) return;
    }
    jumpToMatch();
  };

  return (
    <article
      data-home-match-id={String(replay.match_id)}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-skin-line bg-skin-card",
        "transition-colors duration-150 ease-out",
        "hover:border-slate-300 dark:hover:border-slate-600",
        "dark:bg-slate-800/60 dark:hover:bg-slate-700/75",
        "px-1.5 py-2 sm:px-4 sm:py-3.5"
      )}
      role="button"
      tabIndex={0}
      title={`查看比赛 ${replay.match_id}`}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jumpToMatch();
        }
      }}
    >
      <div className="pointer-events-none absolute left-2 top-2 z-20 hidden sm:block">
        <span
          className={cn(
            "rounded border px-2 py-1 font-mono text-xs font-bold leading-none",
            srcCls
          )}
        >
          {srcTag}
        </span>
      </div>
      <div className="pointer-events-auto absolute right-2 top-2 z-20 hidden sm:block">
        <button
          type="button"
          onClick={handleCopyMatchId}
          title="点击复制比赛编号"
          className="rounded border border-slate-300/70 bg-white/90 px-2 py-1 font-mono text-xs leading-none text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {replay.match_id}
        </button>
      </div>
      <div className="relative z-10 flex max-sm:min-h-[3.25rem] flex-nowrap items-stretch gap-0.5 max-sm:px-0 sm:gap-3">
        <div className="flex min-w-0 max-sm:flex-1 max-sm:justify-end sm:flex-1 items-center justify-end sm:justify-center">
          <HeroCells players={rad} maps={maps} side="radiant" heroImgProps={heroImgProps} />
        </div>

        <div
          className={cn(
            "flex w-[3.25rem] shrink-0 flex-col items-center justify-center rounded-md border border-skin-line px-0.5 py-0.5 sm:w-24 sm:rounded-lg sm:px-2 sm:py-2",
            "bg-skin-inset shadow-inner dark:border-transparent dark:bg-slate-950/35 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          )}
        >
          <div className="mb-0.5 text-[9px] font-bold uppercase leading-none tracking-wide sm:mb-1 sm:text-[10px] md:text-[11px]">
            {radWon ? (
              <span className="text-emerald-700 dark:text-emerald-400">天辉 胜</span>
            ) : (
              <span className="text-rose-700 dark:text-rose-400">夜魇 胜</span>
            )}
          </div>
          <div className="flex items-baseline gap-0.5 font-mono text-xs font-bold tabular-nums leading-none sm:text-lg lg:text-xl">
            <span
              className={cn(
                radWon ? "text-emerald-700 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"
              )}
            >
              {rs}
            </span>
            <span className="text-slate-400 dark:text-slate-600" aria-hidden>
              :
            </span>
            <span
              className={cn(
                !radWon ? "text-rose-700 dark:text-rose-400" : "text-slate-400 dark:text-slate-500"
              )}
            >
              {ds}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 max-sm:flex-1 max-sm:justify-start sm:flex-1 items-center justify-start sm:justify-center">
          <HeroCells players={dire} maps={maps} side="dire" heroImgProps={heroImgProps} />
        </div>
      </div>
    </article>
  );
};

export const ReplayCard = memo(ReplayCardImpl);
