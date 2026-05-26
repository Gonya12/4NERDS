import type { EventDayWorker } from "../../types/models";
import { nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";

type EventDayWorkerRow = {
  id: string;
  event_id: string;
  event_day_id: string;
  worker_id: string;
  created_at: string;
  updated_at: string;
};

function fromRow(row: EventDayWorkerRow): EventDayWorker {
  return {
    id: row.id,
    eventId: row.event_id,
    eventDayId: row.event_day_id,
    workerId: row.worker_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(item: EventDayWorker): EventDayWorkerRow {
  return {
    id: item.id,
    event_id: item.eventId,
    event_day_id: item.eventDayId,
    worker_id: item.workerId,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

export async function listEventDayWorkers(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return [] as EventDayWorker[];
  const { data, error } = await supabase.from("event_day_workers").select("*").eq("event_id", eventId);
  if (error) throwSupabase(error.message);
  return (data || []).map((row) => fromRow(row as EventDayWorkerRow));
}

export async function replaceEventDayWorkers(eventId: string, items: EventDayWorker[]) {
  if (!isSupabaseConfigured || !supabase) return items;
  const { error: deleteError } = await supabase.from("event_day_workers").delete().eq("event_id", eventId);
  if (deleteError) throwSupabase(deleteError.message);

  const timestamp = nowIso();
  const rows = items.map((item) => toRow({ ...item, eventId, updatedAt: timestamp }));
  if (rows.length) {
    const { error } = await supabase.from("event_day_workers").insert(rows);
    if (error) throwSupabase(error.message);
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return items;
}

export async function deleteEventDayWorker(itemId: string) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("event_day_workers").delete().eq("id", itemId);
  if (error) throwSupabase(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
}

function throwSupabase(message: string): never {
  setSupabaseStatus({ connected: false, error: message });
  console.error("Supabase error:", message);
  throw new Error(message);
}
