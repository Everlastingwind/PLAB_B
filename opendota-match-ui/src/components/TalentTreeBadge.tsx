import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { TalentPickUi, TalentTreeUi } from "../data/mockMatchPlayers";
import { formatValveTalentText } from "../lib/display";
import { cn } from "../lib/cn";

const GRID_PANEL =
  "rounded-md border border-gray-200 bg-white p-1 shadow-sm transition-colors duration-200 ease-in-out dark:border-slate-600 dark:bg-slate-700/90 dark:shadow-none";

function normPickDir(d: string | undefined): "left" | "right" | null {
  const t = String(d ?? "").trim().toLowerCase();
  if (t === "left" || t === "l") return "left";
  if (t === "right" || t === "r") return "right";
  return null;
}

function buildFallbackTiersFromPicks(
  picks: TalentPickUi[] | undefined
): TalentTreeUi["tiers"] {
  const levels = [25, 20, 15, 10];
  return levels.map((heroLevel) => {
    const pick = picks?.find((x) => Number(x.level) === heroLevel);
    const side = pick ? normPickDir(pick.direction) : null;
    const nm = String(pick?.talent_name ?? pick?.name ?? "").trim();
    return {
      heroLevel,
      left: {
        abilityKey: "",
        labelCn: side === "left" ? nm || "—" : "—",
        labelEn: "",
      },
      right: {
        abilityKey: "",
        labelCn: side === "right" ? nm || "—" : "—",
        labelEn: "",
      },
      selected: side === "left" || side === "right" ? side : null,
    };
  });
}

const LEVEL_ORDER = [25, 20, 15, 10] as const;

function normalizeGridTiers(
  treeTiers: TalentTreeUi["tiers"] | undefined,
  picks: TalentPickUi[] | undefined
): TalentTreeUi["tiers"] {
  const src =
    treeTiers && treeTiers.length > 0
      ? [...treeTiers].sort((a, b) => b.heroLevel - a.heroLevel)
      : buildFallbackTiersFromPicks(picks);
  return LEVEL_ORDER.map((lv) => {
    const found = src.find((t) => t.heroLevel === lv);
    if (found) return found;
    return {
      heroLevel: lv,
      left: { abilityKey: "", labelCn: "—", labelEn: "" },
      right: { abilityKey: "", labelCn: "—", labelEn: "" },
      selected: null,
    };
  });
}

