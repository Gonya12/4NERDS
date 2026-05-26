import { LocalNotifications } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";
import { notificationChannels } from "./notificationTypes";

export async function ensureNotificationChannels() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.createChannel({
    id: notificationChannels.eventReminders,
    name: "Event reminders",
    importance: 4,
    description: "Upcoming event reminders"
  });
  await LocalNotifications.createChannel({
    id: notificationChannels.newEvents,
    name: "New events",
    importance: 3,
    description: "New possible events found"
  });
  await LocalNotifications.createChannel({
    id: notificationChannels.reviewNeeded,
    name: "Review needed",
    importance: 3,
    description: "Event details need review"
  });
  await LocalNotifications.createChannel({
    id: notificationChannels.registrationUpdates,
    name: "Registration updates",
    importance: 4,
    description: "Vendor registration status updates"
  });
}
