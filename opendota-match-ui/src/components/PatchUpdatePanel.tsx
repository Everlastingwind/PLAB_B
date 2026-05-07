import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { syncPatch741cFromDota2Datafeed } from "../lib/dota2DatafeedSync";

/**
 * 仅在开发环境渲染：从 Steam 拉取公告并 upsert 到 `dota2_updates`。
 */
export function PatchUpdatePanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSync = async () => {
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
      const row = await syncPatch741cFromDota2Datafeed(client);
      setMsg(`已同步：${row.title}（gid=${row.gid}）`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Vite 浏览器端通常没有 `process`，必须用 import.meta.env.DEV；勿用 `typeof process === "undefined"` 否则面板永远不显示
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <section
      className="mt-8 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4 dark:border-amber-400/35 dark:bg-amber-500/10"
      aria-label="开发环境补丁同步"
    >
      <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-200/90">
        开发专用：Dota2 Datafeed → Supabase
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onSync}
        className="rounded border border-amber-600/50 bg-amber-500/15 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30"
      >
        {busy ? "同步中…" : "同步补丁数据 (Sync 7.41C)"}
      </button>
      {msg ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400/90">{msg}</p>
      ) : null}
      {err ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400/90">{err}</p>
      ) : null}
    </section>
  );
}
