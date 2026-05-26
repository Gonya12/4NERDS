import Dexie, { type Table } from "dexie";
import type { AppSettings, Event, EventDecision, GeocodeCache, Organizer, ParsedEventCandidate, ScrapeLog, Source, Worker } from "../../types/models";
import { nowIso } from "../../utils/normalize";

class FourNerdsDb extends Dexie {
  events!: Table<Event, string>;
  organizers!: Table<Organizer, string>;
  sources!: Table<Source, string>;
  candidates!: Table<ParsedEventCandidate, string>;
  settings!: Table<AppSettings, string>;
  geocodes!: Table<GeocodeCache, string>;
  scrapeLogs!: Table<ScrapeLog, string>;
  eventDecisions!: Table<EventDecision, string>;
  workers!: Table<Worker, string>;

  constructor() {
    super("fourNerdsEventTracker");
    this.version(1).stores({
      events: "id, startDate, organizerId, needsReview, interested, maybe, notGoing, registrationStatus",
      organizers: "id, name",
      sources: "id, type, enabled, organizerId",
      candidates: "id, reviewStatus, sourceId, createdAt",
      settings: "id",
      geocodes: "address",
      scrapeLogs: "id, sourceId, classification, createdAt"
    });
    this.version(2).stores({
      events: "id, startDate, organizerId, needsReview, interested, maybe, notGoing, registrationStatus",
      organizers: "id, name",
      sources: "id, type, enabled, organizerId",
      candidates: "id, reviewStatus, sourceId, createdAt, classification",
      settings: "id",
      geocodes: "address",
      scrapeLogs: "id, sourceId, classification, createdAt"
    });
    this.version(3).stores({
      events: "id, startDate, organizerId, needsReview, interested, maybe, notGoing, registrationStatus",
      organizers: "id, name",
      sources: "id, type, enabled, organizerId",
      candidates: "id, reviewStatus, sourceId, createdAt, classification",
      settings: "id",
      geocodes: "address",
      scrapeLogs: "id, sourceId, classification, createdAt"
    });
    this.version(4).stores({
      events: "id, sourceId, startDate, organizerId, needsReview, interested, maybe, notGoing, registrationStatus",
      organizers: "id, name",
      sources: "id, type, enabled, organizerId",
      candidates: "id, reviewStatus, sourceId, createdAt, classification",
      settings: "id",
      geocodes: "address",
      scrapeLogs: "id, sourceId, classification, createdAt"
    });
    this.version(5).stores({
      events: "id, sourceId, startDate, organizerId, needsReview, interested, maybe, notGoing, registrationStatus",
      organizers: "id, name",
      sources: "id, type, enabled, organizerId",
      candidates: "id, reviewStatus, sourceId, createdAt, classification",
      settings: "id",
      geocodes: "address",
      scrapeLogs: "id, sourceId, classification, createdAt",
      eventDecisions: "id, eventId, userName, decision"
    });
    this.version(6).stores({
      events: "id, startDate, registrationStatus",
      organizers: "id, name",
      sources: "id, type, enabled, organizerId",
      candidates: "id, reviewStatus, sourceId, createdAt, classification",
      settings: "id",
      geocodes: "address",
      scrapeLogs: "id, sourceId, classification, createdAt",
      eventDecisions: "id, eventId, userName, decision",
      workers: "id, name, active"
    });
  }
}

export const db = new FourNerdsDb();

export async function getSettings() {
  let settings = await db.settings.get("settings");
  if (!settings) {
    const timestamp = nowIso();
    settings = {
      id: "settings",
      homeAddress: "",
      distanceUnit: "miles",
      notificationsEnabled: true,
      reminderOffsets: [7, 3, 1, 0],
      quietHoursStart: "09:00",
      quietHoursEnd: "22:00",
      showLowConfidenceResults: false,
      refreshOnAppOpen: true,
      sourceRefreshIntervalHours: 12,
      onboardingComplete: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await db.settings.put(settings);
  }
  if (settings.showLowConfidenceResults === undefined) {
    settings = { ...settings, showLowConfidenceResults: false, updatedAt: nowIso() };
    await db.settings.put(settings);
  }
  if (settings.refreshOnAppOpen === undefined || settings.sourceRefreshIntervalHours === undefined) {
    settings = {
      ...settings,
      refreshOnAppOpen: settings.refreshOnAppOpen ?? true,
      sourceRefreshIntervalHours: settings.sourceRefreshIntervalHours ?? 12,
      updatedAt: nowIso()
    };
    await db.settings.put(settings);
  }
  return settings;
}

export async function removeDemoData() {
  const [events, sources, organizers] = await Promise.all([
    db.events.toArray(),
    db.sources.toArray(),
    db.organizers.toArray()
  ]);

  const demoEventIds = events
    .filter((event) =>
      event.notes?.includes("Sample data") ||
      event.sourceUrl?.includes("example.com") ||
      ["Newark Card Show", "Collectibles Expo", "Anime and Toy Vendor Market"].includes(event.name)
    )
    .map((event) => event.id);
  const demoSourceIds = sources
    .filter((source) => source.name.startsWith("Demo ") || source.url?.includes("example.com") || source.notes?.includes("Default source placeholder"))
    .map((source) => source.id);
  const demoOrganizerIds = organizers
    .filter((organizer) => organizer.name.includes("Demo Organizer") || organizer.websiteUrl?.includes("example.com"))
    .map((organizer) => organizer.id);

  await Promise.all([
    demoEventIds.length ? db.events.bulkDelete(demoEventIds) : Promise.resolve(),
    demoSourceIds.length ? db.sources.bulkDelete(demoSourceIds) : Promise.resolve(),
    demoOrganizerIds.length ? db.organizers.bulkDelete(demoOrganizerIds) : Promise.resolve()
  ]);
}

const defaultWorkers = ["Gonzalo", "Thiago", "Ivan", "Nahuel", "Worker 1", "Worker 2", "Worker 3"];

export async function seedWorkers() {
  const existing = await db.workers.count();
  if (existing > 0) return;
  const timestamp = nowIso();
  await db.workers.bulkAdd(defaultWorkers.map((name) => ({
    id: `worker_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    name,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp
  })));
}
