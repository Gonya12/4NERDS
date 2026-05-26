import { format } from "date-fns";
import type { Event, EventDay, EventDayWorker, Worker } from "../types/models";
import { eventDays } from "./eventSchedule";

function dayLabel(day: EventDay) {
  const date = new Date(`${day.date.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? day.date.slice(0, 10) : format(date, "EEE");
}

export function effectiveConfirmedWorkerIds(event: Event) {
  const dayWorkers = event.eventDayWorkers || [];
  if (dayWorkers.length) return Array.from(new Set(dayWorkers.map((item) => item.workerId)));
  return event.confirmedWorkerIds || [];
}

export function workerDayCounts(event: Event) {
  const counts = new Map<string, number>();
  const dayWorkers = event.eventDayWorkers || [];
  if (dayWorkers.length) {
    dayWorkers.forEach((item) => counts.set(item.workerId, (counts.get(item.workerId) || 0) + 1));
    return counts;
  }
  (event.confirmedWorkerIds || []).forEach((workerId) => counts.set(workerId, Math.max(1, eventDays(event).length)));
  return counts;
}

export function workersForDay(event: Event, dayId: string, workers: Worker[]) {
  const dayWorkers = event.eventDayWorkers || [];
  const ids = dayWorkers.length
    ? new Set(dayWorkers.filter((item) => item.eventDayId === dayId).map((item) => item.workerId))
    : new Set(event.confirmedWorkerIds || []);
  return workers.filter((worker) => ids.has(worker.id));
}

export function availabilitySummaryByWorker(event: Event, workers: Worker[]) {
  const days = eventDays(event);
  const dayWorkers = event.eventDayWorkers || [];
  const workerMap = new Map(workers.map((worker) => [worker.id, worker.name]));
  const grouped = new Map<string, string[]>();

  if (dayWorkers.length) {
    dayWorkers.forEach((item) => {
      const day = days.find((eventDay) => eventDay.id === item.eventDayId);
      if (!day) return;
      grouped.set(item.workerId, [...(grouped.get(item.workerId) || []), dayLabel(day)]);
    });
  } else {
    (event.confirmedWorkerIds || []).forEach((workerId) => grouped.set(workerId, days.map(dayLabel)));
  }

  return Array.from(grouped.entries()).map(([workerId, labels]) => {
    const uniqueLabels = Array.from(new Set(labels));
    return {
      workerId,
      workerName: workerMap.get(workerId) || "Unknown worker",
      dayLabels: uniqueLabels,
      text: `${workerMap.get(workerId) || "Unknown worker"}: ${uniqueLabels.length === 1 ? `${uniqueLabels[0]} only` : uniqueLabels.join(", ")}`
    };
  });
}

export function normalizeDayWorkerRows(eventId: string, rows: EventDayWorker[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.eventDayId}:${row.workerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return row.eventId === eventId;
  });
}
