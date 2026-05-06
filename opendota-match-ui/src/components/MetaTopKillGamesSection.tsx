import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  heroIconUrl,
  itemIconUrl,
  normalizeDotaAssetUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
} from "../data/mockMatchPlayers";
import { replayIndexPlayerDisplayLabel } from "../lib/playerDisplay";
import {
  TOP_SNAPSHOT_FORCE_PRO_MATCH_IDS,
  type TopSectionSnapshotPayload,
} from "../lib/homeTopSnapshot";
import { fetchProReplaysIndex } from "../lib/replaysApi";
import { ReplayCard } from "./ReplayCard";
import type { EntityMapsPayload } from "../types/entityMaps";
import type { ReplayPlayerSummary, ReplaySummary } from "../types/replaysIndex";
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import { isRadiantFromPlayer } from "../lib/matchGrouping";

type Props = {
  replays: ReplaySummary[];
  maps: EntityMapsPayload | null;
  listLoading: boolean;
  /** 首页父组件批量拉取的 plan_b/slim；禁止在本组件内请求 plan_b */
  slimByMatchId: Readonly<Record<number, SlimMatchJson | null | undefined>>;
  slimLoading?: boolean;
  /** 每日快照中的 TOP 三区（读静态 JSON） */
  snapshotTop?: TopSectionSnapshotPayload | null;
};

function formatRoleEarly(role: string | null | undefined): string {
  const r = String(role || "").trim();
  if (!r) return "—";
  if (r === "support(4)") return "Pos4";
  if (r === "support(5)") return "Pos5";
  if (r === "carry") return "Carry";
  if (r === "mid") return "Mid";
  if (r === "offlane") return "Offlane";
  return r;
}

function didPlayerWin(
  player: ReplayPlayerSummary,
  replay: ReplaySummary
): boolean {
  return (
    isRadiantFromPlayer(player as unknown as Record<string, unknown>) ===
    Boolean(replay.radiant_win)
  );
}

function pickTopKillPlayer(players: ReplayPlayerSummary[]): ReplayPlayerSummary | null {
  if (!players.length) return null;
  return players.reduce((a, b) =>
    (b.kills ?? 0) > (a.kills ?? 0) ? b : a
  );
}

function pickSlimPlayer(slim: SlimMatchJson | null, sum: ReplayPlayerSummary): SlimPlayer | null {
  const players = slim?.players;
  if (!Array.isArray(players) || !players.length) return null;
  const hid = sum.hero_id;
  const aid = sum.account_id;
  const slot = sum.player_slot;
  const byHero = players.filter((p) => Number(p.hero_id) === hid);
  if (byHero.length === 1) return byHero[0];
  if (aid > 0) {
    const m = byHero.find((p) => Number(p.account_id) === aid);
    if (m) return m;
  }
  const m = byHero.find((p) => Number(p.player_slot) === slot);
  return m ?? byHero[0] ?? null;
}

function itemIconsForPlayer(
  sp: SlimPlayer,
  maps: EntityMapsPayload
): Array<{ src: string }> {
  const out: Array<{ src: string }> = [];
  const slots = sp.items_slot;
  if (Array.isArray(slots)) {
    for (let i = 0; i < 6; i++) {
      const s = slots[i];
      if (!s || s.empty) continue;
      const key = String(s.item_key || "").replace(/^item_/, "").trim();
      const rawImg = String(s.image_url || "").trim();
      const src =
        normalizeDotaAssetUrl(rawImg) || (key ? itemIconUrl(key) : "");
      if (src) out.push({ src });
    }
    if (out.length) return out;
  }
  for (let i = 0; i < 6; i++) {
    const id = sp[`item_${i}` as keyof SlimPlayer];
    if (id == null) continue;
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) continue;
    const meta = maps.items[String(n)];
    const key = String(meta?.key || "").trim();
    if (key) out.push({ src: itemIconUrl(key) });
  }
  return out;
}

