import type { Event, EventDay, Worker } from "../types/models";
import { eventDays } from "./eventSchedule";
import { isPaidAndConfirmedEvent } from "./saleEventLinking";

export type ScheduleEvent = { event: Event; day: EventDay };

function localDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function selectConfirmedUpcomingSchedule(events: Event[], workers: Worker[], today = new Date()) {
  const todayKey = dateKey(today);
  return events
    .filter((event) => isPaidAndConfirmedEvent(event, workers))
    .flatMap((event): ScheduleEvent[] => {
      const day = eventDays(event).find((candidate) => candidate.date.slice(0, 10) >= todayKey);
      return day ? [{ event, day }] : [];
    })
    .sort((a, b) => a.day.date.localeCompare(b.day.date));
}

function formattedDate(day: EventDay) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(localDate(day.date));
}

function formattedTime(value?: string) {
  if (!value) return "";
  const [hours, minutes = 0] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function timeRange(day: EventDay) {
  const values = [formattedTime(day.startTime), formattedTime(day.endTime)].filter(Boolean);
  return values.join("–");
}

function eventLocation(event: Event) {
  const cityState = [event.city, event.state].filter(Boolean).join(", ");
  if (event.venueName) return [event.venueName, cityState].filter(Boolean).join(", ");
  return [event.address, cityState].filter(Boolean).join(", ");
}

function transition(index: number, total: number, date: string) {
  if (index === 0) return `Our next event is on ${date}:`;
  if (index === 1) return `The following event is on ${date}:`;
  if (index === total - 1 && total > 3) return `Our last currently confirmed event is on ${date}:`;
  return `After that, we have another event on ${date}:`;
}

export function generateScheduleMessage(rows: ScheduleEvent[]) {
  if (!rows.length) return "There are currently no paid upcoming events.";
  const blocks = rows.map(({ event, day }, index) => [
    transition(index, rows.length, formattedDate(day)),
    event.name,
    timeRange(day),
    eventLocation(event)
  ].filter(Boolean).join("\n"));

  return [
    "Hey guys, these are the next events we already have paid:",
    "",
    blocks.join("\n\n"),
    "",
    "Please let me know which events you can work."
  ].join("\n");
}
