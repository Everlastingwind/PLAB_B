import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import type { FeedSelection } from "../components/FeedModeToggle";
import {
  MATCH_LIST_LOAD_STEP,
  fetchReplaysForPlayerProfile,
  replayMatchesLatestPatch,
} from "../lib/replaysApi";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";
import { privacyMaskedPlayerDisplayName } from "../lib/playerDisplay";
import { heroKeyFromId } from "../lib/replaysApi";
import {
  abilityIconUrl,
  heroIconUrl,
  itemIconUrl,
  normalizeDotaAssetUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
  steamCdnImgHero,
} from "../data/mockMatchPlayers";
import { cn } from "../lib/cn";
import { MECHA_INSET, MECHA_RAISED } from "../lib/mechaStyles";
import type { SlimPlayer } from "../types/slimMatch";
import { TalentTreeBadge } from "../components/TalentTreeBadge";
import type { TalentPickUi, TalentTreeUi } from "../data/mockMatchPlayers";
import { SEO } from "../components/SEO";
import { ViewportMountRow } from "../components/ViewportMountRow";
import { loadSlimMatchJsonForDetails } from "../lib/loadSlimMatchJson";
import { useSitePatch } from "../contexts/SitePatchContext";
import { mainSixSlotsFromPlayerRecord } from "../lib/matchInventory";

function replayUploadedMs(r: ReplaySummary): number {
  const t = new Date(r.uploaded_at).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toTalentTreeUi(raw: SlimPlayer["talent_tree"]): TalentTreeUi | null {
  if (!raw || !Array.isArray(raw.tiers)) return null;
  const tiers: TalentTreeUi["tiers"] = raw.tiers.map((t) => ({
    heroLevel: Number(t.hero_level || 0),
    left: {
      abilityKey: String(t.left?.ability_key || ""),
      labelCn: String(t.left?.label_cn || ""),
      labelEn: String(t.left?.label_en || ""),
    },
    right: {
      abilityKey: String(t.right?.ability_key || ""),
      labelCn: String(t.right?.label_cn || ""),
      labelEn: String(t.right?.label_en || ""),
    },
    selected:
      t.selected === "left" || t.selected === "right" ? t.selected : null,
  }));
  return {
    tiers,
    dotsLearned: Number(raw.dots_learned || 0),
  };
}

function toTalentPicksUi(raw: SlimPlayer["talent_picks"]): TalentPickUi[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      level: Number(p.level ?? p.hero_level ?? 0),
      direction: String(p.direction || ""),
      talent_name: p.talent_name,
      name: p.name,
    }))
    .filter((p) => Number.isFinite(p.level) && p.level > 0);
}

