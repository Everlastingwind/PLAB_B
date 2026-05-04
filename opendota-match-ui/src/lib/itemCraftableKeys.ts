import { staticDataSearchParam } from "./staticDataVersion";
import { normalizeMetaItemKey } from "./metaGlobalItemStats";

let cache: ReadonlySet<string> | null = null;

/**
 * 与 JSON 合并：无 components 但仍需纳入 Items 统计的直购件（闪烁匕首）。
 */
const ITEM_STATS_EXTRA_KEYS: readonly string[] = ["blink"];

/**
 * 需合成成装 + 额外直购件（见上）。基线来自 `public/data/item_craftable_keys.json`（OpenDota
 * `components` 含非 recipe_ 件），可由脚本再生。
 */
export async function loadCraftableItemKeySet(): Promise<ReadonlySet<string>> {
  if (cache) return cache;
  const q = staticDataSearchParam();
  const res = await fetch(`/data/item_craftable_keys.json${q}`, {
    cache: import.meta.env.DEV ? "no-store" : "default",
  });
  if (!res.ok) {
    throw new Error(`无法加载 item_craftable_keys.json（${res.status}）`);
  }
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error("item_craftable_keys.json 格式非法");
  }
  const set = new Set<string>();
  for (const x of raw) {
    if (typeof x === "string" && x.trim()) {
      set.add(normalizeMetaItemKey(x));
    }
  }
  for (const k of ITEM_STATS_EXTRA_KEYS) {
    set.add(normalizeMetaItemKey(k));
  }
  cache = set;
  return set;
}
