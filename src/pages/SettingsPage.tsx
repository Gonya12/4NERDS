import { BarChart3, Bell, Download, Images, Plus, RefreshCw, Trash2, Upload, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addWorker, clearPlannerData, deleteWorker, listPlannerEvents, listWorkers, saveWorker, seedTeamWorkers } from "../services/planner/plannerRepository";
import { exportBackup, importBackup } from "../services/storage/backupService";
import { deleteLocation, listLocations, saveLocation } from "../services/database/locationRepository";
import { getSupabaseStatus, testSupabaseConnection } from "../utils/supabase";
import { scheduleSmartEventNotifications } from "../services/notifications/smartNotificationService";
import { useTheme } from "../services/theme/ThemeProvider";
import type { ThemePreference } from "../services/theme/themeService";
import type { Location, Worker } from "../types/models";
import { nowIso } from "../utils/normalize";

export function SettingsPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [newWorker, setNewWorker] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [syncStatus, setSyncStatus] = useState(getSupabaseStatus());
  const [syncMessage, setSyncMessage] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const { theme, setTheme } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setWorkers(await listWorkers());
      setLocations(await listLocations());
      setSyncStatus(getSupabaseStatus());
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Unable to load sync data.");
      setSyncStatus(getSupabaseStatus());
    }
  }

  useEffect(() => { void load(); }, []);

  async function add() {
    if (!newWorker.trim()) return;
    await addWorker(newWorker);
    setNewWorker("");
    await load();
  }

  async function addLocationRow() {
    const timestamp = nowIso();
    await saveLocation({ id: crypto.randomUUID(), name: "New Location", createdAt: timestamp, updatedAt: timestamp });
    await load();
  }

  async function testConnection() {
    setSyncMessage("Testing Supabase connection...");
    const result = await testSupabaseConnection();
    setSyncStatus(getSupabaseStatus());
    setSyncMessage(result.ok ? "Supabase connection works." : result.error);
  }

  async function syncNow() {
    setSyncMessage("Syncing...");
    try {
      const [events, workerRows] = await Promise.all([listPlannerEvents(), listWorkers()]);
      setWorkers(workerRows);
      setSyncStatus(getSupabaseStatus());
      setSyncMessage(`Synced ${events.length} events and ${workerRows.length} workers.`);
    } catch (error) {
      setSyncStatus(getSupabaseStatus());
      setSyncMessage(error instanceof Error ? error.message : "Sync failed.");
    }
  }

  async function scheduleSmartReminders() {
    setNotificationMessage("Scheduling reminders...");
    try {
      const events = await listPlannerEvents();
      const count = await scheduleSmartEventNotifications(events);
      setNotificationMessage(count ? `Scheduled ${count} smart reminders.` : "No future reminders needed right now.");
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "Could not schedule reminders.");
    }
  }

  async function seedWorkersNow() {
    setSyncMessage("Seeding workers...");
    try {
      await seedTeamWorkers();
      await load();
      setSyncStatus(getSupabaseStatus());
      setSyncMessage("Workers seeded or already present.");
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : JSON.stringify(error);
      setSyncStatus(getSupabaseStatus());
      setSyncMessage(message);
    }
  }

  async function downloadBackup() {
    const data = await exportBackup();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `4-nerds-planner-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function clearAll() {
    if (!window.confirm("Clear all events and reset workers?")) return;
    await clearPlannerData();
    await load();
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold text-coral">Settings</p>
        <h1 className="text-3xl font-black text-ink dark:text-white">4 Nerds Planner</h1>
      </header>

      <section className="rounded-2xl bg-ink p-4 text-white shadow-soft dark:bg-slate-900">
        <p className="text-sm text-slate-300">App mode</p>
        <p className="mt-1 text-xl font-black">{syncStatus.appMode}</p>
        <p className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
          Manual event planning, {syncStatus.configured ? "shared Supabase storage" : "local-only storage"}
        </p>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-coral">Team Sync</p>
            <h2 className="font-black text-ink dark:text-white">Supabase Status</h2>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${syncStatus.connected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {syncStatus.connected ? "Connected" : syncStatus.configured ? "Failed" : "Local"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Supabase URL detected</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.urlDetected ? "Yes" : "No"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Publishable key detected</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.publishableKeyDetected ? "Yes" : "No"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Current mode</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.mode}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Supabase connected</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.connected ? "Connected" : syncStatus.configured ? "Failed" : "Not configured"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Last sync time</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.lastSyncTime ? new Date(syncStatus.lastSyncTime).toLocaleString() : "Never"}</p>
          </div>
        </div>
        {(syncStatus.error || syncMessage) && (
          <p className={`rounded-xl p-3 text-sm font-bold ${syncStatus.error ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200" : "bg-slate-50 text-slate-600 dark:bg-slate-950/70 dark:text-slate-300"}`}>
            {syncStatus.error || syncMessage}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={testConnection} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-ink text-sm font-bold text-white"><Wifi size={16} /> Test Connection</button>
          <button onClick={syncNow} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-coral text-sm font-bold text-white"><RefreshCw size={16} /> Sync Now</button>
          <button onClick={seedWorkersNow} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><Plus size={16} /> Seed Workers</button>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <div>
          <p className="text-sm font-bold text-coral">Appearance</p>
          <h2 className="font-black text-ink dark:text-white">Theme</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-950/70">
          {(["light", "dark", "system"] as ThemePreference[]).map((option) => (
            <button
              key={option}
              onClick={() => setTheme(option)}
              className={`min-h-11 rounded-xl text-sm font-black capitalize transition ${theme === option ? "bg-white text-ink shadow-soft dark:bg-slate-800 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}
            >
              {option === "system" ? "System" : option}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <div>
          <p className="text-sm font-bold text-coral">Tools</p>
          <h2 className="font-black text-ink dark:text-white">Planner Utilities</h2>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link to="/analytics" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><BarChart3 size={16} /> Analytics</Link>
          <Link to="/flyers" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><Images size={16} /> Flyers</Link>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <div>
          <p className="text-sm font-bold text-coral">Smart Notifications</p>
          <h2 className="font-black text-ink dark:text-white">Local Reminders</h2>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">Schedules local reminders for events tomorrow, events in 3 days, incomplete setup, payments, and staffing.</p>
        {notificationMessage ? <p className="rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-600 dark:bg-slate-950/70 dark:text-slate-300">{notificationMessage}</p> : null}
        <button onClick={scheduleSmartReminders} className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-xl bg-ink text-sm font-bold text-white dark:bg-coral"><Bell size={16} /> Schedule Smart Reminders</button>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <h2 className="font-black text-ink dark:text-white">Manage Workers</h2>
        <div className="flex gap-2">
          <input value={newWorker} onChange={(e) => setNewWorker(e.target.value)} placeholder="Add worker" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3" />
          <button onClick={add} className="inline-flex items-center gap-1 rounded-xl bg-ink px-4 font-bold text-white dark:bg-coral"><Plus size={17} /> Add</button>
        </div>
        <div className="space-y-2">
          {workers.map((worker) => (
            <div key={worker.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-950/70">
              <input
                value={worker.name}
                onChange={async (e) => { await saveWorker({ ...worker, name: e.target.value, updatedAt: nowIso() }); await load(); }}
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-bold text-ink dark:text-white"
              />
              <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <input type="checkbox" checked={worker.active} onChange={async (e) => { await saveWorker({ ...worker, active: e.target.checked, updatedAt: nowIso() }); await load(); }} />
                Active
              </label>
              <button onClick={async () => { await deleteWorker(worker.id); await load(); }} className="rounded-lg p-2 text-rose-700"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-coral">Common Locations</p>
            <h2 className="font-black text-ink dark:text-white">Saved Places</h2>
          </div>
          <button onClick={addLocationRow} className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white dark:bg-coral"><Plus size={15} /> Add</button>
        </div>
        <div className="space-y-3">
          {locations.map((location) => (
            <div key={location.id} className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
              <input value={location.name} onChange={async (e) => { await saveLocation({ ...location, name: e.target.value }); await load(); }} placeholder="Name" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input value={location.venueName || ""} onChange={async (e) => { await saveLocation({ ...location, venueName: e.target.value }); await load(); }} placeholder="Venue name" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <input value={location.address || ""} onChange={async (e) => { await saveLocation({ ...location, address: e.target.value }); await load(); }} placeholder="Address" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <div className="grid grid-cols-3 gap-2">
                <input value={location.city || ""} onChange={async (e) => { await saveLocation({ ...location, city: e.target.value }); await load(); }} placeholder="City" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <input value={location.state || ""} onChange={async (e) => { await saveLocation({ ...location, state: e.target.value }); await load(); }} placeholder="State" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <input value={location.zip || ""} onChange={async (e) => { await saveLocation({ ...location, zip: e.target.value }); await load(); }} placeholder="ZIP" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <input value={location.instagramHandle || ""} onChange={async (e) => { await saveLocation({ ...location, instagramHandle: e.target.value }); await load(); }} placeholder="Instagram @handle" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <button onClick={async () => { await deleteLocation(location.id); await load(); }} className="inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-xl bg-rose-50 text-sm font-bold text-rose-700"><Trash2 size={15} /> Delete Location</button>
            </div>
          ))}
          {locations.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">No common locations saved yet.</p> : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button onClick={downloadBackup} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><Download size={16} /> Export JSON</button>
        <button onClick={() => fileRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><Upload size={16} /> Import JSON</button>
        <button onClick={clearAll} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-rose-50 text-sm font-bold text-rose-700"><Trash2 size={16} /> Clear All Data</button>
      </section>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        await importBackup(await file.text());
        await load();
      }} />

      <section className="rounded-2xl bg-white/90 p-4 text-sm text-slate-600 shadow-soft dark:bg-slate-900 dark:text-slate-300">
        <h2 className="font-black text-ink dark:text-white">About</h2>
        <p className="mt-1">A private planning app for 4 Nerds vendor events and worker availability.</p>
      </section>
    </div>
  );
}
