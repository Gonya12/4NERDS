import { differenceInCalendarDays, format, isToday, isTomorrow, parseISO } from "date-fns";

export function displayDate(dateIso?: string) {
  if (!dateIso) return "Date unknown";
  return format(parseISO(dateIso), "EEE, MMM d, yyyy");
}

export function displayDateTime(dateIso?: string) {
  if (!dateIso) return "Date unknown";
  return format(parseISO(dateIso), "EEE, MMM d, yyyy h:mm a");
}

export function countdownLabel(dateIso?: string) {
  if (!dateIso) return "Unknown";
  const date = parseISO(dateIso);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  const days = differenceInCalendarDays(date, new Date());
  if (days > 0) return `In ${days} days`;
  if (days === 0) return "Today";
  return `${Math.abs(days)} days ago`;
}

export function dayKey(dateIso: string) {
  return format(parseISO(dateIso), "yyyy-MM-dd");
}

export function dayHeading(dateIso: string) {
  return format(parseISO(dateIso), "EEEE, MMM d");
}
