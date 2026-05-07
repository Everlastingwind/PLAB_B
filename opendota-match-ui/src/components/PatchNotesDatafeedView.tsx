import { useMemo, type ReactNode } from "react";
import { cn } from "../lib/cn";
import type {
  PatchEntityInfo,
  PatchEntityKind,
} from "../lib/patch741Resolve";

const sectionGap = "mt-12 first:mt-8";
const h3Class =
  "text-lg font-semibold tracking-tight text-skin-ink dark:text-zinc-100";
const h4Class =
  "text-base font-semibold text-skin-ink/95 dark:text-zinc-200";
const bodyClass =
  "text-sm leading-relaxed text-skin-sub dark:text-zinc-400";
const listClass =
  "list-disc pl-5 " +
  bodyClass +
  " space-y-2.5 marker:text-skin-sub/80 dark:marker:text-zinc-500";

type PatchNotesLang = "zh" | "en";

type Props = {
  content: string;
  lang: PatchNotesLang;
  getEntityInfo: (
    id: number,
    type: PatchEntityKind
  ) => PatchEntityInfo | null;
  translateNote: (text: string, lang: PatchNotesLang) => string;
  translateTitle: (text: string, lang: PatchNotesLang) => string;
};

function collectNoteFields(v: unknown, out: string[]): void {
  if (v === null || v === undefined) return;
  if (typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) collectNoteFields(x, out);
    return;
  }
  const o = v as Record<string, unknown>;
  const n = o.note;
  if (typeof n === "string" && n.trim()) out.push(n.trim());
  for (const val of Object.values(o)) {
    collectNoteFields(val, out);
  }
}

function firstString(
  o: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function hasStructuredData(d: Record<string, unknown>): boolean {
  const gn = d.general_notes;
  if (Array.isArray(gn) && gn.length > 0) {
    for (const x of gn) {
      if (!x || typeof x !== "object") continue;
      const s = x as Record<string, unknown>;
      const g = s.generic;
      const n = s.notes;
      if (Array.isArray(g) && g.length > 0) return true;
      if (Array.isArray(n) && n.length > 0) return true;
    }
  }
  if (Array.isArray(d.items) && d.items.length > 0) return true;
  if (Array.isArray(d.neutral_items) && d.neutral_items.length > 0)
    return true;
  if (Array.isArray(d.heroes) && d.heroes.length > 0) return true;
  return false;
}

function indentPad(level: unknown): string {
  const n = typeof level === "number" && Number.isFinite(level) ? level : 1;
  const step = Math.max(0, Math.min(4, n - 1));
  const map = ["", "pl-3", "pl-6", "pl-9", "pl-12"];
  return map[step] ?? "";
}

function EntityTitleRow({
  info,
  lang,
  translateTitle,
}: {
  info: PatchEntityInfo;
  lang: PatchNotesLang;
  translateTitle: Props["translateTitle"];
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <img
        src={info.iconUrl}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-md border border-skin-line object-cover dark:border-zinc-600"
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      <span className="text-base font-semibold text-accent-cyan dark:text-cyan-300">
        {translateTitle(info.name, lang)}
      </span>
    </div>
  );
}

function NoteLine({
  text,
  info,
  indent,
  lang,
  translateNote,
}: {
  text: string;
  info?: string;
  indent?: number;
  lang: PatchNotesLang;
  translateNote: (text: string, lang: PatchNotesLang) => string;
}) {
  const t = translateNote(text, lang);
  const i = info ? translateNote(info, lang) : undefined;
  return (
    <li className={cn("leading-relaxed", indentPad(indent ?? 1))}>
      <span className={bodyClass}>{t}</span>
      {i ? (
        <span className="mt-1 block text-xs text-skin-sub/85 dark:text-zinc-500">
          {i}
        </span>
      ) : null}
    </li>
  );
}

function renderGenericOrNotes(
  rows: unknown,
  key: number,
  lang: PatchNotesLang,
  translateNote: (text: string, lang: PatchNotesLang) => string
): ReactNode {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <ul key={key} className={cn(listClass, "mt-3")}>
      {rows.map((row, i) => {
        if (!row || typeof row !== "object") return null;
        const o = row as Record<string, unknown>;
        const note = o.note;
        if (typeof note !== "string" || !note.trim()) return null;
        const inf = typeof o.info === "string" ? o.info : undefined;
        const il = o.indent_level;
        return (
          <NoteLine
            key={`${key}-n-${i}`}
            text={note.trim()}
            info={inf}
            indent={typeof il === "number" ? il : 1}
            lang={lang}
            translateNote={translateNote}
          />
        );
      })}
    </ul>
  );
}

