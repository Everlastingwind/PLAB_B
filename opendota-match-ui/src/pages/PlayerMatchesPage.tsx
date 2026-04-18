import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import type { FeedSelection } from "../components/FeedModeToggle";
import {
  fetchReplaysForFeedSelection,
  filterByAccountId,
  hasMore,
  slicePage,
} from "../lib/replaysApi";
import type { ReplaySummary } from "../types/replaysIndex";
import { useEntityMaps } from "../hooks/useEntityMaps";
import { displayPlayerLabel } from "../lib/playerDisplay";
import { seededProNameForAccount } from "../data/proPlayers";
import { heroKeyFromId } from "../lib/replaysApi";
import {
  abilityIconUrl,
  heroIconUrl,
  itemIconUrl,
  normalizeDotaAssetUrl,
  onDotaSteamAssetImgError,
} from "../data/mockMatchPlayers";
import { cn } from "../lib/cn";
import { MECHA_INSET, MECHA_RAISED } from "../lib/mechaStyles";
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import { TalentTreeBadge } from "../components/TalentTreeBadge";
import type { TalentPickUi, TalentTreeUi } from "../data/mockMatchPlayers";
import { SEOMeta } from "../components/SEOMeta";
import { forEachConcurrent } from "../lib/fetchConcurrent";
import { staticDataSearchParam } from "../lib/staticDataVersion";

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

