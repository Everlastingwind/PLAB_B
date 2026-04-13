/**
 * 拉取 Natus Vincere（OpenDota team_id=36）在战队页标注的最近一场公开对局详情。
 * 返回形状可被 purifyMatchJsonForSlim 接受，并带 _meta 以避免重复请求 OpenDota 合并接口。
 */

import type { SlimMatchJson } from "../types/slimMatch";

export const NAVI_TEAM_ID = 36;
const OD_BASE = "https://api.opendota.com/api";

/** 与 /match/:matchId 对齐；大小写不敏感，支持短链 `navi` */
const NAVI_LIVE_SLUGS = new Set(["navi-latest", "navi"]);

export function isNaviOpenDotaLiveRoute(matchId: string | undefined): boolean {
  if (matchId == null) return false;
  try {
    const s = decodeURIComponent(matchId).trim().toLowerCase();
    return NAVI_LIVE_SLUGS.has(s);
  } catch {
    const s = matchId.trim().toLowerCase();
    return NAVI_LIVE_SLUGS.has(s);
  }
}

type OdTeamBrief = {
  team_id?: number;
  match_id?: number;
  name?: string;
};

type OdTeamBlock = { name?: string; tag?: string; team_id?: number };

type OdMatchRoot = Record<string, unknown> & {
  match_id?: number;
  players?: Array<Record<string, unknown>>;
  league?: { name?: string; leagueid?: number };
  leagueid?: number;
  radiant_team?: OdTeamBlock;
  dire_team?: OdTeamBlock;
};

async function fetchJson<T>(url: string): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function patchOpenDotaMatchForSlim(match: OdMatchRoot): SlimMatchJson {
  const league = match.league;
  if (league && typeof league === "object") {
    const ln = String(league.name ?? "").trim();
    const existingLn = String((match as { league_name?: unknown }).league_name ?? "").trim();
    if (ln && !existingLn) (match as { league_name?: string }).league_name = ln;
    const lid = league.leagueid ?? match.leagueid;
    if (lid != null && match.league_id == null) {
      (match as { league_id?: number }).league_id = Number(lid);
    }
  }

  const rName = String(match.radiant_team?.name ?? "").trim();
  const dName = String(match.dire_team?.name ?? "").trim();
  const players = match.players;
  if (Array.isArray(players) && (rName || dName)) {
    for (const p of players) {
      if (!p || typeof p !== "object") continue;
      if (String(p.team_name ?? "").trim()) continue;
      const isR = p.isRadiant === true;
      p.team_name = isR ? rName || dName : dName || rName;
    }
  }

  const mid = match.match_id;
  (match as { _meta?: Record<string, unknown> })._meta = {
    source: "opendota_api",
    team_id: NAVI_TEAM_ID,
    team_tag: "NAVI",
    note: "OpenDota /teams + /matches；已注入 league_name、team_name",
    match_id: mid,
  };

  return match as SlimMatchJson;
}

export async function fetchOpenDotaMatchById(matchId: number): Promise<SlimMatchJson> {
  const mid = Number(matchId);
  if (!Number.isFinite(mid) || mid <= 0) {
    throw new Error("无效比赛编号");
  }
  const match = await fetchJson<OdMatchRoot>(`${OD_BASE}/matches/${mid}`);
  const pl = match.players;
  if (!Array.isArray(pl) || pl.length === 0) {
    throw new Error("对局 JSON 无 players");
  }
  return patchOpenDotaMatchForSlim(match);
}

/**
 * @throws Error 网络或非 2xx、或战队无 match_id、或对局无 players
 */
export async function fetchNaviLatestOpenDotaMatch(): Promise<SlimMatchJson> {
  const team = await fetchJson<OdTeamBrief>(`${OD_BASE}/teams/${NAVI_TEAM_ID}`);
  const mid = Number(team?.match_id);
  if (!Number.isFinite(mid) || mid <= 0) {
    throw new Error("OpenDota 未返回 NaVi 最近 match_id");
  }

  return fetchOpenDotaMatchById(mid);
}
