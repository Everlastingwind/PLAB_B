import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import type { FeedSelection } from "../components/FeedModeToggle";
import {
  fetchReplaysForFeedSelection,
  filterByHeroKey,
  hasMore,
  slicePage,
  heroKeyFromId,
} from "../lib/replaysApi";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";
import {
  replayIndexCanLinkProPlayer,
  replayIndexEffectiveProRaw,
  replayIndexPlayerDisplayLabel,
} from "../lib/playerDisplay";
import {
  abilityIconUrl,
  heroIconUrl,
  itemIconUrl,
  normalizeDotaAssetUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
  steamCdnImgHero,
} from "../data/mockMatchPlayers";
import type { SkillBuildStepUi } from "../data/mockMatchPlayers";
import { SkillBuildTimeline } from "../components/SkillBuildTimeline";
import {
  isRubickHero,
  isRubickNativeSlimSkillBuildStep,
} from "../lib/rubickSkillBuild";
import { cn } from "../lib/cn";
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import { TalentTreeBadge } from "../components/TalentTreeBadge";
import type { TalentPickUi, TalentTreeUi } from "../data/mockMatchPlayers";
import { SEOMeta } from "../components/SEOMeta";
import { ViewportMountRow } from "../components/ViewportMountRow";
import { forEachConcurrent } from "../lib/fetchConcurrent";
import { loadSlimMatchJsonForDetail } from "../lib/loadSlimMatchJson";

const MATCH_JSON_CONCURRENCY = 6;

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

function normalizeTalentKey(k: string): string {
  const s = String(k || "").trim().toLowerCase();
  if (!s) return "";
  // tiny / primal / doom historical key compatibility
  if (s === "special_bonus_attack_damage_30") return "special_bonus_attack_damage_25";
  if (s === "special_bonus_attack_damage_25") return "special_bonus_attack_damage_25";
  if (s === "special_bonus_unique_doom_3") return "special_bonus_magic_resistance_10";
  return s;
}

function mergeTalentTreeBySkillBuild(
  tree: TalentTreeUi | null,
  player: SlimPlayer | undefined,
  maps: NonNullable<ReturnType<typeof useEntityMaps>["maps"]>
): TalentTreeUi | null {
  if (!tree?.tiers?.length || !player) return tree;
  const pickedOrdered: string[] = [];
  // Prefer ability_upgrades_arr exact order (authoritative for pick chronology).
  if (Array.isArray(player.ability_upgrades_arr) && player.ability_upgrades_arr.length) {
    const abilityMap = maps.abilities || {};
    for (const raw of player.ability_upgrades_arr) {
      const id = Number(raw);
      if (!Number.isFinite(id) || id <= 0) continue;
      const row = abilityMap[String(id)];
      const k = normalizeTalentKey(String(row?.key || ""));
      if (k.startsWith("special_bonus_")) pickedOrdered.push(k);
    }
  }
  // Fallback: skill_build talent events.
  if (!pickedOrdered.length && Array.isArray(player.skill_build)) {
    for (const s of player.skill_build) {
      const isTalent = s?.type === "talent" || Boolean(s?.is_talent);
      if (!isTalent) continue;
      const k = normalizeTalentKey(String(s?.ability_key || ""));
      if (k) pickedOrdered.push(k);
    }
  }
  if (!pickedOrdered.length) return tree;
  const tiers = tree.tiers.map((tier) => {
    const lk = normalizeTalentKey(tier.left?.abilityKey || "");
    const rk = normalizeTalentKey(tier.right?.abilityKey || "");
    const li = lk ? pickedOrdered.indexOf(lk) : -1;
    const ri = rk ? pickedOrdered.indexOf(rk) : -1;
    if (li >= 0 && ri < 0) return { ...tier, selected: "left" as const };
    if (ri >= 0 && li < 0) return { ...tier, selected: "right" as const };
    // If both sides are eventually picked (deferred talent case), use the one picked first.
    if (li >= 0 && ri >= 0) {
      return { ...tier, selected: li <= ri ? ("left" as const) : ("right" as const) };
    }
    return tier;
  });
  return {
    ...tree,
    tiers,
    dotsLearned: tiers.filter((t) => t.selected === "left" || t.selected === "right")
      .length,
  };
}

