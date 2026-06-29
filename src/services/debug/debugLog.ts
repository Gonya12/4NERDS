export type DebugLogEntry = {
  id: string;
  timestamp: string;
  type: "info" | "error" | "api" | "route" | "pwa";
  message: string;
  details?: string;
};

const entries: DebugLogEntry[] = [];
const listeners = new Set<() => void>();
let initialized = false;
let originalFetch: typeof window.fetch | undefined;

export const appVersion = __APP_VERSION__;
export const appBuildTime = __APP_BUILD_TIME__;

export function addDebugLog(type: DebugLogEntry["type"], message: string, details?: unknown) {
  if (!import.meta.env.DEV) return;
  entries.unshift({
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    type,
    message,
    details: stringifyDetails(details)
  });
  if (entries.length > 80) entries.pop();
  listeners.forEach((listener) => listener());
}

export function getDebugLogs() {
  return entries;
}

export function subscribeDebugLogs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function initDebugLogging() {
  if (initialized || !import.meta.env.DEV || typeof window === "undefined") return;
  initialized = true;
  addDebugLog("info", "Browser started", {
    userAgent: navigator.userAgent,
    standalone: window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)),
    version: appVersion,
    buildTime: appBuildTime
  });

  window.addEventListener("error", (event) => {
    addDebugLog("error", event.message || "JavaScript error", {
      source: event.filename,
      line: event.lineno,
      column: event.colno
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    addDebugLog("error", "Unhandled promise rejection", event.reason);
  });

  originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    try {
      const response = await originalFetch!(input, init);
      if (!response.ok) {
        addDebugLog("api", `API call failed: ${response.status}`, { url, statusText: response.statusText });
      }
      return response;
    } catch (error) {
      addDebugLog("api", "API call threw an error", { url, error });
      throw error;
    }
  };
}

function stringifyDetails(details: unknown) {
  if (details === undefined) return undefined;
  if (details instanceof Error) return details.message;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}
