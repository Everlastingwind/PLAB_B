/**
 * 与前端一同构建发布。更新线上 `public/data` 后设置/递增该变量，可一次让浏览器放弃旧缓存。
 * 未设置时依赖浏览器与 CDN 的默认缓存策略，避免每次导航都全量重下大 JSON。
 */
export function staticDataSearchParam(): string {
  const v = import.meta.env.VITE_STATIC_DATA_VERSION;
  if (typeof v === "string" && v.trim().length > 0) {
    return `?v=${encodeURIComponent(v.trim())}`;
  }
  return "";
}
