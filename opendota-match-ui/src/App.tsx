import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { HomePage } from "./pages/HomePage";

const MatchPage = lazy(() =>
  import("./pages/MatchPage").then((m) => ({ default: m.MatchPage }))
);
const HeroMatchesPage = lazy(() =>
  import("./pages/HeroMatchesPage").then((m) => ({
    default: m.HeroMatchesPage,
  }))
);
const PlayerMatchesPage = lazy(() =>
  import("./pages/PlayerMatchesPage").then((m) => ({
    default: m.PlayerMatchesPage,
  }))
);
const ProPlayersPage = lazy(() =>
  import("./pages/ProPlayersPage").then((m) => ({
    default: m.ProPlayersPage,
  }))
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage }))
);
const HighMmrMatchesPage = lazy(() =>
  import("./pages/HighMmrMatchesPage").then((m) => ({
    default: m.HighMmrMatchesPage,
  }))
);

const routeFallback = (
  <p className="p-6 text-sm text-skin-ink">页面加载中…</p>
);

export default function App() {
  return (
    <>
      <Suspense fallback={routeFallback}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/match/:matchId" element={<MatchPage />} />
          <Route path="/hero/:heroKey" element={<HeroMatchesPage />} />
          <Route path="/player/:accountId" element={<PlayerMatchesPage />} />
          <Route path="/pros" element={<ProPlayersPage />} />
          <Route path="/high-mmr-matches" element={<HighMmrMatchesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <Analytics />
    </>
  );
}
