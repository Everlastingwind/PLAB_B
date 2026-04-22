/**
 * 从 src/App.tsx 中解析无动态参数的 Route path，生成 public/sitemap.xml
 * 排除 path="*" 与含 :param 的路由。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const appTsx = path.join(root, "src", "App.tsx");
const outFile = path.join(root, "public", "sitemap.xml");

const BASE = "https://dota2planb.com";

function collectStaticPathsFromApp(source) {
  const paths = new Set();
  const re = /<Route\s+path="([^"]+)"\s+element=/g;
  for (const m of source.matchAll(re)) {
    const p = m[1];
    if (p === "*" || p.includes(":")) continue;
    paths.add(p.startsWith("/") ? p : `/${p}`);
  }
  if (!paths.has("/")) paths.add("/");
  return [...paths].sort((a, b) => a.localeCompare(b, "en"));
}

function buildUrlsetXml(paths) {
  const today = new Date().toISOString().split("T")[0];
  const body = paths
    .map(
      (p) => `  <url>
    <loc>${BASE}${p === "/" ? "/" : p}</loc>
    <lastmod>${today}</lastmod>
  </url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

const source = fs.readFileSync(appTsx, "utf8");
const paths = collectStaticPathsFromApp(source);
fs.writeFileSync(outFile, buildUrlsetXml(paths), "utf8");
console.log(`Sitemap: ${paths.length} URL(s) → ${path.relative(root, outFile)}`);
