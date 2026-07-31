import type { Event, EventDay, Worker } from "../types/models";
import { workersForDay } from "./availability";
import { eventDays } from "./eventSchedule";
import { calculatePaymentSummary, formatMoney } from "./paymentMath";
import { isPaidAndConfirmedEvent } from "./saleEventLinking";

export type ScheduleMessageStyle = "quick" | "detailed" | "worker";
export type ScheduleDateRange = "next" | "next_3" | "this_month" | "next_2_months" | "next_3_months" | "all" | "custom";
export type ScheduleOptions = {
  style: ScheduleMessageStyle;
  dateRange: ScheduleDateRange;
  customStart?: string;
  customEnd?: string;
  includeTimes: boolean;
  includeAddress: boolean;
  includeSetupTime: boolean;
  includeBooth: boolean;
  includeConfirmedWorkers: boolean;
  includeWorkersNeeded: boolean;
  includeEventCost: boolean;
  includeAmountOwed: boolean;
  includeOrganizerInstagram: boolean;
  includeMapsLink: boolean;
  separateMultiDayEvents: boolean;
};

export const defaultScheduleOptions: ScheduleOptions = {
  style: "quick",
  dateRange: "all",
  includeTimes: true,
  includeAddress: false,
  includeSetupTime: false,
  includeBooth: false,
  includeConfirmedWorkers: false,
  includeWorkersNeeded: false,
  includeEventCost: false,
  includeAmountOwed: false,
  includeOrganizerInstagram: false,
  includeMapsLink: false,
  separateMultiDayEvents: true
};

export type ScheduleEvent = { event: Event; days: EventDay[] };

function localDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function upcomingDays(event: Event, today: Date) {
  const todayKey = dateKey(today);
  return eventDays(event).filter((day) => day.date.slice(0, 10) >= todayKey);
}

function rangeEnd(today: Date, months: number) {
  const end = new Date(today);
  end.setMonth(end.getMonth() + months);
  return dateKey(end);
}

export function selectConfirmedUpcomingSchedule(
  events: Event[],
  workers: Worker[],
  options: Pick<ScheduleOptions, "dateRange" | "customStart" | "customEnd">,
  today = new Date()
) {
  const todayKey = dateKey(today);
  let rows = events
    .filter((event) => isPaidAndConfirmedEvent(event, workers))
    .map((event): ScheduleEvent => ({ event, days: upcomingDays(event, today) }))
    .filter((row) => row.days.length > 0)
    .sort((a, b) => a.days[0].date.localeCompare(b.days[0].date));

  if (options.dateRange === "next") rows = rows.slice(0, 1);
  else if (options.dateRange === "next_3") rows = rows.slice(0, 3);
  else {
    const thisMonth = todayKey.slice(0, 7);
    const maximum = options.dateRange === "next_2_months" ? rangeEnd(today, 2)
      : options.dateRange === "next_3_months" ? rangeEnd(today, 3)
        : options.dateRange === "custom" ? options.customEnd || "9999-12-31" : "9999-12-31";
    const minimum = options.dateRange === "custom" ? options.customStart || todayKey : todayKey;
    rows = rows.map((row) => ({
      ...row,
      days: row.days.filter((day) => {
        const key = day.date.slice(0, 10);
        return options.dateRange === "this_month" ? key.slice(0, 7) === thisMonth : key >= minimum && key <= maximum;
      })
    })).filter((row) => row.days.length > 0);
  }
  return rows;
}

function formattedDate(day: EventDay, style: ScheduleMessageStyle, includeYear = true) {
  const date = localDate(day.date);
  if (style === "quick") return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", ...(includeYear ? { year: "numeric" as const } : {}) }).format(date);
}

function formattedTime(value?: string) {
  if (!value) return "";
  const [hours, minutes = 0] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: minutes ? "2-digit" : undefined }).format(date);
}

function timeRange(day: EventDay) {
  const values = [formattedTime(day.startTime), formattedTime(day.endTime)].filter(Boolean);
  return values.join("–");
}

function eventLocation(event: Event) {
  const cityState = [event.city, event.state].filter(Boolean).join(", ");
  return [event.venueName, event.address, cityState].filter(Boolean).join(", ");
}

