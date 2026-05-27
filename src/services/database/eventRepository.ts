import type { Event, EventDay, EventStage, EventStatus, RegistrationStatus, SplitMode } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { db, seedWorkers } from "../storage/localDb";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";
import { deletePaymentRecord, listPaymentRecords, savePaymentRecord } from "./paymentRepository";
import { getFinance } from "./financeRepository";
import { defaultChecklistItems, listChecklistItems, seedChecklistIfEmpty } from "./checklistRepository";
import { getReview, listLiveNotes, seedSalesCategories } from "./eventExtrasRepository";
import { listEventDayWorkers, replaceEventDayWorkers } from "./availabilityRepository";
import { listPriceOptions, replacePriceOptions } from "./priceOptionRepository";
import { listSalesRecordsForEvent } from "./salesRepository";

const homeCacheKey = "4nerds_home_events_cache_v1";

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
  status?: EventStatus | null;
  event_stage?: EventStage | null;
  split_mode?: SplitMode | null;
  packing_notes?: string | null;
  booth_number?: string | null;
  setup_time?: string | null;
  parking_notes?: string | null;
  floor_section?: string | null;
  entry_instructions?: string | null;
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

type EventDayWorkerRow = { id: string; event_id: string; event_day_id: string; worker_id: string; created_at: string; updated_at: string };
type PriceOptionRow = { id: string; event_id: string; label: string; price: number; pricing_type: "flat" | "per_day" | "package"; applies_to_day_ids?: string[] | null; description?: string | null; is_selected: boolean; created_at: string; updated_at: string };
type PaymentRow = { id: string; event_id: string; worker_id: string; amount_paid: number; paid_at?: string | null; note?: string | null; created_at: string; updated_at: string };

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

