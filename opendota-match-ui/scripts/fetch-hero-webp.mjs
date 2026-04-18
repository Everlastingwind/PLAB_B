/**
 * 从 entity_maps.json 读取全部英雄 key，下载 Steam dota_react 竖版头像 PNG，
 * 转 WebP 并压到约 ≤10KB，写入 public/images/heroes/{key}.webp
 *
 * 用法（在 opendota-match-ui 目录）:
 *   npm run fetch-heroes-webp
 *
 * 依赖: sharp（devDependency）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.join(__dirname, "..");
const ENTITY_MAPS = path.join(UI_ROOT, "public/data/entity_maps.json");
const OUT_DIR = path.join(UI_ROOT, "public/images/heroes");
const STEAM_PNG = (key) =>
  `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${key}.png`;
const MAX_BYTES = 10 * 1024;

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "PLAB_B-fetch-hero-webp/1.0" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          res.resume();
          if (!loc) return reject(new Error("redirect without location"));
          return resolve(downloadBuffer(new URL(loc, url).href));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function pngToWebpUnderBudget(pngBuf) {
  const widths = [128, 112, 96, 80, 64, 56, 48];
  let best = null;
  for (const width of widths) {
    for (let q = 85; q >= 18; q -= 3) {
      const buf = await sharp(pngBuf)
        .resize(width, width, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: q, effort: 5, smartSubsample: true })
        .toBuffer();
      if (buf.length <= MAX_BYTES) return buf;
      if (!best || buf.length < best.length) best = buf;
    }
  }
  return best;
}

async function main() {
  const raw = await fs.readFile(ENTITY_MAPS, "utf8");
  const maps = JSON.parse(raw);
  const heroes = maps.heroes ?? {};
  const keys = [
    ...new Set(
      Object.values(heroes)
        .map((h) => String(h?.key ?? "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ].sort();

  await fs.mkdir(OUT_DIR, { recursive: true });

  const concurrency = 4;
  let ok = 0;
  let fail = 0;

  async function work(key) {
    const outPath = path.join(OUT_DIR, `${key}.webp`);
    try {
      const png = await downloadBuffer(STEAM_PNG(key));
      const webp = await pngToWebpUnderBudget(png);
      await fs.writeFile(outPath, webp);
      const sz = webp.length;
      if (sz > MAX_BYTES) {
        console.warn(`[warn] ${key}.webp ${sz}B > ${MAX_BYTES}B (已尽力压缩)`);
      }
      ok++;
      console.log(`[ok] ${key}.webp ${sz}B`);
    } catch (e) {
      fail++;
      console.error(`[fail] ${key}:`, e.message || e);
    }
  }

  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency);
    await Promise.all(batch.map(work));
  }

  console.log(`\n完成: 成功 ${ok}, 失败 ${fail}, 输出目录 ${OUT_DIR}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
