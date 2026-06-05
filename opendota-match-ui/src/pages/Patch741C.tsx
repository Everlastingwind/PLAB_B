import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { heroes, item_ids, items } from "dotaconstants";
import { PageShell } from "../components/PageShell";
import { SEOMeta } from "../components/SEOMeta";
import { supabase } from "../lib/supabaseClient.js";
import { useSitePatch } from "../contexts/SitePatchContext";
import {
  fetchDota2UpdateByVersion,
  patchNavDisplayLabel,
  type Dota2UpdateRow,
} from "../lib/dota2UpdatesApi";
import { parseSteamBBCode } from "../lib/parseSteamBBCode";
import { PatchUpdatePanel } from "../components/PatchUpdatePanel";
import { PatchNotesDatafeedView } from "../components/PatchNotesDatafeedView";
import {
  getEntityInfo,
  translateNote,
  type PatchEntityKind,
  type PatchEntityInfo,
} from "../lib/patch741Resolve";
import {
  translatePatch741cNote,
  translatePatch741cTitle,
} from "../utils/patch741c_translations";
import { cn } from "../lib/cn";

/** 页面侧显式绑定 dotaconstants 映射表（与 patch741Resolve 同源） */
export const dotaconstantsPatch741 = { item_ids, items, heroes };

export type { PatchEntityKind, PatchEntityInfo };
export { getEntityInfo, translateNote };
export {
  nameDict,
  translationDict,
  translatePatch741cNote,
  translatePatch741cTitle,
} from "../utils/patch741c_translations";

export function Patch741CPage() {
  const { patch } = useSitePatch();
  const currentPatch = patch?.currentPatch ?? "";
  const patchLabel = patchNavDisplayLabel(currentPatch);

  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [row, setRow] = useState<Dota2UpdateRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentPatch) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const client = supabase;
      if (!client) {
        setError(
          "未配置 Supabase：请在仓库根目录 .env.local 填写 URL 与 anon key，保存后重启 npm run dev"
        );
        setRow(null);
        setLoading(false);
        return;
      }
      const { row: data, error: qErr } = await fetchDota2UpdateByVersion(
        client,
        currentPatch
      );

      if (cancelled) return;
      if (qErr) {
        setError(qErr);
        setRow(null);
      } else {
        setRow(data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPatch]);

  const bodyRender = useMemo(() => {
    if (!row?.content) return { kind: "empty" as const };
    const raw = row.content.trim();
    if (raw.startsWith("{")) {
      try {
        JSON.parse(raw);
        return { kind: "datafeed" as const, json: raw };
      } catch {
        /* fallthrough BBCode */
      }
    }
    return {
      kind: "bbcode" as const,
      html: parseSteamBBCode(row.content),
    };
  }, [row?.content]);

  const releaseLabel = useMemo(() => {
    if (!row?.release_date) return null;
    try {
      const d = new Date(row.release_date);
      return d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return row.release_date;
    }
  }, [row?.release_date]);

  if (!patch) return null;

  return (
    <>
      <SEOMeta title={`Dota 2 更新 ${patchLabel}`} />
      <PageShell>
        <main className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-skin-line pb-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-skin-sub">
                Gameplay Update
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-skin-ink sm:text-3xl">
                {patchLabel}
              </h1>
              {releaseLabel ? (
                <p className="mt-1 text-sm text-skin-sub">{releaseLabel}</p>
              ) : null}
            </div>
            <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3">
              <Link
                to="/"
                className="text-sm text-accent-cyan underline-offset-2 hover:underline"
              >
                {lang === "en" ? "Home" : "返回首页"}
              </Link>
              <div
                className="inline-flex rounded-full border border-skin-line bg-skin-inset/60 p-0.5 dark:border-zinc-600 dark:bg-zinc-800/80"
                role="group"
                aria-label={lang === "en" ? "Language" : "语言"}
              >
                <button
                  type="button"
                  onClick={() => setLang("zh")}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition sm:text-sm",
                    lang === "zh"
                      ? "bg-white text-skin-ink shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-skin-sub hover:text-skin-ink dark:text-zinc-400 dark:hover:text-zinc-200"
                  )}
                >
                  中文
                </button>
                <button
                  type="button"
                  onClick={() => setLang("en")}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition sm:text-sm",
                    lang === "en"
                      ? "bg-white text-skin-ink shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-skin-sub hover:text-skin-ink dark:text-zinc-400 dark:hover:text-zinc-200"
                  )}
                >
                  English
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div
              className="h-40 animate-pulse rounded-xl border border-skin-line bg-skin-inset/50"
              aria-busy
              aria-label="加载中"
            />
          ) : error ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200/90">
              {error}
            </p>
          ) : !row ? (
            <div className="rounded-xl border border-skin-line bg-skin-card p-6 shadow-sm">
              <p className="text-sm text-skin-sub">
                暂无 {patchLabel} 补丁数据。请在 Supabase 中创建表{" "}
                <code className="rounded bg-skin-inset px-1 py-0.5 text-xs">
                  dota2_updates
                </code>{" "}
                后，于开发环境使用下方「同步补丁数据」从官方 Datafeed 拉取。
              </p>
            </div>
          ) : (
            <article
              className={cn(
                "rounded-xl border border-skin-line bg-skin-card p-5 shadow-sm sm:p-8",
                "dark:border-zinc-600/80 dark:bg-surface-deep/80"
              )}
            >
              <h2 className="text-lg font-semibold text-skin-ink sm:text-xl">
                {row.title}
              </h2>
              {bodyRender.kind === "datafeed" ? (
                <PatchNotesDatafeedView
                  content={bodyRender.json}
                  lang={lang}
                  getEntityInfo={getEntityInfo}
                  translateNote={translatePatch741cNote}
                  translateTitle={translatePatch741cTitle}
                />
              ) : bodyRender.kind === "bbcode" ? (
                <div
                  className={cn(
                    "prose-patch mt-6 max-w-none text-skin-ink",
                    "[&_a]:text-accent-cyan [&_strong]:text-skin-ink"
                  )}
                  dangerouslySetInnerHTML={{ __html: bodyRender.html }}
                />
              ) : null}
            </article>
          )}

          <PatchUpdatePanel />
        </main>
      </PageShell>
    </>
  );
}
