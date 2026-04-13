import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import "./index.css";

document.documentElement.classList.remove("dark");

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.textContent = "缺少 #root 节点，请检查 index.html";
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RootErrorBoundary>
    </StrictMode>
  );
}
