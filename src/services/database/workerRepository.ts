import type { Worker } from "../../types/models";
import { nowIso } from "../../utils/normalize";
import { db, seedWorkers } from "../storage/localDb";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";

const defaultWorkerNames = ["Gonzalo", "Thiago", "Ivan", "Nahuel", "Slave 1", "Slave 2", "Slave 3"];

type WorkerRow = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function fromRow(row: WorkerRow): Worker {
  return {
    id: row.id,
    name: row.name,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(worker: Worker): WorkerRow {
  return {
    id: worker.id,
    name: worker.name,
    active: worker.active,
    created_at: worker.createdAt,
    updated_at: worker.updatedAt
  };
}

export async function seedSupabaseWorkers() {
  if (!supabase) return;
  const { data, error } = await supabase.from("workers").select("id, name");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }

  const existingNames = new Set((data || []).map((worker) => String((worker as { name: string }).name).toLowerCase()));
  const missingNames = defaultWorkerNames.filter((name) => !existingNames.has(name.toLowerCase()));
  if (!missingNames.length) return;

  const timestamp = nowIso();
  const rows = missingNames.map((name) => ({
    name,
    active: true,
    created_at: timestamp,
    updated_at: timestamp
  }));
  console.log("Seed workers payload", rows);
  const { data: inserted, error: insertError } = await supabase.from("workers").insert(rows).select("id, name");
  console.log("Seed workers response", inserted);
  if (insertError) {
    setSupabaseStatus({ connected: false, error: insertError.message });
    console.error("Supabase error:", insertError.message);
    throw insertError;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}

export async function listWorkers() {
  if (!isSupabaseConfigured || !supabase) {
    console.log("Using Local mode");
    await seedWorkers();
    return db.workers.orderBy("name").toArray();
  }

  console.log("Using Supabase mode");
  await seedSupabaseWorkers();
  const { data, error } = await supabase.from("workers").select("*").order("name");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  console.log(`Loaded ${data?.length || 0} workers from Supabase`);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return (data || []).map((row) => fromRow(row as WorkerRow));
}

export async function saveWorker(worker: Worker) {
  if (!isSupabaseConfigured || !supabase) {
    await db.workers.put({ ...worker, updatedAt: nowIso() });
    return;
  }

  const { error } = await supabase.from("workers").upsert(toRow({ ...worker, updatedAt: nowIso() }));
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}

export async function addWorker(name: string) {
  const timestamp = nowIso();
  if (!isSupabaseConfigured || !supabase) {
    await db.workers.add({
      id: crypto.randomUUID(),
      name: name.trim(),
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return;
  }

  const { error } = await supabase.from("workers").insert({
    name: name.trim(),
    active: true,
    created_at: timestamp,
    updated_at: timestamp
  });
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}

export async function deleteWorker(workerId: string) {
  if (!isSupabaseConfigured || !supabase) {
    await db.workers.delete(workerId);
    const events = await db.events.toArray();
    await Promise.all(events.map((event) => db.events.put({
      ...event,
      confirmedWorkerIds: (event.confirmedWorkerIds || []).filter((id) => id !== workerId),
      updatedAt: nowIso()
    })));
    return;
  }

  const { error: eventWorkerError } = await supabase.from("event_workers").delete().eq("worker_id", workerId);
  if (eventWorkerError) {
    setSupabaseStatus({ connected: false, error: eventWorkerError.message });
    console.error("Supabase error:", eventWorkerError.message);
    throw eventWorkerError;
  }
  const { error } = await supabase.from("workers").delete().eq("id", workerId);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}
