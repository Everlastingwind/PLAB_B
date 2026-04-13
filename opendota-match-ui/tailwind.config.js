/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx,css}"],
  theme: {
    extend: {
      colors: {
        /** 浅色页/字/卡片 — 变量见 index.css；深色为 .dark */
        skin: {
          page: "var(--app-bg)",
          muted: "var(--app-bg-muted)",
          ink: "var(--app-text)",
          sub: "var(--app-text-muted)",
          line: "var(--app-border)",
          header: "var(--app-header-bg)",
          card: "var(--app-card-bg)",
          cardLine: "var(--app-card-border)",
          inset: "var(--app-inset-bg)",
          raised: "var(--app-raised-bg)",
          frame: "var(--app-frame-bg)",
        },
        // 深蓝灰底（OpenDota 风格）
        surface: {
          DEFAULT: "#121a24",
          raised: "#1b2735",
          deep: "#0c141c",
        },
        accent: {
          cyan: "#22d3ee",
          blue: "#38bdf8",
          muted: "#5b8cff",
        },
        radiant: "#34d399",
        dire: "#f87171",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      boxShadow: {
        header: "0 4px 24px rgba(0, 0, 0, 0.35)",
        card: "var(--app-card-shadow)",
      },
    },
  },
  plugins: [],
};
