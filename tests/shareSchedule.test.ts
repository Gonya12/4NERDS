import assert from "node:assert/strict";
import test from "node:test";
import type { Event, EventDay, Worker } from "../src/types/models.ts";
import { defaultScheduleOptions, generateScheduleMessage, selectConfirmedUpcomingSchedule } from "../src/utils/shareSchedule.ts";

const workers: Worker[] = [
  { id: "gonzalo", name: "Gonzalo", active: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "thiago", name: "Thiago", active: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" }
];

function day(eventId: string, id: string, date: string, startTime = "10:00", endTime = "17:00"): EventDay {
  return { id, eventId, date, startTime, endTime, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
}

function event(id: string, name: string, date: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    name,
    startDate: date,
    registrationStatus: "open",
    sourceType: "manual",
    confidence: "high",
    needsReview: false,
    interested: false,
    maybe: false,
    notGoing: false,
    status: "registered",
    eventStage: "paid",
    confirmedWorkerIds: ["gonzalo"],
    reminderEnabled: false,
    reminderOffsets: [],
    reminderNotificationIds: [],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides
  };
}

test("includes only future events that satisfy the canonical paid-and-confirmed rule", () => {
  const rows = selectConfirmedUpcomingSchedule([
    event("paid", "Paid and confirmed", "2026-08-08"),
    event("applied", "Applied only", "2026-08-09", { eventStage: "applied" }),
    event("unpaid", "Confirmed but unpaid", "2026-08-10", { eventStage: "applied" }),
    event("cancelled", "Cancelled", "2026-08-11", { status: "skipped" }),
    event("past", "Past event", "2026-07-01")
  ], workers, defaultScheduleOptions, new Date(2026, 6, 31, 12));

  assert.deepEqual(rows.map((row) => row.event.name), ["Paid and confirmed"]);
});

test("sorts chronologically and derives weekday names from real dates", () => {
  const rows = selectConfirmedUpcomingSchedule([
    event("later", "Later Show", "2026-08-22"),
    event("next", "Next Show", "2026-08-08")
  ], workers, defaultScheduleOptions, new Date(2026, 6, 31, 12));
  const message = generateScheduleMessage(rows, workers, defaultScheduleOptions);

  assert.ok(message.indexOf("Next Show") < message.indexOf("Later Show"));
  assert.match(message, /Sat, Aug 8/);
  assert.match(message, /Sat, Aug 22/);
});

test("uses day-specific worker assignments for multi-day events", () => {
  const multi = event("multi", "Weekend Expo", "2026-08-07", {
    eventDays: [day("multi", "friday", "2026-08-07"), day("multi", "saturday", "2026-08-08")],
    eventDayWorkers: [
      { id: "a", eventId: "multi", eventDayId: "friday", workerId: "gonzalo", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "b", eventId: "multi", eventDayId: "saturday", workerId: "thiago", createdAt: "2026-01-01", updatedAt: "2026-01-01" }
    ]
  });
  const options = { ...defaultScheduleOptions, includeConfirmedWorkers: true };
  const rows = selectConfirmedUpcomingSchedule([multi], workers, options, new Date(2026, 6, 31, 12));
  const message = generateScheduleMessage(rows, workers, options);

  assert.match(message, /Fri, Aug 7[\s\S]*Confirmed: Gonzalo[\s\S]*Sat, Aug 8[\s\S]*Confirmed: Thiago/);
});

test("financial details stay off by default", () => {
  const paid = event("fee", "Table Show", "2026-08-08", { eventCost: 100, paymentRecords: [] });
  const rows = selectConfirmedUpcomingSchedule([paid], workers, defaultScheduleOptions, new Date(2026, 6, 31, 12));
  const message = generateScheduleMessage(rows, workers, defaultScheduleOptions);

  assert.doesNotMatch(message, /Event cost|Paid:|Still owed/);
});
