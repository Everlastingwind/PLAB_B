import type { MatchHeaderData } from "../data/mockMatch";
import { mockMatchHeader } from "../data/mockMatch";
import type { TeamTableMock } from "../data/mockMatchPlayers";
import { loadEntityMapsPayload } from "./entityMapsLoader";
import { purifyMatchJsonForSlim } from "./purifyRawMatchJson";
import { fetchDeployedDataJson } from "./fetchStaticJson";
import { isNaviOpenDotaLiveRoute } from "./fetchNaviLatestOpenDotaMatch";
import { fetchPlanBSlimPayloadBatch } from "./supabasePlanB";
import type { EntityMapsPayload, VpkrTalentLabelEntry } from "../types/entityMaps";
import type { SlimMatchJson } from "../types/slimMatch";

async function fetchLatestTalentsMap(): Promise<
  Record<string, VpkrTalentLabelEntry> | undefined
> {
  try {
    const raw = await fetchDeployedDataJson<{
      byAbilityKey?: Record<string, VpkrTalentLabelEntry>;
    }>("/data/latest_talents_map.json");
    const tbl = raw?.byAbilityKey;
    return tbl && typeof tbl === "object" ? tbl : undefined;
  } catch {
    return undefined;
  }
}

export type MatchBoardBundle = {
  header: MatchHeaderData;
  radiant: TeamTableMock;
  dire: TeamTableMock;
  fromLiveJson: boolean;
};

export async function loadMatchBoardFromRouteMatchId(
  matchId: string | undefined
): Promise<{ ok: true; data: MatchBoardBundle } | { ok: false; error: string }> {
  let idForFiles = "";
  try {
    idForFiles = decodeURIComponent(matchId?.trim() ?? "");
  } catch {
    idForFiles = matchId?.trim() ?? "";
  }
  const paths =
    idForFiles && !isNaviOpenDotaLiveRoute(idForFiles)
      ? [`/data/matches/${idForFiles}.json`]
      : ["/data/latest_match.json"];
  const numericMatchId =
    idForFiles && /^\d+$/.test(idForFiles) ? Number(idForFiles) : 0;

  let slim: SlimMatchJson | null = null;
  let lastErr: Error | null = null;
  let maps: EntityMapsPayload | null = null;
  const mapsPromise = loadEntityMapsPayload();
  const talentLabelsPromise = fetchLatestTalentsMap();

  if (numericMatchId > 0) {
    try {
      const [m, talentLabelsByKey, batch] = await Promise.all([
        mapsPromise,
        talentLabelsPromise,
        fetchPlanBSlimPayloadBatch([numericMatchId]),
      ]);
      const raw = batch.get(numericMatchId) ?? null;
      if (raw) {
        maps = {
          ...m,
          ...(talentLabelsByKey && Object.keys(talentLabelsByKey).length > 0
            ? { talentLabelsByKey }
            : {}),
        };
        slim = purifyMatchJsonForSlim(raw);
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }

  if (!slim) {
    for (const path of paths) {
      try {
        const [m, talentLabelsByKey, raw] = await Promise.all([
          mapsPromise,
          talentLabelsPromise,
          fetchDeployedDataJson<unknown>(path),
        ]);
        maps = {
          ...m,
          ...(talentLabelsByKey && Object.keys(talentLabelsByKey).length > 0
            ? { talentLabelsByKey }
            : {}),
        };
        slim = purifyMatchJsonForSlim(raw);
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  if (!slim && numericMatchId > 0) {
    return { ok: false, error: "没有这一场比赛数据" };
  }
  if (!slim || !maps) {
    if (numericMatchId > 0) {
      return { ok: false, error: "没有这一场比赛数据" };
    }
    return {
      ok: false,
      error: lastErr?.message ?? "无法加载比赛 JSON",
    };
  }

  const players = slim.players;
  if (!players?.length) {
    return {
      ok: false,
      error:
        "比赛 JSON 中无有效玩家（players 为空或格式被误判）。当前为示例数据：BIZ GAMING / Rock n Sports。请确认已写入 public/data/matches 或 latest_match，并重新生成 slim。",
    };
  }

  const [{ buildUiFromSlim, DEFAULT_TEAM_NAMES }, proOverrides] =
    await Promise.all([
      import("../adapters/slimToUi"),
      import("./proAccountDisplayOverrides").then((m) =>
        m.loadProAccountDisplayOverrides()
      ),
    ]);
  const ui = buildUiFromSlim(slim, maps, {
    ...DEFAULT_TEAM_NAMES,
    proDisplayNameByAccountId: proOverrides,
  });
  const rawRadiantScore = Number(ui.header.scoreRadiant ?? 0);
  const rawDireScore = Number(ui.header.scoreDire ?? 0);
  const hasValidScoreFromSource = rawRadiantScore > 0 || rawDireScore > 0;
  const fallbackRadiantKills = players
    .filter((p) => Number(p.player_slot ?? 0) < 128)
    .reduce((sum, p) => sum + Number(p.kills ?? 0), 0);
  const fallbackDireKills = players
    .filter((p) => Number(p.player_slot ?? 0) >= 128)
    .reduce((sum, p) => sum + Number(p.kills ?? 0), 0);

  const data: MatchBoardBundle = {
    header: {
      ...ui.header,
      leagueName:
        ui.header.leagueName === "—" ? mockMatchHeader.leagueName : ui.header.leagueName,
      matchId: ui.header.matchId === "—" ? mockMatchHeader.matchId : ui.header.matchId,
      duration:
        ui.header.duration === "0:00" ? mockMatchHeader.duration : ui.header.duration,
      scoreRadiant: hasValidScoreFromSource
        ? rawRadiantScore
        : fallbackRadiantKills,
      scoreDire: hasValidScoreFromSource
        ? rawDireScore
        : fallbackDireKills,
    },
    radiant: ui.radiant,
    dire: ui.dire,
    fromLiveJson: true,
  };

  return { ok: true, data };
}
