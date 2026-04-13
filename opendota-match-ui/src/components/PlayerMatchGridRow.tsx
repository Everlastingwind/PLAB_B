import { Link } from "react-router-dom";
import type { PlayerRowMock } from "../data/mockMatchPlayers";
import { heroIconUrl, itemIconUrl } from "../data/mockMatchPlayers";
import { cn } from "../lib/cn";
import { clipMechaCorner } from "../lib/mechaStyles";
import { formatStat } from "../lib/display";
import { kdaFromPlayerRecord } from "../lib/playerKda";
import { displayPlayerLabel } from "../lib/playerDisplay";
import { SkillBuildTimeline } from "./SkillBuildTimeline";
import { TalentTreeBadge } from "./TalentTreeBadge";

/** 全局表头与所有数据行共用同一列轨道，保证对齐；物品列按内容宽度，避免 3fr 拉满右侧空白 */
export const MATCH_BOARD_GRID_COLS =
  "grid grid-cols-[2.5fr_1fr_1fr_1fr_1fr_max-content] gap-4";

/** 与表头共用：列轨道 + 内边距；背景由阵营区分 */
export const MATCH_STAT_GRID_TEMPLATE = cn(
  MATCH_BOARD_GRID_COLS,
  "items-start w-full rounded-lg p-3 mb-2 min-w-0"
);

function rowShellClass(side: "radiant" | "dire") {
  return cn(
    MATCH_STAT_GRID_TEMPLATE,
    side === "radiant"
      ? "border border-emerald-800/20 bg-emerald-100/70 dark:border-emerald-700/25 dark:bg-emerald-950/35"
      : "border border-rose-800/20 bg-rose-100/70 dark:border-rose-700/25 dark:bg-rose-950/35"
  );
}

function itemKeyClean(key: string): string {
  return key.replace(/^item_/, "");
}

const AGHANIM_SCEPTER_ICON = itemIconUrl("ultimate_scepter");
const AGHANIM_SHARD_ICON = itemIconUrl("aghanims_shard");

function hasTalentOrSkillUi(p: PlayerRowMock): boolean {
  if (p.skillBuild && p.skillBuild.length > 0) return true;
  if (p.talentPicks && p.talentPicks.length > 0) return true;
  const tiers = p.talentTree?.tiers;
  return Boolean(tiers && tiers.length > 0);
}

