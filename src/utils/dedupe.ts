import type { Event, ParsedEventCandidate } from "../types/models";
import { normalizeText } from "./normalize";

export function findLikelyDuplicate(candidate: ParsedEventCandidate, events: Event[]) {
  const name = normalizeText(candidate.eventName || "");
  const city = normalizeText(candidate.city || "");
  const state = normalizeText(candidate.state || "");
  const date = candidate.startDate?.slice(0, 10);

  return events.find((event) => {
    const sameDate = Boolean(date && event.startDate.slice(0, 10) === date);
    const samePlace =
      normalizeText(event.city || "") === city &&
      normalizeText(event.state || "") === state &&
      Boolean(city || state);
    const eventName = normalizeText(event.name);
    const sameName = Boolean(name && (eventName.includes(name) || name.includes(eventName)));
    return sameDate && (sameName || samePlace);
  });
}
