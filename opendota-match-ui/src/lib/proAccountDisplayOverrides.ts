import type { ReplaySummary } from "../types/replaysIndex";
import { fetchDeployedDataJson } from "./fetchStaticJson";

type OverridesFile = {
  by_account_id?: Record<string, string>;
};

let cached: ReadonlyMap<number, string> | null = null;
let inflight: Promise<ReadonlyMap<number, string>> | null = null;

function parseOverridesPayload(raw: unknown): Map<number, string> {
  const m = new Map<number, string>();
  if (!raw || typeof raw !== "object") return m;
  const blob = raw as OverridesFile;
  const table = blob.by_account_id;
  if (!table || typeof table !== "object") return m;
  for (const [k, v] of Object.entries(table)) {
    const aid = Math.floor(Number(k));
    if (!Number.isFinite(aid) || aid <= 0) continue;
    const label = String(v ?? "").trim();
    if (label) m.set(aid, label);
  }
  return m;
}

/**
 * 全站单例：与 entity_maps 类似，供对局页 + 索引合并共用。
 * 文件：`/data/pro_account_display_overrides.json`
 */
export function loadProAccountDisplayOverrides(): Promise<
  ReadonlyMap<number, string>
> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = (async () => {
      try {
        const raw = await fetchDeployedDataJson<unknown>(
          "/data/pro_account_display_overrides.json"
        );
        cached = parseOverridesPayload(raw);
      } catch {
        cached = new Map();
      } finally {
        inflight = null;
      }
      return cached!;
    })();
  }
  return inflight;
}

/** 首屏尚未拉取完时供可选同步兜底（可能为 null） */
export function peekProAccountDisplayOverrides(): ReadonlyMap<
  number,
  string
> | null {
  return cached;
}

export function applyProDisplayOverridesToReplaySummariesSync(
  replays: readonly ReplaySummary[],
  map: ReadonlyMap<number, string>
): ReplaySummary[] {
  if (!map.size) return [...replays];
  return replays.map((r) => ({
    ...r,
    players: r.players.map((p) => {
      const label = map.get(p.account_id);
      if (!label) return p;
      return { ...p, pro_name: label };
    }),
  }));
}

export async function applyProDisplayOverridesToReplaySummaries(
  replays: readonly ReplaySummary[]
): Promise<ReplaySummary[]> {
  const map = await loadProAccountDisplayOverrides();
  return applyProDisplayOverridesToReplaySummariesSync(replays, map);
}