function totalKillsByReplay(replay: ReplaySummary): number {
  let sum = 0;
  for (const p of replay.players || []) {
    const k = Number(p.kills);
    if (Number.isFinite(k) && k >= 0) sum += k;
  }
  if (sum > 0) return sum;
  const radiant = Number(replay.radiant_score);
  const dire = Number(replay.dire_score);
  const hasValidIndexedScore =
    (Number.isFinite(radiant) && radiant > 0) ||
    (Number.isFinite(dire) && dire > 0);
  if (hasValidIndexedScore) return radiant + dire;
  return 0;
}

export function MetaTopKillGamesSection(props: Props) {
  const {
    replays,
    maps,
    listLoading,
    slimByMatchId,
    slimLoading = false,
    snapshotTop,
  } = props;
  const [proIndexMatchIds, setProIndexMatchIds] = useState<Set<number> | null>(null);

  const topRows = useMemo(() => {
    if (snapshotTop) return [];
    const scored: {
      replay: ReplaySummary;
      player: ReplayPlayerSummary;
      maxK: number;
    }[] = [];
    for (const r of replays) {
      const p = pickTopKillPlayer(r.players || []);
      if (!p) continue;
      scored.push({
        replay: r,
        player: p,
        maxK: p.kills ?? 0,
      });
    }
    scored.sort(
      (a, b) =>
        b.maxK - a.maxK ||
        b.replay.match_id - a.replay.match_id
    );
    const out: typeof scored = [];
    const seen = new Set<number>();
    for (const row of scored) {
      if (seen.has(row.replay.match_id)) continue;
      seen.add(row.replay.match_id);
      out.push(row);
      if (out.length >= 5) break;
    }
    return out;
  }, [replays, snapshotTop]);

  const snapshotKillRows = useMemo(() => {
    if (!snapshotTop || !maps) return [];
    return snapshotTop.singleKillTop
      .map(({ replay, itemIconKeys }) => {
        const player = pickTopKillPlayer(replay.players || []);
        return player ? { replay, player, itemIconKeys } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [snapshotTop, maps]);

  const topTotalRows = useMemo(() => {
    if (snapshotTop) return snapshotTop.totalKillsTop;
    const scored = replays.map((replay) => {
      const totalKills = totalKillsByReplay(replay);
      return { replay, totalKills };
    });
    scored.sort((a, b) => b.totalKills - a.totalKills || b.replay.match_id - a.replay.match_id);
    return scored.slice(0, 5).map((x) => x.replay);
  }, [replays, snapshotTop]);

  const topPubWithMostProRows = useMemo(() => {
    if (snapshotTop) return snapshotTop.pubMostProsTop;
    const scored = replays
      .filter((r) => {
        if (TOP_SNAPSHOT_FORCE_PRO_MATCH_IDS.has(r.match_id)) return false;
        const isPub = (r.source ?? "pub") === "pub";
        if (!isPub) return false;
        if (proIndexMatchIds && proIndexMatchIds.has(r.match_id)) return false;
        return true;
      })
      .map((replay) => {
        const proCount = (replay.players || []).reduce((acc, p) => {
          const name = String(p.pro_name || "").trim();
          return name ? acc + 1 : acc;
        }, 0);
        return { replay, proCount };
      });
    scored.sort(
      (a, b) =>
        b.proCount - a.proCount ||
        totalKillsByReplay(b.replay) - totalKillsByReplay(a.replay) ||
        b.replay.match_id - a.replay.match_id
    );
    return scored.slice(0, 5);
  }, [proIndexMatchIds, replays, snapshotTop]);

  useEffect(() => {
    if (snapshotTop) return;
    let cancelled = false;
    void fetchProReplaysIndex()
      .then((idx) => {
        if (cancelled) return;
        const ids = new Set<number>();
        for (const r of idx.replays || []) {
          const id = Number(r.match_id);
          if (Number.isFinite(id) && id > 0) ids.add(id);
        }
        setProIndexMatchIds(ids);
      })
      .catch(() => {
        if (cancelled) return;
        setProIndexMatchIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [snapshotTop]);

  if (!maps) return null;

  const singleKillEmpty = snapshotTop
    ? snapshotKillRows.length === 0
    : topRows.length === 0;

  return (
    <div className="mt-4 border-t border-skin-line pt-4">
      <p className="meta-major-title mb-2">单人击杀 Top 5</p>
      {listLoading ? (
        <p className="text-xs text-skin-sub">加载对局索引…</p>
      ) : singleKillEmpty ? (
        <p className="text-xs text-skin-sub">暂无可用数据。</p>
      ) : snapshotTop ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {snapshotKillRows.map(({ replay, player, itemIconKeys }) => {
            const hero = maps.heroes[String(player.hero_id)];
            const heroKey = hero?.key || "invoker";
            const k = player.kills ?? 0;
            const d = player.deaths ?? 0;
            const a = player.assists ?? 0;
            const display = replayIndexPlayerDisplayLabel(
              player.account_id,
              player.pro_name
            );
            const roleLine = formatRoleEarly(player.role_early);
            const won = didPlayerWin(player, replay);
            const items = itemIconKeys.map((key) => ({
              src: itemIconUrl(key),
            }));

            return (
              <Link
                key={replay.match_id}
                to={`/match/${replay.match_id}`}
                aria-label={`查看比赛 ${replay.match_id}`}
                className="block rounded border border-slate-500/35 bg-slate-200/25 p-3 transition-colors hover:border-amber-500/35 hover:bg-slate-200/45 dark:border-slate-500/45 dark:bg-slate-700/25 dark:hover:border-amber-500/30 dark:hover:bg-slate-600/35"
              >
                <div className="flex gap-3">
                  <img
                    src={heroIconUrl(heroKey)}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded object-cover"
                    {...steamCdnImgDefer}
                    onError={onDotaSteamAssetImgError}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold leading-snug text-skin-ink">
                      {display}
                    </p>
                    <p className="mt-1 font-mono text-base font-semibold tabular-nums tracking-tight text-skin-ink">
                      {k} / {d} / {a}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end justify-center gap-1.5 text-right">
                    <span className="rounded border border-slate-500/40 bg-slate-100/80 px-2 py-0.5 text-sm font-semibold tabular-nums text-slate-700 dark:border-slate-500/50 dark:bg-slate-800/80 dark:text-slate-200">
                      {roleLine}
                    </span>
                    <span
                      className={
                        won
                          ? "text-sm font-bold text-emerald-700 dark:text-emerald-400"
                          : "text-sm font-bold text-rose-700 dark:text-rose-400"
                      }
                    >
                      {won ? "Win" : "Lose"}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex min-h-[2rem] flex-wrap items-center gap-1.5">
                  {items.length ? (
                    items.map((it, idx) => (
                      <img
                        key={`${replay.match_id}-it-${idx}`}
                        src={it.src}
                        alt=""
                        className="h-8 w-8 rounded border border-slate-500/30 object-cover dark:border-slate-600/40"
                        {...steamCdnImgDefer}
                        onError={onDotaSteamAssetImgError}
                      />
                    ))
                  ) : (
                    <span className="text-xs text-skin-sub">暂无出装</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {topRows.map(({ replay, player }) => {
            const hero = maps.heroes[String(player.hero_id)];
            const heroKey = hero?.key || "invoker";
            const slimRaw = slimByMatchId[replay.match_id];
            const sp = slimRaw ? pickSlimPlayer(slimRaw, player) : null;
            const k = player.kills ?? 0;
            const d = player.deaths ?? 0;
            const a = player.assists ?? 0;
            const display = replayIndexPlayerDisplayLabel(
              player.account_id,
              player.pro_name
            );
            const roleLine = formatRoleEarly(player.role_early);
            const won = didPlayerWin(player, replay);
            const items =
              sp && maps ? itemIconsForPlayer(sp, maps) : [];
            const loadingItems =
              slimLoading && !slimByMatchId[replay.match_id];

            return (
              <Link
                key={replay.match_id}
                to={`/match/${replay.match_id}`}
                aria-label={`查看比赛 ${replay.match_id}`}
                className="block rounded border border-slate-500/35 bg-slate-200/25 p-3 transition-colors hover:border-amber-500/35 hover:bg-slate-200/45 dark:border-slate-500/45 dark:bg-slate-700/25 dark:hover:border-amber-500/30 dark:hover:bg-slate-600/35"
              >
                <div className="flex gap-3">
                  <img
                    src={heroIconUrl(heroKey)}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded object-cover"
                    {...steamCdnImgDefer}
                    onError={onDotaSteamAssetImgError}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold leading-snug text-skin-ink">
                      {display}
                    </p>
                    <p className="mt-1 font-mono text-base font-semibold tabular-nums tracking-tight text-skin-ink">
                      {k} / {d} / {a}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end justify-center gap-1.5 text-right">
                    <span className="rounded border border-slate-500/40 bg-slate-100/80 px-2 py-0.5 text-sm font-semibold tabular-nums text-slate-700 dark:border-slate-500/50 dark:bg-slate-800/80 dark:text-slate-200">
                      {roleLine}
                    </span>
                    <span
                      className={
                        won
                          ? "text-sm font-bold text-emerald-700 dark:text-emerald-400"
                          : "text-sm font-bold text-rose-700 dark:text-rose-400"
                      }
                    >
                      {won ? "Win" : "Lose"}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex min-h-[2rem] flex-wrap items-center gap-1.5">
                  {loadingItems ? (
                    <span className="text-xs text-skin-sub">出装加载中…</span>
                  ) : items.length ? (
                    items.map((it, idx) => (
                      <img
                        key={`${replay.match_id}-it-${idx}`}
                        src={it.src}
                        alt=""
                        className="h-8 w-8 rounded border border-slate-500/30 object-cover dark:border-slate-600/40"
                        {...steamCdnImgDefer}
                        onError={onDotaSteamAssetImgError}
                      />
                    ))
                  ) : (
                    <span className="text-xs text-skin-sub">暂无出装</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <div className="mt-6 border-t border-skin-line pt-4">
        <p className="meta-major-title mb-2">总人头 Top 5</p>
        {listLoading ? (
          <p className="text-xs text-skin-sub">加载对局索引…</p>
        ) : topTotalRows.length === 0 ? (
          <p className="text-xs text-skin-sub">暂无可用数据。</p>
        ) : (
          <div className="flex flex-col gap-2 sm:gap-3">
            {topTotalRows.map((replay, i) => (
              <ReplayCard
                key={`total-${replay.match_id}`}
                replay={replay}
                maps={maps}
                eagerHeroPortraits={i < 1}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mt-6 border-t border-skin-line pt-4">
        <p className="meta-major-title mb-2">Most pros</p>
        {listLoading ? (
          <p className="text-xs text-skin-sub">加载对局索引…</p>
        ) : topPubWithMostProRows.length === 0 ? (
          <p className="text-xs text-skin-sub">暂无可用数据。</p>
        ) : (
          <div className="flex flex-col gap-2 sm:gap-3">
            {topPubWithMostProRows.map(({ replay, proCount }, i) => (
              <div key={`pub-pro-${replay.match_id}`}>
                <div className="mb-1.5 flex items-center justify-start">
                  <span className="rounded-full border border-violet-500/35 bg-violet-100/70 px-2.5 py-0.5 text-[11px] font-semibold text-violet-800 dark:border-violet-500/45 dark:bg-violet-500/15 dark:text-violet-300">
                    职业选手 {proCount} / 10
                  </span>
                </div>
                <ReplayCard
                  replay={replay}
                  maps={maps}
                  eagerHeroPortraits={i < 1}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
