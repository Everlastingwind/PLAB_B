import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ReplaySummary } from "../types/replaysIndex";
import type { EntityMapsPayload } from "../types/entityMaps";
import type { SlimMatchJson } from "../types/slimMatch";
import {
  heroIconUrl,
  itemIconUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
  steamCdnImgHero,
} from "../data/mockMatchPlayers";
import { HeroPickerPopover } from "./HeroPickerPopover";
import type { SlimPlayer } from "../types/slimMatch";
import { collectPurchaseEvents } from "../lib/metaGlobalItemStats";

/** 与下方 rows 切片上限一致；父组件合并 plan_b 请求时用 */
export const HERO_OVERVIEW_INSIGHT_CAP = 180;

type Props = {
  heroId: number;
  heroKey: string;
  heroName: string;
  replays: ReplaySummary[];
  maps: EntityMapsPayload;
  /** 父页面批量请求 plan_b/slim 的结果；禁止在本组件内发起任何 Supabase 请求 */
  slimByMatchId: Readonly<
    Record<number, SlimMatchJson | null | undefined>
  >;
  /** 父页面正在拉取 slim（plan_b） */
  slimLoading?: boolean;
  enabled?: boolean;
  /** URL ?with_hero_id / ?vs_hero_id 联动：组合筛选队友 / 对手 */
  withHeroId?: number | null;
  vsHeroId?: number | null;
  onWithHeroChange?: (heroId: number | null) => void;
  onVsHeroChange?: (heroId: number | null) => void;
};

type OverviewData = {
  totalMatches: number;
  winRate: number;
  talentRows: Array<{
    level: 10 | 15 | 20 | 25;
    leftPct: number;
    rightPct: number;
  }>;
  itemTop: Array<{ itemKey: string; avgMinute: number; pct: number }>;
  itemMatches: Record<string, Array<{ matchId: number; minute: number; won: boolean }>>;
  counteredBy: Array<{ heroId: number; winRate: number; games: number }>;
  goodAgainst: Array<{ heroId: number; winRate: number; games: number }>;
};

const MAX_MATCHES_FOR_INSIGHT = HERO_OVERVIEW_INSIGHT_CAP;
const VERSUS_MIN_GAMES = 20;
type HeroPlayerLite = {
  hero_id: number;
  purchase_history?: Array<{ time?: number; item?: string; item_key?: string }>;
  talent_tree?: { tiers?: Array<{ hero_level?: number; selected?: string }> };
};
const HERO_OVERVIEW_CACHE = new Map<string, OverviewData>();
const COMPOSED_ITEM_KEYS = new Set<string>([
  "abyssal_blade","aeon_disk","aether_lens","ancient_janggo","angels_demise","arcane_blink","arcane_boots","armlet","assault","basher","bfury","black_king_bar","blade_mail","bloodstone","bloodthorn","boots_of_bearing","bracer","buckler","butterfly","consecrated_wraps","crellas_crozier","crimson_guard","cyclone","dagon","desolator","devastator","diffusal_blade","diffusal_blade_2","disperser","dragon_lance","echo_sabre","essence_distiller","eternal_shroud","ethereal_blade","falcon_blade","force_staff","glimmer_cape","great_famango","greater_crit","greater_famango","guardian_greaves","gungir","hand_of_midas","harpoon","headdress","heart","heavens_halberd","helm_of_the_dominator","helm_of_the_overlord","holy_locket","hurricane_pike","hydras_breath","invis_sword","iron_talon","kaya","kaya_and_sange","lesser_crit","lotus_orb","maelstrom","mage_slayer","magic_wand","manta","mask_of_madness","medallion_of_courage","mekansm","meteor_hammer","mjollnir","monkey_king_bar","moon_shard","necronomicon","necronomicon_2","necronomicon_3","null_talisman","nullifier","oblivion_staff","octarine_core","orb_of_corrosion","orchid","overwhelming_blink","pavise","pers","phase_boots","phylactery","pipe","power_treads","radiance","rapier","refresher","revenants_brooch","ring_of_basilius","rod_of_atos","sange","sange_and_yasha","satanic","sheepstick","shivas_guard","silver_edge","skadi","solar_crest","soul_booster","soul_ring","specialists_array","sphere","spirit_vessel","swift_blink","tranquil_boots","travel_boots","travel_boots_2","trident","ultimate_scepter","ultimate_scepter_2","urn_of_shadows","vanguard","veil_of_discord","vladmir","ward_dispenser","wind_waker","witch_blade","wraith_band","wraith_pact","yasha","yasha_and_kaya",
]);

