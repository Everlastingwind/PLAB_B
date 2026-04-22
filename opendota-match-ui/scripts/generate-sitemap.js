/**
 * 生成 public/sitemap.xml：
 * - 固定 3 条静态路由：/, /high-mmr-matches, /pros
 * - 从 public/data/replays_index.json 读取比赛列表，为每场生成 /match/{id}
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outFile = path.join(root, "public", "sitemap.xml");
const replaysIndexFile = path.join(root, "public", "data", "replays_index.json");

const BASE = "https://dota2planb.com";

/** 与产品约定一致，不依赖 App.tsx 解析 */
const STATIC_PATHS = ["/", "/high-mmr-matches", "/pros"];

function toDateOnly(iso) {
  if (!iso || typeof iso !== "string") return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * 从 replays_index.json 收集 match_id；同一 id 多行时保留最新 uploaded_at 作为 lastmod
 */
function loadMatchUrlsFromReplaysIndex() {
  let raw;
  try {
    raw = fs.readFileSync(replaysIndexFile, "utf8");
  } catch {
    console.warn(
      `Sitemap: 未找到 ${path.relative(root, replaysIndexFile)}，跳过比赛 URL`
    );
    return [];
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn(`Sitemap: 解析 replays_index.json 失败，跳过比赛 URL — ${e.message}`);
    return [];
  }
  const replays = Array.isArray(data?.replays) ? data.replays : [];
  /** @type {Map<number, string | null>} */
  const lastmodById = new Map();
  for (const r of replays) {
    const mid = Number(r?.match_id);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    const ua = typeof r?.uploaded_at === "string" ? r.uploaded_at : null;
    const prev = lastmodById.get(mid);
    if (prev === undefined) {
      lastmodById.set(mid, ua);
    } else if (ua && (!prev || ua > prev)) {
      lastmodById.set(mid, ua);
    }
  }
  const ids = [...lastmodById.keys()].sort((a, b) => a - b);
  return ids.map((id) => ({
    loc: `${BASE}/match/${id}`,
    lastmod: toDateOnly(lastmodById.get(id) || "") || null,
  }));
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildUrlEntry(loc, lastmod) {
  const locEsc = escapeXml(loc);
  const lines = [`  <url>`, `    <loc>${locEsc}</loc>`];
  if (lastmod) lines.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
  lines.push(`  </url>`);
  return lines.join("\n");
}

function buildUrlsetXml(staticEntries, matchEntries) {
  const today = new Date().toISOString().split("T")[0];
  const staticBlocks = staticEntries.map((p) =>
    buildUrlEntry(`${BASE}${p === "/" ? "/" : p}`, today)
  );
  const matchBlocks = matchEntries.map((e) =>
    buildUrlEntry(e.loc, e.lastmod || today)
  );
  const body = [...staticBlocks, ...matchBlocks].join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

const matchEntries = loadMatchUrlsFromReplaysIndex();
const xml = buildUrlsetXml(STATIC_PATHS, matchEntries);

fs.writeFileSync(outFile, xml, "utf8");
console.log(
  `Sitemap: ${STATIC_PATHS.length} 静态 + ${matchEntries.length} 比赛 → ${path.relative(root, outFile)}`
);
