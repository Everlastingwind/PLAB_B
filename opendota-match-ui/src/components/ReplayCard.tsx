import { Link } from "react-router-dom";
import type { MouseEvent } from "react";
import { heroIconUrl } from "../data/mockMatchPlayers";
import type { EntityMapsPayload } from "../types/entityMaps";
import type { ReplayPlayerSummary, ReplaySummary } from "../types/replaysIndex";
import { displayPlayerLabel } from "../lib/playerDisplay";
import { heroKeyFromId } from "../lib/replaysApi";
import { cn } from "../lib/cn";
import { compareByPlayerSlot, isRadiantFromPlayer } from "../lib/matchGrouping";
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
}: {
  players: ReplayPlayerSummary[];
  maps: EntityMapsPayload;
  side: "radiant" | "dire";
}) {
  const sorted = [...players].sort(compareByPlayerSlot);
  return (
    <div className="flex flex-nowrap items-center justify-center gap-0.5 sm:gap-2">
      {sorted.map((p) => {
        const key = heroKeyFromId(p.hero_id, maps);
        const nameRaw = String(p.pro_name ?? "").trim();
        const isAnonymous = nameRaw.length === 0;
        return (
          <div
            key={p.player_slot}
            className="flex w-[46px] shrink-0 flex-col items-center gap-0.5 sm:w-[62px] sm:gap-1 lg:w-[72px]"
          >
            <Link
              to={`/hero/${encodeURIComponent(key)}`}
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
            >
              <img
                src={heroIconUrl(key === "unknown" ? "invoker" : key)}
                alt=""
                className="h-7 w-7 rounded-sm object-cover sm:h-9 sm:w-9 lg:h-10 lg:w-10"
                loading="lazy"
              />
            </Link>
            <Link
              to={`/player/${p.account_id}`}
              className={cn(
                "pointer-events-auto w-full whitespace-normal break-all text-center text-[9px] leading-none underline-offset-2 transition-colors sm:text-[11px] sm:leading-tight",
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
            >
              {isAnonymous ? "匿名" : displayPlayerLabel(p.pro_name)}
            </Link>
          </div>
        );
      })}
    </div>
  );
}

export function ReplayCard({
  replay,
  maps,
}: {
  replay: ReplaySummary;
  maps: EntityMapsPayload;
}) {
  const rad = replay.players.filter((p) =>
    isRadiantFromPlayer({
      player_slot: p.player_slot,
      is_radiant: p.is_radiant,
    })
  );
  const dire = replay.players.filter(
    (p) =>
      !isRadiantFromPlayer({
        player_slot: p.player_slot,
        is_radiant: p.is_radiant,
      })
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

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border border-skin-line bg-skin-card shadow-card",
        "transition-colors duration-200 ease-out",
        "hover:border-slate-300 hover:shadow-md dark:hover:border-slate-600",
        "dark:bg-slate-800/60 dark:backdrop-blur-sm dark:hover:bg-slate-700/75",
        "px-1.5 py-2 sm:px-4 sm:py-3.5"
      )}
    >
      <Link
        to={matchPath}
        className="absolute inset-0 z-0 rounded-[inherit]"
        aria-label={`查看比赛详情 ${replay.match_id}`}
      />
      <div className="pointer-events-none absolute left-2 top-2 z-20">
        <span
          className={cn(
            "rounded border px-2 py-1 font-mono text-xs font-bold leading-none",
            srcCls
          )}
        >
          {srcTag}
        </span>
      </div>
      <div className="absolute right-2 top-2 z-20 pointer-events-auto">
        <button
          type="button"
          onClick={handleCopyMatchId}
          title="点击复制比赛编号"
          className="rounded border border-slate-300/70 bg-white/90 px-2 py-1 font-mono text-xs leading-none text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {replay.match_id}
        </button>
      </div>
      <div className="relative z-10 flex flex-nowrap items-stretch gap-1 pointer-events-none sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center justify-end sm:justify-center">
          <HeroCells players={rad} maps={maps} side="radiant" />
        </div>

        <div
          className={cn(
            "flex w-[3.75rem] shrink-0 flex-col items-center justify-center rounded-md border border-skin-line px-1 py-1 sm:w-24 sm:rounded-lg sm:px-2 sm:py-2",
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
          <div className="flex items-baseline gap-0.5 font-mono text-sm font-bold tabular-nums leading-none sm:text-lg lg:text-xl">
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

        <div className="flex min-w-0 flex-1 items-center justify-start sm:justify-center">
          <HeroCells players={dire} maps={maps} side="dire" />
        </div>
      </div>
    </article>
  );
}
