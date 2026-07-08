import type { Event, Worker } from "../types/models";
import { eventDays } from "./eventSchedule";
import { calculatePaymentSummary } from "./paymentMath";

const plannedLabels = new Set(["applied", "registered", "reserved", "confirmed", "paid"]);

function normalizedStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function statusTokens(value: unknown) {
  return normalizedStatus(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function hasPlannedLabel(value: unknown) {
  const normalized = normalizedStatus(value);
  if (!normalized || normalized === "new" || normalized.includes("not applied") || normalized === "not_applied") return false;
  return statusTokens(value).some((token) => plannedLabels.has(token));
}

function isExplicitlyNotPlanned(value: unknown) {
  const normalized = normalizedStatus(value);
  return normalized === "new" || normalized.includes("not applied") || normalized === "not_applied";
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
  if (status === "skipped") return false;
  if (eventStage === "past") return false;
  if (hasPlannedLabel(event.eventStage) || hasPlannedLabel(event.registrationStatus) || hasPlannedLabel(event.status)) return true;
  if (event.importedFromCalendar) return false;
  if (isExplicitlyNotPlanned(event.eventStage) || isExplicitlyNotPlanned(event.registrationStatus) || isExplicitlyNotPlanned(event.status)) return false;
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
