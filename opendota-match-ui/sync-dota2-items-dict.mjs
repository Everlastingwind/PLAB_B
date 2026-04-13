/**
 * 从 OpenDota 拉取物品常量，生成以装备 ID 为键的精简词典，写入 dota2_dict.json。
 * 若本地文件已存在且 items 数据一致，则不写入；有变动时覆盖并更新 updatedAt。
 */

import fs from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.opendota.com/api/constants/items";
const OUTPUT_NAME = "dota2_dict.json";
const outputPath = path.join(process.cwd(), OUTPUT_NAME);

/** 稳定序列化，用于判断内容是否变化（与键插入顺序无关） */
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** 将 API 原始对象转为 id -> { name, cost, attributes } */
function buildItemsDict(raw) {
  const items = {};
  for (const internalKey of Object.keys(raw)) {
    const row = raw[internalKey];
    if (!row || typeof row !== "object" || typeof row.id !== "number") continue;

    const id = String(row.id);
    const name =
      typeof row.dname === "string" && row.dname.length > 0
        ? row.dname
        : internalKey;
    const cost = typeof row.cost === "number" ? row.cost : null;
    const attributes = Array.isArray(row.attrib) ? row.attrib : [];

    items[id] = { name, cost, attributes };
  }
  return items;
}

function extractPreviousItems(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.items && typeof parsed.items === "object") return parsed.items;
  const keys = Object.keys(parsed);
  if (
    keys.length > 0 &&
    keys.every((k) => /^\d+$/.test(k)) &&
    !("updatedAt" in parsed)
  ) {
    return parsed;
  }
  return null;
}

async function main() {
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const raw = await res.json();
  if (!raw || typeof raw !== "object") {
    throw new Error("接口返回不是对象");
  }

  const items = buildItemsDict(raw);
  const nextFingerprint = stableStringify(items);

  let previousFingerprint = null;
  try {
    const existingText = await fs.readFile(outputPath, "utf8");
    const previous = JSON.parse(existingText);
    const prevItems = extractPreviousItems(previous);
    if (prevItems) previousFingerprint = stableStringify(prevItems);
  } catch {
    // 文件不存在或无法解析：视为需要写入
  }

  if (previousFingerprint === nextFingerprint) {
    console.log(
      `${OUTPUT_NAME} 已存在且数据未变化，跳过写入。` +
        (await fileUpdatedHint(outputPath))
    );
    return;
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    items,
  };

  await fs.writeFile(
    outputPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  console.log(
    `已写入 ${outputPath}，共 ${Object.keys(items).length} 条物品，updatedAt=${payload.updatedAt}`
  );
}

async function fileUpdatedHint(filePath) {
  try {
    const st = await fs.stat(filePath);
    return ` 文件 mtime: ${st.mtime.toISOString()}`;
  } catch {
    return "";
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
