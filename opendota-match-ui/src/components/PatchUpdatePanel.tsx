import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { syncPatchFromDota2Datafeed } from "../lib/dota2DatafeedSync";
import { invalidateSitePatchCache } from "../lib/sitePatchStore";
import { useSitePatch } from "../contexts/SitePatchContext";

/**
 * 仅在开发环境渲染：从 Steam 拉取公告并 upsert 到 `dota2_updates`，
 * 同时将站点 `site_settings` 的「当前补丁」旋转为「上一补丁」并写入输入框版本为新当前补丁。
 */
export function PatchUpdatePanel() {
  const { refresh } = useSitePatch();
  const [targetVersion, setTargetVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  const onSync = async () => {
    const v = targetVersion.trim();
    if (!v) {
      setToast("请输入版本号");
      return;
    }
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const client = supabase;
      if (!client) {
        throw new Error(
          "未配置 Supabase：请在 .env.local 设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY"
        );
      }
      const row = await syncPatchFromDota2Datafeed(client, v);

      const { data: existing, error: selErr } = await client
        .from("site_settings")
        .select("current_patch")
        .eq("id", 1)
        .maybeSingle();

      if (selErr) throw selErr;

      const oldCurrent = existing
        ? String((existing as { current_patch?: unknown }).current_patch ?? "").trim()
        : "";

      if (!existing) {
        throw new Error(
          "site_settings 未初始化：请先在 Supabase 执行 opendota-match-ui/supabase/site_settings.sql"
        );
      }

      const { error: upErr } = await client.from("site_settings").upsert(
        {
          id: 1,
          current_patch: v,
          previous_patch: oldCurrent || v,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (upErr) throw upErr;

      invalidateSitePatchCache();
      await refresh();

      setMsg(
        `已同步：${row.title}（gid=${row.gid}）；站点补丁已设为 ${v}（上一版本：${oldCurrent || "—"}）`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <section
      className="mt-8 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4 dark:border-amber-400/35 dark:bg-amber-500/10"
      aria-label="开发环境补丁同步"
    >
      <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-200/90">
        开发专用：Dota2 Datafeed → Supabase；并更新 site_settings（全站热切换）
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={targetVersion}
          onChange={(e) => setTargetVersion(e.target.value)}
          placeholder="输入新版本号，如 7.41D"
          disabled={busy}
          className="min-w-[160px] flex-1 rounded border border-amber-600/40 bg-white/90 px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50 disabled:opacity-50 dark:border-amber-500/35 dark:bg-zinc-900/90 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          aria-label="补丁版本号"
        />
        <button
          type="button"
          disabled={busy}
          onClick={onSync}
          className="rounded border border-amber-600/50 bg-amber-500/15 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30"
        >
          {busy ? "同步中…" : "同步对应版本数据"}
        </button>
      </div>
      {toast ? (
        <p
          role="status"
          className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-100"
        >
          {toast}
        </p>
      ) : null}
      {msg ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400/90">{msg}</p>
      ) : null}
      {err ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400/90">{err}</p>
      ) : null}
    </section>
  );
}
