import type { EntityMapsPayload } from "../types/entityMaps";
import type { ReplaySummary, ReplaysIndexPayload } from "../types/replaysIndex";

const PAGE_SIZE = 20;

/** 每次请求带时间戳，避免 SPA 模块级缓存导致上传后首页仍显示旧列表 */
export async function fetchReplaysIndex(): Promise<ReplaysIndexPayload> {
  const res = await fetch(`/data/replays_index.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`replays_index ${res.status}`);
  const raw = (await res.json()) as ReplaysIndexPayload;
  return {
    ...raw,
    replays: (raw.replays || []).map((r) => ({ ...r, source: "pub" })),
  };
}

/** 职业比赛索引：由 scripts/fetch_pro_replays_index.py 生成（OpenDota proMatches + 战队过滤） */
export async function fetchProReplaysIndex(): Promise<ReplaysIndexPayload> {
  const res = await fetch(`/data/pro_replays_index.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`pro_replays_index ${res.status}`);
  const raw = (await res.json()) as ReplaysIndexPayload;
  return {
    ...raw,
    replays: (raw.replays || []).map((r) => ({ ...r, source: "pro" })),
  };
}

/** 合并 PUB + PRO 索引：同 match_id 保留 uploaded_at 较新的一条 */
export function mergePubProReplays(
  pubRows: ReplaySummary[],
  proRows: ReplaySummary[]
): ReplaySummary[] {
  const byId = new Map<number, ReplaySummary>();
  const upsert = (r: ReplaySummary, defaultSource: "pub" | "pro") => {
    const row = { ...r, source: r.source ?? defaultSource };
    const ex = byId.get(row.match_id);
    if (!ex) {
      byId.set(row.match_id, row);
      return;
    }
    const t1 = new Date(ex.uploaded_at).getTime();
    const t2 = new Date(row.uploaded_at).getTime();
    if (t2 >= t1) byId.set(row.match_id, row);
  };
  for (const r of pubRows) upsert(r, "pub");
  for (const r of proRows) upsert(r, "pro");
  return Array.from(byId.values()).sort(
    (a, b) =>
      new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
  );
}

/** 录像索引来源（首页 / 英雄页 / 选手页共用）：PUB / PRO 可多选 */
export type FeedSelection = { pub: boolean; pro: boolean };

export async function fetchReplaysForFeedSelection(
  sel: FeedSelection
): Promise<ReplaySummary[]> {
  if (sel.pub && sel.pro) {
    const [pubIdx, proIdx] = await Promise.all([
      fetchReplaysIndex(),
      fetchProReplaysIndex(),
    ]);
    return mergePubProReplays(pubIdx.replays, proIdx.replays);
  }
  if (sel.pub) {
    const idx = await fetchReplaysIndex();
    return idx.replays;
  }
  const idx = await fetchProReplaysIndex();
  return idx.replays;
}

export function slicePage(replays: ReplaySummary[], page: number): ReplaySummary[] {
  const end = page * PAGE_SIZE;
  return replays.slice(0, end);
}

export function hasMore(total: number, page: number): boolean {
  return page * PAGE_SIZE < total;
}

export { PAGE_SIZE };

export function filterByHeroKey(
  replays: ReplaySummary[],
  heroKey: string,
  maps: EntityMapsPayload
): ReplaySummary[] {
  const k = heroKey.toLowerCase();
  return replays.filter((r) =>
    r.players.some((p) => {
      const e = maps.heroes[String(p.hero_id)];
      return e?.key?.toLowerCase() === k;
    })
  );
}

export function filterByAccountId(
  replays: ReplaySummary[],
  accountId: number
): ReplaySummary[] {
  return replays.filter((r) =>
    r.players.some((p) => p.account_id === accountId)
  );
}

export function heroKeyFromId(
  heroId: number,
  maps: EntityMapsPayload
): string {
  return maps.heroes[String(heroId)]?.key ?? "unknown";
}
