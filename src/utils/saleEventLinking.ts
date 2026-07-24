import type { Event, EventDay, Worker } from "../types/models";
import { eventDays } from "./eventSchedule";
import { calculatePaymentSummary } from "./paymentMath";

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isEventFullyPaid(event: Event, workers: Worker[] = []) {
  const dynamic = event as Event & { event_stage?: string; registration_status?: string; totalPaid?: number; totalCost?: number };
  if ([event.eventStage, event.registrationStatus, event.status, dynamic.event_stage, dynamic.registration_status].some((value) => normalized(value) === "paid")) return true;
  if (Number(dynamic.totalCost || 0) > 0 && Number(dynamic.totalPaid || 0) >= Number(dynamic.totalCost)) return true;
  const payment = calculatePaymentSummary(event, workers);
  return payment.totalCost > 0 && payment.totalPaid >= payment.totalCost;
}

export function matchingSaleEventDay(event: Event, saleDate: string) {
  const day = saleDate.slice(0, 10);
  return eventDays(event).find((eventDay) => eventDay.date.slice(0, 10) === day);
}

export function isConfirmedAttendingEvent(event: Event, eventDay?: EventDay) {
  const dynamic = event as Event & { attendanceStatus?: string; attendance_status?: string; attended?: boolean; confirmedAttending?: boolean };
  const status = normalized(event.status);
  if (status === "skipped") return false;
  const dayAssignments = event.eventDayWorkers || [];
  if (eventDay && dayAssignments.length) {
    return dayAssignments.some((assignment) => assignment.eventDayId === eventDay.id);
  }
  if (status === "confirmed" || status === "attended" || status === "completed" || normalized(dynamic.attendanceStatus || dynamic.attendance_status) === "confirmed" || dynamic.attended === true || dynamic.confirmedAttending === true) return true;
  return Boolean(event.confirmedWorkerIds?.length || dayAssignments.length);
}

export function getEligibleSaleEvents(events: Event[], saleDate: string, workers: Worker[] = []) {
  return events.flatMap((event) => {
    const eventDay = matchingSaleEventDay(event, saleDate);
    return eventDay && isEventFullyPaid(event, workers) && isConfirmedAttendingEvent(event, eventDay)
      ? [{ event, eventDay }]
      : [];
  });
}

export function getAutoLinkEventForSale(events: Event[], saleDate: string, workers: Worker[] = []) {
  const eligible = getEligibleSaleEvents(events, saleDate, workers);
  return eligible.length === 1 ? eligible[0] : undefined;
}

export function isPaidAndConfirmedEvent(event: Event, workers: Worker[] = []) {
  return isEventFullyPaid(event, workers) && isConfirmedAttendingEvent(event);
}
