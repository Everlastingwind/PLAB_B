import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const uiRoot = __dirname;
  const repoRoot = path.resolve(uiRoot, "..");
  /** 仓库根 `.env.local` 与 `opendota-match-ui/.env.local` 合并，后者覆盖前者 */
  const mergedVite = {
    ...loadEnv(mode, repoRoot, "VITE_"),
    ...loadEnv(mode, uiRoot, "VITE_"),
  };
  const jsonBase = mergedVite.VITE_PUBLIC_JSON_BASE?.trim();

  return {
    plugins: [react()],
    envDir: uiRoot,
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    /** 确保在 monorepo 根目录配置 `VITE_PUBLIC_JSON_BASE` 时也能注入到 import.meta.env */
    define: jsonBase
      ? {
          "import.meta.env.VITE_PUBLIC_JSON_BASE": JSON.stringify(jsonBase),
        }
      : {},
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
        "/dota2-api": {
          target: "https://www.dota2.com",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/dota2-api/, ""),
        },
      },
    },
  };
});
