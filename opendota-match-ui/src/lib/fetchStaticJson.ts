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
 * 默认使用 `cache: default`：配合 `VITE_STATIC_DATA_VERSION` 进行版本失效，避免每次都全量重拉。
 */
export async function fetchDeployedDataJson<T>(path: string): Promise<T> {
  const res = await fetch(`${path}${staticDataSearchParam()}`, {
    cache: "default",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
