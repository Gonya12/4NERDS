import type { Worker } from "../../types/models";
import { nowIso } from "../../utils/normalize";
import { db, seedWorkers } from "../storage/localDb";
import { isSupabaseConfigured, recordSupabaseRequest, setSupabaseStatus, supabase } from "../../utils/supabase";

const defaultWorkerNames = ["Gonzalo", "Thiago", "Ivan", "Nahuel", "Slave 1", "Slave 2", "Slave 3"];
const workerCacheKey = "4nerds_workers_cache_v1";
let workersSeedChecked = false;
let workerMemoryCache: Worker[] | null = null;
let workerMemoryCacheAt = 0;
const workerCacheMs = 60_000;

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
  recordSupabaseRequest("workers", "seedSupabaseWorkers:select", data?.length || 0);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }

  const existingNames = new Set((data || []).map((worker) => String((worker as { name: string }).name).toLowerCase()));
  const missingNames = defaultWorkerNames.filter((name) => !existingNames.has(name.toLowerCase()));
  if (!missingNames.length) {
    workersSeedChecked = true;
    return;
  }

  const timestamp = nowIso();
  const rows = missingNames.map((name) => ({
    name,
    active: true,
    created_at: timestamp,
    updated_at: timestamp
  }));
  const { data: inserted, error: insertError } = await supabase.from("workers").insert(rows).select("id, name");
  recordSupabaseRequest("workers", "seedSupabaseWorkers:insert", inserted?.length || 0);
  void inserted;
  if (insertError) {
    setSupabaseStatus({ connected: false, error: insertError.message });
    console.error("Supabase error:", insertError.message);
    throw insertError;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  workersSeedChecked = true;
}

function getCachedWorkers() {
  if (workerMemoryCache && Date.now() - workerMemoryCacheAt < workerCacheMs) return workerMemoryCache;
  try {
    const cached = JSON.parse(localStorage.getItem(workerCacheKey) || "[]") as Worker[];
    if (cached.length) {
      workerMemoryCache = cached;
      workerMemoryCacheAt = Date.now();
      return cached;
    }
  } catch {
    return [] as Worker[];
  }
  return [] as Worker[];
}

function cacheWorkers(workers: Worker[]) {
  workerMemoryCache = workers;
  workerMemoryCacheAt = Date.now();
  try { localStorage.setItem(workerCacheKey, JSON.stringify(workers)); } catch { /* Cache is optional. */ }
}

function invalidateWorkerCache() {
  workerMemoryCache = null;
  workerMemoryCacheAt = 0;
  try { localStorage.removeItem(workerCacheKey); } catch { /* Cache is optional. */ }
}

export async function listWorkers(force = false) {
  if (!isSupabaseConfigured || !supabase) {
    await seedWorkers();
    return db.workers.orderBy("name").toArray();
  }

  if (!force) {
    const cached = getCachedWorkers();
    if (cached.length && Date.now() - workerMemoryCacheAt < workerCacheMs) {
      setSupabaseStatus({ cacheStatus: `Loaded ${cached.length} cached workers` });
      return cached;
    }
  }
  if (!workersSeedChecked) await seedSupabaseWorkers();
  const { data, error } = await supabase.from("workers").select("*").order("name");
  recordSupabaseRequest("workers", "listWorkers", data?.length || 0);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  const workers = (data || []).map((row) => fromRow(row as WorkerRow));
  cacheWorkers(workers);
  return workers;
}

export async function saveWorker(worker: Worker) {
  if (!isSupabaseConfigured || !supabase) {
    await db.workers.put({ ...worker, updatedAt: nowIso() });
    return;
  }

  const { error } = await supabase.from("workers").upsert(toRow({ ...worker, updatedAt: nowIso() }));
  recordSupabaseRequest("workers", "saveWorker");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  invalidateWorkerCache();
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
  recordSupabaseRequest("workers", "addWorker");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  invalidateWorkerCache();
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
  recordSupabaseRequest("event_workers", "deleteWorker:deleteEventWorkers");
  if (eventWorkerError) {
    setSupabaseStatus({ connected: false, error: eventWorkerError.message });
    console.error("Supabase error:", eventWorkerError.message);
    throw eventWorkerError;
  }
  const { error } = await supabase.from("workers").delete().eq("id", workerId);
  recordSupabaseRequest("workers", "deleteWorker");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  invalidateWorkerCache();
  setSupabaseStatus({ connected: true, error: "", synced: true });
}
