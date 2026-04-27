import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import { FeedbackWidget } from "./components/FeedbackWidget";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import { loadProAccountDisplayOverrides } from "./lib/proAccountDisplayOverrides";
import "./index.css";

void loadProAccountDisplayOverrides();

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

document.documentElement.classList.remove("dark");

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.textContent = "缺少 #root 节点，请检查 index.html";
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <HelmetProvider>
          <BrowserRouter>
            <App />
            <FeedbackWidget />
          </BrowserRouter>
        </HelmetProvider>
      </RootErrorBoundary>
    </StrictMode>
  );
}
