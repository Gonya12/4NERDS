import type { Event, Worker } from "../types/models";
import { eventDays } from "./eventSchedule";
import { calculatePaymentSummary } from "./paymentMath";

const plannedLabels = new Set(["applied", "registered", "reserved", "confirmed", "paid"]);

function normalizedStatus(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function isPaidEvent(event: Event, workers: Worker[]) {
  const status = normalizedStatus(event.status);
  const eventStage = normalizedStatus(event.eventStage);
  const registrationStatus = normalizedStatus(event.registrationStatus);
  if (status === "skipped" || status === "completed") return false;
  if (eventStage === "paid" || status === "paid") return true;
  if (registrationStatus === "paid" || registrationStatus === "confirmed") return true;
  const payment = calculatePaymentSummary(event, workers);
  return payment.totalCost > 0 && payment.totalPaid >= payment.totalCost;
}

export function isPaidOrConfirmedEvent(event: Event, workers: Worker[]) {
  if (event.status === "skipped") return false;
  if (event.status === "completed" && event.eventStage === "paid") return true;
  return isPaidEvent(event, workers);
}

export function isPlannedEvent(event: Event, workers: Worker[]) {
  const status = normalizedStatus(event.status);
  const eventStage = normalizedStatus(event.eventStage);
  const registrationStatus = normalizedStatus(event.registrationStatus);
  if (status === "skipped") return false;
  if (eventStage === "new" || eventStage === "past") return false;
  if (event.importedFromCalendar && !plannedLabels.has(eventStage) && !plannedLabels.has(registrationStatus) && !plannedLabels.has(status)) return false;
  if (plannedLabels.has(eventStage) || plannedLabels.has(registrationStatus) || plannedLabels.has(status)) return true;
  const payment = calculatePaymentSummary(event, workers);
  return payment.totalCost > 0 && payment.totalPaid >= payment.totalCost;
}

export function nextUpcomingEventDayDate(event: Event) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return eventDays(event)
    .map((day) => day.date.slice(0, 10))
    .filter((date) => new Date(`${date}T23:59:59`).getTime() >= today.getTime())
    .sort()[0];
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
