import type { MatchHeaderData } from "../data/mockMatch";
import type { PlayerRowMock, TeamTableMock } from "../data/mockMatchPlayers";
import { FactionMatchBanner } from "./FactionMatchBanner";
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

function GlobalColumnHeader() {
  const cell = "min-w-0 leading-tight";
  const kdaHint =
    "text-[9px] font-normal normal-case tracking-normal text-slate-500 dark:text-slate-500";
  return (
    <div
      role="row"
      className={cn(
        MATCH_BOARD_GRID_TRACKS,
        "hidden items-start border-b-2 border-skin-line bg-slate-100/85 p-3 dark:border-slate-600/80 dark:bg-slate-800/70 md:grid",
        "text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300"
      )}
    >
      <div className={cn(cell, "text-left")}>
        <span>英雄 / 玩家</span>
      </div>
      <div className={cn(cell, "text-center")}>
        <div>等级</div>
        <div className={cn(kdaHint, "mt-0.5")}>K / D / A</div>
      </div>
      <div className={cn(cell, "text-center")}>正 / 反</div>
      <div className={cn(cell, "text-center")}>经济</div>
      <div className={cn(cell, "text-center")}>伤害</div>
      <div className={cn(cell, "justify-self-start text-left")}>物品</div>
    </div>
  );
}

function MatchMetaStrip({ meta }: { meta: MatchHeaderData }) {
  const isRW = meta.winnerSide === "radiant";
  return (
    <div className="relative flex min-h-[2.5rem] items-center justify-center border-b border-skin-line bg-skin-muted/40 px-3 py-2 dark:bg-slate-900/40">
      <div className="pointer-events-none absolute left-3 top-1/2 max-w-[min(42%,18rem)] -translate-y-1/2 truncate text-left text-xs text-skin-sub dark:text-slate-400">
        {meta.leagueName ? (
          <span className="pointer-events-auto font-medium text-skin-ink dark:text-slate-200">
            {meta.leagueName}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-1.5 text-base font-bold tabular-nums">
        <span
          className={cn(
            isRW
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-400 dark:text-slate-500"
          )}
        >
          {meta.scoreRadiant}
        </span>
        <span className="text-slate-400 dark:text-slate-600">:</span>
        <span
          className={cn(
            !isRW
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-400 dark:text-slate-500"
          )}
        >
          {meta.scoreDire}
        </span>
      </div>
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-skin-sub dark:text-slate-400">
        <span className="pointer-events-auto">
          时间{" "}
          <span className="font-mono font-semibold text-skin-ink dark:text-slate-200">
            {meta.duration}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * 单列垂直对阵：唯一全局表头 + 阵营满宽标签 + 两队玩家行（列宽与 PlayerMatchGridRow 一致）
 */
export function MatchVerticalBoard({
  radiant,
  dire,
  matchMeta,
}: {
  radiant: TeamTableMock;
  dire: TeamTableMock;
  matchMeta: MatchHeaderData;
}) {
  const maxHR = teamHeroDamageMax(radiant.players);
  const maxKR = teamHeroKillsMax(radiant.players);
  const maxHD = teamHeroDamageMax(dire.players);
  const maxKD = teamHeroKillsMax(dire.players);

  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-skin-line/90 bg-skin-card/25 shadow-sm dark:bg-slate-900/20">
      <MatchMetaStrip meta={matchMeta} />

      <div className="flex flex-col">
        <GlobalColumnHeader />

        <FactionMatchBanner
          side="radiant"
          won={radiant.won}
          teamName={radiant.teamName}
        />
        {radiant.players.map((p, idx) => (
          <PlayerMatchGridRow
            key={`radiant-${p.slot}-${p.heroId ?? "h"}-${idx}`}
            p={p}
            maxH={maxHR}
            maxKills={maxKR}
            side="radiant"
          />
        ))}

        <div
          className="mt-6 border-t border-slate-300/35 pt-1 dark:border-slate-600/40"
          aria-hidden
        />

        <FactionMatchBanner
          side="dire"
          won={dire.won}
          teamName={dire.teamName}
        />
        {dire.players.map((p, idx) => (
          <PlayerMatchGridRow
            key={`dire-${p.slot}-${p.heroId ?? "h"}-${idx}`}
            p={p}
            maxH={maxHD}
            maxKills={maxKD}
            side="dire"
          />
        ))}
      </div>
    </div>
  );
}
