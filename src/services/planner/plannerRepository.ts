import type { Event, Worker } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { db, seedWorkers } from "../storage/localDb";

export async function listPlannerEvents() {
  const events = await db.events.orderBy("startDate").toArray();
  return events.map((event) => ({ ...event, confirmedWorkerIds: event.confirmedWorkerIds || [], eventCost: event.eventCost || 0, paymentRecords: event.paymentRecords || [] }));
}

export async function getPlannerEvent(eventId: string) {
  const event = await db.events.get(eventId);
  return event ? { ...event, confirmedWorkerIds: event.confirmedWorkerIds || [], eventCost: event.eventCost || 0, paymentRecords: event.paymentRecords || [] } : undefined;
}

export async function savePlannerEvent(event: Event) {
  await db.events.put({ ...event, confirmedWorkerIds: event.confirmedWorkerIds || [], eventCost: event.eventCost || 0, paymentRecords: event.paymentRecords || [], updatedAt: nowIso() });
}

export async function deletePlannerEvent(eventId: string) {
  await db.events.delete(eventId);
}

export async function listWorkers() {
  await seedWorkers();
  return db.workers.orderBy("name").toArray();
}

export async function activeWorkers() {
  return (await listWorkers()).filter((worker) => worker.active);
}

export async function saveWorker(worker: Worker) {
  await db.workers.put({ ...worker, updatedAt: nowIso() });
}

export async function addWorker(name: string) {
  const timestamp = nowIso();
  await db.workers.add({
    id: id("worker"),
    name: name.trim(),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export async function deleteWorker(workerId: string) {
  await db.workers.delete(workerId);
  const events = await db.events.toArray();
  await Promise.all(events.map((event) => db.events.put({
    ...event,
    confirmedWorkerIds: (event.confirmedWorkerIds || []).filter((id) => id !== workerId),
    updatedAt: nowIso()
  })));
}

export async function clearPlannerData() {
  await Promise.all([
    db.events.clear(),
    db.workers.clear()
  ]);
  await seedWorkers();
}
