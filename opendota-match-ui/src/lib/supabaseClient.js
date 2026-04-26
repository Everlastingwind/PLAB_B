import { createClient } from "@supabase/supabase-js";

const url = String(
  import.meta.env.VITE_SUPABASE_URL ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
).trim();
const anonKey = String(
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
).trim();

// 占位符或非 http(s) URL 也会触发 createClient 抛错 → 整站白屏
const urlOk = /^https?:\/\//i.test(url);

/** 避免手机端 Safari/Chrome 对 GET 的强缓存导致刷新仍看到旧 plan_b */
function fetchNoStore(input, init) {
  return fetch(input, {
    ...init,
    cache: "no-store",
  });
}

// createClient("", "") 同样会抛错；未配置时导出 null
export const supabase =
  url && anonKey && urlOk
    ? createClient(url, anonKey, {
        global: { fetch: fetchNoStore },
      })
    : null;

if (!supabase) {
  console.warn(
    "[supabase] 未初始化：请在仓库根目录 .env.local 中设置 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY（或 VITE_ 前缀），并重启 dev 服务器"
  );
}
