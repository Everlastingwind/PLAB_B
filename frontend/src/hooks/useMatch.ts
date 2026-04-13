import { useEffect, useState } from "react";
import type { TranslatedPlayer } from "../components/MatchCard";

export type TranslatedMatch = {
  match_id: number;
  radiant_win?: boolean;
  duration?: number;
  players: TranslatedPlayer[];
};

export function useMatch(apiBase: string, matchId: number) {
  const [data, setData] = useState<TranslatedMatch | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`${apiBase.replace(/\/$/, "")}/matches/${matchId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: TranslatedMatch) => {
        if (!cancelled) setData(j);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, matchId]);

  return { data, error };
}
