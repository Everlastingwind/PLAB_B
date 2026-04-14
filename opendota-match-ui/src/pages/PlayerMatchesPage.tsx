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
  abilityIconFallbackUrl,
  heroIconUrl,
  itemIconUrl,
} from "../data/mockMatchPlayers";
import { cn } from "../lib/cn";
import { MECHA_INSET, MECHA_RAISED } from "../lib/mechaStyles";
import type { SlimMatchJson, SlimPlayer } from "../types/slimMatch";
import { TalentTreeBadge } from "../components/TalentTreeBadge";
import type { TalentPickUi, TalentTreeUi } from "../data/mockMatchPlayers";

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
  const [detailByMatch, setDetailByMatch] = useState<Record<number, SlimPlayer>>(
    {}
  );
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPage(1);
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

  const visible = useMemo(
    () => slicePage(replays, page),
    [replays, page]
  );

  useEffect(() => {
    let cancelled = false;
    const need = visible
      .map((r) => r.match_id)
      .filter((mid) => !detailByMatch[mid]);
    if (!need.length || aid <= 0) return;
    (async () => {
      const updates: Record<number, SlimPlayer> = {};
      for (const mid of need) {
        try {
          const res = await fetch(`/data/matches/${mid}.json?t=${Date.now()}`, {
            cache: "no-store",
          });
          if (!res.ok) continue;
          const j = (await res.json()) as SlimMatchJson;
          const p = (j.players || []).find(
            (x) => Number(x.account_id || 0) === aid
          );
          if (p) updates[mid] = p;
        } catch {
          // ignore detail fetch failures
        }
      }
      if (!cancelled && Object.keys(updates).length) {
        setDetailByMatch((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, aid, detailByMatch]);

  const onIntersect = useCallback(() => {
    setPage((p) => (hasMore(replays.length, p) ? p + 1 : p));
  }, [replays.length]);

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

  return (
    <PageShell centerSearch feedMode={feed} onFeedModeChange={setFeed}>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-bold text-skin-ink">
              {titleName && titleName !== "匿名玩家"
                ? `选手 ${titleName}`
                : `玩家 #${accountId}`}
            </h1>
            <Link
              to="/"
              className="text-xs text-amber-600 hover:underline dark:text-amber-500"
            >
              返回主页
            </Link>
          </div>

          {feed.pro ? (
            <p className="mb-4 text-xs leading-relaxed text-skin-sub">
              当前列表可含 OpenDota 职业索引对局（PRO）；与 PUB 同时开启时已按比赛编号去重合并。
            </p>
          ) : null}

          {titleName === "匿名玩家" || !titleName ? (
            <p className="mb-6 text-sm text-skin-sub">
              非职业选手以「匿名玩家」展示；完整出装与加点请点进单场录像查看。
            </p>
          ) : (
            <p className="mb-6 text-sm text-skin-sub">
              以下为该职业选手最近出现的对局；点进比赛可查看技能加点与出装。
            </p>
          )}

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
            replays.length === 0 ? (
              <p className="text-sm text-skin-sub">暂无该账号的录像记录。</p>
            ) : (
              <>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-skin-sub">
                  对局明细
                </h2>
                <div className="overflow-hidden rounded-lg border border-skin-line">
                  <div className="grid grid-cols-[220px_90px_250px_300px_70px_170px] gap-2 border-b border-skin-line bg-skin-inset px-3 py-2 text-[11px] font-semibold text-skin-sub">
                    <div>英雄</div>
                    <div>K/D/A</div>
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
                        className="grid grid-cols-[220px_90px_250px_300px_70px_170px] gap-2 border-b border-skin-line/70 px-3 py-2 text-xs last:border-b-0"
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
                        <div className="flex items-center gap-1">
                          {items.filter((it) => !it.empty && (it.item_key || it.image_url)).length
                            ? items.map((it, idx) => (
                                !it.empty && (it.item_key || it.image_url) ? (
                                  <img
                                    key={`${r.match_id}-it-${idx}`}
                                    src={
                                      (it.image_url || "").trim() ||
                                      itemIconUrl(String(it.item_key || "").replace(/^item_/, ""))
                                    }
                                    alt=""
                                    className="h-8 w-8 rounded object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      const el = e.currentTarget;
                                      el.style.display = "none";
                                    }}
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
                                    onError={(e) => {
                                      const el = e.currentTarget;
                                      if (!el.src.includes("filler_ability")) {
                                        el.src = abilityIconFallbackUrl;
                                      }
                                    }}
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
  );
}