function mapsLink(event: Event) {
  const location = eventLocation(event);
  return location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}` : "";
}

function confirmedWorkerLines(event: Event, day: EventDay, workers: Worker[], options: ScheduleOptions) {
  if (!options.includeConfirmedWorkers && !options.includeWorkersNeeded) return [];
  const confirmed = workersForDay(event, day.id, workers);
  const lines: string[] = [];
  if (options.includeConfirmedWorkers) lines.push(confirmed.length ? `Confirmed: ${confirmed.map((worker) => worker.name).join(", ")}` : "Nobody has confirmed availability yet.");
  if (options.includeWorkersNeeded) {
    if (!confirmed.length) lines.push("Workers needed.");
    else {
      const dynamic = event as Event & { requiredWorkerCount?: number; required_worker_count?: number };
      const target = Math.max(1, Number(dynamic.requiredWorkerCount || dynamic.required_worker_count || Math.min(2, workers.filter((worker) => worker.active).length || 2)));
      const needed = Math.max(0, target - confirmed.length);
      lines.push(needed ? `Still need: ${needed} worker${needed === 1 ? "" : "s"}` : "Worker coverage confirmed.");
    }
  }
  return lines;
}

function optionalEventLines(event: Event, day: EventDay, workers: Worker[], options: ScheduleOptions) {
  const lines: string[] = [];
  if (options.includeTimes && timeRange(day)) lines.push(timeRange(day));
  if (options.includeAddress && eventLocation(event)) lines.push(eventLocation(event));
  if (options.includeSetupTime && event.setupTime) lines.push(`Setup time: ${formattedTime(event.setupTime) || event.setupTime}`);
  if (options.includeBooth && event.boothNumber) lines.push(`Table/booth: ${event.boothNumber}`);
  lines.push(...confirmedWorkerLines(event, day, workers, options));
  const payment = calculatePaymentSummary(event, workers);
  if (options.includeEventCost && payment.totalCost > 0) lines.push(`Event cost: ${formatMoney(payment.totalCost)} · Paid: ${formatMoney(payment.totalPaid)}${options.includeAmountOwed ? ` · Still owed: ${formatMoney(payment.totalRemaining)}` : ""}`);
  else if (options.includeAmountOwed && payment.totalRemaining > 0) lines.push(`Still owed: ${formatMoney(payment.totalRemaining)}`);
  if (options.includeOrganizerInstagram && event.organizerInstagramHandle) lines.push(`Organizer Instagram: ${event.organizerInstagramHandle.startsWith("@") ? event.organizerInstagramHandle : `@${event.organizerInstagramHandle}`}`);
  if (options.includeMapsLink && mapsLink(event)) lines.push(`Maps: ${mapsLink(event)}`);
  return lines;
}

function compactEventBlock(row: ScheduleEvent, workers: Worker[], options: ScheduleOptions) {
  const days = options.separateMultiDayEvents ? row.days : [row.days[0]];
  return days.map((day, index) => {
    const date = options.separateMultiDayEvents || row.days.length === 1
      ? formattedDate(day, options.style, options.style === "detailed")
      : `${formattedDate(row.days[0], options.style, false)}–${formattedDate(row.days[row.days.length - 1], options.style, false)}`;
    const title = index === 0 ? row.event.name : "";
    const details = optionalEventLines(row.event, day, workers, options);
    if (options.style === "quick") return [`• ${date} — ${title || row.event.name}`, ...details.map((line) => `  ${line}`)].join("\n");
    return [date, title, ...details].filter(Boolean).join("\n");
  }).join("\n\n");
}

export function generateScheduleMessage(rows: ScheduleEvent[], workers: Worker[], options: ScheduleOptions) {
  if (!rows.length) return "";
  const blocks = rows.map((row) => compactEventBlock(row, workers, options));
  if (options.style === "quick") return ["Upcoming 4 Nerds events:", "", blocks.join("\n\n"), "", "Let me know which dates you can work."].join("\n");
  if (options.style === "worker") return ["Hey, these are the next events we already have confirmed and paid for:", "", blocks.join("\n\n"), "", "Please tell me which ones you can work. Don’t wait until the last minute 😭"].join("\n");
  const detailed = blocks.map((block, index) => {
    const intro = index === 0 ? "Our next event is:"
      : index === 1 ? "After that:"
        : index === blocks.length - 1 ? "Our final currently confirmed event is:" : "Then:";
    return `${intro}\n\n${block}`;
  });
  return ["4 Nerds Upcoming Event Schedule", "", detailed.join("\n\n"), "", "Please check which dates you can work and let me know."].join("\n");
}
