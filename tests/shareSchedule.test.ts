import assert from "node:assert/strict";
import test from "node:test";
import type { Event, Worker } from "../src/types/models.ts";
import { generateScheduleMessage, selectConfirmedUpcomingSchedule } from "../src/utils/shareSchedule.ts";

const workers: Worker[] = [
  { id: "gonzalo", name: "Gonzalo", active: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" }
];

function event(id: string, name: string, date: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    name,
    startDate: date,
    startTime: "10:00",
    endTime: "17:00",
    city: "Parsippany",
    state: "NJ",
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
    event("applied", "Applied only", "2026-08-16", { eventStage: "applied" }),
    event("cancelled", "Cancelled", "2026-08-22", { status: "skipped" }),
    event("past", "Past event", "2026-07-01")
  ], workers, new Date(2026, 6, 31, 12));

  assert.deepEqual(rows.map((row) => row.event.name), ["Paid and confirmed"]);
});

test("creates the natural editable group-chat message in chronological order", () => {
  const rows = selectConfirmedUpcomingSchedule([
    event("third", "Third Show", "2026-08-29"),
    event("second", "Woodbridge Card Show", "2026-08-16", { startTime: "09:00", endTime: "16:00", venueName: "APA Hotel Woodbridge", city: "Iselin" }),
    event("first", "Morris County Card Show", "2026-08-08")
  ], workers, new Date(2026, 6, 31, 12));
  const message = generateScheduleMessage(rows);

  assert.match(message, /^Hey guys, these are the next events we already have paid:/);
  assert.match(message, /Our next event is on Saturday, August 8:\nMorris County Card Show\n10:00 AM–5:00 PM\nParsippany, NJ/);
  assert.match(message, /The following event is on Sunday, August 16:\nWoodbridge Card Show\n9:00 AM–4:00 PM\nAPA Hotel Woodbridge, Iselin, NJ/);
  assert.match(message, /After that, we have another event on Saturday, August 29:/);
  assert.ok(message.indexOf("Morris County") < message.indexOf("Woodbridge"));
  assert.match(message, /Please let me know which events you can work\.$/);
});

test("uses natural wording for one event", () => {
  const rows = selectConfirmedUpcomingSchedule([event("one", "Only Show", "2026-08-08")], workers, new Date(2026, 6, 31, 12));
  const message = generateScheduleMessage(rows);

  assert.match(message, /Our next event is on Saturday, August 8:/);
  assert.doesNotMatch(message, /following|After that|last currently/);
});

test("returns the required empty message when nothing qualifies", () => {
  assert.equal(generateScheduleMessage([]), "There are currently no paid upcoming events.");
});
