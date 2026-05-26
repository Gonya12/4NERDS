import type { Event, RegistrationStatus } from "../../types/models";
import { nowIso } from "../../utils/normalize";
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
  event_cost: number;
  created_at: string;
  updated_at: string;
};

type EventWorkerRow = {
  event_id: string;
  worker_id: string;
};

function fromRow(row: EventRow, confirmedWorkerIds: string[], paymentRecords = [] as Event["paymentRecords"]): Event {
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
    event_cost: Number(event.eventCost || 0),
    created_at: event.createdAt,
    updated_at: event.updatedAt
  };
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
    return events.map((event) => ({ ...event, confirmedWorkerIds: event.confirmedWorkerIds || [], eventCost: event.eventCost || 0, paymentRecords: event.paymentRecords || [] }));
  }

  console.log("Using Supabase mode");
  const { data, error } = await supabase.from("events").select("*").order("start_date");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  const workersByEvent = await loadConfirmedWorkersByEvent();
  const validRows = (data || []).filter((row) => {
    const eventRow = row as EventRow;
    return Boolean(eventRow.name && eventRow.start_date);
  });
  const events = await Promise.all(validRows.map(async (row) => {
    const eventRow = row as EventRow;
    return fromRow(eventRow, workersByEvent.get(eventRow.id) || [], await listPaymentRecords(eventRow.id));
  }));
  console.log(`Loaded ${events.length} events from Supabase`);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return events;
}

export async function getEvent(eventId: string) {
  if (!isSupabaseConfigured || !supabase) {
    const event = await db.events.get(eventId);
    return event ? { ...event, confirmedWorkerIds: event.confirmedWorkerIds || [], eventCost: event.eventCost || 0, paymentRecords: event.paymentRecords || [] } : undefined;
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
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return fromRow(data as EventRow, (eventWorkers || []).map((row) => (row as { worker_id: string }).worker_id), await listPaymentRecords(eventId));
}

export async function saveEvent(event: Event) {
  const savedEvent = {
    ...event,
    confirmedWorkerIds: event.confirmedWorkerIds || [],
    eventCost: Number(event.eventCost || 0),
    paymentRecords: event.paymentRecords || [],
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

  const { error: deleteWorkerError } = await supabase.from("event_workers").delete().eq("event_id", savedEvent.id);
  if (deleteWorkerError) {
    setSupabaseStatus({ connected: false, error: deleteWorkerError.message });
    console.error("Supabase error:", deleteWorkerError.message);
    throw deleteWorkerError;
  }

  if (savedEvent.confirmedWorkerIds.length) {
    const timestamp = nowIso();
    const rows = savedEvent.confirmedWorkerIds.map((workerId) => ({
      id: `${savedEvent.id}_${workerId}`,
      event_id: savedEvent.id,
      worker_id: workerId,
      created_at: timestamp,
      updated_at: timestamp
    }));
    const { error: insertWorkerError } = await supabase.from("event_workers").upsert(rows);
    if (insertWorkerError) {
      setSupabaseStatus({ connected: false, error: insertWorkerError.message });
      console.error("Supabase error:", insertWorkerError.message);
      throw insertWorkerError;
    }
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
    supabase.from("payment_records").delete().neq("id", ""),
    supabase.from("event_workers").delete().neq("id", ""),
    supabase.from("events").delete().neq("id", "")
  ]);
  const error = results.find((result) => result.error)?.error;
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}
