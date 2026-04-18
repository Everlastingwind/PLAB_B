import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchHeaderData } from "../data/mockMatch";
import { mockMatchHeader } from "../data/mockMatch";
import { mockTeamDire, mockTeamRadiant } from "../data/mockMatchPlayers";
import type { TeamTableMock } from "../data/mockMatchPlayers";
import { loadEntityMapsPayload } from "../lib/entityMapsLoader";
import { purifyMatchJsonForSlim } from "../lib/purifyRawMatchJson";
import { fetchDeployedDataJson } from "../lib/fetchStaticJson";
import {
  fetchOpenDotaMatchById,
  fetchNaviLatestOpenDotaMatch,
  isNaviOpenDotaLiveRoute,
} from "../lib/fetchNaviLatestOpenDotaMatch";
import type { EntityMapsPayload, VpkrTalentLabelEntry } from "../types/entityMaps";
import type { SlimMatchJson } from "../types/slimMatch";

export interface MatchDataState {
  loading: boolean;
  error: string | null;
  header: MatchHeaderData;
  radiant: TeamTableMock;
  dire: TeamTableMock;
  /** 是否来自 public/data 的 slim JSON（非本地 mock） */
  fromLiveJson: boolean;
}

/** 与比赛数据并行拉取；缺失或失败时不阻断主流程 */
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

async function applyOpenDotaEnrich(next: SlimMatchJson) {
  const { enrichSlimWithOpenDotaAbilityUpgrades } = await import(
    "../lib/enrichSlimFromOpenDota"
  );
  try {
    return await enrichSlimWithOpenDotaAbilityUpgrades(next);
  } catch {
    return next;
  }
}

async function applyOpenDotaEndgameItems(next: SlimMatchJson, m: EntityMapsPayload) {
  const { mergeOpenDotaEndgameItemsIntoSlim } = await import(
    "../lib/mergeOpenDotaEndgameItems"
  );
  try {
    await mergeOpenDotaEndgameItemsIntoSlim(next, m);
  } catch {
    /* 404 / 网络失败 */
  }
}

/** @param matchId 若提供则优先加载 /data/matches/{id}.json */
export function useMatchData(matchId?: string): MatchDataState & { reload: () => void } {
  const [state, setState] = useState<MatchDataState>({
    loading: true,
    error: null,
    header: mockMatchHeader,
    radiant: mockTeamRadiant,
    dire: mockTeamDire,
    fromLiveJson: false,
  });

  /** 防止快速切换路由时，旧请求晚到覆盖新场次状态 */
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGeneration.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
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

      if (isNaviOpenDotaLiveRoute(idForFiles || matchId)) {
        try {
          const [m, talentLabelsByKey, raw] = await Promise.all([
            mapsPromise,
            talentLabelsPromise,
            fetchNaviLatestOpenDotaMatch(),
          ]);
          maps = {
            ...m,
            ...(talentLabelsByKey && Object.keys(talentLabelsByKey).length > 0
              ? { talentLabelsByKey }
              : {}),
          };
          let next = purifyMatchJsonForSlim(raw);
          next = await applyOpenDotaEnrich(next);
          await applyOpenDotaEndgameItems(next, maps);
          slim = next;
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
        }
      } else {
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
            let next = purifyMatchJsonForSlim(raw);
            next = await applyOpenDotaEnrich(next);
            await applyOpenDotaEndgameItems(next, maps!);
            slim = next;
            break;
          } catch (e) {
            lastErr = e instanceof Error ? e : new Error(String(e));
          }
        }
        if (!slim && numericMatchId > 0) {
          try {
            const [m, talentLabelsByKey, raw] = await Promise.all([
              mapsPromise,
              talentLabelsPromise,
              fetchOpenDotaMatchById(numericMatchId),
            ]);
            maps = {
              ...m,
              ...(talentLabelsByKey && Object.keys(talentLabelsByKey).length > 0
                ? { talentLabelsByKey }
                : {}),
            };
            let next = purifyMatchJsonForSlim(raw);
            next = await applyOpenDotaEnrich(next);
            await applyOpenDotaEndgameItems(next, maps);
            slim = next;
          } catch {
            // 本地与 OpenDota 都无法命中时，统一给出明确提示
            throw new Error("没有这一场比赛数据");
          }
        }
      }
      if (!slim || !maps) {
        if (numericMatchId > 0) throw new Error("没有这一场比赛数据");
        throw lastErr ?? new Error("无法加载比赛 JSON");
      }

      const players = slim.players;
      if (!players?.length) {
        if (loadGeneration.current !== gen) return;
        setState({
          loading: false,
          error:
            "比赛 JSON 中无有效玩家（players 为空或格式被误判）。当前为示例数据：BIZ GAMING / Rock n Sports。请确认已写入 public/data/matches 或 latest_match，并重新生成 slim。",
          header: mockMatchHeader,
          radiant: mockTeamRadiant,
          dire: mockTeamDire,
          fromLiveJson: false,
        });
        return;
      }
      const { buildUiFromSlim, DEFAULT_TEAM_NAMES } = await import(
        "../adapters/slimToUi"
      );
      const ui = buildUiFromSlim(slim, maps, DEFAULT_TEAM_NAMES);
      const rawRadiantScore = Number(ui.header.scoreRadiant ?? 0);
      const rawDireScore = Number(ui.header.scoreDire ?? 0);
      const hasValidScoreFromSource = rawRadiantScore > 0 || rawDireScore > 0;
      const fallbackRadiantKills = players
        .filter((p) => Number(p.player_slot ?? 0) < 128)
        .reduce((sum, p) => sum + Number(p.kills ?? 0), 0);
      const fallbackDireKills = players
        .filter((p) => Number(p.player_slot ?? 0) >= 128)
        .reduce((sum, p) => sum + Number(p.kills ?? 0), 0);
      if (loadGeneration.current !== gen) return;
      setState({
        loading: false,
        error: null,
        header: {
          ...ui.header,
          leagueName: ui.header.leagueName === "—" ? mockMatchHeader.leagueName : ui.header.leagueName,
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
      });
    } catch (e) {
      if (loadGeneration.current !== gen) return;
      setState({
        loading: false,
        error: e instanceof Error ? e.message : "加载失败",
        header: mockMatchHeader,
        radiant: mockTeamRadiant,
        dire: mockTeamDire,
        fromLiveJson: false,
      });
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
