import { format, parseISO } from "date-fns";
import type { Event } from "../types/models";
import { dateRangeSummary, eventDays } from "./eventSchedule";

function normalizeHandle(value?: string) {
  if (!value) return "";
  const clean = value.trim();
  return clean ? (clean.startsWith("@") ? clean : `@${clean}`) : "";
}

function dayWords(event: Event) {
  const days = eventDays(event);
  if (days.length === 1) return "";
  const names = days.map((day) => format(parseISO(day.date), "EEEE"));
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `all ${names.length} days`;
}

export function generateInstagramCaption(event: Event) {
  const days = eventDays(event);
  const location = event.venueName || [event.address, event.city, event.state].filter(Boolean).join(", ") || "the event";
  const locationHandle = normalizeHandle(event.locationInstagramHandle);
  const organizerHandle = normalizeHandle(event.organizerInstagramHandle);
  const attendance = days.length === 1
    ? `this upcoming ${format(parseISO(days[0].date), "EEEE, MMMM d")}`
    : `${dayWords(event)} this upcoming ${dateRangeSummary(event)}`;
  const lines = [
    `We will be attending ${attendance} at ${location}. Come visit us for offers and more - we are always buying and trading.`
  ];
  if (locationHandle) lines.push(`Hosted at ${locationHandle}`);
  if (organizerHandle) lines.push(`Event by ${organizerHandle}`);
  lines.push("#Pokemon #TCG #TradingCards #Collectibles #4Nerds");
  return lines.join("\n\n");
}
