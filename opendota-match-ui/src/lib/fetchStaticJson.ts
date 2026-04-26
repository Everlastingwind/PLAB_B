import { staticDataSearchParam } from "./staticDataVersion";

/** 本地 `public/data/*.json`：`cache` 可覆盖；默认与部署拉取一致，避免强缓存旧数据。 */
export async function fetchStaticJson<T>(
  path: string,
  init?: RequestInit & { cache?: RequestCache }
): Promise<T> {
  const { cache, ...rest } = init ?? {};
  const res = await fetch(path, {
    cache: cache ?? "no-store",
    ...rest,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/**
 * 与站点一同部署的 JSON + 可选 `VITE_STATIC_DATA_VERSION`。
 * 使用 `no-store`：手机端对同源 JSON 的 HTTP 缓存很激进，用 default 会导致刷新仍非最新。
 */
export async function fetchDeployedDataJson<T>(path: string): Promise<T> {
  const res = await fetch(`${path}${staticDataSearchParam()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
