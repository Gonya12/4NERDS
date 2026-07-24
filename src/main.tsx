import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./services/pwa/registerPwa";
import { ThemeProvider } from "./services/theme/ThemeProvider";
import { initializeTheme } from "./services/theme/themeService";
import { initDebugLogging } from "./services/debug/debugLog";
import { GlobalErrorBoundary } from "./components/GlobalErrorBoundary";
import { markAppMounted, recoverChunkLoadOnce, saveStartupError } from "./services/startupRecovery";

initializeTheme();
initDebugLogging();

window.addEventListener("error", (event) => {
  saveStartupError(event.error || event.message);
  recoverChunkLoadOnce(event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  saveStartupError(event.reason);
  recoverChunkLoadOnce(event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </GlobalErrorBoundary>
  </React.StrictMode>
);
markAppMounted();