function fromDayWorkerRow(row: EventDayWorkerRow) {
  return { id: row.id, eventId: row.event_id, eventDayId: row.event_day_id, workerId: row.worker_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

function fromPriceOptionRow(row: PriceOptionRow) {
  return {
    id: row.id,
    eventId: row.event_id,
    label: row.label,
    price: Number(row.price || 0),
    pricingType: row.pricing_type || "flat",
    appliesToDayIds: row.applies_to_day_ids || undefined,
    description: row.description || undefined,
    isSelected: Boolean(row.is_selected),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fromPaymentRow(row: PaymentRow) {
  return {
    id: row.id,
    eventId: row.event_id,
    workerId: row.worker_id,
    amountPaid: Number(row.amount_paid || 0),
    paidAt: row.paid_at || undefined,
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
    status: row.status || "interested",
    eventStage: row.event_stage || "new",
    splitMode: row.split_mode || "equal",
    packingNotes: row.packing_notes || undefined,
    boothNumber: row.booth_number || undefined,
    setupTime: row.setup_time || undefined,
    parkingNotes: row.parking_notes || undefined,
    floorSection: row.floor_section || undefined,
    entryInstructions: row.entry_instructions || undefined,
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
    status: event.status || "interested",
    event_stage: event.eventStage || "new",
    split_mode: event.splitMode || "equal",
    packing_notes: event.packingNotes || null,
    booth_number: event.boothNumber || null,
    setup_time: event.setupTime || null,
    parking_notes: event.parkingNotes || null,
    floor_section: event.floorSection || null,
    entry_instructions: event.entryInstructions || null,
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
    return events.map((event) => ({
      ...event,
      confirmedWorkerIds: event.confirmedWorkerIds || [],
      eventCost: event.eventCost || 0,
      paymentRecords: event.paymentRecords || [],
      eventDays: event.eventDays?.length ? event.eventDays : [fallbackEventDay(event)],
      eventDayWorkers: event.eventDayWorkers || [],
      priceOptions: event.priceOptions || [],
      checklistItems: event.checklistItems?.length ? event.checklistItems : defaultChecklistItems(event.id),
      status: event.status || "interested",
      eventStage: event.eventStage || "new"
    }));
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
    const event = fromRow(eventRow, workersByEvent.get(eventRow.id) || [], await listPaymentRecords(eventRow.id), daysByEvent.get(eventRow.id) || []);
    event.checklistItems = await listChecklistItems(eventRow.id);
    event.finance = await getFinance(eventRow.id);
    event.liveNotes = await listLiveNotes(eventRow.id);
    event.salesCategories = await seedSalesCategories(eventRow.id);
    event.review = await getReview(eventRow.id);
    event.eventDayWorkers = await listEventDayWorkers(eventRow.id);
    event.priceOptions = await listPriceOptions(eventRow.id);
    return event;
  }));
  console.log(`Loaded ${events.length} events from Supabase`);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return events;
}

export function getCachedHomeEvents() {
  try {
    const raw = localStorage.getItem(homeCacheKey);
    if (!raw) {
      setSupabaseStatus({ cacheStatus: "Home cache empty" });
      return [] as Event[];
    }
    const parsed = JSON.parse(raw) as Event[];
    setSupabaseStatus({ cacheStatus: `Loaded ${parsed.length} cached home events` });
    return parsed;
  } catch {
    setSupabaseStatus({ cacheStatus: "Home cache unreadable" });
    return [] as Event[];
  }
}

function cacheHomeEvents(events: Event[]) {
  try {
    localStorage.setItem(homeCacheKey, JSON.stringify(events));
    setSupabaseStatus({ cacheStatus: `Cached ${events.length} home events` });
  } catch {
    setSupabaseStatus({ cacheStatus: "Home cache write failed" });
  }
}

export async function listHomeEvents(limit = 10) {
  const startedAt = performance.now();
  let queryCount = 0;

  if (!isSupabaseConfigured || !supabase) {
    const events = (await db.events.orderBy("startDate").toArray())
      .filter((event) => (event.status !== "completed" && event.status !== "skipped"))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, limit)
      .map((event) => ({
        ...event,
        confirmedWorkerIds: event.confirmedWorkerIds || [],
        eventCost: event.eventCost || 0,
        paymentRecords: event.paymentRecords || [],
        eventDays: event.eventDays?.length ? event.eventDays : [fallbackEventDay(event)],
        eventDayWorkers: event.eventDayWorkers || [],
        priceOptions: event.priceOptions || [],
        status: event.status || "interested",
        eventStage: event.eventStage || "new"
      }));
    cacheHomeEvents(events);
    setSupabaseStatus({ durationMs: Math.round(performance.now() - startedAt), eventsLoaded: events.length, queryCount: 1, cacheStatus: "Local home cache updated" });
    return events;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("events")
    .select("id,name,start_date,end_date,start_time,end_time,venue_name,address,city,state,registration_status,image_url,image_path,status,event_stage,split_mode,event_cost,created_at,updated_at")
    .gte("start_date", today)
    .neq("status", "completed")
    .neq("status", "skipped")
    .order("start_date")
    .limit(limit);
  queryCount += 1;
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message, durationMs: Math.round(performance.now() - startedAt), queryCount });
    throw error;
  }

  const rows = (data || []).filter((row) => (row as EventRow).name && (row as EventRow).start_date) as EventRow[];
  const ids = rows.map((row) => row.id);
  if (!ids.length) {
    cacheHomeEvents([]);
    setSupabaseStatus({ connected: true, error: "", synced: true, durationMs: Math.round(performance.now() - startedAt), eventsLoaded: 0, queryCount });
    return [] as Event[];
  }

  const [daysResult, workersResult, dayWorkersResult, pricesResult, paymentsResult] = await Promise.all([
    supabase.from("event_days").select("*").in("event_id", ids).order("date"),
    supabase.from("event_workers").select("event_id, worker_id").in("event_id", ids),
    supabase.from("event_day_workers").select("*").in("event_id", ids),
    supabase.from("event_price_options").select("*").in("event_id", ids),
    supabase.from("payment_records").select("id,event_id,worker_id,amount_paid,paid_at,note,created_at,updated_at").in("event_id", ids)
  ]);
  queryCount += 5;
  const relatedError = [daysResult, workersResult, dayWorkersResult, pricesResult, paymentsResult].find((result) => result.error)?.error;
  if (relatedError) {
    setSupabaseStatus({ connected: false, error: relatedError.message, durationMs: Math.round(performance.now() - startedAt), queryCount });
    throw relatedError;
  }

  const daysByEvent = new Map<string, EventDay[]>();
  (daysResult.data || []).forEach((row) => {
    const day = fromDayRow(row as EventDayRow);
    daysByEvent.set(day.eventId, [...(daysByEvent.get(day.eventId) || []), day]);
  });
  const workersByEvent = new Map<string, string[]>();
  (workersResult.data || []).forEach((row) => {
    const typed = row as EventWorkerRow;
    workersByEvent.set(typed.event_id, [...(workersByEvent.get(typed.event_id) || []), typed.worker_id]);
  });
  const dayWorkersByEvent = new Map<string, ReturnType<typeof fromDayWorkerRow>[]>();
  (dayWorkersResult.data || []).forEach((row) => {
    const item = fromDayWorkerRow(row as EventDayWorkerRow);
    dayWorkersByEvent.set(item.eventId, [...(dayWorkersByEvent.get(item.eventId) || []), item]);
  });
  const pricesByEvent = new Map<string, ReturnType<typeof fromPriceOptionRow>[]>();
  (pricesResult.data || []).forEach((row) => {
    const item = fromPriceOptionRow(row as PriceOptionRow);
    pricesByEvent.set(item.eventId, [...(pricesByEvent.get(item.eventId) || []), item]);
  });
  const paymentsByEvent = new Map<string, ReturnType<typeof fromPaymentRow>[]>();
  (paymentsResult.data || []).forEach((row) => {
    const item = fromPaymentRow(row as PaymentRow);
    paymentsByEvent.set(item.eventId, [...(paymentsByEvent.get(item.eventId) || []), item]);
  });

  const events = rows.map((row) => fromRow(row, workersByEvent.get(row.id) || [], paymentsByEvent.get(row.id) || [], daysByEvent.get(row.id) || []))
    .map((event) => ({
      ...event,
      eventDayWorkers: dayWorkersByEvent.get(event.id) || [],
      priceOptions: pricesByEvent.get(event.id) || []
    }));

  cacheHomeEvents(events);
  setSupabaseStatus({ connected: true, error: "", synced: true, durationMs: Math.round(performance.now() - startedAt), eventsLoaded: events.length, queryCount });
  return events;
}