export function HeroMatchesPage() {
  const { heroKey = "" } = useParams<{ heroKey: string }>();
  const nav = useNavigate();
  const decoded = decodeURIComponent(heroKey);
  const { maps, loading: mapsLoading } = useEntityMaps();
  const [feed, setFeed] = useState<FeedSelection>({ pub: true, pro: false });
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [feedListLoading, setFeedListLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [detailByMatch, setDetailByMatch] = useState<Record<number, SlimMatchJson>>(
    {}
  );
  const [playerUiByMatch, setPlayerUiByMatch] = useState<
    Record<
      number,
      {
        tree: TalentTreeUi | null | undefined;
        picks?: TalentPickUi[];
        skillBuild?: SkillBuildStepUi[];
      }
    >
  >({});
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPage(1);
    setRoleFilter("all");
  }, [decoded, feed]);

  useEffect(() => {
    if (!maps) return;
    let cancelled = false;
    setFeedListLoading(true);
    setReplays([]);
    void fetchReplaysForFeedSelection(feed)
      .then(({ replays: rows, cloudIndexError }) => {
        if (!cancelled) {
          if (cloudIndexError) console.warn(cloudIndexError);
          setReplays(filterByHeroKey(rows, decoded, maps));
          setDetailByMatch({});
          setPlayerUiByMatch({});
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
  }, [decoded, maps, feed]);

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

  const replayRole = useCallback(
    (r: ReplaySummary): string => {
      const p0 = (r.players || []).find(
        (x) => heroKeyFromId(x.hero_id, maps!) === decoded
      );
      const fromSummary = normalizeRole((p0 as { role_early?: unknown } | undefined)?.role_early);
      if (fromSummary) return fromSummary;
      const detail = detailByMatch[r.match_id];
      const row = (detail?.players || []).find(
        (x) => heroKeyFromId(Number(x.hero_id || 0), maps!) === decoded
      );
      return normalizeRole((row as { role_early?: unknown } | undefined)?.role_early);
    },
    [decoded, detailByMatch, maps]
  );

  const roleOptions = useMemo(
    () => ["carry", "mid", "offlane", "support(4)", "support(5)"],
    []
  );

  const filteredReplays = useMemo(() => {
    if (roleFilter === "all") return replays;
    return replays.filter((r) => replayRole(r) === roleFilter);
  }, [replays, replayRole, roleFilter]);

  const roleCounts = useMemo(() => {
    const out: Record<string, number> = {
      carry: 0,
      mid: 0,
      offlane: 0,
      "support(4)": 0,
      "support(5)": 0,
    };
    for (const r of replays) {
      const rr = replayRole(r);
      if (rr in out) out[rr] += 1;
    }
    return out;
  }, [replays, replayRole]);

  const visible = useMemo(
    () => slicePage(filteredReplays, page),
    [filteredReplays, page]
  );

  useEffect(() => {
    let cancelled = false;
    if (!maps) return;
    const need = visible
      .map((r) => r.match_id)
      .filter((mid) => !detailByMatch[mid]);
    if (!need.length) return;
    (async () => {
      const [{ buildUiFromSlim, DEFAULT_TEAM_NAMES }, proOverrides] =
        await Promise.all([
          import("../adapters/slimToUi"),
          import("../lib/proAccountDisplayOverrides").then((m) =>
            m.loadProAccountDisplayOverrides()
          ),
        ]);
      const updates: Record<number, SlimMatchJson> = {};
      const playerUiUpdates: Record<
        number,
        {
          tree: TalentTreeUi | null | undefined;
          picks?: TalentPickUi[];
          skillBuild?: SkillBuildStepUi[];
        }
      > = {};
      await forEachConcurrent(need, MATCH_JSON_CONCURRENCY, async (mid) => {
        try {
          const j = await loadSlimMatchJsonForDetail(mid);
          if (!j) return;
          updates[mid] = j;
          try {
            const ui = buildUiFromSlim(j, maps, {
              ...DEFAULT_TEAM_NAMES,
              proDisplayNameByAccountId: proOverrides,
            });
            const uiPlayers = [...ui.radiant.players, ...ui.dire.players];
            const p0 = (replays.find((x) => x.match_id === mid)?.players || []).find(
              (x) => heroKeyFromId(x.hero_id, maps) === decoded
            );
            const exact = uiPlayers.find((x) => {
              if (x.heroKey !== decoded) return false;
              const pName =
                p0 && Number(p0.account_id) > 0
                  ? replayIndexEffectiveProRaw(
                      Number(p0.account_id),
                      p0.pro_name
                    )
                  : String(p0?.pro_name ?? "").trim();
              const xName = String(x.proName ?? "").trim();
              if (pName && xName) return pName === xName;
              return true;
            });
            if (exact) {
              playerUiUpdates[mid] = {
                tree: exact.talentTree,
                picks: exact.talentPicks,
                skillBuild: exact.skillBuild,
              };
            }
          } catch {
            // adapter failure should not block main row rendering
          }
        } catch {
          // ignore detail fetch errors
        }
      });
      if (!cancelled && Object.keys(updates).length) {
        setDetailByMatch((prev) => ({ ...prev, ...updates }));
        if (Object.keys(playerUiUpdates).length) {
          setPlayerUiByMatch((prev) => ({ ...prev, ...playerUiUpdates }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, detailByMatch, maps, decoded, replays]);

  const onIntersect = useCallback(() => {
    setPage((p) => (hasMore(filteredReplays.length, p) ? p + 1 : p));
  }, [filteredReplays.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !maps) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) onIntersect();
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [maps, onIntersect, visible.length]);

  const heroLabel =
    maps?.heroes &&
    Object.values(maps.heroes).find((h) => h.key === decoded);
  const heroNameEn = heroLabel?.nameEn || decoded;
  return (
    <>
      <SEOMeta
        title={`${heroNameEn} 胜率异动 | 顶分局出装加点解析`}
        description={`查看 ${heroNameEn} 的最新高分局出装路线、技能加点与关键团战表现。`}
        keywords={`${heroNameEn},DOTA2英雄数据,高分局,出装,技能加点`}
      />
      <PageShell centerSearch feedMode={feed} onFeedModeChange={setFeed}>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-bold text-skin-ink">
              包含「{heroLabel?.nameCn || heroLabel?.nameEn || decoded}」的对局
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
          {!mapsLoading && maps ? (
            feedListLoading ? (
              <p className="text-sm text-skin-sub">加载录像列表…</p>
            ) : filteredReplays.length === 0 ? (
              <p className="text-sm text-skin-sub">
                {replays.length === 0
                  ? "暂无该英雄的录像记录。"
                  : `暂无该英雄在 ${roleLabel(roleFilter)} 位置的对局。`}
              </p>
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border border-skin-line">
                  <div className="grid grid-cols-[190px_120px_90px_90px_240px_260px_70px_160px] gap-2 border-b border-skin-line bg-skin-inset px-3 py-2 text-[11px] font-semibold text-skin-sub">
                    <div>英雄</div>
                    <div>选手</div>
                    <div>K/D/A</div>
                    <div>位置</div>
                    <div>出装</div>
                    <div>技能加点</div>
                    <div className="text-center">天赋</div>
                    <div className="text-right pr-3">比赛编号</div>
                  </div>
                  {visible.map((r, vIdx) => {
                    const p = r.players.find(
                      (x) => heroKeyFromId(x.hero_id, maps) === decoded
                    );
                    const matchDetail = detailByMatch[r.match_id];
                    const row = (() => {
                      const players = matchDetail?.players || [];
                      if (!players.length) return undefined;
                      // Prefer exact player from replay row (same account + same hero)
                      if (p?.account_id && p.account_id > 0) {
                        const exact = players.find(
                          (x) =>
                            Number(x.account_id || 0) === Number(p.account_id) &&
                            heroKeyFromId(Number(x.hero_id || 0), maps) === decoded
                        );
                        if (exact) return exact;
                      }
                      // Fallback: same hero in this match
                      return players.find(
                        (x) => heroKeyFromId(Number(x.hero_id || 0), maps) === decoded
                      );
                    })();
                    const k = p?.kills ?? 0;
                    const d = p?.deaths ?? 0;
                    const a = p?.assists ?? 0;
                    const accountId = Number(p?.account_id ?? 0);
                    const canLinkPlayer = replayIndexCanLinkProPlayer(
                      accountId,
                      p?.pro_name ?? null
                    );
                    const playerColLabel = replayIndexPlayerDisplayLabel(
                      accountId,
                      p?.pro_name ?? null
                    );
                    const items = (row?.items_slot || []).slice(0, 6);
                    const rawSkillSteps = (row?.skill_build || []).filter(
                      (s) => s && s.type !== "empty"
                    );
                    const steps =
                      row &&
                      isRubickHero(Number(row.hero_id || 0), decoded)
                        ? rawSkillSteps.filter((s) =>
                            isRubickNativeSlimSkillBuildStep(s)
                          )
                        : rawSkillSteps;
                    const stepsSlice = steps.slice(0, 16);
                    const skillBuildFromAdapter = playerUiByMatch[r.match_id]?.skillBuild;
                    const talentTreeFallback = mergeTalentTreeBySkillBuild(
                      toTalentTreeUi(row?.talent_tree),
                      row,
                      maps
                    );
                    const talentPicksFallback = toTalentPicksUi(row?.talent_picks);
                    const fromAdapter = playerUiByMatch[r.match_id];
                    const talentTree = fromAdapter?.tree ?? talentTreeFallback;
                    const talentPicks = fromAdapter?.picks ?? talentPicksFallback;
                    return (
                      <ViewportMountRow
                        key={`${r.match_id}-${r.uploaded_at}`}
                        index={vIdx}
                        skeleton={
                          <div className="grid grid-cols-[190px_120px_90px_90px_240px_260px_70px_160px] gap-2 border-b border-slate-500/55 px-3 py-3 min-h-[52px] bg-slate-100/25 dark:bg-slate-900/30" />
                        }
                      >
                        <div
                          className={cn(
                            "grid cursor-pointer grid-cols-[190px_120px_90px_90px_240px_260px_70px_160px] gap-2 border-b border-slate-500/55 px-3 py-2 text-xs transition-colors hover:bg-slate-100/60 dark:border-slate-700/80 dark:hover:bg-slate-800/40",
                            vIdx === visible.length - 1 && "border-b-0"
                          )}
                          title={`查看比赛 ${r.match_id}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => nav(`/match/${r.match_id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              nav(`/match/${r.match_id}`);
                            }
                          }}
                        >
                        <div className="flex items-center gap-2">
                          <img
                            src={heroIconUrl(decoded === "unknown" ? "invoker" : decoded)}
                            alt=""
                            className="h-10 w-10 rounded object-cover"
                            {...(vIdx < 2 ? steamCdnImgHero : steamCdnImgDefer)}
                            onError={onDotaSteamAssetImgError}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-skin-ink">
                              {heroLabel?.nameCn || heroLabel?.nameEn || decoded}
                            </div>
                            <div className="truncate text-[11px] text-skin-sub">
                              {heroLabel?.nameEn || decoded}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center truncate text-skin-ink">
                          {canLinkPlayer ? (
                            <Link
                              to={`/player/${accountId}`}
                              className="truncate hover:underline"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              {playerColLabel}
                            </Link>
                          ) : (
                            <span className="text-skin-sub">
                              {playerColLabel === "匿名玩家"
                                ? "匿名"
                                : playerColLabel}
                            </span>
                          )}
                        </div>
                        <div className="font-mono tabular-nums text-skin-ink">
                          {k}/{d}/{a}
                        </div>
                        <div className="flex items-center">
                          <span className="rounded border border-slate-500/35 bg-slate-200/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700 dark:border-slate-500/45 dark:bg-slate-700/40 dark:text-slate-200">
                            {String(row?.role_early || "-")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {items.filter((it) => !it.empty && (it.item_key || it.image_url))
                            .length
                            ? items.map((it, idx) =>
                                !it.empty && (it.item_key || it.image_url) ? (
                                  <img
                                    key={`${r.match_id}-it-${idx}`}
                                    src={
                                      normalizeDotaAssetUrl(
                                        String(it.image_url || "").trim()
                                      ) ||
                                      itemIconUrl(
                                        String(it.item_key || "").replace(/^item_/, "")
                                      )
                                    }
                                    alt=""
                                    className="h-8 w-8 rounded object-cover"
                                    loading="lazy"
                                    decoding="async"
                                    referrerPolicy="no-referrer"
                                    fetchPriority="low"
                                    onError={onDotaSteamAssetImgError}
                                  />
                                ) : null
                              )
                            : <span className="text-skin-sub">-</span>}
                        </div>
                        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                          {skillBuildFromAdapter?.length ? (
                            <div className="min-w-0 max-w-full scale-90 origin-left">
                              <SkillBuildTimeline steps={skillBuildFromAdapter} />
                            </div>
                          ) : stepsSlice.length ? (
                            stepsSlice.map((s, idx) => {
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
                                  className="h-6 w-6 rounded object-cover"
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
                          ) : (
                            <span className="text-skin-sub">-</span>
                          )}
                        </div>
                        <div className="flex items-center justify-center">
                          {talentTree || talentPicks.length > 0 ? (
                            <TalentTreeBadge tree={talentTree} talentPicks={talentPicks} />
                          ) : (
                            <span className="text-[11px] text-skin-sub">-</span>
                          )}
                        </div>
                        <div className="flex items-center justify-end pr-3">
                          <span className="w-full text-right font-mono tabular-nums text-[11px] text-amber-700 dark:text-amber-400">
                            {r.match_id}
                          </span>
                        </div>
                      </div>
                      </ViewportMountRow>
                    );
                  })}
                </div>
                <div ref={sentinelRef} className="h-8 w-full" aria-hidden />
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
