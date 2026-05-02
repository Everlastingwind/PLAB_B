import { useEffect, useMemo, useRef, useState } from "react";
import type { EntityMapsPayload } from "../types/entityMaps";
import {
  heroIconUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
} from "../data/mockMatchPlayers";
import { cn } from "../lib/cn";

type HeroRow = {
  id: number;
  key: string;
  nameCn: string;
  nameEn: string;
};

function flattenHeroRows(maps: EntityMapsPayload): HeroRow[] {
  const out: HeroRow[] = [];
  for (const [idStr, h] of Object.entries(maps.heroes || {})) {
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) continue;
    out.push({
      id,
      key: h.key,
      nameCn: h.nameCn || "",
      nameEn: h.nameEn || "",
    });
  }
  return out.sort((a, b) => {
    const an = (a.nameCn || a.nameEn || a.key).trim();
    const bn = (b.nameCn || b.nameEn || b.key).trim();
    return an.localeCompare(bn, "zh-CN");
  });
}

function matchesHeroQuery(row: HeroRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    row.key.toLowerCase().includes(s) ||
    row.nameEn.toLowerCase().includes(s) ||
    (row.nameCn ? row.nameCn.includes(q.trim()) : false)
  );
}

export type HeroPickerMode = "teammate" | "opponent";

type Props = {
  mode: HeroPickerMode;
  maps: EntityMapsPayload;
  value: number | null;
  onChange: (heroId: number | null) => void;
  className?: string;
};

export function HeroPickerPopover({
  mode,
  maps,
  value,
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => flattenHeroRows(maps), [maps]);
  const filtered = useMemo(
    () => rows.filter((r) => matchesHeroQuery(r, q)),
    [rows, q]
  );

  const selected =
    value != null && value > 0 ? maps.heroes[String(value)] : undefined;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const emptyLabel = mode === "teammate" ? "➕ 队友" : "➕ 对手";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
          selected
            ? "border-skin-line bg-skin-inset text-skin-ink dark:border-zinc-600"
            : "border-dashed border-slate-400/70 bg-transparent text-skin-sub hover:border-amber-500/50 hover:text-skin-ink dark:border-zinc-500 dark:hover:border-amber-500/40"
        )}
      >
        {selected ? (
          <>
            <img
              src={heroIconUrl(selected.key)}
              alt=""
              className="h-8 w-8 shrink-0 rounded object-cover"
              {...steamCdnImgDefer}
              onError={onDotaSteamAssetImgError}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-skin-ink">
              {selected.nameCn || selected.nameEn || selected.key}
            </span>
            <button
              type="button"
              aria-label="清除"
              className="shrink-0 rounded p-0.5 text-skin-sub hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                setOpen(false);
                setQ("");
              }}
            >
              ×
            </button>
          </>
        ) : (
          <span className="text-skin-sub">{emptyLabel}</span>
        )}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-[400] w-[min(calc(100vw-2rem),22rem)] rounded-lg border border-skin-line bg-white p-2 shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
          role="dialog"
          aria-label="选择英雄"
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="拼音 / 中文 / 英文名"
            className="mb-2 w-full rounded border border-skin-line bg-skin-inset px-2 py-1.5 text-xs text-skin-ink placeholder:text-skin-sub focus:outline-none focus:ring-1 focus:ring-amber-500/40 dark:border-zinc-600"
            autoComplete="off"
          />
          <div className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-5">
            {filtered.map((h) => (
              <button
                key={h.id}
                type="button"
                title={h.nameCn || h.nameEn || h.key}
                onClick={() => {
                  onChange(h.id);
                  setOpen(false);
                  setQ("");
                }}
                className={cn(
                  "flex flex-col items-center rounded border border-transparent p-1 text-center hover:border-amber-500/40 hover:bg-amber-500/10",
                  value === h.id && "border-amber-500/50 bg-amber-500/15"
                )}
              >
                <img
                  src={heroIconUrl(h.key)}
                  alt=""
                  className="h-9 w-9 rounded object-cover"
                  {...steamCdnImgDefer}
                  onError={onDotaSteamAssetImgError}
                />
                <span className="mt-0.5 line-clamp-2 w-full text-[9px] leading-tight text-skin-sub">
                  {h.nameCn || h.nameEn}
                </span>
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className="py-2 text-center text-xs text-skin-sub">无匹配英雄</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