export function PlayerMatchesPage() {
  const { accountId = "0" } = useParams<{ accountId: string }>();
  const aid = Number(accountId) || 0;
  const { maps, loading: mapsLoading } = useEntityMaps();
  const [feed, setFeed] = useState<FeedSelection>({ pub: true, pro: false });
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [detailByMatch, setDetailByMatch] = useState<Record<number, SlimPlayer>>(
    {}
  );
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPage(1);
    setRoleFilter("all");
  }, [aid, feed]);

  useEffect(() => {
    let cancelled = false;
    fetchReplaysForFeedSelection(feed)
      .then((rows) => {
        if (!cancelled) {
          setReplays(filterByAccountId(rows, aid));
          setDetailByMatch({});
        }
      })
      .catch(() => {
        if (!cancelled) setReplays([]);
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

  const replayRole = useCallback(
    (r: ReplaySummary): string => {
      const ps = (r.players || []).find((x) => Number(x.account_id || 0) === aid) as
        | ({ role_early?: unknown } & typeof r.players[number])
        | undefined;
      const fromSummary = normalizeRole(ps?.role_early);
      if (fromSummary) return fromSummary;
      const row = detailByMatch[r.match_id];
      return normalizeRole((row as { role_early?: unknown } | undefined)?.role_early);
    },
    [aid, detailByMatch]
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
    const need = visible
      .map((r) => r.match_id)
      .filter((mid) => !detailByMatch[mid]);
    if (!need.length || aid <= 0) return;
    (async () => {
      const updates: Record<number, SlimPlayer> = {};
      const q = staticDataSearchParam();
      await forEachConcurrent(need, MATCH_JSON_CONCURRENCY, async (mid) => {
        try {
          const res = await fetch(`/data/matches/${mid}.json${q}`, {
            cache: "default",
          });
          if (!res.ok) return;
          const j = (await res.json()) as SlimMatchJson;
          const p = (j.players || []).find(
            (x) => Number(x.account_id || 0) === aid
          );
          if (p) updates[mid] = p;
        } catch {
          // ignore detail fetch failures
        }
      });
      if (!cancelled && Object.keys(updates).length) {
        setDetailByMatch((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, aid, detailByMatch]);

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

  const titleName = useMemo(() => {
    for (const r of replays) {
      for (const p of r.players) {
        if (p.account_id === aid && p.pro_name) {
          return displayPlayerLabel(p.pro_name);
        }
      }
    }
    const seeded = seededProNameForAccount(aid);
    return seeded ? displayPlayerLabel(seeded) : null;
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

  const playerName = titleName && titleName !== "匿名玩家" ? titleName : `玩家 #${accountId}`;
  const coreHeroNameEn = useMemo(() => {
    const topHero = heroSummaries[0];
    if (!topHero) return "未知英雄";
    return (
      maps?.heroes[String(topHero.hero_id)]?.nameEn ||
      maps?.heroes[String(topHero.hero_id)]?.nameCn ||
      topHero.key
    );
  }, [heroSummaries, maps]);

  // 职业选手对标模块标题公式：[选手ID] [英雄名称] 深度数据对标 | DOTA2 Plan B
  // 选手ID优先用职业名/展示名，缺失时回退 accountId；英雄名称优先英文名。
  const playerIdentifier = titleName && titleName !== "匿名玩家" ? titleName : accountId;
  const seoTitle = `${playerIdentifier} 深度数据对标`;
  const seoDescription = `查看 ${playerName} 的最新高分局出装路线与正反补细节对比，重点追踪 ${coreHeroNameEn} 等核心英雄的近期打法变化。`;

  return (
    <>
      <SEOMeta
        title={seoTitle}
        description={seoDescription}
        keywords={`${playerName},DOTA2高分局,${coreHeroNameEn},出装路线,对线正反补`}
      />
      <PageShell centerSearch feedMode={feed} onFeedModeChange={setFeed}>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-bold text-skin-ink">
              {titleName && titleName !== "匿名玩家"
                ? `选手 ${titleName}`
                : `玩家 #${accountId}`}
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
              <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-skin-sub">
                使用英雄
              </h2>
              <div className="flex flex-wrap gap-2">
                {heroSummaries.map((h) => (
                  <Link
                    key={h.hero_id}
                    to={`/hero/${encodeURIComponent(h.key)}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md border border-skin-line px-2 py-1.5 text-xs text-skin-ink transition hover:border-amber-500/40 hover:text-amber-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-amber-400",
                      MECHA_INSET
                    )}
                  >
                    <span className={cn("rounded p-0.5", MECHA_RAISED)}>
                      <img
                        src={heroIconUrl(
                          h.key === "unknown" ? "invoker" : h.key
                        )}
                        alt=""
                        className="h-8 w-8 rounded-[2px] object-cover"
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
            filteredReplays.length === 0 ? (
              <p className="text-sm text-skin-sub">
                {replays.length === 0
                  ? "暂无该账号的录像记录。"
                  : `暂无该选手在 ${roleLabel(roleFilter)} 位置的对局。`}
              </p>
            ) : (
              <>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-skin-sub">
                  对局明细
                </h2>
                <div className="overflow-hidden rounded-lg border border-skin-line">
                  <div className="grid grid-cols-[210px_90px_90px_230px_290px_70px_170px] gap-2 border-b border-skin-line bg-skin-inset px-3 py-2 text-[11px] font-semibold text-skin-sub">
                    <div>英雄</div>
                    <div>K/D/A</div>
                    <div>位置</div>
                    <div>出装</div>
                    <div>技能加点</div>
                    <div className="text-center">天赋</div>
                    <div className="text-right pr-3">比赛编号</div>
                  </div>
                  {visible.map((r) => {
                    const row = detailByMatch[r.match_id];
                    const p = r.players.find((x) => x.account_id === aid);
                    const key = p ? heroKeyFromId(p.hero_id, maps) : "unknown";
                    const k = p?.kills ?? 0;
                    const d = p?.deaths ?? 0;
                    const a = p?.assists ?? 0;
                    const items = (row?.items_slot || []).slice(0, 6);
                    const steps = (row?.skill_build || [])
                      .filter((s) => s && s.type !== "empty")
                      .slice(0, 16);
                    const talentTree = toTalentTreeUi(row?.talent_tree);
                    const talentPicks = toTalentPicksUi(row?.talent_picks);
                    return (
                      <div
                        key={`${r.match_id}-${r.uploaded_at}`}
                        className="grid grid-cols-[210px_90px_90px_230px_290px_70px_170px] gap-2 border-b border-skin-line/70 px-3 py-2 text-xs last:border-b-0"
                      >
                        <Link
                          to={`/match/${r.match_id}`}
                          className="flex items-center gap-2 rounded px-1 py-0.5 transition hover:bg-slate-100 dark:hover:bg-slate-800/70"
                          title={`查看比赛 ${r.match_id}`}
                        >
                          <img
                            src={heroIconUrl(key === "unknown" ? "invoker" : key)}
                            alt=""
                            className="h-10 w-10 rounded object-cover"
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            fetchPriority="low"
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
                          {items.filter((it) => !it.empty && (it.item_key || it.image_url)).length
                            ? items.map((it, idx) => (
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
                              ))
                            : <span className="text-skin-sub">-</span>}
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
                        <div className="flex items-center justify-end pr-3">
                          <Link
                            to={`/match/${r.match_id}`}
                            className="w-full text-right font-mono tabular-nums text-[11px] text-amber-700 hover:underline dark:text-amber-400"
                          >
                            {r.match_id}
                          </Link>
                        </div>
                      </div>
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
