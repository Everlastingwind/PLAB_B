import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { SEOMeta } from "../components/SEOMeta";
import { SEEDED_PRO_PLAYERS } from "../data/proPlayers";
import { normalizeDotaAssetUrl } from "../data/mockMatchPlayers";

export function ProPlayersPage() {
  const rows = SEEDED_PRO_PLAYERS;

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

