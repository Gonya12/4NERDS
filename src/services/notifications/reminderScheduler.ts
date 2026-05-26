import { setHours, setMinutes, subDays } from "date-fns";
import type { Event } from "../../types/models";
import { db } from "../storage/localDb";
import { cancelNotifications, notificationId, scheduleLocalNotification } from "./notificationService";
import { notificationChannels } from "./notificationTypes";

function reminderDate(eventDateIso: string, offset: number) {
  const date = subDays(new Date(eventDateIso), offset);
  return setMinutes(setHours(date, offset === 0 ? 9 : 10), 0);
}

export async function scheduleEventReminders(event: Event) {
  await cancelEventReminders(event);
  if (!event.reminderEnabled || event.notGoing) return [];
  const ids: number[] = [];
  for (const offset of event.reminderOffsets) {
    const at = reminderDate(event.startDate, offset);
    if (at.getTime() <= Date.now()) continue;
    const id = notificationId(`${event.id}-${offset}`);
    const title = offset === 0 ? "Event today" : offset === 1 ? "Event tomorrow" : `Event in ${offset} days`;
    await scheduleLocalNotification({
      id,
      title,
      body: `${event.name} is coming up. Check vendor details.`,
      channelId: notificationChannels.eventReminders,
      at
    });
    ids.push(id);
  }
  await db.events.update(event.id, { reminderNotificationIds: ids });
  return ids;
}

export async function cancelEventReminders(event: Event) {
  await cancelNotifications(event.reminderNotificationIds || []);
  await db.events.update(event.id, { reminderNotificationIds: [] });
}
