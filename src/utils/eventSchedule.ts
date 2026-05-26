import { format, parseISO } from "date-fns";
import type { Event, EventDay } from "../types/models";

function toTime(value?: string) {
  if (!value) return "";
  const [hours, minutes = "00"] = value.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return format(date, minutes === "00" ? "h:mm a" : "h:mm a");
}

export function eventDays(event: Event): EventDay[] {
  if (event.eventDays?.length) return [...event.eventDays].sort((a, b) => a.date.localeCompare(b.date));
  return [{
    id: `${event.id}_fallback_day`,
    eventId: event.id,
    date: event.startDate.slice(0, 10),
    startTime: event.startTime,
    endTime: event.endTime,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  }];
}

export function formatEventDay(day: EventDay) {
  const times = [toTime(day.startTime), toTime(day.endTime)].filter(Boolean).join(" - ");
  return `${format(parseISO(day.date), "EEE, MMM d")}${times ? ` · ${times}` : ""}${day.note ? ` · ${day.note}` : ""}`;
}

export function dateRangeSummary(event: Event) {
  const days = eventDays(event);
  if (days.length === 1) return format(parseISO(days[0].date), "EEEE, MMMM d");
  const first = parseISO(days[0].date);
  const last = parseISO(days[days.length - 1].date);
  return first.getMonth() === last.getMonth()
    ? `${format(first, "MMMM d")}-${format(last, "d")}`
    : `${format(first, "MMM d")} - ${format(last, "MMM d")}`;
}

export function shortScheduleSummary(event: Event) {
  const days = eventDays(event);
  if (days.length === 1) return formatEventDay(days[0]);
  return `${days.length} days · ${dateRangeSummary(event)}`;
}
