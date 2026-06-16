import { CalendarSync, Edit, ExternalLink, MapPinned, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "../components/ErrorState";
import { LoadingScreen } from "../components/LoadingScreen";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { deleteCalendarFeed, listCalendarFeeds, saveCalendarFeed, syncCalendarFeed } from "../services/database/calendarFeedRepository";
import type { CalendarFeed } from "../types/models";
import { nowIso } from "../utils/normalize";
import { njPokemonCalendar, njPokemonEventsMap } from "../data/njPokemonSources";
import { actionCooldownRemainingSeconds, canRunAction, markActionRun, recordPageLoad } from "../utils/supabase";

const emptyDraft = { name: "", icsUrl: "", enabled: true, autoImport: false };

export function CalendarFeedsPage() {
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CalendarFeed | "new" | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState("");

  async function load() {
    recordPageLoad("Calendar Feeds");
    setError("");
    try {
      setFeeds(await listCalendarFeeds());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load calendar feeds.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openForm(feed?: CalendarFeed) {
    setEditing(feed || "new");
    setDraft(feed ? { name: feed.name, icsUrl: feed.icsUrl, enabled: feed.enabled, autoImport: feed.autoImport } : emptyDraft);
    setError("");
  }

  async function saveDraft() {
    if (!draft.name.trim() || !draft.icsUrl.trim()) {
      setError("Feed name and public ICS URL are required.");
      return;
    }
    try {
      new URL(draft.icsUrl);
    } catch {
      setError("Enter a valid public ICS URL.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const timestamp = nowIso();
      const existing = editing && editing !== "new" ? editing : undefined;
      await saveCalendarFeed({
        id: existing?.id || crypto.randomUUID(),
        name: draft.name.trim(),
        icsUrl: draft.icsUrl.trim(),
        enabled: draft.enabled,
        autoImport: draft.autoImport,
        lastCheckedAt: existing?.lastCheckedAt,
        lastStatus: existing?.lastStatus,
        lastError: existing?.lastError,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      });
      setEditing(null);
      setResult("Calendar feed saved.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save calendar feed.");
    } finally {
      setSaving(false);
    }
  }

  async function sync(feed: CalendarFeed) {
    const key = `calendar-sync:${feed.id}`;
    if (!canRunAction(key, 60_000)) {
      setResult(`Calendar sync was just run. Try again in ${actionCooldownRemainingSeconds(key, 60_000)}s.`);
      return;
    }
    markActionRun(key);
    setSyncingId(feed.id);
    setProgress("Reading calendar feed...");
    setResult("");
    setError("");
    try {
      const summary = await syncCalendarFeed(feed, setProgress);
      setResult(`Found ${summary.found} events. ${summary.imported} imported, ${summary.duplicates} duplicates skipped, ${summary.review} ready for review.`);
      await load();
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Could not sync calendar feed.";
      await load();
      setError(message);
    } finally {
      setSyncingId("");
      setProgress("");
    }
  }

  if (loading) return <LoadingScreen label="Loading calendar feeds..." />;

  return (
    <div className="space-y-5 lg:mx-auto lg:max-w-6xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-coral">Imports</p>
          <h1 className="text-3xl font-black text-ink dark:text-white">Calendar Feeds</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Import public Google Calendar or ICS event feeds without signing in.</p>
        </div>
        <button onClick={() => openForm()} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-coral px-4 text-sm font-black text-white"><Plus size={17} /> Add Feed</button>
      </header>

      <div className="flex items-center justify-between gap-3">
        <SyncStatusBadge syncing={Boolean(syncingId)} label={progress || "Syncing calendar..."} />
        <Link to="/nj-calendar" className="ml-auto rounded-full bg-white px-3 py-2 text-xs font-black text-ink shadow-soft dark:bg-slate-900 dark:text-white">View NJ Calendar</Link>
      </div>

      <section className="grid gap-2 sm:grid-cols-2">
        <a href={njPokemonCalendar.embedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-ink shadow-soft dark:bg-slate-900 dark:text-white"><ExternalLink size={17} /> Open Original Google Calendar</a>
        <a href={njPokemonEventsMap.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-ink shadow-soft dark:bg-slate-900 dark:text-white"><MapPinned size={17} /> Open NJ Pokémon Events Map</a>
      </section>

      {result ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">{result}</p> : null}
      {error ? <ErrorState message="Calendar feed action failed." details={error} onRetry={load} /> : null}

      {feeds.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-7 text-center dark:border-slate-700 dark:bg-slate-900">
          <CalendarSync className="mx-auto text-coral" size={32} />
          <h2 className="mt-3 font-black text-ink dark:text-white">No calendar feeds yet</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Add a public iCal URL to find upcoming events.</p>
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2">
          {feeds.map((feed) => (
            <article key={feed.id} className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${feed.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"}`}>{feed.enabled ? "Enabled" : "Disabled"}</span>
                    {feed.autoImport ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700 dark:bg-sky-950 dark:text-sky-200">Auto-import</span> : null}
                  </div>
                  <h2 className="mt-2 font-black text-ink dark:text-white">{feed.name}</h2>
                  <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{feed.icsUrl}</p>
                </div>
                <button onClick={() => openForm(feed)} className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800" aria-label={`Edit ${feed.name}`}><Edit size={16} /></button>
              </div>
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-950/70">
                <p><strong>Last checked:</strong> {feed.lastCheckedAt ? new Date(feed.lastCheckedAt).toLocaleString() : "Never"}</p>
                <p className="mt-1"><strong>Last result:</strong> {feed.lastStatus || "Not synced yet"}</p>
                {feed.lastError ? <details className="mt-1 text-rose-600 dark:text-rose-300"><summary className="cursor-pointer font-bold">Error details</summary>{feed.lastError}</details> : null}
              </div>
              <div className="mt-3 grid grid-cols-[1fr_44px] gap-2">
                <button onClick={() => void sync(feed)} disabled={!feed.enabled || syncingId === feed.id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-black text-white disabled:opacity-50 dark:bg-coral"><RefreshCw size={16} className={syncingId === feed.id ? "animate-spin" : ""} /> Sync Now</button>
                <button onClick={async () => { if (window.confirm(`Delete ${feed.name}?`)) { await deleteCalendarFeed(feed.id); await load(); } }} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-200" aria-label={`Delete ${feed.name}`}><Trash2 size={16} /></button>
              </div>
              {feed.icsUrl === njPokemonCalendar.icsUrl ? <a href={njPokemonCalendar.embedUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-xs font-black text-ink dark:bg-slate-800 dark:text-white"><ExternalLink size={14} /> Open Original Google Calendar</a> : null}
            </article>
          ))}
        </section>
      )}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm lg:items-center lg:justify-center">
          <section className="mx-auto w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-bold text-coral">Calendar Feed</p><h2 className="text-2xl font-black text-ink dark:text-white">{editing === "new" ? "Add Feed" : "Edit Feed"}</h2></div>
              <button onClick={() => setEditing(null)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
            </div>
            <div className="mt-5 space-y-3">
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Feed name" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <input value={draft.icsUrl} onChange={(event) => setDraft({ ...draft, icsUrl: event.target.value })} placeholder="Public iCal / ICS URL" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <label className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm font-bold dark:bg-slate-950/70"><span>Enabled</span><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /></label>
              <label className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm font-bold dark:bg-slate-950/70"><span>Auto-import new events</span><input type="checkbox" checked={draft.autoImport} onChange={(event) => setDraft({ ...draft, autoImport: event.target.checked })} /></label>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => setEditing(null)} className="min-h-11 rounded-xl bg-slate-100 font-bold dark:bg-slate-800">Cancel</button>
              <button onClick={saveDraft} disabled={saving} className="min-h-11 rounded-xl bg-coral font-black text-white disabled:opacity-60">{saving ? "Saving..." : "Save Feed"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
