/**
 * 从 OpenDota /api/constants/items 生成 public/data/item_craftable_keys.json
 * 规则与 dem_result_to_slim_match 侧一致：components 中存在非 recipe_ 的件则视为可合成成装。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "../public/data/item_craftable_keys.json");

const raw = await fetch("https://api.opendota.com/api/constants/items").then((r) =>
  r.json()
);
const keys = [];
for (const [internalKey, row] of Object.entries(raw)) {
  if (!row || typeof row !== "object") continue;
  const comps = row.components;
  if (!Array.isArray(comps)) continue;
  const ok = comps.some(
    (c) => String(c).trim() && !String(c).startsWith("recipe_")
  );
  if (ok) keys.push(internalKey.toLowerCase());
}
if (!keys.includes("blink")) keys.push("blink");
keys.sort();
await fs.writeFile(outPath, JSON.stringify(keys), "utf8");
console.log("wrote", keys.length, "keys ->", outPath);
