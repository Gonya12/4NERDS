import { format, parseISO } from "date-fns";
import type { Event } from "../types/models";
import { dateRangeSummary, eventDays } from "./eventSchedule";

function normalizeHandle(value?: string) {
  if (!value) return "";
  const clean = value.trim();
  if (!clean || clean.toLowerCase() === "unknown") return "";
  return `@${clean.replace(/^@+/, "")}`;
}

function dayWords(event: Event) {
  const days = eventDays(event);
  if (days.length === 1) return "";
  const names = days.map((day) => format(parseISO(day.date), "EEEE"));
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `all ${names.length} days`;
}

function readableTime(value?: string) {
  if (!value) return "";
  const [hours, minutes = "00"] = value.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return format(date, "h:mm a");
}

export function generateInstagramCaption(event: Event) {
  const days = eventDays(event);
  const cityState = [event.city, event.state].filter(Boolean).join(", ");
  const location = [event.venueName, cityState].filter(Boolean).join(" in ") || event.address || "the event";
  const locationHandle = normalizeHandle(event.locationInstagramHandle);
  const organizerHandle = normalizeHandle(event.organizerInstagramHandle);
  const hostHandle = organizerHandle || locationHandle;
  const attendance = days.length === 1
    ? `this ${format(parseISO(days[0].date), "EEEE, MMMM d")}`
    : `${dayWords(event)} this upcoming ${dateRangeSummary(event)}`;
  const timeDetails = days
    .map((day) => [readableTime(day.startTime), readableTime(day.endTime)].filter(Boolean).join(" - "))
    .filter(Boolean)
    .join(" / ");
  const lines = [
    `4 Nerds will be attending ${event.name} ${attendance} at ${location}! 🎉`,
    `Come visit us for Pokémon cards, great deals, buying, selling, and trading.`
  ];
  if (timeDetails) lines.push(`Event time: ${timeDetails}`);
  if (hostHandle) lines.push(`Hosted by ${hostHandle}`);
  lines.push("We buy and trade — bring your Pokémon cards! 🔥");
  lines.push("#4Nerds #PokemonCards #PokemonTCG #PokemonCardShow #CardShow #TradingCards #PokemonCollectors #TCGCommunity");
  return lines.join("\n\n");
}
