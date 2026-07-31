import assert from "node:assert/strict";
import test from "node:test";
import type { Event, EventDay, Worker } from "../src/types/models.ts";
import { deriveEventDisplayStatus } from "../src/utils/eventStage.ts";
import { generateScheduleMessage, selectConfirmedUpcomingSchedule } from "../src/utils/shareSchedule.ts";

const now = new Date(2026, 6, 31, 12);
const workers: Worker[] = [{ id: "gonzalo", name: "Gonzalo", active: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" }];

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
    status: "interested",
    eventStage: "new",
    confirmedWorkerIds: [],
    reminderEnabled: false,
    reminderOffsets: [],
    reminderNotificationIds: [],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides
  };
}

function day(eventId: string, id: string, date: string): EventDay {
  return { id, eventId, date, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
}

test("event cards and sharing use the same canonical paid/applied status", () => {
  const explicitPaid = event("paid", "Paid badge", "2026-08-02", { eventStage: "paid", eventCost: 500, paymentRecords: [] });
  const importedPaid = event("imported", "Imported paid", "2026-08-06", { eventStage: "paid", importedFromCalendar: true });
  const applied = event("applied", "Applied badge", "2026-08-28", { eventStage: "applied" });

  assert.equal(deriveEventDisplayStatus(explicitPaid, workers, now), "paid");
  assert.equal(deriveEventDisplayStatus(importedPaid, workers, now), "paid");
  assert.equal(deriveEventDisplayStatus(applied, workers, now), "applied");
  assert.deepEqual(selectConfirmedUpcomingSchedule([applied, importedPaid, explicitPaid], workers, now).map((row) => row.status), ["paid", "paid", "applied"]);
});

test("excludes interested, unknown, cancelled, declined, not-attending, and past events", () => {
  const rows = selectConfirmedUpcomingSchedule([
    event("interested", "Interested", "2026-08-02", { interested: true }),
    event("unknown", "Unknown", "2026-08-03"),
    event("cancelled", "Cancelled", "2026-08-04", { status: "skipped" }),
    event("declined", "Declined", "2026-08-05", { notGoing: true }),
    event("past", "Past paid", "2026-07-01", { eventStage: "paid" })
  ], workers, now);

  assert.deepEqual(rows, []);
});

test("generates the August 2026 paid and pending sections in chronological order", () => {
  const paidWoodbridge = event("woodbridge", "woodbridgecardshow", "2026-08-02", { eventStage: "paid", venueName: "APA Hotel Woodbridge", city: "Iselin", state: "NJ" });
  const paidBigShow = event("big-show", "The Big Show Thursday Nights", "2026-08-06", { eventStage: "paid", startTime: "17:00", endTime: "22:00", venueName: "Embassy Suites", city: "Piscataway", state: "NJ" });
  const paidApex = event("apex", "Apex TCG", "2026-08-16", { eventStage: "paid", venueName: "Hilton Hasbrouck Heights", city: "Hasbrouck Heights", state: "NJ" });
  const paidBridgewater = event("bridgewater", "The Big Show", "2026-08-22", { eventStage: "paid", startTime: "10:00", endTime: "16:00", venueName: "Bridgewater Commons" });
  const pendingMall = event("mall", "Mall Woodbridge", "2026-08-28", {
    eventStage: "applied",
    eventDays: [day("mall", "fri", "2026-08-28"), day("mall", "sat", "2026-08-29"), day("mall", "sun", "2026-08-30")],
    venueName: "Woodbridge Center",
    city: "Woodbridge",
    state: "NJ"
  });
  const rows = selectConfirmedUpcomingSchedule([pendingMall, paidBridgewater, paidApex, paidBigShow, paidWoodbridge], workers, now);
  const message = generateScheduleMessage(rows);

  assert.match(message, /^Hey guys, here are our upcoming events:/);
  assert.match(message, /✅ PAID \/ CONFIRMED[\s\S]*Sunday, August 2\nwoodbridgecardshow\nAPA Hotel Woodbridge, Iselin, NJ/);
  assert.match(message, /Thursday, August 6\nThe Big Show Thursday Nights\n5:00 PM–10:00 PM\nEmbassy Suites, Piscataway, NJ/);
  assert.match(message, /Sunday, August 16\nApex TCG/);
  assert.match(message, /Saturday, August 22\nThe Big Show\n10:00 AM–4:00 PM/);
  assert.match(message, /🟡 APPLIED \/ RESERVED — NOT CONFIRMED YET[\s\S]*August 28–30\nMall Woodbridge\nWoodbridge Center, Woodbridge, NJ/);
  assert.match(message, /We applied\/reserved for this one, but it has not been confirmed or paid yet\./);
  assert.ok(message.indexOf("August 2") < message.indexOf("August 6"));
  assert.ok(message.indexOf("August 6") < message.indexOf("August 16"));
  assert.ok(message.indexOf("August 16") < message.indexOf("August 22"));
  assert.ok(message.indexOf("August 22") < message.indexOf("August 28–30"));
  assert.match(message, /Please let me know which dates you are available to work\.$/);
});

test("still generates a message when only pending events qualify", () => {
  const rows = selectConfirmedUpcomingSchedule([event("pending", "Pending Show", "2026-08-16", { eventStage: "applied" })], workers, now);
  const message = generateScheduleMessage(rows);

  assert.doesNotMatch(message, /✅ PAID/);
  assert.match(message, /🟡 APPLIED \/ RESERVED/);
});
