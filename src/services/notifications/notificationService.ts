import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { ParsedEventCandidate } from "../../types/models";
import { getSettings } from "../storage/localDb";
import { ensureNotificationChannels } from "./notificationChannels";
import { requestNotificationPermission } from "./notificationPermissions";
import { notificationChannels } from "./notificationTypes";
import { notificationSupportMessage } from "./webNotificationSupport";

function notificationId(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  return Math.abs(hash % 2147483647);
}

export async function scheduleLocalNotification(options: {
  id: number;
  title: string;
  body: string;
  channelId: string;
  at?: Date;
}) {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return false;
  if (!Capacitor.isNativePlatform()) {
    const supportMessage = notificationSupportMessage();
    if (supportMessage) {
      localStorage.setItem("notification_support_message", supportMessage);
      console.info(supportMessage);
    } else if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => undefined);
    }
    if ("Notification" in window && Notification.permission === "granted" && !options.at) {
      new Notification(options.title, { body: options.body });
    } else {
      console.info("Notification preview:", options.title, options.body);
    }
    return true;
  }
  await ensureNotificationChannels();
  const permission = await requestNotificationPermission();
  if (permission !== "granted") return false;
  await LocalNotifications.schedule({
    notifications: [{
      id: options.id,
      title: options.title,
      body: options.body,
      channelId: options.channelId,
      schedule: options.at ? { at: options.at } : undefined
    }]
  });
  return true;
}

export async function cancelNotifications(ids: number[]) {
  if (!Capacitor.isNativePlatform() || ids.length === 0) return;
  await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
}

export async function notifyNewCandidate(candidate: ParsedEventCandidate) {
  return scheduleLocalNotification({
    id: notificationId(`candidate-${candidate.id}`),
    title: candidate.confidence === "low" ? "Event needs review" : "New possible event found",
    body: `${candidate.eventName || "A source"} may be coming up. Tap to review.`,
    channelId: candidate.confidence === "low" ? notificationChannels.reviewNeeded : notificationChannels.newEvents
  });
}

export async function notifyRegistrationOpen(eventName: string, eventId: string) {
  return scheduleLocalNotification({
    id: notificationId(`registration-${eventId}`),
    title: "Vendor registration may be open",
    body: `${eventName} registration looks open.`,
    channelId: notificationChannels.registrationUpdates
  });
}

export { notificationId };
