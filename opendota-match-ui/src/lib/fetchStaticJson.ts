import { staticDataSearchParam } from "./staticDataVersion";

/**
 * 根据站点路径 `/data/foo.json` 得到 Storage 上的对象路径后缀（不含域名）。
 * `base` 可能是 bucket 根，也可能已包含 `/public/data`（避免重复拼接）。
 */
function joinCdnStorageObjectUrl(baseInput: string, sitePath: string): string {
  const base = baseInput.trim().replace(/\/+$/, "");
  const normalized = sitePath.startsWith("/") ? sitePath : `/${sitePath}`;
  const fileRel = normalized.startsWith("/data/")
    ? normalized.slice("/data/".length)
    : normalized.replace(/^\//, "");

  if (/\/public\/data$/i.test(base)) {
    return `${base}/${fileRel}`;
  }
  return `${base}/public/data/${fileRel}`;
}

/** 同源 `/data/...`，含 `v=` 与 `t=` */
function resolveLocalPublicDataUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const v = staticDataSearchParam();
  const bust = `t=${Date.now()}`;
  if (!v) return `${normalized}?${bust}`;
  return `${normalized}${v}&${bust}`;
}

function hasRemoteJsonBase(): boolean {
  const raw = import.meta.env.VITE_PUBLIC_JSON_BASE;
  return typeof raw === "string" && raw.trim().length > 0;
}

/**
 * 将站点路径 `/data/*.json` 解析为可请求的 URL。
 *
 * - `VITE_PUBLIC_JSON_BASE`： bucket 根 **或** 已包含结尾 `/public/data` 的完整前缀（两种均支持）。
 * - 未设置时沿用同源 `/data/...`。
 * - 追加 `t=` 打穿 CDN；若 CDN 仅上传了部分文件，{@link fetchDeployedDataJson} 会对 400/404 回退同源。
 */
export function resolvePublicDataFetchUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const raw = import.meta.env.VITE_PUBLIC_JSON_BASE;
  const base =
    typeof raw === "string" && raw.trim().length > 0
      ? raw.trim().replace(/\/+$/, "")
      : "";

  let urlWithoutTimeBust: string;
  if (!base) {
    urlWithoutTimeBust = `${normalized}${staticDataSearchParam()}`;
  } else {
    if (!/^https?:\/\//i.test(base)) {
      console.warn(
        "[fetchStaticJson] VITE_PUBLIC_JSON_BASE 须为 https:// 开头的绝对 URL，当前值:",
        base
      );
    }
    urlWithoutTimeBust = joinCdnStorageObjectUrl(base, normalized);
  }

  const sep = urlWithoutTimeBust.includes("?") ? "&" : "?";
  return `${urlWithoutTimeBust}${sep}t=${Date.now()}`;
}

async function fetchJsonWithLocalFallback(
  path: string,
  init?: RequestInit & { cache?: RequestCache }
): Promise<Response> {
  const primary = resolvePublicDataFetchUrl(path);
  const { cache, ...rest } = init ?? {};
  let res = await fetch(primary, {
    cache: cache ?? "no-store",
    ...rest,
  });

  if (
    !res.ok &&
    hasRemoteJsonBase() &&
    (res.status === 400 || res.status === 404)
  ) {
    const fb = resolveLocalPublicDataUrl(path);
    res = await fetch(fb, {
      cache: cache ?? "no-store",
      ...rest,
    });
  }

  return res;
}

/** 本地 `public/data/*.json`：默认 no-store */
export async function fetchStaticJson<T>(
  path: string,
  init?: RequestInit & { cache?: RequestCache }
): Promise<T> {
  const res = await fetchJsonWithLocalFallback(path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/**
 * 部署静态 JSON：优先 CDN；若桶内无该对象（仅上传了快照等）则回退本站 `/data/`。
 */
export async function fetchDeployedDataJson<T>(path: string): Promise<T> {
  const res = await fetchJsonWithLocalFallback(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
