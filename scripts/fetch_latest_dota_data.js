/**
 * 从 Dotabuff d2vpkr 解包仓库拉取最新 npc 与本地化数据，生成前端可用的天赋映射表。
 *
 * 用法:
 *   npm run fetch-dota-vpkr
 *   node scripts/fetch_latest_dota_data.js --out=opendota-match-ui/public/data/latest_talents_map.json
 *   NPC_ABILITIES_URL=... node scripts/fetch_latest_dota_data.js
 *
 * 数据源说明:
 *   d2vpkr 在 GitHub Raw 上提供的是 Valve KeyValues（.txt），例如:
 *   - …/dota/scripts/npc/npc_abilities.txt
 *   - …/dota/scripts/npc/npc_heroes.txt
 *   - …/dota/resource/localization/abilities_english.txt
 *   若使用 …/npc_abilities.json 等路径会得到 404；本脚本默认使用上述 .txt。
 *
 * 环境变量可覆盖默认 URL（键名）: NPC_ABILITIES_URL, NPC_HEROES_URL,
 * ABILITIES_ENGLISH_URL, DOTA_ENGLISH_URL；或 D2VPKR_NPC_ABILITIES_URL 等同名变量。
 */

import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_BASE =
  "https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota";

/** @type {Record<string, string>} */
const DEFAULT_URLS = {
  npc_abilities: `${REPO_BASE}/scripts/npc/npc_abilities.txt`,
  npc_heroes: `${REPO_BASE}/scripts/npc/npc_heroes.txt`,
  abilities_english: `${REPO_BASE}/resource/localization/abilities_english.txt`,
  dota_english: `${REPO_BASE}/resource/localization/dota_english.txt`,
};

const RAW_CACHE_DIR = path.join(__dirname, "..", "data", "d2vpkr_raw");

// ---------------------------------------------------------------------------
// Valve KeyValues (VDF) tokenizer — 足够解析 npc_* 与 localization
// ---------------------------------------------------------------------------

/**
 * @param {string} input
 * @returns {string[]}
 */
function tokenizeVdf(input) {
  const tokens = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === "\uFEFF") {
      i++;
      continue;
    }
    if (c === "/" && input[i + 1] === "/") {
      while (i < n && input[i] !== "\n" && input[i] !== "\r") i++;
      continue;
    }
    if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i + 1 < n && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    if (c === "\r" || c === "\n" || c === "\t" || c === " ") {
      i++;
      continue;
    }
    if (c === "{" || c === "}") {
      tokens.push(c);
      i++;
      continue;
    }
    if (c === '"') {
      i++;
      let s = "";
      while (i < n) {
        const ch = input[i];
        if (ch === "\\") {
          i++;
          if (i < n) s += input[i++];
          continue;
        }
        if (ch === '"') {
          i++;
          break;
        }
        s += ch;
        i++;
      }
      tokens.push(s);
      continue;
    }
    let s = "";
    while (i < n) {
      const ch = input[i];
      if (ch === "\r" || ch === "\n" || ch === "\t" || ch === " ") break;
      if (ch === "{" || ch === "}" || ch === '"') break;
      if (ch === "/" && input[i + 1] === "/") break;
      s += ch;
      i++;
    }
    if (s.length) tokens.push(s);
  }
  return tokens;
}

/**
 * @param {string[]} tokens
 * @returns {Record<string, unknown>}
 */
function parseVdfRoot(tokens) {
  let idx = 0;
  function parseBlock() {
    /** @type {Record<string, unknown>} */
    const obj = Object.create(null);
    while (idx < tokens.length) {
      const t = tokens[idx];
      if (t === "}") {
        idx++;
        return obj;
      }
      const key = tokens[idx++];
      if (idx >= tokens.length) break;
      const next = tokens[idx];
      if (next === "{") {
        idx++;
        obj[key] = parseBlock();
      } else {
        obj[key] = tokens[idx++];
      }
    }
    return obj;
  }
  /** @type {Record<string, unknown>} */
  const root = Object.create(null);
  while (idx < tokens.length) {
    const key = tokens[idx++];
    if (idx >= tokens.length || tokens[idx] !== "{") {
      throw new Error(`VDF: 在键 "${key}" 后期望 '{'`);
    }
    idx++;
    root[key] = parseBlock();
  }
  return root;
}

/**
 * @param {string} text
 */
