import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envDir: "..",
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  server: {
    proxy: {
      // 开发时把 /api/* 转到本地 FastAPI，避免前端直连钉钉 Webhook 的 CORS
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
