import type { Event, Worker } from "../types/models";
import { eventDays } from "./eventSchedule";
import { calculatePaymentSummary } from "./paymentMath";

export function isPaidEvent(event: Event, workers: Worker[]) {
  if (event.status === "skipped" || event.status === "completed") return false;
  if (event.eventStage === "paid" || event.status === "paid") return true;
  if ((event.registrationStatus as string) === "paid" || (event.registrationStatus as string) === "confirmed") return true;
  const payment = calculatePaymentSummary(event, workers);
  return payment.totalCost > 0 && payment.totalPaid >= payment.totalCost;
}

export function isPaidOrConfirmedEvent(event: Event, workers: Worker[]) {
  if (event.status === "skipped") return false;
  if (event.status === "completed" && event.eventStage === "paid") return true;
  return isPaidEvent(event, workers);
}

export function latestEventDayDate(event: Event) {
  const days = eventDays(event)
    .map((day) => day.date.slice(0, 10))
    .sort();
  return days[days.length - 1] || event.startDate.slice(0, 10);
}

export function isPastEvent(event: Event) {
  return new Date(`${latestEventDayDate(event)}T23:59:59`).getTime() < new Date().setHours(0, 0, 0, 0);
}

export function isPastPaidOrAttendedEvent(event: Event, workers: Worker[]) {
  if (event.status === "skipped") return false;
  if (!isPastEvent(event)) return false;
  if (event.eventStage === "past" || event.status === "completed" || event.status === "attended") return true;
  return isPaidEvent(event, workers);
}
