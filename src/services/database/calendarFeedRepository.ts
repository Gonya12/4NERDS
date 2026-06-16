import type { CalendarFeed, CalendarFeedEvent, CalendarImportCandidate, Event, EventDay } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { db } from "../storage/localDb";
import { isSupabaseConfigured, recordSupabaseRequest, setSupabaseStatus, supabase } from "../../utils/supabase";
import { saveEvent } from "./eventRepository";
import { njPokemonCalendar } from "../../data/njPokemonSources";

type CalendarFeedRow = {
  id: string;
  name: string;
  ics_url: string;
  enabled: boolean;
  auto_import: boolean;
  last_checked_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

type FeedApiResponse = {
  success: boolean;
  reached?: boolean;
  events?: CalendarFeedEvent[];
  error?: string;
  stage?: string;
  parser_status?: "success" | "failed";
  event_count?: number;
  source_url?: string;
  upstream_status?: number;
  body_snippet?: string;
  parser_error?: string;
};

export type CalendarFeedTestResult = {
  reachable: boolean;
  eventsFound: number;
  httpStatus: number;
  apiReached: boolean;
  parserStatus: "Success" | "Failed" | "Unknown";
  details: string;
};

class CalendarFeedRequestError extends Error {
  constructor(message: string, public readonly httpStatus: number, public readonly apiReached: boolean) {
    super(message);
    this.name = "CalendarFeedRequestError";
  }
}

const localFeedKey = "4nerds_calendar_feeds_local_v1";
const candidateKey = "4nerds_calendar_import_candidates_v1";
const defaultFeedSeededKey = "4nerds_default_calendar_feed_seeded_v1";

function fromRow(row: CalendarFeedRow): CalendarFeed {
  return {
    id: row.id,
    name: row.name,
    icsUrl: row.ics_url,
    enabled: Boolean(row.enabled),
    autoImport: Boolean(row.auto_import),
    lastCheckedAt: row.last_checked_at || undefined,
    lastStatus: row.last_status || undefined,
    lastError: row.last_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(feed: CalendarFeed): CalendarFeedRow {
  return {
    id: feed.id,
    name: feed.name,
    ics_url: feed.icsUrl,
    enabled: feed.enabled,
    auto_import: feed.autoImport,
    last_checked_at: feed.lastCheckedAt || null,
    last_status: feed.lastStatus || null,
    last_error: feed.lastError || null,
    created_at: feed.createdAt,
    updated_at: feed.updatedAt
  };
}

function readLocalFeeds() {
  try {
    return JSON.parse(localStorage.getItem(localFeedKey) || "[]") as CalendarFeed[];
  } catch {
    return [] as CalendarFeed[];
  }
}

function writeLocalFeeds(feeds: CalendarFeed[]) {
  localStorage.setItem(localFeedKey, JSON.stringify(feeds));
}

export async function listCalendarFeeds() {
  if (!isSupabaseConfigured || !supabase) return readLocalFeeds();
  const { data, error } = await supabase.from("calendar_feeds").select("*").order("name");
  recordSupabaseRequest("calendar_feeds", "listCalendarFeeds", data?.length || 0);
  if (error) throw new Error(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return (data || []).map((row) => fromRow(row as CalendarFeedRow));
}

export async function seedDefaultCalendarFeed() {
  if (isSupabaseConfigured || localStorage.getItem(defaultFeedSeededKey) === "true") return;
  const feeds = readLocalFeeds();
  if (!feeds.some((feed) => feed.icsUrl === njPokemonCalendar.icsUrl)) {
    const timestamp = nowIso();
    writeLocalFeeds([{
      id: njPokemonCalendar.id,
      name: njPokemonCalendar.name,
      icsUrl: njPokemonCalendar.icsUrl,
      enabled: true,
      autoImport: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }, ...feeds]);
  }
  localStorage.setItem(defaultFeedSeededKey, "true");
}

export async function saveCalendarFeed(feed: CalendarFeed) {
  const saved = { ...feed, updatedAt: nowIso() };
  if (!isSupabaseConfigured || !supabase) {
    writeLocalFeeds([saved, ...readLocalFeeds().filter((item) => item.id !== saved.id)]);
    return saved;
  }
  const { data, error } = await supabase.from("calendar_feeds").upsert(toRow(saved)).select("*").single();
  recordSupabaseRequest("calendar_feeds", "saveCalendarFeed", data ? 1 : 0);
  if (error) throw new Error(error.message);
  return fromRow(data as CalendarFeedRow);
}

export async function deleteCalendarFeed(feedId: string) {
  if (!isSupabaseConfigured || !supabase) {
    writeLocalFeeds(readLocalFeeds().filter((item) => item.id !== feedId));
  } else {
    const { error } = await supabase.from("calendar_feeds").delete().eq("id", feedId);
    recordSupabaseRequest("calendar_feeds", "deleteCalendarFeed");
    if (error) throw new Error(error.message);
  }
  saveCalendarCandidates(listCalendarCandidates().filter((candidate) => candidate.calendarFeedId !== feedId));
}

export function listCalendarCandidates() {
  try {
    return JSON.parse(localStorage.getItem(candidateKey) || "[]") as CalendarImportCandidate[];
  } catch {
    return [] as CalendarImportCandidate[];
  }
}

export function listCalendarCandidatesForFeed(feedId: string) {
  return listCalendarCandidates().filter((candidate) => candidate.calendarFeedId === feedId);
}

export function saveCalendarCandidates(candidates: CalendarImportCandidate[]) {
  localStorage.setItem(candidateKey, JSON.stringify(candidates));
}

async function existingExternalIds() {
  if (!isSupabaseConfigured || !supabase) {
    const events = await db.events.toArray();
    return new Set(events.map((event) => event.externalSourceId).filter(Boolean));
  }
  const { data, error } = await supabase.from("events").select("external_source_id").not("external_source_id", "is", null);
  recordSupabaseRequest("events", "existingExternalIds", data?.length || 0);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((row) => String((row as { external_source_id: string }).external_source_id)));
}

export async function syncCalendarFeed(feed: CalendarFeed, onProgress?: (message: string) => void) {
  onProgress?.("Reading calendar feed...");
  const { response, payload } = await callCalendarFeedApi(feed.icsUrl);
  if (!response.ok || !payload.success) {
    const message = formatCalendarFeedError(response.status, payload, feed.icsUrl);
    await saveFeedStatusSafely({ ...feed, lastCheckedAt: nowIso(), lastStatus: "Failed", lastError: message });
    throw new Error(message);
  }

  onProgress?.("Parsing events...");
  console.info("Parsed events count", payload.events?.length || 0);
  const externalIds = await existingExternalIds();
  onProgress?.("Checking duplicates...");
  const timestamp = nowIso();
  const current = listCalendarCandidates();
  const candidatesByUid = new Map(
    current
      .filter((candidate) => candidate.calendarFeedId === feed.id)
      .map((candidate) => [candidate.uid, candidate])
  );
  const candidatesFromOtherFeeds = current.filter((candidate) => candidate.calendarFeedId !== feed.id);
  const uniqueEvents = Array.from(new Map((payload.events || []).map((item) => [item.uid, item])).values());
  const candidates = uniqueEvents.map((item): CalendarImportCandidate => ({
    ...item,
    id: candidatesByUid.get(item.uid)?.id || id("calendar_candidate"),
    calendarFeedId: feed.id,
    calendarFeedName: feed.name,
    duplicate: externalIds.has(item.uid) || candidatesByUid.get(item.uid)?.reviewStatus === "saved",
    reviewStatus: candidatesByUid.get(item.uid)?.reviewStatus || "pending",
    createdAt: candidatesByUid.get(item.uid)?.createdAt || timestamp
  }));

  let imported = 0;
  for (const candidate of candidates) {
    if (feed.autoImport && !candidate.duplicate && candidate.reviewStatus === "pending") {
      await saveCalendarCandidate(candidate);
      candidate.reviewStatus = "saved";
      candidate.duplicate = true;
      imported += 1;
    }
  }
  saveCalendarCandidates([...candidates, ...candidatesFromOtherFeeds]);
  const duplicates = candidates.filter((candidate) => candidate.duplicate).length;
  const status = `Found ${candidates.length}; ${imported} imported; ${duplicates} duplicates`;
  await saveFeedStatusSafely({ ...feed, lastCheckedAt: timestamp, lastStatus: status, lastError: undefined, lastFoundCount: candidates.length });
  onProgress?.("Preparing import list...");
  return {
    found: candidates.length,
    imported,
    duplicates,
    review: candidates.filter((candidate) => candidate.reviewStatus === "pending" && !candidate.duplicate).length
  };
}

export async function testCalendarFeed(icsUrl: string): Promise<CalendarFeedTestResult> {
  try {
    const { response, payload } = await callCalendarFeedApi(icsUrl);
    const reachable = response.ok && payload.success;
    return {
      reachable,
      eventsFound: payload.events?.length || 0,
      httpStatus: response.status,
      apiReached: Boolean(payload.reached),
      parserStatus: payload.parser_status === "success" ? "Success" : payload.parser_status === "failed" ? "Failed" : "Unknown",
      details: reachable
        ? `HTTP ${response.status}\nCalendar API route reached: yes\nParser status: ${payload.parser_status || "unknown"}\nEvents found: ${payload.event_count ?? payload.events?.length ?? 0}\nFeed URL: ${payload.source_url || icsUrl}`
        : formatCalendarFeedError(response.status, payload, icsUrl)
    };
  } catch (error) {
    return {
      reachable: false,
      eventsFound: 0,
      httpStatus: error instanceof CalendarFeedRequestError ? error.httpStatus : 0,
      apiReached: error instanceof CalendarFeedRequestError ? error.apiReached : false,
      parserStatus: "Unknown",
      details: error instanceof Error ? error.message : "Calendar feed test failed."
    };
  }
}

async function callCalendarFeedApi(icsUrl: string) {
  const apiUrl = `/api/calendar-feed?url=${encodeURIComponent(icsUrl)}`;
  console.info("Calling calendar feed API", apiUrl);
  let response: Response;
  try {
    response = await fetch(apiUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed.";
    console.error("Calendar feed error", message);
    throw new CalendarFeedRequestError(
      `Calendar API route reached: no\nFailed URL: ${apiUrl}\nNetwork error: ${message}`,
      0,
      false
    );
  }

  const rawBody = await response.text();
  let payload: FeedApiResponse;
  try {
    payload = JSON.parse(rawBody) as FeedApiResponse;
  } catch {
    const routeMissing = response.status === 404 || rawBody.includes("<!DOCTYPE html") || rawBody.includes("<html");
    const message = routeMissing
      ? "Calendar API route not found. Make sure api/calendar-feed.ts is deployed."
      : "Calendar API returned a response that was not valid JSON.";
    console.error("Calendar feed error", message, { status: response.status, body: rawBody.slice(0, 500) });
    throw new CalendarFeedRequestError(
      `${message}\nHTTP status: ${response.status}\nCalendar API route reached: no\nFailed URL: ${apiUrl}\nAPI response: ${rawBody.slice(0, 500) || "(empty)"}`,
      response.status,
      false
    );
  }

  console.info("API response", { status: response.status, payload });
  if (response.status === 404 && !payload.reached) {
    const message = "Calendar API route not found. Make sure api/calendar-feed.ts is deployed.";
    console.error("Calendar feed error", message, payload);
    throw new CalendarFeedRequestError(
      `${message}\nHTTP status: 404\nCalendar API route reached: no\nFailed URL: ${apiUrl}\nAPI response: ${JSON.stringify(payload, null, 2)}`,
      404,
      false
    );
  }
  if (!payload.success) console.error("Calendar feed error", payload.error || "Unknown calendar API error");
  return { response, payload };
}

function formatCalendarFeedError(httpStatus: number, payload: FeedApiResponse, fallbackUrl: string) {
  return [
    payload.error || "Could not read calendar feed.",
    `HTTP status: ${httpStatus}`,
    `Calendar API route reached: ${payload.reached ? "yes" : "no"}`,
    payload.stage ? `Failure stage: ${payload.stage}` : "",
    payload.parser_status ? `Parser status: ${payload.parser_status}` : "",
    payload.upstream_status ? `Upstream status: ${payload.upstream_status}` : "",
    `Failed URL: ${payload.source_url || fallbackUrl}`,
    payload.parser_error ? `Parser error: ${payload.parser_error}` : "",
    payload.body_snippet ? `Upstream response snippet: ${payload.body_snippet}` : "",
    `API response: ${JSON.stringify(payload, null, 2)}`
  ].filter(Boolean).join("\n");
}

async function saveFeedStatusSafely(feed: CalendarFeed) {
  try {
    await saveCalendarFeed(feed);
  } catch (error) {
    console.warn("Calendar feed status could not be saved", error);
  }
}

export async function saveCalendarCandidate(candidate: CalendarImportCandidate) {
  if (candidate.duplicate) throw new Error("This calendar event was already imported.");
  const event = calendarCandidateToEvent(candidate);
  await saveEvent(event);
  saveCalendarCandidates(listCalendarCandidates().map((item) => item.id === candidate.id ? { ...item, reviewStatus: "saved" } : item));
  return event;
}

export function ignoreCalendarCandidate(candidateId: string) {
  saveCalendarCandidates(listCalendarCandidates().map((item) => item.id === candidateId ? { ...item, reviewStatus: "ignored" } : item));
}

export function calendarCandidateToEvent(candidate: CalendarImportCandidate): Event {
  const timestamp = nowIso();
  const eventId = id("event");
  const days = candidateDays(candidate, eventId, timestamp);
  const first = days[0];
  return {
    id: eventId,
    name: candidate.title,
    description: candidate.description,
    startDate: new Date(candidate.start).toISOString(),
    endDate: candidate.end ? new Date(candidate.end).toISOString() : undefined,
    startTime: first?.startTime,
    endTime: days[days.length - 1]?.endTime,
    venueName: candidate.location,
    address: candidate.location,
    registrationStatus: "unknown",
    sourceUrl: candidate.url,
    sourceType: "event_page",
    confidence: "high",
    needsReview: false,
    interested: false,
    maybe: false,
    notGoing: false,
    eventDays: days,
    confirmedWorkerIds: [],
    eventCost: 0,
    paymentRecords: [],
    reminderEnabled: false,
    reminderOffsets: [],
    reminderNotificationIds: [],
    status: "interested",
    eventStage: "new",
    externalSource: "google_calendar_ics",
    externalSourceId: candidate.uid,
    calendarFeedId: candidate.calendarFeedId,
    importedFromCalendar: true,
    manuallyEdited: false,
    notes: candidate.description,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function candidateDays(candidate: CalendarImportCandidate, eventId: string, timestamp: string): EventDay[] {
  const start = new Date(candidate.start);
  const end = new Date(candidate.end || candidate.start);
  const last = new Date(end);
  if (candidate.allDay && candidate.end) last.setDate(last.getDate() - 1);
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
  const finalDate = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 12);
  const days: EventDay[] = [];
  while (cursor <= finalDate) {
    const isFirst = days.length === 0;
    const isLast = cursor.toDateString() === finalDate.toDateString();
    days.push({
      id: id("day"),
      eventId,
      date: localDate(cursor),
      startTime: candidate.allDay || !isFirst ? undefined : localTime(start),
      endTime: candidate.allDay || !isLast ? undefined : localTime(end),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days.length ? days : [{
    id: id("day"),
    eventId,
    date: localDate(start),
    startTime: candidate.allDay ? undefined : localTime(start),
    endTime: candidate.allDay ? undefined : localTime(end),
    createdAt: timestamp,
    updatedAt: timestamp
  }];
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
