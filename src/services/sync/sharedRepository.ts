import type { Event, EventDecision, Organizer, ParsedEventCandidate, Source, TeamDecision } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { db, getSettings } from "../storage/localDb";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { ensureDeviceUserName } from "./teamUser";

type DbEventDecision = {
  id: string;
  event_id: string;
  user_name: string;
  decision: TeamDecision;
  notes?: string;
  reminder_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export function syncModeLabel() {
  return isSupabaseConfigured ? "Team Sync Mode" : "Local Mode";
}

export function getLastSyncTime() {
  return localStorage.getItem("last_supabase_sync_at") || "";
}

function setLastSyncTime() {
  localStorage.setItem("last_supabase_sync_at", nowIso());
}

function toPayloadRow<T extends { id: string; createdAt?: string; updatedAt?: string }>(record: T) {
  return {
    id: record.id,
    payload: record,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function fromPayloadRow<T>(row: any): T {
  return row.payload as T;
}

function toDbDecision(decision: EventDecision): DbEventDecision {
  return {
    id: decision.id,
    event_id: decision.eventId,
    user_name: decision.userName,
    decision: decision.decision,
    notes: decision.notes,
    reminder_enabled: decision.reminderEnabled,
    created_at: decision.createdAt,
    updated_at: decision.updatedAt
  };
}

function fromDbDecision(decision: DbEventDecision): EventDecision {
  return {
    id: decision.id,
    eventId: decision.event_id,
    userName: decision.user_name,
    decision: decision.decision,
    notes: decision.notes,
    reminderEnabled: decision.reminder_enabled,
    createdAt: decision.created_at,
    updatedAt: decision.updated_at
  };
}

async function pullTable<T>(table: string) {
  if (!supabase) return [] as T[];
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw error;
  return data || [];
}

export async function syncFromSupabase() {
  if (!supabase) return false;
  const [events, organizers, sources, candidates, decisions, settings] = await Promise.all([
    pullTable<any>("events"),
    pullTable<any>("organizers"),
    pullTable<any>("sources"),
    pullTable<any>("review_candidates"),
    pullTable<DbEventDecision>("event_decisions"),
    pullTable<any>("app_settings")
  ]);

  await Promise.all([
    db.events.bulkPut(events.map((item) => fromPayloadRow<Event>(item))),
    db.organizers.bulkPut(organizers.map((item) => fromPayloadRow<Organizer>(item))),
    db.sources.bulkPut(sources.map((item) => fromPayloadRow<Source>(item))),
    db.candidates.bulkPut(candidates.map((item) => fromPayloadRow<ParsedEventCandidate>(item))),
    db.eventDecisions.bulkPut(decisions.map(fromDbDecision))
  ]);

  const sharedSettings = settings[0];
  if (sharedSettings) {
    const localSettings = await getSettings();
    await db.settings.put({ ...localSettings, ...fromPayloadRow(sharedSettings), id: "settings" });
  }
  setLastSyncTime();
  return true;
}

export async function listEvents() {
  if (supabase) await syncFromSupabase();
  return db.events.orderBy("startDate").toArray();
}

export async function listSources() {
  if (supabase) await syncFromSupabase();
  return db.sources.toArray();
}

export async function listOrganizers() {
  if (supabase) await syncFromSupabase();
  return db.organizers.toArray();
}

export async function listPendingCandidates() {
  if (supabase) await syncFromSupabase();
  return db.candidates.where("reviewStatus").equals("pending").reverse().sortBy("createdAt");
}

export async function getEvent(eventId: string) {
  if (supabase) await syncFromSupabase();
  return db.events.get(eventId);
}

export async function saveEvent(event: Event) {
  await db.events.put(event);
  if (supabase) {
    const { error } = await supabase.from("events").upsert(toPayloadRow(event));
    if (error) throw error;
    setLastSyncTime();
  }
}

export async function deleteEvent(eventId: string) {
  await db.events.delete(eventId);
  if (supabase) {
    const { error } = await supabase.from("events").delete().eq("id", eventId);
    if (error) throw error;
    setLastSyncTime();
  }
}

export async function saveSource(source: Source) {
  await db.sources.put(source);
  if (supabase) {
    const { error } = await supabase.from("sources").upsert(toPayloadRow(source));
    if (error) throw error;
    setLastSyncTime();
  }
}

export async function deleteSource(sourceId: string) {
  await db.sources.delete(sourceId);
  if (supabase) {
    const { error } = await supabase.from("sources").delete().eq("id", sourceId);
    if (error) throw error;
    setLastSyncTime();
  }
}

export async function saveOrganizer(organizer: Organizer) {
  await db.organizers.put(organizer);
  if (supabase) {
    const { error } = await supabase.from("organizers").upsert(toPayloadRow(organizer));
    if (error) throw error;
    setLastSyncTime();
  }
}

export async function deleteOrganizer(organizerId: string) {
  await db.organizers.delete(organizerId);
  if (supabase) {
    const { error } = await supabase.from("organizers").delete().eq("id", organizerId);
    if (error) throw error;
    setLastSyncTime();
  }
}

export async function saveCandidate(candidate: ParsedEventCandidate) {
  await db.candidates.put(candidate);
  if (supabase) {
    const { error } = await supabase.from("review_candidates").upsert(toPayloadRow(candidate));
    if (error) throw error;
    setLastSyncTime();
  }
}

export async function saveCandidates(candidates: ParsedEventCandidate[]) {
  if (candidates.length === 0) return;
  await db.candidates.bulkPut(candidates);
  if (supabase) {
    const { error } = await supabase.from("review_candidates").upsert(candidates.map(toPayloadRow));
    if (error) throw error;
    setLastSyncTime();
  }
}

export async function updateCandidateStatus(candidateId: string, reviewStatus: "saved" | "discarded") {
  await db.candidates.update(candidateId, { reviewStatus });
  if (supabase) {
    const candidate = await db.candidates.get(candidateId);
    if (candidate) await saveCandidate(candidate);
  }
}

export async function listEventDecisions(eventId: string) {
  if (supabase) await syncFromSupabase();
  return db.eventDecisions.where("eventId").equals(eventId).toArray();
}

export async function setMyDecision(event: Event, decision: TeamDecision, reminderEnabled: boolean) {
  const userName = ensureDeviceUserName();
  const existing = (await db.eventDecisions.where("eventId").equals(event.id).toArray()).find((item) => item.userName === userName);
  const timestamp = nowIso();
  const record: EventDecision = {
    id: existing?.id || id("decision"),
    eventId: event.id,
    userName,
    decision,
    notes: existing?.notes,
    reminderEnabled,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  await db.eventDecisions.put(record);
  if (supabase) {
    const { error } = await supabase.from("event_decisions").upsert(toDbDecision(record));
    if (error) throw error;
    setLastSyncTime();
  }
  return record;
}

export async function saveSharedSettings() {
  if (!supabase) return;
  const settings = await getSettings();
  const { error } = await supabase.from("app_settings").upsert(toPayloadRow(settings));
  if (error) throw error;
  setLastSyncTime();
}