/** 48×48；未点亮中性灰 / 深 slate，点亮 amber + 微光 */
export function TalentTreeBadge({
  tree,
  talentPicks,
}: {
  tree: TalentTreeUi | null | undefined;
  talentPicks?: TalentPickUi[] | null;
}) {
  const tiers = useMemo(() => {
    const raw = tree?.tiers;
    if (!raw?.length) return [];
    return [...raw].sort((a, b) => b.heroLevel - a.heroLevel);
  }, [tree]);

  const tooltipTiers = useMemo(() => {
    if (tiers.length > 0) return tiers;
    return buildFallbackTiersFromPicks(talentPicks ?? undefined);
  }, [tiers, talentPicks]);

  const gridTiers = useMemo(
    () => normalizeGridTiers(tree?.tiers, talentPicks ?? undefined),
    [tree?.tiers, talentPicks]
  );

  const anchorRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, bottom: 0 });
  const [placement, setPlacement] = useState<"above" | "below">("above");

  const clearClose = () => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    clearClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  const openNow = () => {
    clearClose();
    setOpen(true);
  };

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const margin = 8;
    const gap = 6;
    const tip = tooltipRef.current;
    let h = 220;
    if (tip) {
      h = tip.getBoundingClientRect().height;
    }
    const spaceAbove = rect.top - margin;
    const placeBelow = spaceAbove < h + gap;
    setPlacement(placeBelow ? "below" : "above");
    setPos({ left: cx, top: rect.top, bottom: rect.bottom });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const id = requestAnimationFrame(() => updatePos());
    return () => cancelAnimationFrame(id);
  }, [open, updatePos, tooltipTiers]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePos]);

  useEffect(
    () => () => {
      clearClose();
    },
    []
  );

  const tooltipStyle =
    placement === "above"
      ? {
          left: pos.left,
          top: pos.top - 6,
          transform: "translate(-50%, -100%)" as const,
        }
      : {
          left: pos.left,
          top: pos.bottom + 6,
          transform: "translate(-50%, 0)" as const,
        };

  const tooltip = open ? (
    <div
      ref={tooltipRef}
      role="tooltip"
      className="pointer-events-auto fixed z-[9999] w-[min(92vw,380px)] max-w-[380px] rounded-md border border-gray-200 bg-white px-3 py-2.5 text-left text-gray-800 shadow-xl shadow-black/10 transition-colors duration-200 ease-in-out dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:shadow-black/40"
      style={tooltipStyle}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <div className="mb-2 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 transition-colors duration-200 ease-in-out dark:text-slate-400">
        Talents
      </div>
      <div className="flex flex-col gap-2">
        {tooltipTiers.map((tier) => (
          <div
            key={tier.heroLevel}
            className="grid grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)] items-center gap-1.5 text-[11px] leading-snug"
          >
            <TalentLine
              active={tier.selected === "left"}
              inactive={tier.selected === "right"}
              label={tier.left?.labelCn || tier.left?.labelEn || ""}
            />
            <span className="w-full shrink-0 text-center font-mono text-[10px] text-gray-500 transition-colors duration-200 ease-in-out dark:text-slate-500">
              {tier.heroLevel}
            </span>
            <TalentLine
              active={tier.selected === "right"}
              inactive={tier.selected === "left"}
              label={tier.right?.labelCn || tier.right?.labelEn || ""}
            />
          </div>
        ))}
      </div>
      {placement === "above" ? (
        <div className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2 border-8 border-transparent border-t-white dark:border-t-slate-800" />
      ) : (
        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 border-8 border-transparent border-b-white dark:border-b-slate-800" />
      )}
    </div>
  ) : null;

  return (
    <>
      <div
        ref={anchorRef}
        className="relative shrink-0"
        onMouseEnter={() => {
          openNow();
          queueMicrotask(updatePos);
        }}
        onMouseLeave={scheduleClose}
      >
        <div
          className={cn(
            "grid h-12 w-12 shrink-0 grid-cols-2 grid-rows-4 gap-[2px] p-[4px]",
            GRID_PANEL
          )}
          aria-label="天赋树"
        >
          {gridTiers.map((tier) => (
            <Fragment key={tier.heroLevel}>
              <TalentBranchNode side="left" selected={tier.selected} />
              <TalentBranchNode side="right" selected={tier.selected} />
            </Fragment>
          ))}
        </div>
      </div>
      {typeof document !== "undefined" && tooltip
        ? createPortal(tooltip, document.body)
        : null}
    </>
  );
}

/** 10 级在网格最下行、25 级在最上行（gridTiers 已按 25→10 排序） */
const TALENT_CELL_ON =
  "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.45)] ring-1 ring-amber-500/70 dark:bg-yellow-500 dark:shadow-[0_0_8px_rgba(234,179,8,0.5)] dark:ring-yellow-400/60";
const TALENT_CELL_IDLE = "bg-slate-800/60";

function TalentBranchNode({
  side,
  selected,
}: {
  side: "left" | "right";
  selected: "left" | "right" | null;
}) {
  const isOn = selected === side;
  const isOff = selected != null && selected !== side;
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 rounded-[2px] transition-all duration-200 ease-in-out",
        isOn && TALENT_CELL_ON,
        !isOn && !isOff && TALENT_CELL_IDLE,
        isOff && cn(TALENT_CELL_IDLE, "opacity-75")
      )}
    />
  );
}

function TalentLine({
  label,
  active,
  inactive,
}: {
  label: string;
  active: boolean;
  inactive: boolean;
}) {
  const raw = label.trim() || "—";
  const text = formatValveTalentText(raw);
  return (
    <div
      className={cn(
        "flex min-h-[2rem] min-w-0 items-center rounded-[2px] px-1.5 py-1 text-gray-800 transition-colors duration-200 ease-in-out dark:text-slate-200",
        active &&
          "border border-yellow-500/70 bg-yellow-50 font-semibold text-yellow-900 dark:border-yellow-500/60 dark:bg-yellow-950/50 dark:text-yellow-300",
        !active && inactive && "opacity-40 text-gray-500 dark:text-slate-500",
        !active && !inactive && "opacity-80 text-gray-500 dark:text-slate-400"
      )}
    >
      <span className="min-w-0 flex-1 break-words">{text}</span>
    </div>
  );
}
