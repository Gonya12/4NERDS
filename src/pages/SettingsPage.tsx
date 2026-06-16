import { BarChart3, Bell, CalendarSync, Download, Images, MapPinned, Plus, RefreshCw, Trash2, Upload, Wifi, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addWorker, clearPlannerData, deleteWorker, listPlannerEvents, listPlannerHomeEvents, listWorkers, saveWorker, seedTeamWorkers } from "../services/planner/plannerRepository";
import { exportBackup, importBackup } from "../services/storage/backupService";
import { deleteLocation, listLocations, saveLocation } from "../services/database/locationRepository";
import { actionCooldownRemainingSeconds, canRunAction, getSupabaseStatus, markActionRun, recordPageLoad, testSupabaseConnection } from "../utils/supabase";
import { scheduleSmartEventNotifications } from "../services/notifications/smartNotificationService";
import { useTheme } from "../services/theme/ThemeProvider";
import type { ThemePreference } from "../services/theme/themeService";
import type { Location, Worker } from "../types/models";
import { nowIso } from "../utils/normalize";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { njPokemonEventsMap } from "../data/njPokemonSources";

export function SettingsPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [newWorker, setNewWorker] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [editingLocation, setEditingLocation] = useState<Location | "new" | null>(null);
  const [locationDraft, setLocationDraft] = useState({
    name: "",
    venueName: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    instagramHandle: "",
    notes: ""
  });
  const [locationMessage, setLocationMessage] = useState("");
  const [locationError, setLocationError] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);
  const [syncStatus, setSyncStatus] = useState(getSupabaseStatus());
  const [syncMessage, setSyncMessage] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const { theme, setTheme } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    recordPageLoad("Settings");
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

  function openLocationForm(location?: Location) {
    setLocationMessage("");
    setLocationError("");
    setEditingLocation(location || "new");
    setLocationDraft({
      name: location?.name || "",
      venueName: location?.venueName || "",
      address: location?.address || "",
      city: location?.city || "",
      state: location?.state || "",
      zip: location?.zip || "",
      instagramHandle: location?.instagramHandle || "",
      notes: location?.notes || ""
    });
  }

  function closeLocationForm() {
    setEditingLocation(null);
    setLocationError("");
    setSavingLocation(false);
  }

  async function saveLocationDraft() {
    setLocationError("");
    setLocationMessage("");
    const name = locationDraft.name.trim();
    if (!name) {
      setLocationError("Location name is required.");
      return;
    }

    const normalizedName = name.toLowerCase();
    const normalizedAddress = locationDraft.address.trim().toLowerCase();
    const currentId = editingLocation && editingLocation !== "new" ? editingLocation.id : "";
    const duplicate = locations.find((location) => {
      if (location.id === currentId) return false;
      const sameName = location.name.trim().toLowerCase() === normalizedName;
      const sameAddress = normalizedAddress && (location.address || "").trim().toLowerCase() === normalizedAddress;
      return sameName || Boolean(sameAddress);
    });
    if (duplicate) {
      setLocationError("A location with the same name or address already exists.");
      return;
    }

    setSavingLocation(true);
    try {
      const timestamp = nowIso();
      await saveLocation({
        id: currentId || crypto.randomUUID(),
        name,
        venueName: locationDraft.venueName.trim() || undefined,
        address: locationDraft.address.trim() || undefined,
        city: locationDraft.city.trim() || undefined,
        state: locationDraft.state.trim() || undefined,
        zip: locationDraft.zip.trim() || undefined,
        instagramHandle: locationDraft.instagramHandle.trim() || undefined,
        notes: locationDraft.notes.trim() || undefined,
        createdAt: editingLocation && editingLocation !== "new" ? editingLocation.createdAt : timestamp,
        updatedAt: timestamp
      });
      await load();
      setLocationMessage("Location saved");
      setEditingLocation(null);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Could not save location.");
    } finally {
      setSavingLocation(false);
    }
  }

  async function testConnection() {
    if (!canRunAction("settings-test-connection", 30_000)) {
      setSyncMessage(`Please wait ${actionCooldownRemainingSeconds("settings-test-connection", 30_000)}s before testing again.`);
      return;
    }
    markActionRun("settings-test-connection");
    setSyncBusy(true);
    setSyncMessage("Testing Supabase connection...");
    try {
      const result = await testSupabaseConnection();
      setSyncStatus(getSupabaseStatus());
      setSyncMessage(result.ok ? "Supabase connection works." : result.error);
    } finally {
      setSyncBusy(false);
    }
  }

  async function syncNow() {
    if (!canRunAction("settings-sync-now", 45_000)) {
      setSyncMessage(`Please wait ${actionCooldownRemainingSeconds("settings-sync-now", 45_000)}s before syncing again.`);
      return;
    }
    markActionRun("settings-sync-now");
    setSyncBusy(true);
    setSyncMessage("Syncing...");
    try {
      const [events, workerRows] = await Promise.all([listPlannerHomeEvents(100), listWorkers(true)]);
      setWorkers(workerRows);
      setSyncStatus(getSupabaseStatus());
      setSyncMessage(`Synced ${events.length} events and ${workerRows.length} workers.`);
    } catch (error) {
      setSyncStatus(getSupabaseStatus());
      setSyncMessage(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncBusy(false);
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
    <div className="space-y-5 lg:mx-auto lg:max-w-6xl">
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
        <div>
          <p className="text-sm font-bold text-coral">Imports</p>
          <h2 className="font-black text-ink dark:text-white">Calendar Feeds</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Connect public Google Calendar or ICS feeds and review new events.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link to="/calendar-feeds" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-black text-white dark:bg-coral"><CalendarSync size={17} /> Manage Feeds</Link>
          <Link to="/nj-calendar" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-ink dark:bg-slate-800 dark:text-white">View NJ Calendar</Link>
        </div>
        <a href={njPokemonEventsMap.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-black text-ink dark:bg-slate-800 dark:text-white"><MapPinned size={17} /> Open NJ Pokémon Events Map</a>
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
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Last sync duration</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.lastSyncDurationMs ? `${syncStatus.lastSyncDurationMs}ms` : "Not measured"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Events loaded</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.lastEventsLoaded}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Queries made</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.lastQueryCount}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Supabase requests this session</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.sessionRequestCount}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Last page loaded</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.lastPageLoaded || "Not tracked yet"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
            <p className="text-xs font-bold text-slate-500">Cache status</p>
            <p className="font-black text-ink dark:text-white">{syncStatus.cacheStatus}</p>
          </div>
        </div>
        {(syncStatus.error || syncMessage) && (
          <p className={`rounded-xl p-3 text-sm font-bold ${syncStatus.error ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200" : "bg-slate-50 text-slate-600 dark:bg-slate-950/70 dark:text-slate-300"}`}>
            {syncStatus.error || syncMessage}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={testConnection} disabled={syncBusy} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-ink text-sm font-bold text-white disabled:opacity-50"><Wifi size={16} /> Test Connection</button>
          <button onClick={syncNow} disabled={syncBusy} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-coral text-sm font-bold text-white disabled:opacity-50"><RefreshCw size={16} className={syncBusy ? "animate-spin" : ""} /> Sync Now</button>
          <button onClick={seedWorkersNow} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><Plus size={16} /> Seed Workers</button>
        </div>
        <SyncStatusBadge syncing={syncBusy} label={syncMessage || "Syncing..."} />
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
          <button onClick={() => openLocationForm()} className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white dark:bg-coral"><Plus size={15} /> Add</button>
        </div>
        {locationMessage ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">{locationMessage}</p> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {locations.map((location) => (
            <div key={location.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-ink dark:text-white">{location.name}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{[location.venueName, location.address, location.city, location.state].filter(Boolean).join(" | ") || "Venue/address not set"}</p>
                  {location.instagramHandle ? <p className="mt-1 text-xs font-bold text-coral">{location.instagramHandle}</p> : null}
                </div>
                <button onClick={() => openLocationForm(location)} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-ink dark:bg-slate-800 dark:text-white">Edit</button>
              </div>
              <button onClick={async () => { await deleteLocation(location.id); await load(); }} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-xl bg-rose-50 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200"><Trash2 size={15} /> Delete Location</button>
            </div>
          ))}
          {locations.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">No common locations saved yet.</p> : null}
        </div>
      </section>

      {editingLocation ? (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm">
          <section className="mx-auto max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-coral">Common Location</p>
                <h2 className="text-2xl font-black text-ink dark:text-white">{editingLocation === "new" ? "Add Location" : "Edit Location"}</h2>
              </div>
              <button onClick={closeLocationForm} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={16} /></button>
            </div>
            {locationError ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{locationError}</p> : null}
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">
                Location nickname *
                <input value={locationDraft.name} onChange={(e) => setLocationDraft({ ...locationDraft, name: e.target.value })} placeholder="Woodbridge Card Show" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              </label>
              <input value={locationDraft.venueName} onChange={(e) => setLocationDraft({ ...locationDraft, venueName: e.target.value })} placeholder="Venue name" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <input value={locationDraft.address} onChange={(e) => setLocationDraft({ ...locationDraft, address: e.target.value })} placeholder="Address" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <div className="grid grid-cols-3 gap-2">
                <input value={locationDraft.city} onChange={(e) => setLocationDraft({ ...locationDraft, city: e.target.value })} placeholder="City" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                <input value={locationDraft.state} onChange={(e) => setLocationDraft({ ...locationDraft, state: e.target.value })} placeholder="State" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                <input value={locationDraft.zip} onChange={(e) => setLocationDraft({ ...locationDraft, zip: e.target.value })} placeholder="ZIP" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              </div>
              <input value={locationDraft.instagramHandle} onChange={(e) => setLocationDraft({ ...locationDraft, instagramHandle: e.target.value })} placeholder="Instagram @handle" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <textarea value={locationDraft.notes} onChange={(e) => setLocationDraft({ ...locationDraft, notes: e.target.value })} placeholder="Notes" className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">Venue and address are optional, but adding them makes event creation faster.</p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={closeLocationForm} disabled={savingLocation} className="min-h-12 rounded-xl bg-slate-100 font-bold text-slate-700 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-200">Cancel</button>
              <button onClick={saveLocationDraft} disabled={savingLocation} className="min-h-12 rounded-xl bg-coral font-black text-white disabled:opacity-60">{savingLocation ? "Saving..." : "Save Location"}</button>
            </div>
          </section>
        </div>
      ) : null}

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
