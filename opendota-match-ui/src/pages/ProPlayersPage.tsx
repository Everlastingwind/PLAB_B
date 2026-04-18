import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { SEOMeta } from "../components/SEOMeta";
import { SEEDED_PRO_PLAYERS, type SeedProPlayer } from "../data/proPlayers";
import { normalizeDotaAssetUrl } from "../data/mockMatchPlayers";

type OpenDotaPlayerMini = {
  profile?: {
    personaname?: string;
    name?: string;
    avatarfull?: string;
  };
  leaderboard_rank?: number;
  rank_tier?: number;
  mmr_estimate?: { estimate?: number };
};

type ProRow = SeedProPlayer & {
  avatar?: string;
  displayName?: string;
  rankTier?: number;
  leaderboardRank?: number;
  mmrEstimate?: number;
};

export function ProPlayersPage() {
  const [rows, setRows] = useState<ProRow[]>(
    SEEDED_PRO_PLAYERS.map((p) => ({ ...p }))
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await Promise.all(
        SEEDED_PRO_PLAYERS.map(async (p) => {
          try {
            const res = await fetch(
              `https://api.opendota.com/api/players/${p.accountId}`,
              { cache: "no-store" }
            );
            if (!res.ok) return { ...p };
            const j = (await res.json()) as OpenDotaPlayerMini;
            return {
              ...p,
              avatar: j.profile?.avatarfull,
              displayName: j.profile?.name || j.profile?.personaname || p.proName,
              rankTier: j.rank_tier,
              leaderboardRank: j.leaderboard_rank,
              mmrEstimate: j.mmr_estimate?.estimate,
            };
          } catch {
            return { ...p };
          }
        })
      );
      if (!cancelled) setRows(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const ar = a.leaderboardRank ?? 999999;
        const br = b.leaderboardRank ?? 999999;
        return ar - br;
      }),
    [rows]
  );

  return (
    <>
      <SEOMeta title="职业选手" />
      <PageShell centerSearch>
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="mb-4 text-base font-bold text-skin-ink">职业选手</h1>
        <div className="overflow-hidden rounded-xl border border-skin-line bg-skin-card">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 border-b border-skin-line px-3 py-2 text-xs font-semibold text-skin-sub">
            <span>选手</span>
            <span className="text-right">天梯名次</span>
            <span className="text-right">MMR估算</span>
            <span className="text-right">账号ID</span>
          </div>
          {sorted.map((p) => (
            <div
              key={p.accountId}
              className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 border-b border-skin-line/70 px-3 py-2 text-sm last:border-b-0"
            >
              <Link
                to={`/player/${p.accountId}`}
                className="flex min-w-0 items-center gap-2 hover:underline"
              >
                {p.avatar ? (
                  <img
                    src={normalizeDotaAssetUrl(p.avatar)}
                    alt={p.proName}
                    className="h-8 w-8 rounded object-cover"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    fetchPriority="low"
                  />
                ) : (
                  <span className="h-8 w-8 rounded bg-skin-inset" />
                )}
                <span className="truncate">{p.displayName || p.proName}</span>
              </Link>
              <span className="text-right font-mono text-xs tabular-nums">
                {p.leaderboardRank ? `#${p.leaderboardRank}` : "-"}
              </span>
              <span className="text-right font-mono text-xs tabular-nums">
                {p.mmrEstimate ? Math.round(p.mmrEstimate) : "-"}
              </span>
              <span className="text-right font-mono text-xs tabular-nums">
                {p.accountId}
              </span>
            </div>
          ))}
        </div>
      </main>
    </PageShell>
    </>
  );
}

