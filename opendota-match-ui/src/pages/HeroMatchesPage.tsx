import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import type { FeedSelection } from "../components/FeedModeToggle";
import {
  MATCH_LIST_LOAD_STEP,
  fetchReplaysForHeroProfile,
  filterReplaysByTeammateOpponentHero,
  heroKeyFromId,
  replayMatchesLatestPatch,
  type FeedReplayIndexResult,
} from "../lib/replaysApi";
import { slotToRoleEarlyFallbackMap } from "../lib/metaRoleFallback";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";
import {
  replayIndexCanLinkProPlayer,
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
import { loadSlimMatchJsonForDetails } from "../lib/loadSlimMatchJson";
import {
  HeroBuildOverviewCard,
  HERO_OVERVIEW_INSIGHT_CAP,
} from "../components/HeroBuildOverviewCard";
import { supabase } from "../lib/supabaseClient.js";
import {
  extractHeroPatchNotesFromUpdateContent,
  extractVersionFromPatchJsonContent,
} from "../lib/heroPatchFromUpdate";
import { translatePatch741cNote } from "../utils/patch741c_translations";
import { useSitePatch } from "../contexts/SitePatchContext";

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
  const { patch } = useSitePatch();
  if (!patch) return null;

  const { heroKey = "" } = useParams<{ heroKey: string }>();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const decoded = decodeURIComponent(heroKey);
  const { maps, loading: mapsLoading } = useEntityMaps();
  const [feed, setFeed] = useState<FeedSelection>({ pub: true, pro: false });
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [feedListLoading, setFeedListLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [detailByMatch, setDetailByMatch] = useState<
    Record<number, SlimMatchJson | null>
  >({});
  /** 唯一批量 slim/plan_b 拉取由本页 effect 负责；子组件禁止自建请求 */
  const [listPage, setListPage] = useState(1);
  /** 与录像列表并行拉取的最新补丁；null 表示加载中 */
  const [latestHeroPatch, setLatestHeroPatch] = useState<{
    version: string;
    lines: string[];
  } | null>(null);

  const withHeroIdParam = useMemo(() => {
    const raw = searchParams.get("with_hero_id");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);

  const vsHeroIdParam = useMemo(() => {
    const raw = searchParams.get("vs_hero_id");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);

  const setWithHeroIdParam = useCallback(
    (id: number | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id != null && id > 0) next.set("with_hero_id", String(id));
          else next.delete("with_hero_id");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setVsHeroIdParam = useCallback(
    (id: number | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id != null && id > 0) next.set("vs_hero_id", String(id));
          else next.delete("vs_hero_id");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const decodedNavRef = useRef<string | null>(null);
  useEffect(() => {
    if (decodedNavRef.current !== null && decodedNavRef.current !== decoded) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("with_hero_id");
          next.delete("vs_hero_id");
          return next;
        },
        { replace: true }
      );
    }
    decodedNavRef.current = decoded;
  }, [decoded, setSearchParams]);

  useEffect(() => {
    setListPage(1);
    setRoleFilter("all");
  }, [decoded, feed]);

  useEffect(() => {
    const raw = searchParams.get("role")?.trim().toLowerCase() ?? "";
    if (!raw) return;
    const toFilter =
      raw === "pos4"
        ? "support(4)"
        : raw === "pos5"
          ? "support(5)"
          : raw === "carry" || raw === "mid" || raw === "offlane"
            ? raw
            : raw === "support(4)" || raw === "support(5)"
              ? raw
              : null;
    if (
      toFilter &&
      ["carry", "mid", "offlane", "support(4)", "support(5)"].includes(
        toFilter
      )
    ) {
      setRoleFilter(toFilter);
    }
  }, [searchParams, decoded]);

  useEffect(() => {
    setListPage(1);
  }, [withHeroIdParam, vsHeroIdParam]);

  useEffect(() => {
    if (!maps) return;
    let cancelled = false;
    setFeedListLoading(true);
    setReplays([]);
    setLatestHeroPatch(null);
    void (async () => {
      try {
        async function fetchLatestPatchRow(): Promise<{
          version: string | null;
          content: string | null;
        } | null> {
          if (!supabase) return null;
          const { data, error } = await supabase
            .from("dota2_updates")
            .select("version, content")
            .order("release_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) {
            console.warn(error);
            return null;
          }
          if (!data) return null;
          return {
            version: data.version ?? null,
            content: data.content ?? null,
          };
        }

        const [replayResult, patchRow] = await Promise.all([
          fetchReplaysForHeroProfile(feed, decoded, maps).catch(
            (): FeedReplayIndexResult => ({
              replays: [],
              cloudIndexError: null,
            })
          ),
          fetchLatestPatchRow(),
        ]);

        if (cancelled) return;
        if (replayResult.cloudIndexError)
          console.warn(replayResult.cloudIndexError);
        setReplays(replayResult.replays);

        let hid = 0;
        let nameEn = decoded;
        for (const [sid, h] of Object.entries(maps.heroes || {})) {
          if (h.key === decoded) {
            hid = Number(sid) || 0;
            nameEn = h.nameEn || decoded;
            break;
          }
        }

        let patchBlock: { version: string; lines: string[] } = {
          version: "",
          lines: [],
        };
        if (hid > 0 && patchRow?.content) {
          const raw = extractHeroPatchNotesFromUpdateContent(
            patchRow.content,
            hid,
            nameEn
          );
          const version =
            (patchRow.version && String(patchRow.version).trim()) ||
            extractVersionFromPatchJsonContent(patchRow.content) ||
            "";
          patchBlock = {
            version,
            lines: raw.map((t) => translatePatch741cNote(t, "zh")),
          };
        } else if (patchRow) {
          patchBlock = {
            version:
              (patchRow.version && String(patchRow.version).trim()) ||
              extractVersionFromPatchJsonContent(patchRow.content || "") ||
              "",
            lines: [],
          };
        }

        setLatestHeroPatch(patchBlock);
        setDetailByMatch({});
        setFeedListLoading(false);
      } catch {
        if (!cancelled) {
          setFeedListLoading(false);
          setReplays([]);
          setLatestHeroPatch({ version: "", lines: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decoded, maps, feed]);

  const normalizeRole = (raw: unknown): string => {
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s) return "unknown";
    if (s === "support4" || s === "support 4" || s === "support(4)") return "support(4)";
    if (s === "support5" || s === "support 5" || s === "support(5)") return "support(5)";
    if (s === "carry" || s === "mid" || s === "offlane") return s;
    return "unknown";
  };

  const roleLabel = (role: string): string => {
    if (role === "support(4)") return "pos4";
    if (role === "support(5)") return "pos5";
    if (role === "unknown") return "未标注";
    return role;
  };

  /** 索引 role_early + 与 Meta 一致的队内经济排序兜底，避免「未标注」与列表场次割裂 */
  const replayRoleEffective = useCallback(
    (r: ReplaySummary): string => {
      if (!maps) return "unknown";
      const p0 = (r.players || []).find(
        (x) => heroKeyFromId(x.hero_id, maps) === decoded
      );
      if (!p0) return "unknown";
      const direct = normalizeRole(
        (p0 as { role_early?: unknown } | undefined)?.role_early
      );
      if (direct !== "unknown") return direct;
      const fb = slotToRoleEarlyFallbackMap(r);
      return fb.get(Number(p0.player_slot)) ?? "unknown";
    },
    [decoded, maps]
  );

  const roleOptions = useMemo(
    () => ["carry", "mid", "offlane", "support(4)", "support(5)", "unknown"],
    []
  );

  const replaysSynergy = useMemo(() => {
    if (!maps) return [];
    return filterReplaysByTeammateOpponentHero(replays, maps, decoded, {
      withHeroId: withHeroIdParam,
      vsHeroId: vsHeroIdParam,
    });
  }, [replays, maps, decoded, withHeroIdParam, vsHeroIdParam]);

  const filteredReplays = useMemo(() => {
    if (roleFilter === "all") return replaysSynergy;
    return replaysSynergy.filter((r) => replayRoleEffective(r) === roleFilter);
  }, [replaysSynergy, replayRoleEffective, roleFilter]);

  const overviewReplays = useMemo(() => {
    if (roleFilter === "all") return replaysSynergy;
    return replaysSynergy.filter((r) => {
      const rr = replayRoleEffective(r);
      return rr === roleFilter || rr === "unknown";
    });
  }, [replaysSynergy, replayRoleEffective, roleFilter]);

  /** 出装 Items / 天赋统计：仅当前补丁 */
  const overviewReplaysLatestOnly = useMemo(
    () =>
      overviewReplays.filter((r) =>
        replayMatchesLatestPatch(r, patch.currentPatch)
      ),
    [overviewReplays, patch.currentPatch]
  );

  const roleCounts = useMemo(() => {
    const out: Record<string, number> = {
      carry: 0,
      mid: 0,
      offlane: 0,
      "support(4)": 0,
      "support(5)": 0,
      unknown: 0,
    };
    for (const r of replaysSynergy) {
      const rr = replayRoleEffective(r);
      if (rr in out) out[rr] += 1;
    }
    return out;
  }, [replaysSynergy, replayRoleEffective]);

  const filteredReplayIdsSignature = useMemo(
    () => filteredReplays.map((r) => String(r.match_id)).join(","),
    [filteredReplays]
  );

  const totalListPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(filteredReplays.length / MATCH_LIST_LOAD_STEP)
      ),
    [filteredReplays.length]
  );

  const pageForList = Math.min(listPage, totalListPages);

  const displayedReplays = useMemo(
    () =>
      filteredReplays.slice(
        (pageForList - 1) * MATCH_LIST_LOAD_STEP,
        pageForList * MATCH_LIST_LOAD_STEP
      ),
    [filteredReplays, pageForList]
  );

  /** Overview 仅用当前补丁 id；列表行保留全版本 slim */
  const mergedSlimMatchIds = useMemo(() => {
    const idSet = new Set<number>();
    for (const r of overviewReplaysLatestOnly.slice(0, HERO_OVERVIEW_INSIGHT_CAP)) {
      const mid = Number(r.match_id);
      if (Number.isFinite(mid) && mid > 0) idSet.add(mid);
    }
    for (const r of displayedReplays) {
      const mid = Number(r.match_id);
      if (Number.isFinite(mid) && mid > 0) idSet.add(mid);
    }
    return [...idSet].sort((a, b) => a - b);
  }, [overviewReplaysLatestOnly, displayedReplays]);

  const slimIdsToFetch = useMemo(
    () =>
      mergedSlimMatchIds.filter((id) => detailByMatch[id] === undefined),
    [mergedSlimMatchIds, detailByMatch]
  );
  const slimIdsToFetchKey = slimIdsToFetch.join(",");

  useEffect(() => {
    setListPage(1);
  }, [filteredReplayIdsSignature]);

  useEffect(() => {
    if (listPage > totalListPages) setListPage(totalListPages);
  }, [listPage, totalListPages]);

  useEffect(() => {
    let cancelled = false;
    if (!maps || slimIdsToFetch.length === 0) return;
    void loadSlimMatchJsonForDetails(slimIdsToFetch, { preferCloud: true })
      .then((batch) => {
        if (cancelled) return;
        setDetailByMatch((prev) => {
          const next = { ...prev };
          for (const mid of slimIdsToFetch) {
            next[mid] = batch[mid] ?? null;
          }
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDetailByMatch((prev) => {
          const next = { ...prev };
          for (const mid of slimIdsToFetch) next[mid] = null;
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [slimIdsToFetchKey, maps]);

  const heroEntry = useMemo(() => {
    if (!maps?.heroes) return null;
    for (const [sid, h] of Object.entries(maps.heroes)) {
      if (h.key === decoded) return { id: Number(sid) || 0, ...h };
    }
    return null;
  }, [maps, decoded]);
  const heroLabel = heroEntry;
  const heroId = heroEntry?.id ?? 0;
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
            <h1 className="text-xl font-bold text-skin-ink">
              包含「{heroLabel?.nameCn || heroLabel?.nameEn || decoded}」的对局
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRoleFilter("all")}
                className={cn(
                  "rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                  roleFilter === "all"
                    ? "border-amber-500/50 bg-amber-100/70 text-amber-700 dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-slate-500/35 bg-slate-200/40 text-slate-700 hover:bg-slate-300/45 dark:border-slate-500/45 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:bg-slate-700/60"
                )}
              >
                all ({replaysSynergy.length})
              </button>
              {roleOptions.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoleFilter(role)}
                  className={cn(
                    "rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
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
          {heroId > 0 && maps ? (
            <HeroBuildOverviewCard
              heroId={heroId}
              heroKey={decoded}
              heroName={heroLabel?.nameCn || heroLabel?.nameEn || decoded}
              replays={overviewReplaysLatestOnly}
              maps={maps}
              slimByMatchId={detailByMatch}
              enabled={!feedListLoading && replays.length > 0}
              withHeroId={withHeroIdParam}
              vsHeroId={vsHeroIdParam}
              onWithHeroChange={setWithHeroIdParam}
              onVsHeroChange={setVsHeroIdParam}
              latestHeroPatch={latestHeroPatch}
            />
          ) : null}
          {!mapsLoading && maps ? (
            feedListLoading ? (
              <p className="text-sm text-skin-sub">加载录像列表…</p>
            ) : filteredReplays.length === 0 ? (
              <p className="text-sm text-skin-sub">
                {replays.length === 0
                  ? "暂无该英雄的录像记录。"
                  : replaysSynergy.length === 0 &&
                      (withHeroIdParam != null || vsHeroIdParam != null)
                    ? "暂无同时满足「队友 / 对手」英雄条件的录像，请尝试清除组合筛选或换英雄。"
                    : `暂无该英雄在 ${roleLabel(roleFilter)} 位置的对局。`}
              </p>
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border border-skin-line">
                  <div className="grid w-full grid-cols-[minmax(170px,1.08fr)_minmax(120px,0.92fr)_82px_84px_minmax(220px,1.2fr)_minmax(240px,1.45fr)_72px_72px_136px] gap-2 border-b border-skin-line bg-skin-inset px-3 py-2 text-xs font-semibold text-skin-sub">
                    <div>英雄</div>
                    <div>选手</div>
                    <div>K/D/A</div>
                    <div>位置</div>
                    <div>出装</div>
                    <div>技能加点</div>
                    <div className="text-center">天赋</div>
                    <div className="text-center">结果</div>
                    <div className="flex items-center justify-center">比赛编号</div>
                  </div>
                  {displayedReplays.map((r, vIdx) => {
                    const p = r.players.find(
                      (x) => heroKeyFromId(x.hero_id, maps) === decoded
                    );
                    const isWin =
                      p != null
                        ? Boolean(p.is_radiant) === Boolean(r.radiant_win)
                        : false;
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
                    const accountIdFromIndex = Number(p?.account_id ?? 0);
                    const accountIdFromDetail = Number(row?.account_id ?? 0);
                    const accountId =
                      Number.isFinite(accountIdFromIndex) && accountIdFromIndex > 0
                        ? accountIdFromIndex
                        : accountIdFromDetail;
                    const proNameRaw = (p?.pro_name ?? row?.pro_name ?? null) as
                      | string
                      | null;
                    const isProReplay =
                      String(r.source || "").toLowerCase() === "pro" ||
                      String(r.match_tier || "").toLowerCase() === "pro";
                    const canLinkPlayer = isProReplay
                      ? Number.isFinite(accountId) && accountId > 0
                      : replayIndexCanLinkProPlayer(accountId, proNameRaw);
                    const maskedLabel = replayIndexPlayerDisplayLabel(
                      accountId,
                      proNameRaw
                    );
                    const playerColLabel = maskedLabel;
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
                    const talentTreeFallback = mergeTalentTreeBySkillBuild(
                      toTalentTreeUi(row?.talent_tree),
                      row,
                      maps
                    );
                    const talentPicksFallback = toTalentPicksUi(row?.talent_picks);
                    const talentTree = talentTreeFallback;
                    const talentPicks = talentPicksFallback;
                    return (
                      <ViewportMountRow
                        key={`${r.match_id}-${r.uploaded_at}`}
                        index={vIdx}
                        rootMargin="40px 0px"
                        skeleton={
                          <div className="grid w-full grid-cols-[minmax(170px,1.08fr)_minmax(120px,0.92fr)_82px_84px_minmax(220px,1.2fr)_minmax(240px,1.45fr)_72px_72px_136px] gap-2 border-b border-slate-500/55 px-3 py-3 min-h-[52px] bg-slate-100/25 dark:bg-slate-900/30" />
                        }
                      >
                        <div
                          className={cn(
                            "grid w-full cursor-pointer grid-cols-[minmax(170px,1.08fr)_minmax(120px,0.92fr)_82px_84px_minmax(220px,1.2fr)_minmax(240px,1.45fr)_72px_72px_136px] gap-2 border-b border-slate-500/55 px-3 py-2 text-sm transition-colors hover:bg-slate-100/60 dark:border-slate-700/80 dark:hover:bg-slate-800/40",
                            vIdx === displayedReplays.length - 1 && "border-b-0"
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
                            className="h-10 w-10 rounded object-cover bg-slate-200 dark:bg-slate-800"
                            {...(vIdx < 2 ? steamCdnImgHero : steamCdnImgDefer)}
                            loading="lazy"
                            onError={onDotaSteamAssetImgError}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-skin-ink">
                              {heroLabel?.nameCn || heroLabel?.nameEn || decoded}
                            </div>
                            <div className="truncate text-xs text-skin-sub">
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
                          <span className="rounded border border-slate-500/35 bg-slate-200/40 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-700 dark:border-slate-500/45 dark:bg-slate-700/40 dark:text-slate-200">
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
                                    className="h-8 w-8 rounded object-cover bg-slate-200 dark:bg-slate-800"
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
                          {stepsSlice.length ? (
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
                          ) : (
                            <span className="text-skin-sub">-</span>
                          )}
                        </div>
                        <div className="flex items-center justify-center">
                          {talentTree || talentPicks.length > 0 ? (
                            <TalentTreeBadge tree={talentTree} talentPicks={talentPicks} />
                          ) : (
                            <span className="text-xs text-skin-sub">-</span>
                          )}
                        </div>
                        <div className="flex items-center justify-center">
                          <span
                            className={cn(
                              "text-xs font-semibold uppercase tracking-wide",
                              isWin
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            )}
                          >
                            {isWin ? "win" : "loss"}
                          </span>
                        </div>
                        <div className="flex items-center justify-center">
                          <span className="font-mono tabular-nums text-xs text-amber-700 dark:text-amber-400">
                            {r.match_id}
                          </span>
                        </div>
                      </div>
                      </ViewportMountRow>
                    );
                  })}
                </div>
                {filteredReplays.length > 0 ? (
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
                      {filteredReplays.length} 场）
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
