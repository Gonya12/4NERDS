import type { Event, Worker } from "../../types/models";
import { clearEventsAndResetWorkers, deleteEvent, getEvent, listEvents, saveEvent } from "../database/eventRepository";
import { addWorker as addDatabaseWorker, deleteWorker as deleteDatabaseWorker, listWorkers as listDatabaseWorkers, saveWorker as saveDatabaseWorker } from "../database/workerRepository";

export async function listPlannerEvents() {
  return listEvents();
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

export async function listWorkers() {
  return listDatabaseWorkers();
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
