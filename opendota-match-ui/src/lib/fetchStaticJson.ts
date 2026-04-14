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
