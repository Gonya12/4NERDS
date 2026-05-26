import type { Event } from "../../types/models";
import { eventDays } from "../../utils/eventSchedule";
import { calculatePaymentSummary } from "../../utils/paymentMath";
import { checklistProgress } from "../../utils/financeMath";
import { notificationChannels } from "./notificationTypes";
import { notificationId, scheduleLocalNotification } from "./notificationService";

function atHour(dateText: string, hour: number) {
  const date = new Date(`${dateText.slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function daysBefore(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - days);
  return copy;
}

function future(date?: Date) {
  return Boolean(date && date.getTime() > Date.now());
}

export async function scheduleSmartEventNotifications(events: Event[]) {
  let scheduled = 0;

  for (const event of events) {
    if (event.status === "completed" || event.status === "skipped") continue;
    const firstDay = eventDays(event)[0]?.date || event.startDate;
    const eventDate = atHour(firstDay, 9);
    if (!eventDate) continue;

    const inThreeDays = daysBefore(eventDate, 3);
    const tomorrow = daysBefore(eventDate, 1);

    if (future(inThreeDays)) {
      const ok = await scheduleLocalNotification({
        id: notificationId(`smart-3-days-${event.id}`),
        title: "Event in 3 days",
        body: `${event.name} is coming up. Check workers, payments, and setup.`,
        channelId: notificationChannels.eventReminders,
        at: inThreeDays
      });
      if (ok) scheduled += 1;
    }

    if (future(tomorrow)) {
      const ok = await scheduleLocalNotification({
        id: notificationId(`smart-tomorrow-${event.id}`),
        title: "Event tomorrow",
        body: `${event.name} is tomorrow. Make sure setup and packing are ready.`,
        channelId: notificationChannels.eventReminders,
        at: tomorrow
      });
      if (ok) scheduled += 1;
    }

    const checklist = checklistProgress(event);
    const payment = calculatePaymentSummary(event, []);
    const warnings = [
      !event.confirmedWorkerIds?.length ? "nobody confirmed" : "",
      checklist.total && checklist.percent < 100 ? "checklist incomplete" : "",
      payment.totalCost > 0 && payment.totalRemaining > 0 ? "payment incomplete" : ""
    ].filter(Boolean);

    if (warnings.length && future(inThreeDays)) {
      const ok = await scheduleLocalNotification({
        id: notificationId(`smart-warning-${event.id}`),
        title: "Event needs attention",
        body: `${event.name}: ${warnings.join(", ")}.`,
        channelId: notificationChannels.reviewNeeded,
        at: inThreeDays
      });
      if (ok) scheduled += 1;
    }
  }

  return scheduled;
}
