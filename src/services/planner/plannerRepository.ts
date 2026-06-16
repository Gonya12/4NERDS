import type { Event, Worker } from "../../types/models";
import { clearEventsAndResetWorkers, deleteEvent, getCachedHomeEvents, getEvent, listEventOptions, listEvents, listHomeEvents, listPastPaidEventsPage, saveEvent } from "../database/eventRepository";
import { addWorker as addDatabaseWorker, deleteWorker as deleteDatabaseWorker, listWorkers as listDatabaseWorkers, saveWorker as saveDatabaseWorker, seedSupabaseWorkers } from "../database/workerRepository";

export async function listPlannerEvents() {
  return listEvents();
}

export function getCachedPlannerHomeEvents() {
  return getCachedHomeEvents();
}

export async function listPlannerHomeEvents(limit = 10) {
  return listHomeEvents(limit);
}

export async function listPlannerEventOptions(limit = 500) {
  return listEventOptions(limit);
}

export async function listPlannerPastPaidEventsPage(page = 0, pageSize = 20) {
  return listPastPaidEventsPage(page, pageSize);
}

export async function getPlannerEvent(eventId: string) {
  return getEvent(eventId);
}

export async function savePlannerEvent(event: Event) {
  return saveEvent(event);
}

export async function deletePlannerEvent(eventId: string) {
  return deleteEvent(eventId);
}

export async function listWorkers(force = false) {
  return listDatabaseWorkers(force);
}

export async function activeWorkers() {
  return (await listWorkers()).filter((worker) => worker.active);
}

export async function saveWorker(worker: Worker) {
  return saveDatabaseWorker(worker);
}

export async function addWorker(name: string) {
  return addDatabaseWorker(name);
}

export async function deleteWorker(workerId: string) {
  return deleteDatabaseWorker(workerId);
}

export async function clearPlannerData() {
  return clearEventsAndResetWorkers();
}

export async function seedTeamWorkers() {
  return seedSupabaseWorkers();
}
