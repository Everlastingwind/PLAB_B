/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 更新静态数据后构建时设置，用于缓存刷新；见 `staticDataVersion.ts` */
  readonly VITE_STATIC_DATA_VERSION?: string;
  /** 可选：Supabase Storage / CDN 根 URL（不含尾部 `/`），对应桶内 `public/data/` 前缀 */
  readonly VITE_PUBLIC_JSON_BASE?: string;
}
