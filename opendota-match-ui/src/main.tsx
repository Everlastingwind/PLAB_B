import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import { FeedbackWidget } from "./components/FeedbackWidget";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import {
  SitePatchProvider,
  SitePatchReadyGate,
} from "./contexts/SitePatchContext";
import { loadProAccountDisplayOverrides } from "./lib/proAccountDisplayOverrides";
import "./index.css";

const THEME_STORAGE_KEY = "plab-theme";

function bootstrapThemeClass(): void {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const useDark = saved ? saved === "dark" : prefersDark;
  document.documentElement.classList.toggle("dark", useDark);
}

void loadProAccountDisplayOverrides();

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

bootstrapThemeClass();

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.textContent = "缺少 #root 节点，请检查 index.html";
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <HelmetProvider>
          <BrowserRouter>
            <SitePatchProvider>
              <SitePatchReadyGate>
                <App />
              </SitePatchReadyGate>
              <FeedbackWidget />
            </SitePatchProvider>
          </BrowserRouter>
        </HelmetProvider>
      </RootErrorBoundary>
    </StrictMode>
  );
}
