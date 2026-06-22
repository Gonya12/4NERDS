import { registerSW } from "virtual:pwa-register";
import { addDebugLog } from "../debug/debugLog";

export type PwaStatus = {
  supported: boolean;
  registered: boolean;
  needRefresh: boolean;
  offlineReady: boolean;
  status: string;
  error?: string;
};

let status: PwaStatus = {
  supported: "serviceWorker" in navigator,
  registered: false,
  needRefresh: false,
  offlineReady: false,
  status: "Not registered"
};
const listeners = new Set<() => void>();

function setPwaStatus(patch: Partial<PwaStatus>) {
  status = { ...status, ...patch };
  addDebugLog("pwa", status.status, status);
  listeners.forEach((listener) => listener());
}

export function getPwaStatus() {
  return status;
}

export function subscribePwaStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    setPwaStatus({ needRefresh: true, status: "Update available" });
  },
  onOfflineReady() {
    setPwaStatus({ offlineReady: true, status: "Offline cache ready" });
  },
  onRegistered(registration) {
    if (registration) {
      setPwaStatus({ registered: true, status: "Service worker registered" });
      registration.update().catch(() => undefined);
    }
  },
  onRegisterError(error) {
    setPwaStatus({ error: error instanceof Error ? error.message : String(error), status: "Service worker registration failed" });
  }
});

export function applyPwaUpdate() {
  updateServiceWorker(true);
}
