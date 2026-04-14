import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import type { EntityMapsPayload, HeroMapEntry } from "../types/entityMaps";
import { cn } from "../lib/cn";
import { heroIconUrl } from "../data/mockMatchPlayers";
import heroPrimaryAttr from "../data/hero_primary_attr.json";
import { FeedModeToggle, type FeedMode } from "./FeedModeToggle";
import { SEEDED_PRO_PLAYERS } from "../data/proPlayers";

type HeroRow = HeroMapEntry & { id: string };
type AttrFilter = "str" | "agi" | "int" | "all";
type ProPlayerCandidate = { accountId: number; proName: string };
type SearchRow =
  | { kind: "hero"; key: string; id: string; nameCn: string; nameEn: string }
  | { kind: "player"; accountId: number; proName: string }
  | { kind: "match"; matchId: number };

const ATTR_LABELS: ReadonlyArray<{ id: AttrFilter; label: string }> = [
  { id: "str", label: "力量" },
  { id: "agi", label: "敏捷" },
  { id: "int", label: "智力" },
  { id: "all", label: "全才" },
];

const HERO_ATTR_BY_KEY: Record<string, AttrFilter> = (() => {
  const out: Record<string, AttrFilter> = {};
  const raw = heroPrimaryAttr as Record<string, string>;
  for (const [key, paRaw] of Object.entries(raw)) {
    const pa = String(paRaw).trim().toLowerCase();
    if (pa === "str" || pa === "agi" || pa === "int" || pa === "all") {
      out[key] = pa;
    }
  }
  return out;
})();

// 常用简称 / 俗称（可按需继续补充）
const HERO_ALIASES_BY_KEY: Record<string, string[]> = {
  nevermore: ["sf", "影魔"],
  queenofpain: ["qop", "痛苦"],
  wisp: ["io", "小精灵"],
  furion: ["np", "先知"],
  windrunner: ["wr", "风行", "风行者"],
  magnataur: ["mag", "猛犸"],
  shredder: ["timber", "伐木机"],
  skeleton_king: ["wk", "骷髅王"],
  life_stealer: ["naix", "小狗"],
  zuus: ["zeus", "宙斯"],
  doom_bringer: ["doom", "末日"],
  rattletrap: ["clock", "发条"],
};

function flattenHeroes(maps: EntityMapsPayload): HeroRow[] {
  return Object.entries(maps.heroes).map(([id, h]) => ({ ...h, id }));
}

function matchesHero(q: string, h: HeroRow): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return false;
  const aliasRows = HERO_ALIASES_BY_KEY[h.key] || [];
  const aliasHit = aliasRows.some((a) => {
    const t = a.trim().toLowerCase();
    return t === s || t.includes(s);
  });
  return (
    h.key.toLowerCase().includes(s) ||
    h.nameEn.toLowerCase().includes(s) ||
    (h.nameCn && h.nameCn.includes(q.trim())) ||
    h.id === s ||
    aliasHit
  );
}

