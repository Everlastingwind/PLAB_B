import type { MatchHeaderData } from "../data/mockMatch";
import type { PlayerRowMock, TeamTableMock } from "../data/mockMatchPlayers";
import {
  MATCH_BOARD_GRID_TRACKS,
  PlayerMatchGridRow,
} from "./PlayerMatchGridRow";
import { cn } from "../lib/cn";
import { safeKills } from "../lib/playerKda";

function teamHeroDamageMax(players: PlayerRowMock[]) {
  let maxH = 0;
  for (const p of players) {
    const h = p.heroDamage ?? 0;
    if (h > maxH) maxH = h;
  }
  return maxH;
}

function teamHeroKillsMax(players: PlayerRowMock[]) {
  let m = 0;
  for (const p of players) {
    const k = safeKills(p);
    if (k > m) m = k;
  }
  return m;
}

function headerGridClass(side: "radiant" | "dire") {
  return cn(
    MATCH_BOARD_GRID_TRACKS,
    "hidden items-end rounded-lg p-3 mb-2 ring-1 ring-inset md:grid",
    side === "radiant"
      ? "ring-emerald-800/25 bg-emerald-100/80 text-emerald-900/80 dark:ring-emerald-700/30 dark:bg-emerald-950/50 dark:text-emerald-200/90"
      : "ring-rose-800/25 bg-rose-100/80 text-rose-900/80 dark:ring-rose-700/30 dark:bg-rose-950/50 dark:text-rose-200/90",
    "text-[11px] font-semibold uppercase tracking-wide"
  );
}

export function MatchTeamTable({
  team,
  matchMeta,
  hideFactionLabel,
}: {
  team: TeamTableMock;
  matchMeta?: Pick<
    MatchHeaderData,
    "scoreRadiant" | "scoreDire" | "duration" | "winnerSide"
  >;
  hideFactionLabel?: boolean;
}) {
  const maxH = teamHeroDamageMax(team.players);
  const maxKills = teamHeroKillsMax(team.players);

  const showMeta = Boolean(matchMeta);
  const isRW = matchMeta?.winnerSide === "radiant";

  return (
    <section className="min-w-0 overflow-hidden">
      <div
        className={cn(
          "mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3",
          team.side === "radiant"
            ? "border-emerald-300/60 dark:border-emerald-700/40"
            : "border-rose-300/60 dark:border-rose-700/40"
        )}
      >
        <div className="min-w-0">
          {team.factionLabel && !hideFactionLabel ? (
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-500/90">
              {team.factionLabel}
            </div>
          ) : null}
          <h3
            className={cn(
              "truncate text-base font-bold tracking-wide",
              team.side === "radiant"
                ? "text-emerald-950 dark:text-emerald-50"
                : "text-rose-950 dark:text-rose-50"
            )}
          >
            {team.teamName}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showMeta && matchMeta ? (
            <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
              <span
                className={cn(
                  "text-lg font-bold",
                  isRW
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-slate-500 dark:text-slate-500"
                )}
              >
                {matchMeta.scoreRadiant}
              </span>
              <span className="text-slate-400 dark:text-slate-600">|</span>
              <span
                className={cn(
                  "text-lg font-bold",
                  !isRW
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-slate-500 dark:text-slate-500"
                )}
              >
                {matchMeta.scoreDire}
              </span>
            </div>
          ) : null}
          {showMeta && matchMeta ? (
            <span className="shrink-0 text-sm tabular-nums text-slate-600 dark:text-slate-400">
              时间{" "}
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                {matchMeta.duration}
              </span>
            </span>
          ) : null}
          {team.won ? (
            <span
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-semibold",
                team.side === "radiant"
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/20 dark:text-emerald-300"
                  : "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/20 dark:text-rose-300"
              )}
            >
              胜利
            </span>
          ) : (
            <span
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium",
                team.side === "radiant"
                  ? "border-emerald-700/30 bg-white/80 text-emerald-800/90 dark:border-emerald-600/25 dark:bg-emerald-950/40 dark:text-emerald-200/80"
                  : "border-rose-700/30 bg-white/80 text-rose-800/90 dark:border-rose-600/25 dark:bg-rose-950/40 dark:text-rose-200/80"
              )}
            >
              战败
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 overflow-x-auto">
        <div className={headerGridClass(team.side)}>
          <div className="min-w-0 text-left">玩家</div>
          <div className="text-center">出门装</div>
          <div className="text-center">Lv / KDA</div>
          <div className="text-center">正/反</div>
          <div className="text-center">经济</div>
          <div className="text-center">伤害</div>
          <div className="min-w-0 justify-self-start text-left">物品</div>
        </div>

        {team.players.map((p, idx) => (
          <PlayerMatchGridRow
            key={`${team.side}-${p.slot}-${p.heroId ?? "h"}-${idx}`}
            p={p}
            maxH={maxH}
            maxKills={maxKills}
            side={team.side}
          />
        ))}
      </div>
    </section>
  );
}
