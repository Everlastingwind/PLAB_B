import { staticDataSearchParam } from "./staticDataVersion";

/** 本地 `public/data/*.json`：不要用时间戳强刷，交给浏览器缓存 / 304。 */
export async function fetchStaticJson<T>(
  path: string,
  init?: RequestInit & { cache?: RequestCache }
): Promise<T> {
  const { cache, ...rest } = init ?? {};
  const res = await fetch(path, {
    cache: cache ?? "default",
    ...rest,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** 与站点一同部署的 JSON：`cache: default` + 可选 `VITE_STATIC_DATA_VERSION` 查询参数。 */
export async function fetchDeployedDataJson<T>(path: string): Promise<T> {
  const res = await fetch(`${path}${staticDataSearchParam()}`, {
    cache: "default",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
