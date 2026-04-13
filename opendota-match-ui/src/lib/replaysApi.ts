import type { EntityMapsPayload } from "../types/entityMaps";
import type { ReplaySummary, ReplaysIndexPayload } from "../types/replaysIndex";

const PAGE_SIZE = 20;

/** 每次请求带时间戳，避免 SPA 模块级缓存导致上传后首页仍显示旧列表 */
export async function fetchReplaysIndex(): Promise<ReplaysIndexPayload> {
  const res = await fetch(`/data/replays_index.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`replays_index ${res.status}`);
  return (await res.json()) as ReplaysIndexPayload;
}

/** 职业比赛索引：由 scripts/fetch_pro_replays_index.py 生成（OpenDota proMatches + 战队过滤） */
export async function fetchProReplaysIndex(): Promise<ReplaysIndexPayload> {
  const res = await fetch(`/data/pro_replays_index.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`pro_replays_index ${res.status}`);
  return (await res.json()) as ReplaysIndexPayload;
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