export async function getEvent(eventId: string) {
  if (!isSupabaseConfigured || !supabase) {
    const event = await db.events.get(eventId);
    return event ? {
      ...event,
      confirmedWorkerIds: event.confirmedWorkerIds || [],
      eventCost: event.eventCost || 0,
      paymentRecords: event.paymentRecords || [],
      eventDays: event.eventDays?.length ? event.eventDays : [fallbackEventDay(event)],
      eventDayWorkers: event.eventDayWorkers || [],
      priceOptions: event.priceOptions || [],
      checklistItems: event.checklistItems?.length ? event.checklistItems : defaultChecklistItems(event.id),
      status: event.status || "interested",
      eventStage: event.eventStage || "new"
    } : undefined;
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
  const event = fromRow(data as EventRow, (eventWorkers || []).map((row) => (row as { worker_id: string }).worker_id), await listPaymentRecords(eventId), (dayRows || []).map((row) => fromDayRow(row as EventDayRow)));
  event.checklistItems = await seedChecklistIfEmpty(eventId);
  event.finance = await getFinance(eventId);
  event.liveNotes = await listLiveNotes(eventId);
  event.salesCategories = await seedSalesCategories(eventId);
  event.review = await getReview(eventId);
  event.eventDayWorkers = await listEventDayWorkers(eventId);
  event.priceOptions = await listPriceOptions(eventId);
  event.salesRecords = await listSalesRecordsForEvent(eventId);
  return event;
}

export async function saveEvent(event: Event) {
  const savedEvent = {
    ...event,
    confirmedWorkerIds: event.confirmedWorkerIds || [],
    eventCost: Number(event.eventCost || 0),
    paymentRecords: event.paymentRecords || [],
    eventDays: event.eventDays?.length ? event.eventDays : [fallbackEventDay(event)],
    eventDayWorkers: event.eventDayWorkers || [],
    priceOptions: event.priceOptions || [],
    checklistItems: event.checklistItems || [],
    status: event.status || "interested",
    eventStage: event.eventStage || "new",
    splitMode: event.splitMode || "equal",
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
  await replaceEventDayWorkers(savedEvent.id, savedEvent.eventDayWorkers || []);
  await replacePriceOptions(savedEvent.id, savedEvent.priceOptions || []);
  if (!savedEvent.checklistItems.length) await seedChecklistIfEmpty(savedEvent.id);
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
    supabase.from("event_day_workers").delete().eq("event_id", eventId),
    supabase.from("event_price_options").delete().eq("event_id", eventId),
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
    supabase.from("event_day_workers").delete().not("id", "is", null),
    supabase.from("event_price_options").delete().not("id", "is", null),
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
