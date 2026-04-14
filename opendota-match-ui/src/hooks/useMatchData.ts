import { useCallback, useEffect, useState } from "react";
import type { MatchHeaderData } from "../data/mockMatch";
import { mockMatchHeader } from "../data/mockMatch";
import { mockTeamDire, mockTeamRadiant } from "../data/mockMatchPlayers";
import type { TeamTableMock } from "../data/mockMatchPlayers";
import { buildUiFromSlim, DEFAULT_TEAM_NAMES } from "../adapters/slimToUi";
import { enrichSlimWithOpenDotaAbilityUpgrades } from "../lib/enrichSlimFromOpenDota";
import { mergeOpenDotaEndgameItemsIntoSlim } from "../lib/mergeOpenDotaEndgameItems";
import { purifyMatchJsonForSlim } from "../lib/purifyRawMatchJson";
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

async function fetchJson<T>(path: string): Promise<T> {
  const t = Date.now();
  const res = await fetch(`${path}?t=${t}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** 与比赛数据并行拉取；缺失或失败时不阻断主流程 */
async function fetchLatestTalentsMap(): Promise<
  Record<string, VpkrTalentLabelEntry> | undefined
> {
  try {
    const raw = await fetchJson<{ byAbilityKey?: Record<string, VpkrTalentLabelEntry> }>(
      "/data/latest_talents_map.json"
    );
    const tbl = raw?.byAbilityKey;
    return tbl && typeof tbl === "object" ? tbl : undefined;
  } catch {
    return undefined;
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

  const load = useCallback(async () => {
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
      const mapsPromise = fetchJson<EntityMapsPayload>("/data/entity_maps.json");
      const talentLabelsPromise = fetchLatestTalentsMap();

      if (isNaviOpenDotaLiveRoute(matchId)) {
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
          try {
            next = await enrichSlimWithOpenDotaAbilityUpgrades(next);
          } catch {
            /* 同上 */
          }
          try {
            await mergeOpenDotaEndgameItemsIntoSlim(next, maps);
          } catch {
            /* 同上 */
          }
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
              fetchJson<unknown>(path),
            ]);
            maps = {
              ...m,
              ...(talentLabelsByKey && Object.keys(talentLabelsByKey).length > 0
                ? { talentLabelsByKey }
                : {}),
            };
            let next = purifyMatchJsonForSlim(raw);
            try {
              next = await enrichSlimWithOpenDotaAbilityUpgrades(next);
            } catch {
              /* OpenDota 合并失败不应整页回退 mock */
            }
            try {
              await mergeOpenDotaEndgameItemsIntoSlim(next, maps!);
            } catch {
              /* 404 / 网络失败：沿用 slim 内 DEM 装备 */
            }
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
            try {
              next = await enrichSlimWithOpenDotaAbilityUpgrades(next);
            } catch {
              /* OpenDota ability 合并失败不阻断页面 */
            }
            try {
              await mergeOpenDotaEndgameItemsIntoSlim(next, maps);
            } catch {
              /* OpenDota 装备合并失败不阻断页面 */
            }
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
