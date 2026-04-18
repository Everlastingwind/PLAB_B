/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 更新静态数据后构建时设置，用于缓存刷新；见 `staticDataVersion.ts` */
  readonly VITE_STATIC_DATA_VERSION?: string;
}