function parseVdf(text) {
  const cleaned = text.replace(/^\uFEFF/, "");
  return parseVdfRoot(tokenizeVdf(cleaned));
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * @param {string} url
 * @param {string} label
 */
async function fetchTextHttps(url, label) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": "plab-b/fetch_latest_dota_data (Node)" },
        timeout: 120_000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`${label} HTTP ${res.statusCode} ${res.statusMessage || ""}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`${label} 请求超时`));
    });
  });
}

/**
 * @param {string} url
 * @param {string} label
 */
async function fetchText(url, label) {
  console.log(`正在拉取: ${label}`);
  console.log(`  URL: ${url}`);
  const text = await fetchTextHttps(url, label);
  console.log(`  完成 (${(text.length / 1024).toFixed(1)} KB)`);
  return text;
}

/**
 * @param {string} p
 * @param {string} content
 */
async function writeRawCache(p, content) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf8");
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * 本地化文件根下通常为 { lang { Language ... Tokens { ... } } }，兼容首键大小写/BOM。
 * @param {Record<string, unknown>} root
 */
function flattenLangTokens(root) {
  /** @type {Record<string, string>} */
  const out = Object.create(null);
  for (const top of Object.values(root)) {
    if (!isObj(top)) continue;
    const tokens = top.Tokens ?? top.tokens;
    if (!isObj(tokens)) continue;
    for (const [k, v] of Object.entries(tokens)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  return out;
}

/**
 * @param {string} abilityKey
 * @param {Record<string, string>} tokens
 */
function resolveAbilityLabelEn(abilityKey, tokens) {
  const k1 = `DOTA_Tooltip_ability_${abilityKey}`;
  const k1d = `${k1}_Description`;
  const direct = tokens[abilityKey];
  const t1 = tokens[k1];
  const desc = tokens[k1d];
  const primary = t1 || direct || "";
  return {
    labelEn: primary.trim() || abilityKey,
    labelEnDescription: (desc || "").trim() || undefined,
  };
}

/**
 * @param {string} heroNpc
 * @param {Record<string, unknown>} heroBlock
 * @param {Record<string, string>} tokens
 */
function resolveHeroNameEn(heroNpc, heroBlock, tokens) {
  const wg = heroBlock.workshop_guide_name;
  if (typeof wg === "string" && wg.trim()) return wg.trim();
  const v = tokens[heroNpc];
  if (typeof v === "string" && v.trim()) return v.trim();
  const altKeys = [
    `DOTA_Tooltip_hero_${heroNpc}`,
    `DOTA_Tooltip_Hero_${heroNpc}`,
  ];
  for (const ak of altKeys) {
    const t = tokens[ak];
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return heroNpc.replace(/^npc_dota_hero_/i, "").replace(/_/g, " ");
}

/**
 * @param {Record<string, unknown>} heroBlock
 * @returns {{ slotKey: string, abilityKey: string }[]}
 */
function extractTalentSlotsFromHero(heroBlock) {
  if (!isObj(heroBlock)) return [];
  /** @type {{ slotKey: string, abilityKey: string }[]} */
  const slots = [];
  const re = /^Ability\d+$/;
  for (const [slotKey, val] of Object.entries(heroBlock)) {
    if (!re.test(slotKey)) continue;
    if (typeof val !== "string") continue;
    const abilityKey = val.trim();
    if (!abilityKey) continue;
    if (abilityKey === "special_bonus_attributes" || abilityKey === "special_bonus_undefined")
      continue;
    if (
      !abilityKey.startsWith("special_bonus_") &&
      !abilityKey.startsWith("ad_special_bonus")
    )
      continue;
    slots.push({ slotKey, abilityKey });
  }
  slots.sort((a, b) => {
    const na = parseInt(a.slotKey.replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(b.slotKey.replace(/\D/g, ""), 10) || 0;
    return na - nb;
  });
  return slots;
}

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const envUrls = {};
  for (const k of Object.keys(DEFAULT_URLS)) {
    const ku = k.toUpperCase();
    const ev =
      process.env[`${ku}_URL`] || process.env[`D2VPKR_${ku}_URL`];
    if (ev) envUrls[k] = ev;
  }
  let outPath = path.join(
    __dirname,
    "..",
    "opendota-match-ui",
    "public",
    "data",
    "latest_talents_map.json"
  );
  let cacheRaw = true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--out=")) outPath = path.resolve(a.slice(6));
    else if (a === "--no-cache") cacheRaw = false;
  }
  /** @type {Record<string, string>} */
  const urls = { ...DEFAULT_URLS, ...envUrls };
  return { urls, outPath, cacheRaw };
}

async function main() {
  console.log("正在拉取最新解包数据 (d2vpkr / Dotabuff)…\n");
  const { urls, outPath, cacheRaw } = parseArgs(process.argv);

  try {
    const abilitiesText = await fetchText(urls.npc_abilities, "npc_abilities");
    const heroesText = await fetchText(urls.npc_heroes, "npc_heroes");
    const abEnText = await fetchText(urls.abilities_english, "abilities_english");
    const dotaEnText = await fetchText(urls.dota_english, "dota_english");

    if (cacheRaw) {
      console.log("\n写入原始缓存:", RAW_CACHE_DIR);
      await writeRawCache(path.join(RAW_CACHE_DIR, "npc_abilities.txt"), abilitiesText);
      await writeRawCache(path.join(RAW_CACHE_DIR, "npc_heroes.txt"), heroesText);
      await writeRawCache(path.join(RAW_CACHE_DIR, "abilities_english.txt"), abEnText);
      await writeRawCache(path.join(RAW_CACHE_DIR, "dota_english.txt"), dotaEnText);
    }

    console.log("\n解析 VDF …");
    const abilitiesRoot = parseVdf(abilitiesText);
    const heroesRoot = parseVdf(heroesText);
    const abLangRoot = parseVdf(abEnText);
    const dotaLangRoot = parseVdf(dotaEnText);

    const abilitiesBranch =
      abilitiesRoot.DOTAAbilities || abilitiesRoot["DOTAAbilities"];
    if (!isObj(abilitiesBranch)) {
      throw new Error("npc_abilities: 未找到根键 DOTAAbilities");
    }

    const heroesBranch =
      heroesRoot.DOTAHeroes || heroesRoot["DOTAHeroes"];
    if (!isObj(heroesBranch)) {
      throw new Error("npc_heroes: 未找到根键 DOTAHeroes");
    }

    const abTokens = flattenLangTokens(abLangRoot);
    const dotaTokens = flattenLangTokens(dotaLangRoot);
    /** @type {Record<string, string>} */
    const mergedTokens = { ...dotaTokens, ...abTokens };

    /** @type {Set<string>} */
    const talentKeys = new Set();
    for (const k of Object.keys(abilitiesBranch)) {
      if (k === "special_bonus_attributes" || k === "special_bonus_undefined") continue;
      if (
        k.startsWith("special_bonus_") ||
        k.startsWith("ad_special_bonus")
      ) {
        talentKeys.add(k);
      }
    }

    /** @type {Map<string, Set<string>>} */
    const keyToHeroes = new Map();
    /** @type {Record<string, unknown>} */
    const byHeroNpcName = Object.create(null);

    for (const [heroNpc, block] of Object.entries(heroesBranch)) {
      if (!heroNpc.startsWith("npc_dota_hero_")) continue;
      if (heroNpc === "npc_dota_hero_base") continue;
      if (!isObj(block)) continue;

      const slots = extractTalentSlotsFromHero(block);
      if (!slots.length) continue;

      const heroNameEn = resolveHeroNameEn(heroNpc, block, mergedTokens);
      let heroId = 0;
      try {
        heroId = parseInt(String(block.HeroID ?? block.heroid ?? "0"), 10) || 0;
      } catch {
        heroId = 0;
      }
      /** @type {unknown[]} */
      const talentRows = [];
      for (const { slotKey, abilityKey } of slots) {
        const { labelEn, labelEnDescription } = resolveAbilityLabelEn(
          abilityKey,
          mergedTokens
        );
        if (!keyToHeroes.has(abilityKey)) keyToHeroes.set(abilityKey, new Set());
        keyToHeroes.get(abilityKey).add(heroNpc);
        talentRows.push({
          slotKey,
          abilityKey,
          labelEn,
          labelEnDescription,
        });
      }
      byHeroNpcName[heroNpc] = {
        heroNameEn,
        heroId: heroId || undefined,
        talentSlots: talentRows,
      };
    }

    /** @type {Record<string, unknown>} */
    const byAbilityKey = Object.create(null);
    for (const abilityKey of talentKeys) {
      const entry = abilitiesBranch[abilityKey];
      const heroes = [...(keyToHeroes.get(abilityKey) || [])].sort();
      const { labelEn, labelEnDescription } = resolveAbilityLabelEn(
        abilityKey,
        mergedTokens
      );
      byAbilityKey[abilityKey] = {
        labelEn,
        labelEnDescription,
        heroes,
        npcAbilityEntry: isObj(entry) ? entry : {},
      };
    }

    const out = {
      meta: {
        generatedAt: new Date().toISOString(),
        sourceRepo: "dotabuff/d2vpkr",
        urls,
        note:
          "原始文件为 Valve KeyValues (.txt)。若需 JSON 源，请自行转换或使用本仓库 raw .txt URL。天赋槽位来自各英雄 Ability* 字段中含 special_bonus_ 的项；不含 Facet/版本分支里单独覆盖的天赋。",
        talentKeyFilter:
          "key.startsWith('special_bonus_') || key.startsWith('ad_special_bonus')",
        counts: {
          talentDefinitions: Object.keys(byAbilityKey).length,
          heroesWithTalentSlots: Object.keys(byHeroNpcName).length,
        },
      },
      byAbilityKey,
      byHeroNpcName,
    };

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(out, null, 2), "utf8");

    console.log(
      "\n共提取到",
      Object.keys(byAbilityKey).length,
      "条天赋定义 (special_bonus_* / ad_special_bonus*)"
    );
    console.log(
      "其中",
      Object.keys(byHeroNpcName).length,
      "名英雄在 npc_heroes 中挂有天赋 Ability 槽位"
    );
    console.log("\n已写入:", outPath);
  } catch (e) {
    console.error("\n[错误]", e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exitCode = 1;
  }
}

main();
