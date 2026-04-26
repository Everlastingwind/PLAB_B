/**
 * 与前端一同构建发布。更新线上 `public/data` 后设置/递增该变量，可一次 bust 中间层/CDN 对带版本号 URL 的缓存。
 * 拉取逻辑已用 `cache: no-store`；版本号仍可用于 CDN 或分享链接的显式失效。
 */
export function staticDataSearchParam(): string {
  const v = import.meta.env.VITE_STATIC_DATA_VERSION;
  if (typeof v === "string" && v.trim().length > 0) {
    return `?v=${encodeURIComponent(v.trim())}`;
  }
  return "";
}