/** Dota 2 对阵表：6 主槽 + 神杖/魔晶状态（不展示中立槽）。 */
function GridInventorySlots({
  p,
  side,
}: {
  p: PlayerRowMock;
  side: "radiant" | "dire";
}) {
  const legacy = p.buffs.aghanims ?? "none";
  const scepterOn =
    p.scepterActive ?? (legacy === "scepter" || legacy === "both");
  const shardOn = p.shardActive ?? (legacy === "shard" || legacy === "both");

  const main = p.items.main;

  const sideBorderMain =
    side === "radiant"
      ? "border-emerald-600/30 dark:border-emerald-500/25"
      : "border-rose-600/30 dark:border-rose-500/25";

  const emptyMain =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-700/30 bg-slate-800/50 ring-1 ring-slate-800/35 dark:border-slate-700/40 dark:bg-slate-800/50 dark:ring-slate-900/40";

  const filledMain = cn(
    "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-slate-900/80",
    sideBorderMain
  );

  return (
    <div className="flex w-fit max-w-full min-w-0 items-center gap-2 overflow-hidden">
      <div
        className="flex shrink-0 flex-col gap-1"
        aria-label="阿哈利姆神杖与魔晶"
      >
        <div
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded border p-0.5 transition-all",
            scepterOn
              ? "border-sky-400/55 bg-sky-500/10 shadow-[0_0_10px_rgba(56,189,248,0.28)] dark:border-sky-400/50 dark:bg-sky-500/15"
              : "border-slate-600/30 bg-slate-900/25 opacity-45 dark:border-slate-600/35 dark:bg-slate-950/40"
          )}
          title={scepterOn ? "阿哈利姆神杖（生效）" : "无神杖效果"}
        >
          <img
            src={AGHANIM_SCEPTER_ICON}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
        <div
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded border p-0.5 transition-all",
            shardOn
              ? "border-cyan-400/55 bg-cyan-500/10 shadow-[0_0_10px_rgba(34,211,238,0.26)] dark:border-cyan-400/50 dark:bg-cyan-500/15"
              : "border-slate-600/30 bg-slate-900/25 opacity-45 dark:border-slate-600/35 dark:bg-slate-950/40"
          )}
          title={shardOn ? "阿哈利姆魔晶（生效）" : "无魔晶效果"}
        >
          <img
            src={AGHANIM_SHARD_ICON}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-nowrap items-center gap-2 overflow-hidden">
        <div
          className="grid shrink-0 grid-cols-6 gap-2"
          role="list"
          aria-label="主物品栏（6 格）"
        >
          {([0, 1, 2, 3, 4, 5] as const).map((idx) => {
            const slot = main[idx] ?? null;
            if (!slot) {
              return (
                <div
                  key={idx}
                  className={emptyMain}
                  aria-hidden
                  role="listitem"
                />
              );
            }
            const src =
              slot.imageUrl?.trim() || itemIconUrl(itemKeyClean(slot.itemKey));
            return (
              <div key={idx} className={filledMain} role="listitem">
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DamageCell({
  value,
  maxInTeam,
  side,
}: {
  value: number;
  maxInTeam: number;
  side: "radiant" | "dire";
}) {
  const pct = maxInTeam > 0 ? Math.min(100, (value / maxInTeam) * 100) : 0;
  const bar =
    side === "radiant"
      ? "bg-emerald-500/70 dark:bg-emerald-400/55"
      : "bg-rose-500/70 dark:bg-rose-400/55";
  const track =
    side === "radiant"
      ? "bg-emerald-950/25 dark:bg-emerald-950/50"
      : "bg-rose-950/25 dark:bg-rose-950/50";
  return (
    <div className="min-w-0 overflow-hidden text-center">
      <div
        className={cn(
          "whitespace-nowrap font-mono text-xs font-medium tabular-nums",
          side === "radiant"
            ? "text-emerald-950 dark:text-emerald-100"
            : "text-rose-950 dark:text-rose-100"
        )}
      >
        {value >= 1000
          ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`
          : String(value)}
      </div>
      <div className={cn("mt-1 h-1 w-full overflow-hidden rounded-full", track)}>
        <div
          className={cn("h-full rounded-full", bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PlayerMatchGridRow({
  p,
  maxH,
  maxKills,
  side,
}: {
  p: PlayerRowMock;
  maxH: number;
  maxKills: number;
  side: "radiant" | "dire";
}) {
  const rawKda = kdaFromPlayerRecord(p as unknown as Record<string, unknown>);
  const kills = rawKda.kills;
  const deaths = rawKda.deaths;
  const assists = rawKda.assists;

  /** 浅色行底上必须用深色字；勿用 slate-300 等浅色（对比度不足） */
  const killClass =
    maxKills > 0 && kills === maxKills
      ? side === "radiant"
        ? "font-semibold text-emerald-800 dark:text-emerald-400"
        : "font-semibold text-rose-800 dark:text-rose-400"
      : "text-neutral-900 dark:text-slate-200";
  const kdaSepClass = "text-neutral-600 dark:text-slate-500";
  const kdaMutedClass = "text-neutral-900 dark:text-slate-300";

  // 详情页：仅显示职业选手注册名；非职业统一显示「匿名玩家」。
  const displayName = displayPlayerLabel(p.proName);
  const accountId = Number(p.accountId ?? 0);
  const hasProName = String(p.proName ?? "").trim().length > 0;
  const canLinkPlayer =
    Number.isFinite(accountId) && accountId > 0 && hasProName;

  return (
    <div className={rowShellClass(side)}>
      {/* 1. 玩家：头像 → 天赋树 → 昵称 / Rank / 技能加点（与 OpenDota 类布局一致） */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden sm:gap-2.5">
        <img
          src={heroIconUrl(p.heroKey === "unknown" ? "invoker" : p.heroKey)}
          alt=""
          className={cn(
            "h-12 w-12 shrink-0 object-cover",
            clipMechaCorner,
            "rounded-[4px]"
          )}
          loading="lazy"
        />
        {hasTalentOrSkillUi(p) ? (
          <div className="pointer-events-auto shrink-0">
            <TalentTreeBadge
              tree={p.talentTree}
              talentPicks={p.talentPicks}
            />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {canLinkPlayer ? (
            <Link
              to={`/player/${accountId}`}
              className={cn(
                "truncate text-left text-sm font-semibold leading-tight underline-offset-2 hover:underline",
                side === "radiant"
                  ? "text-emerald-950 dark:text-slate-100"
                  : "text-rose-950 dark:text-slate-100"
              )}
              title={displayName || undefined}
            >
              {displayName || "—"}
            </Link>
          ) : (
            <div
              className={cn(
                "truncate text-left text-sm font-semibold leading-tight",
                side === "radiant"
                  ? "text-emerald-950 dark:text-slate-100"
                  : "text-rose-950 dark:text-slate-100"
              )}
              title={displayName || undefined}
            >
              {displayName || "—"}
            </div>
          )}
          {p.leaderboardRank != null && p.leaderboardRank > 0 ? (
            <div
              className={cn(
                "whitespace-nowrap text-[10px] tabular-nums leading-tight",
                side === "radiant"
                  ? "text-emerald-700 dark:text-emerald-400/90"
                  : "text-rose-700 dark:text-rose-400/90"
              )}
            >
              Rank {p.leaderboardRank}
            </div>
          ) : null}
          {p.skillBuild && p.skillBuild.length > 0 ? (
            <SkillBuildTimeline steps={p.skillBuild} />
          ) : null}
        </div>
      </div>

      {/* 2. 等级 + K/D/A */}
      <div className="min-w-0 text-center">
        <div
          className={cn(
            "whitespace-nowrap font-mono text-xs font-medium tabular-nums",
            side === "radiant"
              ? "text-emerald-950 dark:text-slate-200"
              : "text-rose-950 dark:text-slate-200"
          )}
        >
          Lv.{p.level}
        </div>
        <div className="mt-0.5 whitespace-nowrap font-mono text-xs tabular-nums">
          <span className={killClass}>{kills}</span>
          <span className={kdaSepClass}>/</span>
          <span className={kdaMutedClass}>{deaths}</span>
          <span className={kdaSepClass}>/</span>
          <span className={kdaMutedClass}>{assists}</span>
        </div>
      </div>

      {/* 3. 正反补 */}
      <div className="min-w-0 text-center">
        <div className="whitespace-nowrap font-mono text-xs tabular-nums text-neutral-900 dark:text-slate-200">
          <span
            className={
              side === "radiant"
                ? "font-medium text-emerald-950 dark:text-slate-100"
                : "font-medium text-rose-950 dark:text-slate-100"
            }
          >
            {formatStat(p.lastHits)}
          </span>
          <span className="text-neutral-600 dark:text-slate-500"> / </span>
          <span className="text-neutral-900 dark:text-slate-200">
            {formatStat(p.denies)}
          </span>
        </div>
      </div>

      {/* 4. 经济 */}
      <div className="min-w-0 text-center">
        <div
          className={cn(
            "whitespace-nowrap font-mono text-xs font-semibold tabular-nums",
            side === "radiant"
              ? "text-emerald-900 dark:text-emerald-400"
              : "text-rose-900 dark:text-rose-400"
          )}
        >
          {formatStat(p.netWorth, "gold")}
        </div>
      </div>

      {/* 5. 伤害 */}
      <DamageCell
        value={p.heroDamage ?? 0}
        maxInTeam={maxH}
        side={side}
      />

      {/* 6. 物品：列宽 max-content，格内左对齐，不占用装备右侧空白 */}
      <div className="min-w-0 justify-self-start overflow-hidden">
        <GridInventorySlots p={p} side={side} />
      </div>
    </div>
  );
}