function isComposedCoreItem(itemKey: string): boolean {
  const k = String(itemKey || "").trim().replace(/^item_/, "");
  if (!k) return false;
  return COMPOSED_ITEM_KEYS.has(k);
}

function pct(num: number, den: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return (num / den) * 100;
}

type OverviewAccum = {
  totalMatches: number;
  wins: number;
  itemMatchCount: Map<string, number>;
  itemMinuteSum: Map<string, number>;
  itemMatchRows: Map<string, Array<{ matchId: number; minute: number; won: boolean }>>;
  versus: Map<number, { games: number; wins: number }>;
  talentCount: Record<10 | 15 | 20 | 25, { left: number; right: number; total: number }>;
};

function createOverviewAccum(): OverviewAccum {
  return {
    totalMatches: 0,
    wins: 0,
    itemMatchCount: new Map<string, number>(),
    itemMinuteSum: new Map<string, number>(),
    itemMatchRows: new Map<string, Array<{ matchId: number; minute: number; won: boolean }>>(),
    versus: new Map<number, { games: number; wins: number }>(),
    talentCount: {
      10: { left: 0, right: 0, total: 0 },
      15: { left: 0, right: 0, total: 0 },
      20: { left: 0, right: 0, total: 0 },
      25: { left: 0, right: 0, total: 0 },
    },
  };
}

function buildOverviewData(acc: OverviewAccum): OverviewData {
  const talentRows: OverviewData["talentRows"] = ([10, 15, 20, 25] as const).map((lv) => ({
    level: lv,
    leftPct: pct(acc.talentCount[lv].left, acc.talentCount[lv].total),
    rightPct: pct(acc.talentCount[lv].right, acc.talentCount[lv].total),
  }));

  const itemTop = Array.from(acc.itemMatchCount.entries())
    .map(([itemKey, c]) => {
      const t = acc.itemMinuteSum.get(itemKey) || 0;
      return { itemKey, avgMinute: t / Math.max(c, 1), pct: pct(c, acc.totalMatches) };
    })
    .filter((x) => isComposedCoreItem(x.itemKey))
    .filter((x) => x.avgMinute <= 60)
    .sort((a, b) => a.avgMinute - b.avgMinute || b.pct - a.pct);

  const itemMatches: OverviewData["itemMatches"] = {};
  for (const [itemKey, rows] of acc.itemMatchRows.entries()) {
    if (!isComposedCoreItem(itemKey)) continue;
    itemMatches[itemKey] = [...rows].sort(
      (a, b) => a.minute - b.minute || b.matchId - a.matchId
    );
  }

  const versusRows = Array.from(acc.versus.entries())
    .map(([hid, v]) => ({
      heroId: hid,
      winRate: pct(v.wins, v.games),
      games: v.games,
    }))
    .filter((x) => x.games >= VERSUS_MIN_GAMES)
    .sort((a, b) => a.winRate - b.winRate);

  return {
    totalMatches: acc.totalMatches,
    winRate: pct(acc.wins, Math.max(acc.totalMatches, 1)),
    talentRows,
    itemTop,
    itemMatches,
    counteredBy: versusRows.slice(0, 10),
    goodAgainst: [...versusRows].reverse().slice(0, 10),
  };
}

