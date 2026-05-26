import type { Event, EventDay, RegistrationStatus } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { db, seedWorkers } from "../storage/localDb";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";
import { deletePaymentRecord, listPaymentRecords, savePaymentRecord } from "./paymentRepository";

type EventRow = {
  id: string;
  name: string;
  start_date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  venue_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  registration_status: RegistrationStatus;
  registration_url?: string | null;
  source_url?: string | null;
  notes?: string | null;
  image_url?: string | null;
  image_path?: string | null;
  location_id?: string | null;
  location_instagram_handle?: string | null;
  organizer_instagram_handle?: string | null;
  event_cost: number;
  created_at: string;
  updated_at: string;
};

type EventWorkerRow = {
  event_id: string;
  worker_id: string;
};

type EventDayRow = {
  id: string;
  event_id: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string) {
  if (!uuidPattern.test(value)) {
    throw new Error(`${field} is not a valid UUID: ${value}`);
  }
}

function fromDayRow(row: EventDayRow): EventDay {
  return {
    id: row.id,
    eventId: row.event_id,
    date: row.date,
    startTime: row.start_time || undefined,
    endTime: row.end_time || undefined,
    note: row.note || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toDayRow(day: EventDay, eventId: string): EventDayRow {
  return {
    id: day.id,
    event_id: eventId,
    date: day.date.slice(0, 10),
    start_time: day.startTime || null,
    end_time: day.endTime || null,
    note: day.note || null,
    created_at: day.createdAt,
    updated_at: day.updatedAt
  };
}

function fallbackEventDay(event: Event): EventDay {
  const timestamp = event.createdAt || nowIso();
  return {
    id: id("day"),
    eventId: event.id,
    date: event.startDate.slice(0, 10),
    startTime: event.startTime,
    endTime: event.endTime,
    createdAt: timestamp,
    updatedAt: event.updatedAt || timestamp
  };
}

function fromRow(row: EventRow, confirmedWorkerIds: string[], paymentRecords = [] as Event["paymentRecords"], eventDays: EventDay[] = []): Event {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date || undefined,
    startTime: row.start_time || undefined,
    endTime: row.end_time || undefined,
    venueName: row.venue_name || undefined,
    address: row.address || undefined,
    city: row.city || undefined,
    state: row.state || undefined,
    registrationStatus: row.registration_status || "unknown",
    registrationUrl: row.registration_url || undefined,
    sourceUrl: row.source_url || undefined,
    notes: row.notes || undefined,
    imageUrl: row.image_url || undefined,
    imagePath: row.image_path || undefined,
    locationId: row.location_id || undefined,
    locationInstagramHandle: row.location_instagram_handle || undefined,
    organizerInstagramHandle: row.organizer_instagram_handle || undefined,
    eventDays,
    confirmedWorkerIds,
    eventCost: Number(row.event_cost || 0),
    paymentRecords: paymentRecords || [],
    sourceType: "manual",
    confidence: "high",
    needsReview: false,
    interested: false,
    maybe: false,
    notGoing: false,
    reminderEnabled: false,
    reminderOffsets: [],
    reminderNotificationIds: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(event: Event): EventRow {
  return {
    id: event.id,
    name: event.name,
    start_date: event.startDate.slice(0, 10),
    end_date: event.endDate ? event.endDate.slice(0, 10) : null,
    start_time: event.startTime || null,
    end_time: event.endTime || null,
    venue_name: event.venueName || null,
    address: event.address || null,
    city: event.city || null,
    state: event.state || null,
    registration_status: event.registrationStatus || "unknown",
    registration_url: event.registrationUrl || null,
    source_url: event.sourceUrl || null,
    notes: event.notes || null,
    image_url: event.imageUrl || null,
    image_path: event.imagePath || null,
    location_id: event.locationId || null,
    location_instagram_handle: event.locationInstagramHandle || null,
    organizer_instagram_handle: event.organizerInstagramHandle || null,
    event_cost: Number(event.eventCost || 0),
    created_at: event.createdAt,
    updated_at: event.updatedAt
  };
}

async function loadEventDaysByEvent() {
  if (!supabase) return new Map<string, EventDay[]>();
  const { data, error } = await supabase.from("event_days").select("*").order("date");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  const map = new Map<string, EventDay[]>();
  (data || []).forEach((row) => {
    const day = fromDayRow(row as EventDayRow);
    map.set(day.eventId, [...(map.get(day.eventId) || []), day]);
  });
  return map;
}

async function loadConfirmedWorkersByEvent() {
  if (!supabase) return new Map<string, string[]>();
  const { data, error } = await supabase.from("event_workers").select("event_id, worker_id");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  const map = new Map<string, string[]>();
  (data || []).forEach((row) => {
    const typed = row as EventWorkerRow;
    map.set(typed.event_id, [...(map.get(typed.event_id) || []), typed.worker_id]);
  });
  return map;
}

export async function listEvents() {
  if (!isSupabaseConfigured || !supabase) {
    console.log("Using Local mode");
    const events = await db.events.orderBy("startDate").toArray();
    return events.map((event) => ({ ...event, confirmedWorkerIds: event.confirmedWorkerIds || [], eventCost: event.eventCost || 0, paymentRecords: event.paymentRecords || [], eventDays: event.eventDays?.length ? event.eventDays : [fallbackEventDay(event)] }));
  }

  console.log("Using Supabase mode");
  const { data, error } = await supabase.from("events").select("*").order("start_date");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  const workersByEvent = await loadConfirmedWorkersByEvent();
  const daysByEvent = await loadEventDaysByEvent();
  const validRows = (data || []).filter((row) => {
    const eventRow = row as EventRow;
    return Boolean(eventRow.name && eventRow.start_date);
  });
  const events = await Promise.all(validRows.map(async (row) => {
    const eventRow = row as EventRow;
    return fromRow(eventRow, workersByEvent.get(eventRow.id) || [], await listPaymentRecords(eventRow.id), daysByEvent.get(eventRow.id) || []);
  }));
  console.log(`Loaded ${events.length} events from Supabase`);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return events;
}

export async function getEvent(eventId: string) {
  if (!isSupabaseConfigured || !supabase) {
    const event = await db.events.get(eventId);
    return event ? { ...event, confirmedWorkerIds: event.confirmedWorkerIds || [], eventCost: event.eventCost || 0, paymentRecords: event.paymentRecords || [], eventDays: event.eventDays?.length ? event.eventDays : [fallbackEventDay(event)] } : undefined;
  }

  const { data, error } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  if (!data || !(data as EventRow).name || !(data as EventRow).start_date) return undefined;
  const { data: eventWorkers, error: eventWorkerError } = await supabase.from("event_workers").select("worker_id").eq("event_id", eventId);
  if (eventWorkerError) {
    setSupabaseStatus({ connected: false, error: eventWorkerError.message });
    console.error("Supabase error:", eventWorkerError.message);
    throw eventWorkerError;
  }
  const { data: dayRows, error: dayError } = await supabase.from("event_days").select("*").eq("event_id", eventId).order("date");
  if (dayError) {
    setSupabaseStatus({ connected: false, error: dayError.message });
    console.error("Supabase error:", dayError.message);
    throw dayError;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return fromRow(data as EventRow, (eventWorkers || []).map((row) => (row as { worker_id: string }).worker_id), await listPaymentRecords(eventId), (dayRows || []).map((row) => fromDayRow(row as EventDayRow)));
}

export async function saveEvent(event: Event) {
  const savedEvent = {
    ...event,
    confirmedWorkerIds: event.confirmedWorkerIds || [],
    eventCost: Number(event.eventCost || 0),
    paymentRecords: event.paymentRecords || [],
    eventDays: event.eventDays?.length ? event.eventDays : [fallbackEventDay(event)],
    updatedAt: nowIso()
  };

  if (!isSupabaseConfigured || !supabase) {
    await db.events.put(savedEvent);
    return;
  }

  const { error } = await supabase.from("events").upsert(toRow(savedEvent));
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }

  const { error: deleteDaysError } = await supabase.from("event_days").delete().eq("event_id", savedEvent.id);
  if (deleteDaysError) {
    setSupabaseStatus({ connected: false, error: deleteDaysError.message });
    console.error("Supabase error:", deleteDaysError.message);
    throw deleteDaysError;
  }
  const dayRows = savedEvent.eventDays.map((day) => toDayRow({ ...day, eventId: savedEvent.id, updatedAt: nowIso() }, savedEvent.id));
  if (dayRows.length) {
    const { error: insertDaysError } = await supabase.from("event_days").insert(dayRows);
    if (insertDaysError) {
      setSupabaseStatus({ connected: false, error: insertDaysError.message });
      console.error("Supabase error:", insertDaysError.message);
      throw insertDaysError;
    }
  }

  assertUuid(savedEvent.id, "event_id");
  savedEvent.confirmedWorkerIds.forEach((workerId) => assertUuid(workerId, "worker_id"));

  console.log("selected worker IDs", savedEvent.confirmedWorkerIds);
  console.log("selected event ID", savedEvent.id);

  const deleteResponse = await supabase.from("event_workers").delete().eq("event_id", savedEvent.id);
  console.log("Supabase event_workers delete response", deleteResponse);
  const deleteWorkerError = deleteResponse.error;
  if (deleteWorkerError) {
    setSupabaseStatus({ connected: false, error: deleteWorkerError.message });
    console.error("Supabase error:", deleteWorkerError.message);
    throw deleteWorkerError;
  }

  console.log("saving availability", {
    eventId: savedEvent.id,
    selectedWorkerIds: savedEvent.confirmedWorkerIds
  });

  if (savedEvent.confirmedWorkerIds.length) {
    const timestamp = nowIso();
    const rows = savedEvent.confirmedWorkerIds.map((workerId) => ({
      event_id: savedEvent.id,
      worker_id: workerId,
      created_at: timestamp,
      updated_at: timestamp
    }));
    console.log("payload being inserted", rows);
    const insertResponse = await supabase
      .from("event_workers")
      .insert(rows)
      .select("event_id, worker_id");
    console.log("Supabase response", insertResponse);
    console.log("Supabase insert result", insertResponse.data);
    const insertWorkerError = insertResponse.error;
    if (insertWorkerError) {
      setSupabaseStatus({ connected: false, error: insertWorkerError.message });
      console.error("Supabase error:", insertWorkerError.message);
      throw insertWorkerError;
    }
  } else {
    console.log("payload being inserted", []);
    console.log("Supabase insert result", []);
  }

  const existingPayments = await listPaymentRecords(savedEvent.id);
  const savedPaymentIds = new Set(savedEvent.paymentRecords.map((record) => record.id));
  await Promise.all(existingPayments
    .filter((record) => !savedPaymentIds.has(record.id))
    .map((record) => deletePaymentRecord(record.id)));
  await Promise.all(savedEvent.paymentRecords.map(savePaymentRecord));
  setSupabaseStatus({ connected: true, error: "", synced: true });
  console.log("Saved event to Supabase");
}

export async function deleteEvent(eventId: string) {
  if (!isSupabaseConfigured || !supabase) {
    await db.events.delete(eventId);
    return;
  }

  const tables = [
    supabase.from("payment_records").delete().eq("event_id", eventId),
    supabase.from("event_days").delete().eq("event_id", eventId),
    supabase.from("event_workers").delete().eq("event_id", eventId),
    supabase.from("events").delete().eq("id", eventId)
  ];
  const results = await Promise.all(tables);
  const error = results.find((result) => result.error)?.error;
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}

export async function clearEventsAndResetWorkers() {
  if (!isSupabaseConfigured || !supabase) {
    await Promise.all([db.events.clear(), db.workers.clear()]);
    await seedWorkers();
    return;
  }

  const results = await Promise.all([
    supabase.from("payment_records").delete().not("id", "is", null),
    supabase.from("event_workers").delete().not("id", "is", null),
    supabase.from("events").delete().not("id", "is", null)
  ]);
  const error = results.find((result) => result.error)?.error;
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}