function GeneralSection({
  data,
  heading,
  lang,
  translateNote,
  translateTitle,
}: {
  data: Record<string, unknown>;
  heading: string;
  lang: PatchNotesLang;
  translateNote: (text: string, lang: PatchNotesLang) => string;
  translateTitle: (text: string, lang: PatchNotesLang) => string;
}) {
  const gn = data.general_notes;
  if (!Array.isArray(gn) || gn.length === 0) return null;
  return (
    <section className={sectionGap}>
      <h2 className={cn(h3Class, "text-xl")}>{heading}</h2>
      <div className="mt-6 space-y-8">
        {gn.map((block, bi) => {
          if (!block || typeof block !== "object") return null;
          const b = block as Record<string, unknown>;
          const titleRaw =
            typeof b.title === "string" && b.title.trim()
              ? b.title.trim()
              : null;
          const title = titleRaw
            ? translateTitle(titleRaw, lang)
            : null;
          const generic = b.generic;
          const notes = b.notes;
          const listRaw = Array.isArray(generic)
            ? generic
            : Array.isArray(notes)
              ? notes
              : null;
          if (!listRaw || listRaw.length === 0) return null;
          return (
            <div key={bi}>
              {title ? (
                <h4 className={cn(h4Class, "mb-3")}>{title}</h4>
              ) : null}
              {renderGenericOrNotes(listRaw, bi, lang, translateNote)}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function resolveItemHeader(
  o: Record<string, unknown>,
  getEntityInfo: Props["getEntityInfo"]
): PatchEntityInfo | null {
  const aid = o.ability_id;
  const jsonName = firstString(o, [
    "item_name",
    "name",
    "hero_name",
    "ability_name",
    "title",
  ]);
  if (jsonName) {
    if (typeof aid === "number") {
      const info = getEntityInfo(aid, "item");
      if (info)
        return { name: jsonName, iconUrl: info.iconUrl };
    }
    return { name: jsonName, iconUrl: "" };
  }
  if (typeof aid === "number") return getEntityInfo(aid, "item");
  return null;
}

function ItemBlocks({
  data,
  getEntityInfo,
  field,
  heading,
  lang,
  translateNote,
  translateTitle,
}: {
  data: Record<string, unknown>;
  getEntityInfo: Props["getEntityInfo"];
  field: "items" | "neutral_items";
  heading: string;
  lang: PatchNotesLang;
  translateNote: (text: string, lang: PatchNotesLang) => string;
  translateTitle: (text: string, lang: PatchNotesLang) => string;
}) {
  const arr = data[field];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return (
    <section className={sectionGap}>
      <h2 className={cn(h3Class, "text-xl")}>{heading}</h2>
      <div className="mt-6 space-y-8">
        {arr.map((row, i) => {
          if (!row || typeof row !== "object") return null;
          const o = row as Record<string, unknown>;
          const header = resolveItemHeader(o, getEntityInfo);
          const ability_notes = o.ability_notes;
          if (!Array.isArray(ability_notes) || ability_notes.length === 0)
            return null;
          const showIcon = header && header.iconUrl;
          return (
            <div key={i}>
              {header ? (
                showIcon ? (
                  <EntityTitleRow
                    info={header}
                    lang={lang}
                    translateTitle={translateTitle}
                  />
                ) : (
                  <h4 className={cn(h4Class, "mb-3 text-accent-cyan dark:text-cyan-300")}>
                    {translateTitle(header.name, lang)}
                  </h4>
                )
              ) : null}
              <ul className={cn(listClass, header ? "mt-1" : "mt-0")}>
                {ability_notes.map((n, j) => {
                  if (!n || typeof n !== "object") return null;
                  const e = n as Record<string, unknown>;
                  const t = e.note;
                  if (typeof t !== "string" || !t.trim()) return null;
                  const info = typeof e.info === "string" ? e.info : undefined;
                  return (
                    <li key={j} className="leading-relaxed">
                      <span className={bodyClass}>
                        {translateNote(t.trim(), lang)}
                      </span>
                      {info ? (
                        <span className="mt-1 block text-xs text-skin-sub/80 dark:text-zinc-500">
                          {translateNote(info, lang)}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function resolveHeroHeader(
  o: Record<string, unknown>,
  getEntityInfo: Props["getEntityInfo"]
): PatchEntityInfo | null {
  const hid = o.hero_id;
  const jsonName = firstString(o, ["hero_name", "name", "title"]);
  if (jsonName) {
    if (typeof hid === "number") {
      const info = getEntityInfo(hid, "hero");
      if (info)
        return { name: jsonName, iconUrl: info.iconUrl };
    }
    return { name: jsonName, iconUrl: "" };
  }
  if (typeof hid === "number") return getEntityInfo(hid, "hero");
  return null;
}

function resolveAbilityHeader(
  o: Record<string, unknown>,
  getEntityInfo: Props["getEntityInfo"]
): PatchEntityInfo | null {
  const aid = o.ability_id;
  const jsonName = firstString(o, [
    "ability_name",
    "name",
    "item_name",
    "title",
  ]);
  if (jsonName) {
    if (typeof aid === "number") {
      const info = getEntityInfo(aid, "ability");
      if (info)
        return { name: jsonName, iconUrl: info.iconUrl };
    }
    return { name: jsonName, iconUrl: "" };
  }
  if (typeof aid === "number") return getEntityInfo(aid, "ability");
  return null;
}

function HeroesSection({
  data,
  getEntityInfo,
  heading,
  talentsLabel,
  lang,
  translateNote,
  translateTitle,
}: {
  data: Record<string, unknown>;
  getEntityInfo: Props["getEntityInfo"];
  heading: string;
  talentsLabel: string;
  lang: PatchNotesLang;
  translateNote: (text: string, lang: PatchNotesLang) => string;
  translateTitle: (text: string, lang: PatchNotesLang) => string;
}) {
  const heroes = data.heroes;
  if (!Array.isArray(heroes) || heroes.length === 0) return null;
  return (
    <section className={sectionGap}>
      <h2 className={cn(h3Class, "text-xl")}>{heading}</h2>
      <div className="mt-8 space-y-10">
        {heroes.map((hero, hi) => {
          if (!hero || typeof hero !== "object") return null;
          const h = hero as Record<string, unknown>;
          const heroHeader = resolveHeroHeader(h, getEntityInfo);
          const hero_notes = h.hero_notes;
          const talent_notes = h.talent_notes;
          const abilities = h.abilities;
          const heroIcon = heroHeader && heroHeader.iconUrl;
          return (
            <div
              key={hi}
              className="border-t border-skin-line/80 pt-8 first:border-t-0 first:pt-0 dark:border-zinc-700/60"
            >
              {heroHeader ? (
                heroIcon ? (
                  <EntityTitleRow
                    info={heroHeader}
                    lang={lang}
                    translateTitle={translateTitle}
                  />
                ) : (
                  <h3 className={cn(h3Class, "mb-5 text-accent-cyan dark:text-cyan-300")}>
                    {translateTitle(heroHeader.name, lang)}
                  </h3>
                )
              ) : null}
              {Array.isArray(hero_notes) && hero_notes.length > 0 ? (
                <ul
                  className={cn(
                    listClass,
                    heroHeader ? "mb-5" : "mb-5 mt-0"
                  )}
                >
                  {hero_notes.map((n, j) => {
                    if (!n || typeof n !== "object") return null;
                    const e = n as Record<string, unknown>;
                    const t = e.note;
                    if (typeof t !== "string" || !t.trim()) return null;
                    return (
                      <li key={`h-${j}`} className="leading-relaxed">
                        <span className={bodyClass}>
                          {translateNote(t.trim(), lang)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {Array.isArray(talent_notes) && talent_notes.length > 0 ? (
                <div className="mb-5">
                  <p
                    className={cn(
                      "mb-2 text-xs font-medium uppercase tracking-wide text-skin-sub/90 dark:text-zinc-500"
                    )}
                  >
                    {talentsLabel}
                  </p>
                  <ul className={listClass}>
                    {talent_notes.map((n, j) => {
                      if (!n || typeof n !== "object") return null;
                      const e = n as Record<string, unknown>;
                      const t = e.note;
                      if (typeof t !== "string" || !t.trim()) return null;
                      return (
                        <li key={`t-${j}`} className="leading-relaxed">
                          <span className={bodyClass}>
                            {translateNote(t.trim(), lang)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {Array.isArray(abilities) && abilities.length > 0
                ? abilities.map((ab, ai) => {
                    if (!ab || typeof ab !== "object") return null;
                    const a = ab as Record<string, unknown>;
                    const an = a.ability_notes;
                    if (!Array.isArray(an) || an.length === 0) return null;
                    const abHeader = resolveAbilityHeader(a, getEntityInfo);
                    const abIcon = abHeader && abHeader.iconUrl;
                    return (
                      <div
                        key={ai}
                        className={cn("mb-6 last:mb-0", ai > 0 && "mt-5")}
                      >
                        {abHeader ? (
                          abIcon ? (
                            <EntityTitleRow
                              info={abHeader}
                              lang={lang}
                              translateTitle={translateTitle}
                            />
                          ) : (
                            <h4 className={cn(h4Class, "mb-2.5 text-accent-cyan dark:text-cyan-300")}>
                              {translateTitle(abHeader.name, lang)}
                            </h4>
                          )
                        ) : null}
                        <ul className={listClass}>
                          {an.map((n, j) => {
                            if (!n || typeof n !== "object") return null;
                            const e = n as Record<string, unknown>;
                            const t = e.note;
                            if (typeof t !== "string" || !t.trim())
                              return null;
                            const info =
                              typeof e.info === "string" ? e.info : undefined;
                            return (
                              <li key={j} className="leading-relaxed">
                                <span className={bodyClass}>
                                  {translateNote(t.trim(), lang)}
                                </span>
                                {info ? (
                                  <span className="mt-1 block text-xs text-skin-sub/80 dark:text-zinc-500">
                                    {translateNote(info, lang)}
                                  </span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FlatFallback({
  data,
  lang,
  translateNote,
}: {
  data: Record<string, unknown>;
  lang: PatchNotesLang;
  translateNote: (text: string, lang: PatchNotesLang) => string;
}) {
  const lines = useMemo(() => {
    const o: string[] = [];
    collectNoteFields(data, o);
    return o;
  }, [data]);

  if (lines.length === 0) {
    return <p className={cn(bodyClass, "mt-6")}>暂无内容。</p>;
  }

  return (
    <section className="mt-8">
      <ul className={listClass}>
        {lines.map((line, i) => (
          <li key={i} className="leading-relaxed">
            {translateNote(line, lang)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function pickPatchRoot(
  parsed: Record<string, unknown>,
  lang: PatchNotesLang
): Record<string, unknown> | null {
  const zh = parsed.zh;
  const en = parsed.en;
  if (
    zh &&
    en &&
    typeof zh === "object" &&
    !Array.isArray(zh) &&
    typeof en === "object" &&
    !Array.isArray(en)
  ) {
    return (lang === "zh" ? zh : en) as Record<string, unknown>;
  }
  return parsed;
}

export function PatchNotesDatafeedView({
  content,
  lang,
  getEntityInfo,
  translateNote,
  translateTitle,
}: Props) {
  const data = useMemo(() => {
    try {
      const j = JSON.parse(content) as unknown;
      if (!j || typeof j !== "object" || Array.isArray(j)) return null;
      const parsed = j as Record<string, unknown>;
      return pickPatchRoot(parsed, lang);
    } catch {
      return null;
    }
  }, [content, lang]);

  if (!data) return null;

  const structured = hasStructuredData(data);
  const labels =
    lang === "en"
      ? {
          general: "General",
          items: "Items",
          neutral: "Neutral items",
          heroes: "Heroes",
          talents: "Talents",
        }
      : {
          general: "综合更新",
          items: "物品更新",
          neutral: "中立物品",
          heroes: "英雄更新",
          talents: "天赋",
        };

  if (!structured) {
    return (
      <FlatFallback
        data={data}
        lang={lang}
        translateNote={translateNote}
      />
    );
  }

  return (
    <div className="mt-8 max-w-none">
      <GeneralSection
        data={data}
        heading={labels.general}
        lang={lang}
        translateNote={translateNote}
        translateTitle={translateTitle}
      />
      <ItemBlocks
        data={data}
        getEntityInfo={getEntityInfo}
        field="items"
        heading={labels.items}
        lang={lang}
        translateNote={translateNote}
        translateTitle={translateTitle}
      />
      <ItemBlocks
        data={data}
        getEntityInfo={getEntityInfo}
        field="neutral_items"
        heading={labels.neutral}
        lang={lang}
        translateNote={translateNote}
        translateTitle={translateTitle}
      />
      <HeroesSection
        data={data}
        getEntityInfo={getEntityInfo}
        heading={labels.heroes}
        talentsLabel={labels.talents}
        lang={lang}
        translateNote={translateNote}
        translateTitle={translateTitle}
      />
    </div>
  );
}