export function PlayerMatchesPage() {
  const { patch } = useSitePatch();
  if (!patch) return null;

  const { accountId = "0" } = useParams<{ accountId: string }>();
  const [searchParams] = useSearchParams();
  const heroFilterKey = (searchParams.get("hero") || "").trim();
  const aid = Number(accountId) || 0;
  const { maps, loading: mapsLoading } = useEntityMaps();
  const [feed, setFeed] = useState<FeedSelection>({ pub: true, pro: false });
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [feedListLoading, setFeedListLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [detailByMatch, setDetailByMatch] = useState<
    Record<number, SlimPlayer | null>
  >({});
  const [listPage, setListPage] = useState(1);

  useEffect(() => {
    setListPage(1);
    setRoleFilter("all");
  }, [aid, feed]);

  useEffect(() => {
    setListPage(1);
  }, [heroFilterKey]);

  useEffect(() => {
    let cancelled = false;
    setFeedListLoading(true);
    setReplays([]);
    void fetchReplaysForPlayerProfile(feed, aid)
      .then(({ replays: rows, cloudIndexError }) => {
        if (!cancelled) {
          if (cloudIndexError) console.warn(cloudIndexError);
          setReplays(rows);
          setDetailByMatch({});
          setFeedListLoading(false);
        }
      })
      .catch(() => {
      if (!cancelled) {
        setFeedListLoading(false);
        setReplays([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [aid, feed]);

  const normalizeRole = (raw: unknown): string => {
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s) return "";
    if (s === "support4" || s === "support 4" || s === "support(4)") return "support(4)";
    if (s === "support5" || s === "support 5" || s === "support(5)") return "support(5)";
    if (s === "carry" || s === "mid" || s === "offlane") return s;
    return s;
  };

  const roleLabel = (role: string): string => {
    if (role === "support(4)") return "pos4";
    if (role === "support(5)") return "pos5";
    return role;
  };

  /** 筛选/统计仅用索引行 role_early，避免 slim 回填后列表签名变化触发二次 plan_b 请求 */
  const replayRoleIndexOnly = useCallback(
    (r: ReplaySummary): string => {
      const ps = (r.players || []).find((x) => Number(x.account_id || 0) === aid) as
        | ({ role_early?: unknown } & typeof r.players[number])
        | undefined;
      return normalizeRole(ps?.role_early);
    },
    [aid]
  );

  const roleOptions = useMemo(
    () => ["carry", "mid", "offlane", "support(4)", "support(5)"],
    []
  );

  const roleFilteredReplays = useMemo(() => {
    if (roleFilter === "all") return replays;
    return replays.filter((r) => replayRoleIndexOnly(r) === roleFilter);
  }, [replays, replayRoleIndexOnly, roleFilter]);

  const filteredReplays = useMemo(() => {
    if (!heroFilterKey || !maps) return roleFilteredReplays;
    return roleFilteredReplays.filter((r) => {
      const p = r.players.find((x) => Number(x.account_id || 0) === aid);
      if (!p) return false;
      return heroKeyFromId(p.hero_id, maps) === heroFilterKey;
    });
  }, [roleFilteredReplays, heroFilterKey, maps, aid]);

  /** 当前补丁在上、历史补丁在下；段内按上传时间倒序 */
  const orderedFilteredReplays = useMemo(() => {
    const latest = filteredReplays
      .filter((r) => replayMatchesLatestPatch(r, patch.currentPatch))
      .sort((a, b) => replayUploadedMs(b) - replayUploadedMs(a));
    const legacy = filteredReplays
      .filter((r) => !replayMatchesLatestPatch(r, patch.currentPatch))
      .sort((a, b) => replayUploadedMs(b) - replayUploadedMs(a));
    return [...latest, ...legacy];
  }, [filteredReplays, patch.currentPatch]);

  const firstLegacySectionIndex = useMemo(() => {
    const i = orderedFilteredReplays.findIndex(
      (r) => !replayMatchesLatestPatch(r, patch.currentPatch)
    );
    return i >= 0 ? i : null;
  }, [orderedFilteredReplays, patch.currentPatch]);

  const roleCounts = useMemo(() => {
    const out: Record<string, number> = {
      carry: 0,
      mid: 0,
      offlane: 0,
      "support(4)": 0,
      "support(5)": 0,
    };
    for (const r of replays) {
      const rr = replayRoleIndexOnly(r);
      if (rr in out) out[rr] += 1;
    }
    return out;
  }, [replays, replayRoleIndexOnly]);

  const filteredReplayIdsSignature = useMemo(
    () => orderedFilteredReplays.map((r) => String(r.match_id)).join(","),
    [orderedFilteredReplays]
  );

  const totalListPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(orderedFilteredReplays.length / MATCH_LIST_LOAD_STEP)
      ),
    [orderedFilteredReplays.length]
  );

  const pageForList = Math.min(listPage, totalListPages);

  const displayedReplays = useMemo(() => {
    const start = (pageForList - 1) * MATCH_LIST_LOAD_STEP;
    return orderedFilteredReplays.slice(
      start,
      pageForList * MATCH_LIST_LOAD_STEP
    );
  }, [orderedFilteredReplays, pageForList]);

  const visibleMatchIdsKey = useMemo(
    () => displayedReplays.map((r) => r.match_id).join(","),
    [displayedReplays]
  );

  const visibleMatchIds = useMemo(
    () =>
      visibleMatchIdsKey
        .split(",")
        .map((s) => Number(s))
        .filter((id) => Number.isFinite(id) && id > 0),
    [visibleMatchIdsKey]
  );

  const playerSlimIdsToFetch = useMemo(
    () =>
      visibleMatchIds.filter((id) => detailByMatch[id] === undefined),
    [visibleMatchIds, detailByMatch]
  );
  const playerSlimIdsToFetchKey = playerSlimIdsToFetch.join(",");

  useEffect(() => {
    setListPage(1);
  }, [filteredReplayIdsSignature]);

  useEffect(() => {
    if (listPage > totalListPages) setListPage(totalListPages);
  }, [listPage, totalListPages]);

  useEffect(() => {
    let cancelled = false;
    if (aid <= 0 || playerSlimIdsToFetch.length === 0) return;
    void (async () => {
      try {
        const batch = await loadSlimMatchJsonForDetails(playerSlimIdsToFetch, {
          preferCloud: true,
        });
        if (cancelled) return;
        setDetailByMatch((prev) => {
          const next = { ...prev };
          for (const mid of playerSlimIdsToFetch) {
            const j = batch[mid];
            if (!j) {
              next[mid] = null;
              continue;
            }
            const p = (j.players || []).find(
              (x) => Number(x.account_id || 0) === aid
            );
            next[mid] = p ?? null;
          }
          return next;
        });
      } catch {
        if (cancelled) return;
        setDetailByMatch((prev) => {
          const next = { ...prev };
          for (const mid of playerSlimIdsToFetch) next[mid] = null;
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerSlimIdsToFetchKey, aid]);

  const titleName = useMemo(() => {
    let bestPro: string | null = null;
    for (const r of replays) {
      for (const p of r.players) {
        if (p.account_id !== aid) continue;
        const t = String(p.pro_name ?? "").trim();
        if (t) {
          bestPro = t;
          break;
        }
      }
      if (bestPro) break;
    }
    return privacyMaskedPlayerDisplayName(aid, bestPro);
  }, [replays, aid]);

  /** 该选手在各局中的英雄（去重） */
  const heroSummaries = useMemo(() => {
    if (!maps) return [];
    const m = new Map<number, { hero_id: number; key: string; count: number }>();
    for (const r of replays) {
      for (const p of r.players) {
        if (p.account_id !== aid) continue;
        const prev = m.get(p.hero_id);
        if (prev) prev.count += 1;
        else
          m.set(p.hero_id, {
            hero_id: p.hero_id,
            key: heroKeyFromId(p.hero_id, maps),
            count: 1,
          });
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [replays, aid, maps]);

  const playerName = titleName !== "匿名" ? titleName : `玩家 #${accountId}`;
  const coreHeroNameEn = useMemo(() => {
    const topHero = heroSummaries[0];
    if (!topHero) return "未知英雄";
    return (
      maps?.heroes[String(topHero.hero_id)]?.nameEn ||
      maps?.heroes[String(topHero.hero_id)]?.nameCn ||
      topHero.key
    );
  }, [heroSummaries, maps]);

  // SEO：全页标题为「选手名 - 近期天梯战绩 - PlanB」；英雄名用于补充描述/关键词
  const seoDescription = `查看 ${playerName} 的最新高分局出装路线与正反补细节对比，重点追踪 ${coreHeroNameEn} 等核心英雄的近期打法变化。`;

  return (
    <>
      <SEO
        fullTitle
        title={`${playerName} - 近期天梯战绩 - PlanB`}
        description={seoDescription}
        keywords={`${playerName},DOTA2高分局,${coreHeroNameEn},出装路线,对线正反补,天梯`}
      />
      <PageShell centerSearch feedMode={feed} onFeedModeChange={setFeed}>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-bold text-skin-ink">
              {titleName !== "匿名" ? `选手 ${titleName}` : `玩家 #${accountId}`}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRoleFilter("all")}
                className={cn(
                  "rounded border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
                  roleFilter === "all"
                    ? "border-amber-500/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-slate-500/35 bg-slate-200/40 text-slate-700 hover:bg-slate-300/45 dark:border-slate-500/45 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:bg-slate-700/60"
                )}
              >
                all ({replays.length})
              </button>
              {roleOptions.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoleFilter(role)}
                  className={cn(
                    "rounded border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
                    roleFilter === role
                      ? "border-emerald-500/45 bg-emerald-100/70 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "border-slate-500/35 bg-slate-200/40 text-slate-700 hover:bg-slate-300/45 dark:border-slate-500/45 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:bg-slate-700/60"
                  )}
                >
                  {roleLabel(role)} ({roleCounts[role] || 0})
                </button>
              ))}
            </div>
          </div>

          {!mapsLoading && maps && heroSummaries.length > 0 ? (
            <section className="mb-8">
              <h2 className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-bold uppercase tracking-[0.15em] text-skin-sub">
                <span>使用英雄</span>
                {heroFilterKey ? (
                  <Link
                    to={`/player/${encodeURIComponent(accountId)}`}
                    className="font-sans text-[11px] font-medium normal-case tracking-normal text-amber-700 hover:underline dark:text-amber-400"
                  >
                    显示全部对局
                  </Link>
                ) : null}
              </h2>
              <div className="flex flex-wrap gap-2">
                {heroSummaries.map((h) => (
                  <Link
                    key={h.hero_id}
                    to={`/player/${encodeURIComponent(accountId)}?hero=${encodeURIComponent(h.key)}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs text-skin-ink transition hover:border-amber-500/40 hover:text-amber-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-amber-400",
                      MECHA_INSET,
                      heroFilterKey === h.key
                        ? "border-amber-500/50 bg-amber-100/60 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                        : "border-skin-line"
                    )}
                  >
                    <span className={cn("rounded p-0.5", MECHA_RAISED)}>
                      <img
                        src={heroIconUrl(
                          h.key === "unknown" ? "invoker" : h.key
                        )}
                        alt=""
                        className="h-8 w-8 rounded-[2px] object-cover bg-slate-200 dark:bg-slate-800"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        fetchPriority="low"
                        onError={onDotaSteamAssetImgError}
                      />
                    </span>
                    <span>
                      {maps.heroes[String(h.hero_id)]?.nameCn ||
                        maps.heroes[String(h.hero_id)]?.nameEn ||
                        h.key}
                      <span className="ml-1 text-skin-sub">×{h.count}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {!mapsLoading && maps ? (
            feedListLoading ? (
              <p className="text-sm text-skin-sub">加载录像列表…</p>
            ) : filteredReplays.length === 0 ? (
              <p className="text-sm text-skin-sub">
                {replays.length === 0
                  ? "暂无该账号的录像记录。"
                  : heroFilterKey
                    ? "暂无该选手使用此英雄的对局（在当前索引与位置筛选下）。"
                    : `暂无该选手在 ${roleLabel(roleFilter)} 位置的对局。`}
              </p>
            ) : (
              <>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-skin-sub">
                  对局明细
                </h2>
                <div className="overflow-hidden rounded-lg border border-skin-line">
                  <div className="grid w-full grid-cols-[minmax(190px,1.15fr)_84px_84px_minmax(220px,1.2fr)_minmax(250px,1.45fr)_72px_72px_136px] gap-2 border-b border-skin-line bg-skin-inset px-3 py-2 text-[11px] font-semibold text-skin-sub">
                    <div>英雄</div>
                    <div>K/D/A</div>
                    <div>位置</div>
                    <div>出装</div>
                    <div>技能加点</div>
                    <div className="text-center">天赋</div>
                    <div className="text-center">结果</div>
                    <div className="flex items-center justify-center">比赛编号</div>
                  </div>
                  {displayedReplays.map((r, vIdx) => {
                    const row = detailByMatch[r.match_id];
                    const p = r.players.find((x) => x.account_id === aid);
                    const isWin =
                      p != null
                        ? Boolean(p.is_radiant) === Boolean(r.radiant_win)
                        : false;
                    const key = p ? heroKeyFromId(p.hero_id, maps) : "unknown";
                    const k = p?.kills ?? 0;
                    const d = p?.deaths ?? 0;
                    const a = p?.assists ?? 0;
                    const mainSix =
                      row && maps
                        ? mainSixSlotsFromPlayerRecord(
                            row as unknown as Record<string, unknown>,
                            row.items_slot ?? null,
                            maps
                          )
                        : null;
                    const steps = (row?.skill_build || [])
                      .filter((s) => s && s.type !== "empty")
                      .slice(0, 16);
                    const talentTree = toTalentTreeUi(row?.talent_tree);
                    const talentPicks = toTalentPicksUi(row?.talent_picks);
                    const globalIdx =
                      (pageForList - 1) * MATCH_LIST_LOAD_STEP + vIdx;
                    const showLegacyDivider =
                      firstLegacySectionIndex != null &&
                      globalIdx === firstLegacySectionIndex;
                    return (
                      <Fragment key={`${r.match_id}-${r.uploaded_at}`}>
                        {showLegacyDivider ? (
                          <div
                            className="border-t border-skin-line bg-skin-inset/60 px-3 py-1.5"
                            role="separator"
                            aria-label={`${patch.previousPatch} 及更早版本对局`}
                          >
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-skin-sub">
                              {patch.previousPatch}
                            </span>
                          </div>
                        ) : null}
                      <ViewportMountRow
                        index={vIdx}
                        rootMargin="40px 0px"
                        skeleton={
                          <div className="grid w-full grid-cols-[minmax(190px,1.15fr)_84px_84px_minmax(220px,1.2fr)_minmax(250px,1.45fr)_72px_72px_136px] gap-2 border-b border-skin-line/70 px-3 py-3 min-h-[52px] bg-skin-inset/30" />
                        }
                      >
                      <div
                        className={cn(
                          "grid w-full grid-cols-[minmax(190px,1.15fr)_84px_84px_minmax(220px,1.2fr)_minmax(250px,1.45fr)_72px_72px_136px] gap-2 border-b border-skin-line/70 px-3 py-2 text-xs",
                          vIdx === displayedReplays.length - 1 && "border-b-0"
                        )}
                      >
                        <Link
                          to={`/match/${r.match_id}`}
                          className="flex items-center gap-2 rounded px-1 py-0.5 transition hover:bg-slate-100 dark:hover:bg-slate-800/70"
                          title={`查看比赛 ${r.match_id}`}
                        >
                          <img
                            src={heroIconUrl(key === "unknown" ? "invoker" : key)}
                            alt=""
                            className="h-10 w-10 rounded object-cover bg-slate-200 dark:bg-slate-800"
                            {...(vIdx < 2 ? steamCdnImgHero : steamCdnImgDefer)}
                            loading="lazy"
                            onError={onDotaSteamAssetImgError}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-skin-ink">
                              {row?.hero_name_cn || maps.heroes[String(p?.hero_id || 0)]?.nameCn || key}
                            </div>
                            <div className="truncate text-[11px] text-skin-sub">
                              {row?.hero_name_en || maps.heroes[String(p?.hero_id || 0)]?.nameEn || key}
                            </div>
                          </div>
                        </Link>
                        <div className="font-mono tabular-nums text-skin-ink">
                          {k}/{d}/{a}
                        </div>
                        <div className="flex items-center">
                          <span className="rounded border border-slate-500/35 bg-slate-200/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700 dark:border-slate-500/45 dark:bg-slate-700/40 dark:text-slate-200">
                            {String(row?.role_early || "-")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {mainSix &&
                          mainSix.some(
                            (s) => s && (s.imageUrl || s.itemKey)
                          ) ? (
                            mainSix.map((slot, idx) => {
                              if (!slot?.itemKey && !slot?.imageUrl) return null;
                              return (
                                <img
                                  key={`${r.match_id}-it-${idx}`}
                                  src={
                                    normalizeDotaAssetUrl(
                                      String(slot.imageUrl || "").trim()
                                    ) ||
                                    itemIconUrl(
                                      String(slot.itemKey || "").replace(
                                        /^item_/,
                                        ""
                                      )
                                    )
                                  }
                                  alt=""
                                  className="h-8 w-8 rounded object-cover bg-slate-200 dark:bg-slate-800"
                                  loading="lazy"
                                  decoding="async"
                                  referrerPolicy="no-referrer"
                                  fetchPriority="low"
                                  onError={onDotaSteamAssetImgError}
                                />
                              );
                            })
                          ) : (
                            <span className="text-skin-sub">-</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 overflow-hidden">
                          {steps.length
                            ? steps.map((s, idx) => {
                                const k0 = String(s.ability_key || "").trim();
                                const isTalent =
                                  s.type === "talent" || Boolean(s.is_talent);
                                if (isTalent) return null;
                                const src = k0 ? abilityIconUrl(k0) : "";
                                return src ? (
                                  <img
                                    key={`${r.match_id}-sb-${idx}`}
                                    src={src}
                                    alt=""
                                    className="h-6 w-6 rounded object-cover bg-slate-200 dark:bg-slate-800"
                                    loading="lazy"
                                    decoding="async"
                                    referrerPolicy="no-referrer"
                                    fetchPriority="low"
                                    onError={(e) =>
                                      onDotaSteamAssetImgError(e, {
                                        tryAbilityFiller: true,
                                      })
                                    }
                                  />
                                ) : null;
                              })
                            : <span className="text-skin-sub">-</span>}
                        </div>
                        <div className="flex items-center justify-center">
                          {talentTree || talentPicks.length > 0 ? (
                            <TalentTreeBadge
                              tree={talentTree}
                              talentPicks={talentPicks}
                            />
                          ) : (
                            <span className="text-[11px] text-skin-sub">-</span>
                          )}
                        </div>
                        <div className="flex items-center justify-center">
                          <span
                            className={cn(
                              "text-[11px] font-semibold uppercase tracking-wide",
                              isWin
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            )}
                          >
                            {isWin ? "win" : "loss"}
                          </span>
                        </div>
                        <div className="flex items-center justify-center">
                          <Link
                            to={`/match/${r.match_id}`}
                            className="font-mono tabular-nums text-[11px] text-amber-700 hover:underline dark:text-amber-400"
                          >
                            {r.match_id}
                          </Link>
                        </div>
                      </div>
                      </ViewportMountRow>
                      </Fragment>
                    );
                  })}
                </div>
                {orderedFilteredReplays.length > 0 ? (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      className="rounded border border-skin-line bg-skin-inset px-3 py-1.5 text-sm text-skin-ink disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={pageForList <= 1}
                      onClick={() =>
                        setListPage((p) => Math.max(1, p - 1))
                      }
                    >
                      上一页
                    </button>
                    <p className="text-xs text-skin-sub tabular-nums">
                      第 {pageForList} / {totalListPages} 页（共{" "}
                      {orderedFilteredReplays.length} 场）
                    </p>
                    <button
                      type="button"
                      className="rounded border border-skin-line bg-skin-inset px-3 py-1.5 text-sm text-skin-ink disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={pageForList >= totalListPages}
                      onClick={() =>
                        setListPage((p) =>
                          Math.min(totalListPages, p + 1)
                        )
                      }
                    >
                      下一页
                    </button>
                  </div>
                ) : null}
              </>
            )
          ) : (
            <p className="text-sm text-skin-sub">加载中…</p>
          )}
        </main>
      </PageShell>
    </>
  );
}
