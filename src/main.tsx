import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./services/pwa/registerPwa";
import { ThemeProvider } from "./services/theme/ThemeProvider";
import { initializeTheme } from "./services/theme/themeService";
import { initDebugLogging } from "./services/debug/debugLog";

initializeTheme();
initDebugLogging();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
