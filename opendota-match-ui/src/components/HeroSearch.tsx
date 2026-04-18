import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import type { EntityMapsPayload, HeroMapEntry } from "../types/entityMaps";
import { cn } from "../lib/cn";
import {
  heroIconUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
} from "../data/mockMatchPlayers";
import heroPrimaryAttr from "../data/hero_primary_attr.json";
import { FeedModeToggle, type FeedSelection } from "./FeedModeToggle";
import { SEEDED_PRO_PLAYERS } from "../data/proPlayers";
import { fetchDeployedDataJson } from "../lib/fetchStaticJson";

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
  feedMode?: FeedSelection;
  onFeedModeChange?: (m: FeedSelection) => void;
}) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [attr, setAttr] = useState<AttrFilter>("str");
  const [heroAvatarGridOpen, setHeroAvatarGridOpen] = useState(false);
  const [proPlayers, setProPlayers] = useState<ProPlayerCandidate[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  /** Viewport px; used for `position:fixed` dropdowns below md */
  const [dockTopPx, setDockTopPx] = useState(0);
  /** Tailwind `md` breakpoint (768px) and up */
  const [mdUp, setMdUp] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 768px)").matches
  );

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

  const updateDockTop = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDockTopPx(Math.round(r.bottom + 8));
  }, []);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const run = () => {
      setMdUp(mq.matches);
      if (mq.matches) return;
      updateDockTop();
    };
    run();
    mq.addEventListener("change", run);
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);
    return () => {
      mq.removeEventListener("change", run);
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run, true);
    };
  }, [updateDockTop, open, heroAvatarGridOpen, q, feedMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const paths = ["/data/replays_index.json", "/data/pro_replays_index.json"] as const;
        const payloads = await Promise.all(
          paths.map((p) =>
            fetchDeployedDataJson<{
              replays?: Array<{
                players?: Array<{ account_id?: number; pro_name?: string | null }>;
              }>;
            }>(p).catch(() => null)
          )
        );
        const uniq = new Map<number, string>();
        for (const j of payloads) {
          if (!j) continue;
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
    <div
      ref={boxRef}
      className="relative box-border flex w-full min-w-0 max-w-full flex-col max-md:px-2 md:mx-auto md:max-w-3xl md:px-0"
    >
      <div
        ref={anchorRef}
        className="relative z-20 w-full min-w-0 max-w-full"
      >
        <div className="flex w-full min-w-0 max-w-full items-center justify-center gap-2">
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
            <FeedModeToggle selection={feedMode} onChange={onFeedModeChange} />
          ) : null}
        </div>
        {open && list.length > 0 ? (
          <ul
            style={
              !mdUp && dockTopPx > 0 ? { top: dockTopPx } : undefined
            }
            className={cn(
              "max-h-72 overflow-auto rounded-lg border border-skin-line bg-white py-1 dark:border-slate-600 dark:bg-slate-900",
              "max-md:z-[5000] max-md:fixed max-md:left-4 max-md:right-4 max-md:mt-0 max-md:min-w-0 max-md:w-auto max-md:max-w-none max-md:shadow-xl max-md:shadow-black/15 max-md:ring-1 max-md:ring-slate-800/25",
              "md:z-[200] md:absolute md:left-0 md:right-0 md:top-full md:mt-1 md:min-w-full md:w-full md:max-w-none md:shadow-lg md:shadow-black/10"
            )}
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
      <section
        style={
          !mdUp && heroAvatarGridOpen && dockTopPx > 0
            ? { top: dockTopPx }
            : undefined
        }
        className={cn(
          "min-w-0 mt-2 w-full max-w-full md:relative md:top-auto md:z-10",
          heroAvatarGridOpen &&
            "max-md:z-[4900] max-md:fixed max-md:left-4 max-md:right-4 max-md:mt-0 max-md:w-auto max-md:max-w-none"
        )}
        aria-label="按属性筛选英雄"
      >
        <div
          className={cn(
            "relative w-full min-w-0 max-w-full rounded-lg border border-skin-line bg-skin-card p-2 dark:border-slate-700 dark:bg-slate-900/50",
            "max-md:shadow-xl max-md:ring-1 max-md:ring-slate-900/10 max-md:dark:ring-white/10",
            "md:w-full md:max-w-none md:shadow-none md:ring-0"
          )}
        >
        <div
          className={cn(
            "flex w-full min-w-0 max-w-full flex-nowrap items-stretch gap-1 overflow-x-auto pb-0.5 md:flex-wrap md:justify-start md:gap-2 md:overflow-visible md:pb-0",
            heroAvatarGridOpen && "mb-2"
          )}
        >
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
                "min-w-0 rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors md:shrink-0",
                "max-md:shrink-0 max-md:basis-auto max-md:px-2 max-md:text-[11px] max-md:leading-tight max-md:whitespace-nowrap",
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
          <div
            className={cn(
              "grid w-full min-w-0 max-w-full overflow-auto",
              "max-md:grid-cols-10 max-md:grid-flow-row max-md:gap-x-0.5 max-md:gap-y-1",
              "md:grid-flow-row md:grid-cols-[repeat(auto-fill,minmax(52px,52px))] md:gap-x-1.5 md:gap-y-1.5 md:overflow-x-hidden md:overflow-y-auto md:pb-0.5 md:[max-height:min(65vh,28rem)]"
            )}
          >
            {attrHeroes.map((h) => (
              <button
                key={`attr-${h.id}`}
                type="button"
                onClick={() => goHero(h.key)}
                title={h.nameCn || h.nameEn}
                className="group w-full cursor-pointer border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-skin-card dark:focus-visible:ring-offset-slate-900/50"
              >
                <div
                  className={cn(
                    "relative w-full overflow-hidden rounded-sm bg-slate-800 ring-1 ring-slate-300 transition-all",
                    "aspect-[4/3] dark:bg-slate-900 dark:ring-slate-600",
                    "group-hover:ring-2 group-hover:ring-emerald-500 dark:group-hover:ring-emerald-500"
                  )}
                >
                  <img
                    src={heroIconUrl(h.key)}
                    alt={h.nameCn || h.nameEn}
                    className="h-full w-full object-cover object-center"
                    {...steamCdnImgDefer}
                    onError={onDotaSteamAssetImgError}
                  />
                </div>
              </button>
            ))}
          </div>
        ) : null}
        </div>
      </section>
    </div>
  );
}
