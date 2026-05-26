import { registerSW } from "virtual:pwa-register";

export const updateServiceWorker = registerSW({
  immediate: true,
  onRegistered(registration) {
    if (registration) {
      registration.update().catch(() => undefined);
    }
  }
});
