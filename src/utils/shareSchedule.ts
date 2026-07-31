import type { Event, EventDay, Worker } from "../types/models";
import { eventDays } from "./eventSchedule";
import { deriveEventDisplayStatus } from "./eventStage";

export type ShareScheduleStatus = "paid" | "applied";
export type ScheduleEvent = { event: Event; days: EventDay[]; status: ShareScheduleStatus };

function localDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function selectConfirmedUpcomingSchedule(events: Event[], workers: Worker[], today = new Date()) {
  const todayKey = dateKey(today);
  return events.flatMap((event): ScheduleEvent[] => {
    const days = eventDays(event).sort((a, b) => a.date.localeCompare(b.date));
    if (!event.eventDays?.length && event.endDate && event.endDate.slice(0, 10) !== days[0]?.date.slice(0, 10)) {
      days.push({ ...days[0], id: `${event.id}_fallback_end_day`, date: event.endDate.slice(0, 10) });
    }
    const latestDate = days[days.length - 1]?.date.slice(0, 10) || event.endDate?.slice(0, 10) || event.startDate.slice(0, 10);
    if (latestDate < todayKey) return [];
    const status = deriveEventDisplayStatus(event, workers, today);
    return status === "paid" || status === "applied" ? [{ event, days, status }] : [];
  }).sort((a, b) => a.days[0].date.localeCompare(b.days[0].date));
}

function fullDate(day: EventDay) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(localDate(day.date));
}

function dateRange(days: EventDay[]) {
  if (days.length <= 1) return fullDate(days[0]);
  const first = localDate(days[0].date);
  const last = localDate(days[days.length - 1].date);
  const firstMonth = new Intl.DateTimeFormat("en-US", { month: "long" }).format(first);
  const lastMonth = new Intl.DateTimeFormat("en-US", { month: "long" }).format(last);
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) return `${firstMonth} ${first.getDate()}–${last.getDate()}`;
  return `${firstMonth} ${first.getDate()}–${lastMonth} ${last.getDate()}`;
}

function formattedTime(value?: string) {
  if (!value) return "";
  const [hours, minutes = 0] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function timeRange(event: Event, days: EventDay[]) {
  const firstDay = days[0];
  const values = [formattedTime(firstDay?.startTime || event.startTime), formattedTime(firstDay?.endTime || event.endTime)].filter(Boolean);
  return values.join("–");
}

function eventLocation(event: Event) {
  const clean = (value?: string) => value?.trim() || "";
  const cityState = [clean(event.city), clean(event.state)].filter(Boolean).join(", ");
  if (clean(event.venueName)) return [clean(event.venueName), cityState].filter(Boolean).join(", ");
  return [clean(event.address), cityState].filter(Boolean).join(", ");
}

function eventBlock(row: ScheduleEvent) {
  return [dateRange(row.days), row.event.name, timeRange(row.event, row.days), eventLocation(row.event)].filter(Boolean).join("\n");
}

export function generateScheduleMessage(rows: ScheduleEvent[]) {
  if (!rows.length) return "There are currently no paid or applied upcoming events.";
  const paid = rows.filter((row) => row.status === "paid");
  const applied = rows.filter((row) => row.status === "applied");
  const sections: string[] = [];

  if (paid.length) sections.push(["✅ PAID / CONFIRMED", "", paid.map(eventBlock).join("\n\n")].join("\n"));
  if (applied.length) sections.push([
    "🟡 APPLIED / RESERVED — NOT CONFIRMED YET",
    "",
    applied.map(eventBlock).join("\n\n"),
    "",
    applied.length === 1
      ? "We applied/reserved for this one, but it has not been confirmed or paid yet."
      : "We applied/reserved for these events, but they have not been confirmed or paid yet."
  ].join("\n"));

  return [
    "Hey guys, here are our upcoming events:",
    "",
    sections.join("\n\n"),
    "",
    "Please let me know which dates you are available to work."
  ].join("\n");
}
