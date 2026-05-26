import { db, getSettings } from "./localDb";

export async function exportBackup() {
  const [events, workers, organizers, sources, candidates, scrapeLogs, settings] = await Promise.all([
    db.events.toArray(),
    db.workers.toArray(),
    db.organizers.toArray(),
    db.sources.toArray(),
    db.candidates.toArray(),
    db.scrapeLogs.toArray(),
    getSettings()
  ]);
  return JSON.stringify({ exportedAt: new Date().toISOString(), events, workers, organizers, sources, candidates, scrapeLogs, settings }, null, 2);
}

export async function importBackup(raw: string) {
  const data = JSON.parse(raw);
  if (Array.isArray(data.events)) await db.events.bulkPut(data.events);
  if (Array.isArray(data.workers)) await db.workers.bulkPut(data.workers);
  if (Array.isArray(data.organizers)) await db.organizers.bulkPut(data.organizers);
  if (Array.isArray(data.sources)) await db.sources.bulkPut(data.sources);
  if (Array.isArray(data.candidates)) await db.candidates.bulkPut(data.candidates);
  if (Array.isArray(data.scrapeLogs)) await db.scrapeLogs.bulkPut(data.scrapeLogs);
  if (data.settings) await db.settings.put(data.settings);
}
