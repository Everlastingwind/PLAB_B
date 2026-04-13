import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { MatchPage } from "./pages/MatchPage";
import { HeroMatchesPage } from "./pages/HeroMatchesPage";
import { PlayerMatchesPage } from "./pages/PlayerMatchesPage";
import { ProPlayersPage } from "./pages/ProPlayersPage";

const HighMmrMatchesPage = lazy(() =>
  import("./pages/HighMmrMatchesPage").then((m) => ({
    default: m.HighMmrMatchesPage,
  }))
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/match/:matchId" element={<MatchPage />} />
      <Route path="/hero/:heroKey" element={<HeroMatchesPage />} />
      <Route path="/player/:accountId" element={<PlayerMatchesPage />} />
      <Route path="/pros" element={<ProPlayersPage />} />
      <Route
        path="/high-mmr-matches"
        element={
          <Suspense fallback={<p className="p-6 text-sm text-skin-ink">加载中…</p>}>
            <HighMmrMatchesPage />
          </Suspense>
        }
      />
    </Routes>
  );
}
