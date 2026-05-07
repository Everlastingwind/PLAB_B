import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const maps = JSON.parse(
  fs.readFileSync(path.join(root, "public/data/entity_maps.json"), "utf8")
);

/** nameEn（与补丁 JSON 标题一致）→ nameCn */
const out = {};
for (const key of ["heroes", "items", "abilities"]) {
  const sec = maps[key];
  if (!sec || typeof sec !== "object") continue;
  for (const v of Object.values(sec)) {
    if (!v || typeof v !== "object") continue;
    const en = typeof v.nameEn === "string" ? v.nameEn.trim() : "";
    const cn = typeof v.nameCn === "string" ? v.nameCn.trim() : "";
    if (en && cn) out[en] = cn;
  }
}

const target = path.join(root, "src/utils/patch741c_entity_titles.json");
fs.writeFileSync(target, JSON.stringify(out, null, 2), "utf8");
console.log("Wrote", target, Object.keys(out).length);