export function HeroSearch({
  maps,
  feedMode,
  onFeedModeChange,
}: {
  maps: EntityMapsPayload | null;
  feedMode?: FeedMode;
  onFeedModeChange?: (m: FeedMode) => void;
}) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [attr, setAttr] = useState<AttrFilter>("str");
  const [heroAvatarGridOpen, setHeroAvatarGridOpen] = useState(false);
  const [proPlayers, setProPlayers] = useState<ProPlayerCandidate[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  const list = useMemo<SearchRow[]>(() => {
    if (!maps) return [];
    const s = q.trim();
    if (!s) return [];

    const heroRows: SearchRow[] = flattenHeroes(maps)
      .filter((h) => matchesHero(s, h))
      .map((h) => ({
        kind: "hero",
        key: h.key,
        id: h.id,
        nameCn: h.nameCn || "",
        nameEn: h.nameEn || "",
      }));

    const sq = s.toLowerCase();
    const playerRows: SearchRow[] = proPlayers
      .filter((p) => {
        const idText = String(p.accountId);
        return (
          idText.includes(s) ||
          p.proName.toLowerCase().includes(sq) ||
          p.proName.includes(s)
        );
      })
      .map((p) => ({
        kind: "player",
        accountId: p.accountId,
        proName: p.proName,
      }));

    const numeric = /^\d+$/.test(s);
    const matchRows: SearchRow[] = [];
    if (numeric) {
      const mid = Number(s);
      if (Number.isFinite(mid) && mid > 0) {
        matchRows.push({ kind: "match", matchId: mid });
      }
    }
    const merged = numeric
      ? [...matchRows, ...playerRows, ...heroRows]
      : [...heroRows, ...playerRows];
    return merged.slice(0, 24);
  }, [maps, proPlayers, q]);

  const goHero = useCallback(
    (key: string) => {
      setOpen(false);
      setQ("");
      nav(`/hero/${encodeURIComponent(key)}`);
    },
    [nav]
  );

  const goPlayer = useCallback(
    (accountId: number) => {
      setOpen(false);
      setQ("");
      nav(`/player/${encodeURIComponent(String(accountId))}`);
    },
    [nav]
  );

  const goMatch = useCallback(
    (matchId: number) => {
      setOpen(false);
      setQ("");
      nav(`/match/${encodeURIComponent(String(matchId))}`);
    },
    [nav]
  );

  const attrHeroes = useMemo(() => {
    if (!maps) return [];
    return flattenHeroes(maps)
      .filter((h) => HERO_ATTR_BY_KEY[h.key] === attr)
      .sort((a, b) => {
        const an = (a.nameCn || a.nameEn || a.key).trim();
        const bn = (b.nameCn || b.nameEn || b.key).trim();
        return an.localeCompare(bn, "zh-CN");
      });
  }, [maps, attr]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const urls = [
          `/data/replays_index.json?t=${Date.now()}`,
          `/data/pro_replays_index.json?t=${Date.now()}`,
        ];
        const uniq = new Map<number, string>();
        for (const url of urls) {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const j = (await res.json()) as {
            replays?: Array<{
              players?: Array<{ account_id?: number; pro_name?: string | null }>;
            }>;
          };
          for (const r of j.replays ?? []) {
            for (const p of r.players ?? []) {
              const aid = Number(p.account_id ?? 0);
              const pn = String(p.pro_name ?? "").trim();
              if (!Number.isFinite(aid) || aid <= 0 || !pn) continue;
              if (!uniq.has(aid)) uniq.set(aid, pn);
            }
          }
        }
        if (!cancelled) {
          for (const p of SEEDED_PRO_PLAYERS) {
            if (!uniq.has(p.accountId)) uniq.set(p.accountId, p.proName);
          }
          setProPlayers(
            [...uniq.entries()].map(([accountId, proName]) => ({
              accountId,
              proName,
            }))
          );
        }
      } catch {
        // ignore search enhancer failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!maps) {
    return (
      <div className="h-10 w-full max-w-md rounded-lg border border-skin-line bg-skin-inset px-3 text-xs text-skin-sub">
        加载英雄列表…
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative mx-auto w-full max-w-3xl">
      <div className="relative z-20">
        <div className="flex items-center justify-center gap-2">
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-skin-line bg-white px-3 py-2 shadow-inner dark:border-slate-600 dark:bg-slate-800/90",
              open && "ring-1 ring-amber-400/35 dark:ring-amber-500/25"
            )}
          >
            <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                const next = e.target.value;
                setQ(next);
                setOpen(next.trim().length > 0);
              }}
              onFocus={() => setOpen(q.trim().length > 0)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && list[0]) {
                  e.preventDefault();
                  if (list[0].kind === "hero") goHero(list[0].key);
                  else if (list[0].kind === "player") goPlayer(list[0].accountId);
                  else goMatch(list[0].matchId);
                }
              }}
              placeholder="搜索英雄/职业选手/比赛编号…"
              className="min-w-0 flex-1 bg-transparent text-sm text-skin-ink placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
              autoComplete="off"
            />
          </div>
          {feedMode && onFeedModeChange ? (
            <FeedModeToggle mode={feedMode} onChange={onFeedModeChange} />
          ) : null}
        </div>
        {open && list.length > 0 ? (
          <ul
            className="absolute left-0 right-0 top-full z-[200] mt-1 max-h-72 overflow-auto rounded-lg border border-skin-line bg-white py-1 shadow-lg shadow-black/10 dark:border-slate-600 dark:bg-slate-900 dark:shadow-black/40"
            role="listbox"
          >
            {list.map((row) =>
              row.kind === "hero" ? (
                <li key={`h-${row.id}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-skin-ink hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800/90"
                    onClick={() => goHero(row.key)}
                  >
                    <span className="font-mono text-xs text-slate-500">{row.key}</span>
                    <span>{row.nameCn || row.nameEn}</span>
                    <span className="truncate text-xs text-slate-500">{row.nameEn}</span>
                  </button>
                </li>
              ) : row.kind === "player" ? (
                <li key={`p-${row.accountId}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-skin-ink hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800/90"
                    onClick={() => goPlayer(row.accountId)}
                  >
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                      选手
                    </span>
                    <span>{row.proName}</span>
                    <span className="truncate text-xs text-slate-500">{row.accountId}</span>
                  </button>
                </li>
              ) : (
                <li key={`m-${row.matchId}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-skin-ink hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800/90"
                    onClick={() => goMatch(row.matchId)}
                  >
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                      比赛
                    </span>
                    <span className="font-mono tabular-nums">{row.matchId}</span>
                  </button>
                </li>
              )
            )}
          </ul>
        ) : null}
      </div>
      <div className="relative z-10 mt-2 rounded-lg border border-skin-line bg-skin-card p-2 dark:border-slate-700 dark:bg-slate-900/50">
        <div className={cn("flex flex-wrap gap-1.5", heroAvatarGridOpen && "mb-2")}>
          {ATTR_LABELS.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                if (attr === row.id && heroAvatarGridOpen) {
                  setHeroAvatarGridOpen(false);
                } else {
                  setAttr(row.id);
                  setHeroAvatarGridOpen(true);
                }
              }}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                attr === row.id
                  ? "border-amber-500/70 bg-amber-100 text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-200"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              )}
            >
              {row.label}
            </button>
          ))}
        </div>
        {heroAvatarGridOpen ? (
          <div className="grid max-h-52 w-full grid-cols-6 gap-1 overflow-auto sm:grid-cols-[repeat(auto-fit,minmax(44px,1fr))] sm:gap-1.5">
            {attrHeroes.map((h) => (
              <button
                key={`attr-${h.id}`}
                type="button"
                onClick={() => goHero(h.key)}
                title={h.nameCn || h.nameEn}
                className="aspect-square w-full overflow-hidden rounded-sm border border-slate-300 transition-colors hover:border-amber-500/70 dark:border-slate-600 dark:hover:border-amber-500/60"
              >
                <img
                  src={heroIconUrl(h.key)}
                  alt={h.nameCn || h.nameEn}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
