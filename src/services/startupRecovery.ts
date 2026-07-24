const LAST_STARTUP_ERROR = "4nerds:last-startup-error";
const CHUNK_RELOAD_ATTEMPT = "4nerds:chunk-reload-attempt";

export function isChunkLoadError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value || "");
  return /failed to fetch dynamically imported module|chunkloaderror|importing a module script failed/i.test(message);
}

export function saveStartupError(value: unknown) {
  const safeError = {
    message: value instanceof Error ? value.message : String(value || "Unknown startup error"),
    route: window.location.pathname,
    version: __APP_VERSION__,
    browser: navigator.userAgent,
    timestamp: new Date().toISOString()
  };
  try { localStorage.setItem(LAST_STARTUP_ERROR, JSON.stringify(safeError)); } catch { /* Storage is optional. */ }
  return safeError;
}

export async function clearAppCaches() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(registrations.map((registration) => registration.unregister()));
  }
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.allSettled(names.map((name) => caches.delete(name)));
  }
}

export function recoverChunkLoadOnce(value: unknown) {
  if (!isChunkLoadError(value)) return false;
  saveStartupError(value);
  if (sessionStorage.getItem(CHUNK_RELOAD_ATTEMPT)) return false;
  sessionStorage.setItem(CHUNK_RELOAD_ATTEMPT, "1");
  void clearAppCaches().finally(() => window.location.reload());
  return true;
}

export function markAppMounted() {
  document.documentElement.dataset.appMounted = "true";
  window.setTimeout(() => sessionStorage.removeItem(CHUNK_RELOAD_ATTEMPT), 10_000);
}
