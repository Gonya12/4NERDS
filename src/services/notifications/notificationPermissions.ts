import { LocalNotifications } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";

export async function requestNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return "granted";
  const current = await LocalNotifications.checkPermissions();
  if (current.display === "granted") return "granted";
  const next = await LocalNotifications.requestPermissions();
  return next.display;
}
