import type { Event, EventStage, Worker } from "../types/models";
import { eventDays } from "./eventSchedule";
import { isPaidOrConfirmedEvent, isPlannedEvent } from "./eventCommitment";
import { isConfirmedAttendingEvent } from "./saleEventLinking";

export type EventDisplayStatus = "paid" | "applied" | "upcoming" | "cancelled" | "past";

export const eventDisplayStatusLabels: Record<EventDisplayStatus, string> = {
  paid: "Paid",
  applied: "Applied / Reserved",
  upcoming: "Upcoming",
  cancelled: "Cancelled",
  past: "Past"
};

export const eventDisplayStatusAccentClasses: Record<EventDisplayStatus, string> = {
  paid: "bg-emerald-500",
  applied: "bg-yellow-400",
  upcoming: "bg-sky-500",
  cancelled: "bg-rose-500",
  past: "bg-slate-500"
};

export const eventDisplayStatusCardClasses: Record<EventDisplayStatus, string> = {
  paid: "border-emerald-200/90 bg-gradient-to-br from-white to-emerald-50/80 dark:border-emerald-900/60 dark:from-night-850 dark:to-emerald-950/20",
  applied: "border-amber-200/90 bg-gradient-to-br from-white to-amber-50/90 dark:border-amber-900/60 dark:from-night-850 dark:to-amber-950/20",
  upcoming: "border-sky-200/90 bg-gradient-to-br from-white to-sky-50/80 dark:border-sky-900/60 dark:from-night-850 dark:to-sky-950/20",
  cancelled: "border-rose-200/90 bg-gradient-to-br from-white to-rose-50/80 dark:border-rose-900/60 dark:from-night-850 dark:to-rose-950/20",
  past: "border-slate-200/90 bg-gradient-to-br from-white to-slate-50/80 dark:border-slate-800 dark:from-night-850 dark:to-slate-900/40"
};

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function hasNegativeDecision(event: Event) {
  const dynamic = event as Event & {
    attendanceStatus?: string;
    attendance_status?: string;
    teamDecision?: string;
    team_decision?: string;
    applicationStatus?: string;
    application_status?: string;
  };
  const values = [event.status, event.eventStage, dynamic.attendanceStatus, dynamic.attendance_status, dynamic.teamDecision, dynamic.team_decision, dynamic.applicationStatus, dynamic.application_status];
  return event.notGoing || values.some((value) => ["skipped", "cancelled", "canceled", "declined", "not_going", "not_attending"].includes(normalized(value)));
}

function hasPendingLabel(event: Event) {
  const dynamic = event as Event & { applicationStatus?: string; application_status?: string; reservationStatus?: string; reservation_status?: string };
  const values = [event.eventStage, event.status, event.registrationStatus, dynamic.applicationStatus, dynamic.application_status, dynamic.reservationStatus, dynamic.reservation_status].map(normalized);
  return values.some((value) => value === "applied" || value === "registered" || value === "reserved" || value === "application_submitted" || value === "awaiting_confirmation" || value === "reserved_but_not_paid");
}

export function deriveEventDisplayStatus(event: Event, workers: Worker[] = [], today = new Date()): EventDisplayStatus {
  if (hasNegativeDecision(event)) return "cancelled";
  const sortedDates = [...eventDays(event).map((day) => day.date.slice(0, 10)), event.endDate?.slice(0, 10) || ""].filter(Boolean).sort();
  const latestDate = sortedDates[sortedDates.length - 1] || event.startDate.slice(0, 10);
  if (latestDate < localDateKey(today)) return "past";
  if (isPaidOrConfirmedEvent(event, workers)) return "paid";
  if (hasPendingLabel(event)) return "applied";
  if (isConfirmedAttendingEvent(event)) return "paid";
  if (isPlannedEvent(event, workers)) return "applied";
  return "upcoming";
}

export const eventStageLabels: Record<EventStage, string> = {
  new: "Not Applied",
  applied: "Applied / Reserved",
  paid: "Paid",
  past: "Past"
};

export const eventStageDescriptions: Record<EventStage, string> = {
  new: "Not applied/reserved yet",
  applied: "Applied/reserved, not paid",
  paid: "Applied/reserved and paid",
  past: "Past event"
};

export const eventStageCardClasses: Record<EventStage, string> = {
  new: "border-red-200/90 bg-gradient-to-br from-white to-red-50/80 dark:border-red-900/60 dark:from-night-850 dark:to-red-950/20",
  applied: "border-amber-200/90 bg-gradient-to-br from-white to-amber-50/90 dark:border-amber-900/60 dark:from-night-850 dark:to-amber-950/20",
  paid: "border-emerald-200/90 bg-gradient-to-br from-white to-emerald-50/80 dark:border-emerald-900/60 dark:from-night-850 dark:to-emerald-950/20",
  past: "border-sky-200/90 bg-gradient-to-br from-white to-sky-50/80 dark:border-sky-900/60 dark:from-night-850 dark:to-sky-950/20"
};

export const eventStageAccentClasses: Record<EventStage, string> = {
  new: "bg-red-500",
  applied: "bg-yellow-400",
  paid: "bg-emerald-500",
  past: "bg-sky-500"
};

export function eventStage(eventStage?: EventStage) {
  return eventStage || "new";
}