export function HeroBuildOverviewCard(props: Props) {
  const {
    heroId,
    heroKey,
    heroName,
    replays,
    maps,
    slimByMatchId,
    slimLoading = false,
    enabled = true,
    withHeroId = null,
    vsHeroId = null,
    onWithHeroChange,
    onVsHeroChange,
  } = props;
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const rows = useMemo(
    () => replays.slice(0, MAX_MATCHES_FOR_INSIGHT),
    [replays]
  );
  const replayIdsKey = useMemo(
    () => rows.map((r) => r.match_id).join(","),
    [rows]
  );
  /** 否则 slim 异步到达前会把「无购买样本」写进模块缓存，slim 就绪后仍命中旧结果 */
  const slimPresenceKey = useMemo(
    () =>
      rows
        .map((r) => `${r.match_id}:${slimByMatchId[r.match_id] ? 1 : 0}`)
        .join("|"),
    [rows, slimByMatchId]
  );
  const overviewCacheKey = useMemo(
    () => `${heroId}:${replayIdsKey}:${slimPresenceKey}`,
    [heroId, replayIdsKey, slimPresenceKey]
  );

  const data = useMemo((): OverviewData | null => {
    if (!enabled || rows.length === 0) return null;
    const mem = HERO_OVERVIEW_CACHE.get(overviewCacheKey);
    if (mem) return mem;

    const acc = createOverviewAccum();

    const applyRow = (
      r: ReplaySummary,
      heroPlayer: HeroPlayerLite | undefined
    ) => {
      const pHero = (r.players || []).find(
        (p) => Number(p.hero_id || 0) === heroId
      );
      if (!pHero) return;
      acc.totalMatches += 1;
      const heroWon = Boolean(pHero.is_radiant) === Boolean(r.radiant_win);
      if (heroWon) acc.wins += 1;
      for (const p of r.players || []) {
        if (Number(p.hero_id || 0) === heroId) continue;
        if (Boolean(p.is_radiant) === Boolean(pHero.is_radiant)) continue;
        const hid = Number(p.hero_id || 0);
        if (hid <= 0) continue;
        const cur = acc.versus.get(hid) || { games: 0, wins: 0 };
        cur.games += 1;
        if (heroWon) cur.wins += 1;
        acc.versus.set(hid, cur);
      }

      if (!heroPlayer) return;

      const tt = heroPlayer.talent_tree;
      if (tt && Array.isArray(tt.tiers)) {
        for (const row of tt.tiers) {
          const lv = Number(row.hero_level || 0) as 10 | 15 | 20 | 25;
          if (!(lv in acc.talentCount)) continue;
          const sel = String(row.selected || "").toLowerCase();
          if (sel === "left" || sel === "right") {
            acc.talentCount[lv].total += 1;
            acc.talentCount[lv][sel] += 1;
          }
        }
      }

      const purchaseEvents = collectPurchaseEvents(heroPlayer as SlimPlayer);
      if (purchaseEvents.length === 0) return;
      const earliestByItem = new Map<string, number>();
      for (const ev of purchaseEvents) {
        const m = Math.floor(ev.time / 60);
        const keyRaw = ev.itemKey;
        const ex = earliestByItem.get(keyRaw);
        if (ex === undefined || m < ex) earliestByItem.set(keyRaw, m);
      }
      for (const [ik, m] of earliestByItem.entries()) {
        acc.itemMatchCount.set(ik, (acc.itemMatchCount.get(ik) || 0) + 1);
        acc.itemMinuteSum.set(ik, (acc.itemMinuteSum.get(ik) || 0) + m);
        const rowsByItem = acc.itemMatchRows.get(ik) || [];
        rowsByItem.push({ matchId: r.match_id, minute: m, won: heroWon });
        acc.itemMatchRows.set(ik, rowsByItem);
      }
    };

    for (const r of rows) {
      const slim = slimByMatchId[r.match_id];
      const heroPlayer = slim
        ? ((slim.players || []).find(
            (p) => Number(p.hero_id || 0) === heroId
          ) as HeroPlayerLite | undefined)
        : undefined;
      applyRow(r, heroPlayer);
    }

    const built = buildOverviewData(acc);
    HERO_OVERVIEW_CACHE.set(overviewCacheKey, built);
    return built;
  }, [enabled, rows, slimByMatchId, heroId, overviewCacheKey]);

  const loading = slimLoading;

  const heroNameEn = useMemo(() => {
    return maps.heroes[String(heroId)]?.nameEn || heroKey;
  }, [maps, heroId, heroKey]);

  return (
    <section className="mb-6 rounded-lg border border-skin-line bg-skin-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src={heroIconUrl(heroKey || "invoker")}
            alt={heroName}
            className="h-12 w-12 rounded object-cover"
            {...steamCdnImgHero}
            onError={onDotaSteamAssetImgError}
          />
          <div>
            <h2 className="text-base font-bold text-skin-ink">{heroName}</h2>
            <p className="text-xs text-skin-sub">
              {heroNameEn} ·{" "}
              {loading
                ? "加载明细…"
                : `${data?.totalMatches ?? 0} matches · ${data != null && Number.isFinite(data.winRate) ? data.winRate.toFixed(1) : "0.0"}% winrate`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded border border-slate-500/35 bg-slate-200/35 px-2 py-1 text-xs font-medium text-skin-ink hover:bg-slate-300/35 dark:border-slate-500/45 dark:bg-slate-700/35 dark:hover:bg-slate-700/55"
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>

      {expanded && loading && rows.length > 0 ? (
        <p className="text-xs text-skin-sub">父页面正在批量加载本场 slim（plan_b）…</p>
      ) : null}
      {expanded && data ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            <div className="rounded border border-skin-line p-3">
              <p className="mb-2 text-xs font-semibold text-skin-sub">天赋树左右选择率</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.talentRows.map((t) => (
                  <div key={t.level} className="rounded border border-slate-500/35 bg-slate-200/30 px-2 py-1.5 text-[11px] dark:border-slate-500/45 dark:bg-slate-700/30">
                    <p className="font-semibold text-skin-ink">Lv {t.level}</p>
                    <p className="text-skin-sub">Left {t.leftPct.toFixed(0)}% · Right {t.rightPct.toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded border border-skin-line p-3">
              <p className="mb-2 text-xs font-semibold text-skin-sub">核心出装（时间 + 购买率）</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {data.itemTop.length ? data.itemTop.map((it) => (
                  <div key={it.itemKey} className="rounded border border-slate-500/35 bg-slate-200/35 p-1.5 text-center dark:border-slate-500/45 dark:bg-slate-700/35">
                    <button
                      type="button"
                      className="w-full"
                      onClick={() =>
                        setSelectedItemKey((prev) =>
                          prev === it.itemKey ? null : it.itemKey
                        )
                      }
                      title={`查看 ${it.itemKey} 对局`}
                    >
                      <img
                        src={itemIconUrl(it.itemKey)}
                        alt={it.itemKey}
                        className="mx-auto h-9 w-9 rounded object-cover"
                        {...steamCdnImgDefer}
                        onError={onDotaSteamAssetImgError}
                      />
                      <p className="mt-1 text-[10px] text-skin-ink">{Math.round(it.avgMinute)}m</p>
                      <p className="text-[10px] text-skin-sub">{it.pct.toFixed(0)}%</p>
                    </button>
                  </div>
                )) : <span className="col-span-full text-xs text-skin-sub">暂无购买样本</span>}
              </div>
              {selectedItemKey ? (
                <div className="mt-3 rounded border border-slate-500/35 bg-slate-200/25 p-2 dark:border-slate-500/45 dark:bg-slate-700/25">
                  <p className="mb-1 text-xs font-semibold text-skin-ink">
                    {selectedItemKey} 对局
                  </p>
                  <div className="max-h-44 overflow-auto">
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                      {(data.itemMatches[selectedItemKey] || []).slice(0, 60).map((row) => (
                        <Link
                          key={`${selectedItemKey}-${row.matchId}`}
                          to={`/match/${row.matchId}`}
                          className="rounded border border-slate-500/35 px-1.5 py-1 text-[11px] text-skin-sub hover:bg-slate-300/30 dark:border-slate-500/45 dark:hover:bg-slate-700/35"
                        >
                          {row.minute}m · {row.won ? "胜" : "负"} · {row.matchId}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded border border-skin-line p-3">
              <p className="mb-2 text-xs font-semibold text-skin-sub">Countered By</p>
              <div className="grid grid-cols-5 gap-1.5">
                {data.counteredBy.map((h) => {
                  const hk = maps.heroes[String(h.heroId)]?.key || "invoker";
                  return (
                    <div key={`bad-${h.heroId}`} className="text-center">
                      <img src={heroIconUrl(hk)} alt={hk} className="mx-auto h-9 w-9 rounded object-cover" {...steamCdnImgDefer} onError={onDotaSteamAssetImgError} />
                      <p className="text-[10px] text-rose-400">{h.winRate.toFixed(1)}%</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded border border-skin-line p-3">
              <p className="mb-2 text-xs font-semibold text-skin-sub">Good Against</p>
              <div className="grid grid-cols-5 gap-1.5">
                {data.goodAgainst.map((h) => {
                  const hk = maps.heroes[String(h.heroId)]?.key || "invoker";
                  return (
                    <div key={`good-${h.heroId}`} className="text-center">
                      <img src={heroIconUrl(hk)} alt={hk} className="mx-auto h-9 w-9 rounded object-cover" {...steamCdnImgDefer} onError={onDotaSteamAssetImgError} />
                      <p className="text-[10px] text-emerald-400">{h.winRate.toFixed(1)}%</p>
                    </div>
                  );
                })}
              </div>
            </div>
            {onWithHeroChange && onVsHeroChange ? (
              <div className="rounded border border-skin-line p-3">
                <p className="mb-2 text-xs font-semibold text-skin-sub">组合筛选</p>
                <div className="space-y-2">
                  <div>
                    <p className="mb-1 text-[11px] text-skin-sub">搭配队友</p>
                    <HeroPickerPopover
                      mode="teammate"
                      maps={maps}
                      value={withHeroId}
                      onChange={onWithHeroChange}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] text-skin-sub">对抗对手</p>
                    <HeroPickerPopover
                      mode="opponent"
                      maps={maps}
                      value={vsHeroId}
                      onChange={onVsHeroChange}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}

