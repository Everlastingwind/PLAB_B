/**
 * 与前端一同构建发布。未配置 `VITE_PUBLIC_JSON_BASE` 时，递增该变量可 bust 同源 `/data/`。
 * 配置 CDN 基地址后，`resolvePublicDataFetchUrl`（`fetchStaticJson.ts`）仍会追加 `?t=` 时间戳。
 */
export function staticDataSearchParam(): string {
  const v = import.meta.env.VITE_STATIC_DATA_VERSION;
  if (typeof v === "string" && v.trim().length > 0) {
    return `?v=${encodeURIComponent(v.trim())}`;
  }
  return "";
}
