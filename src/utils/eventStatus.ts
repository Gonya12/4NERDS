import { differenceInCalendarDays, isToday, isTomorrow, parseISO } from "date-fns";

export function eventTimingStatus(startDate: string) {
  const date = parseISO(startDate);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (date.getTime() < Date.now() && !isToday(date)) return "Past";
  const days = differenceInCalendarDays(date, new Date());
  if (days <= 7) return "This Week";
  return "Upcoming";
}
