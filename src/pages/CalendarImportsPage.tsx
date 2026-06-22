import { CalendarCheck, Clock, MapPin, MapPinned, Pencil, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { ignoreCalendarCandidate, listCalendarCandidates, saveCalendarCandidate, saveCalendarCandidates } from "../services/database/calendarFeedRepository";
import type { CalendarImportCandidate } from "../types/models";
import { displayDateTime } from "../utils/dateUtils";
import { njPokemonEventsMap } from "../data/njPokemonSources";
import { safeDateFromLocalInput } from "../utils/browserCompat";

export function CalendarImportsPage() {
  const [candidates, setCandidates] = useState(() => listCalendarCandidates());
  const [editing, setEditing] = useState<CalendarImportCandidate | null>(null);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pending = useMemo(() => candidates.filter((candidate) => candidate.reviewStatus === "pending"), [candidates]);

  function reload() {
    setCandidates(listCalendarCandidates());
  }

  async function save(candidate: CalendarImportCandidate) {
    setSavingId(candidate.id);
    setError("");
    try {
      await saveCalendarCandidate(candidate);
      setMessage(`${candidate.title} was added to Events.`);
      setEditing(null);
      reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save imported event.");
    } finally {
      setSavingId("");
    }
  }

  function updateCandidate(candidate: CalendarImportCandidate) {
    const next = candidates.map((item) => item.id === candidate.id ? candidate : item);
    saveCalendarCandidates(next);
    setCandidates(next);
    setEditing(candidate);
  }

  return (
    <div className="space-y-5 lg:mx-auto lg:max-w-6xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-coral">Review</p>
          <h1 className="text-3xl font-black text-ink dark:text-white">Calendar Imports</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Review imported events before adding them to your schedule.</p>
        </div>
        <Link to="/calendar-feeds" className="shrink-0 rounded-xl bg-white px-3 py-3 text-sm font-black text-ink shadow-soft dark:bg-slate-900 dark:text-white">Feeds</Link>
      </header>

      {message ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{error}</p> : null}

      {pending.length === 0 ? <EmptyState title="Nothing to review. Sync a calendar feed to look for new events." action={<Link to="/calendar-feeds" className="rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white dark:bg-coral">Open Calendar Feeds</Link>} /> : null}

      <section className="grid gap-3 md:grid-cols-2">
        {pending.map((candidate) => (
          <article key={candidate.id} className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700 dark:bg-sky-950 dark:text-sky-200">Imported</span>
              {candidate.duplicate ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-800 dark:bg-amber-950 dark:text-amber-200">Duplicate found</span> : null}
            </div>
            <h2 className="mt-3 text-lg font-black text-ink dark:text-white">{candidate.title}</h2>
            <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <p className="flex items-center gap-2"><CalendarCheck size={16} /> {displayDateTime(candidate.start)}</p>
              {candidate.end ? <p className="flex items-center gap-2"><Clock size={16} /> Ends {displayDateTime(candidate.end)}</p> : null}
              <p className="flex items-center gap-2"><MapPin size={16} /> {candidate.location || "Location not provided"}</p>
              <p className="text-xs font-bold text-slate-400">{candidate.calendarFeedName}</p>
            </div>
            {!candidate.location ? <a href={njPokemonEventsMap.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-xs font-black text-ink dark:bg-slate-800 dark:text-white"><MapPinned size={15} /> Open NJ Pokémon Events Map</a> : null}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={() => void save(candidate)} disabled={candidate.duplicate || savingId === candidate.id} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-coral text-xs font-black text-white disabled:opacity-40"><Save size={14} /> Save</button>
              <button onClick={() => setEditing(candidate)} disabled={candidate.duplicate} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-xs font-black text-ink disabled:opacity-40 dark:bg-slate-800 dark:text-white"><Pencil size={14} /> Edit & Save</button>
              <button onClick={() => { ignoreCalendarCandidate(candidate.id); reload(); }} className="min-h-11 rounded-xl bg-slate-100 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">Ignore</button>
            </div>
          </article>
        ))}
      </section>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm lg:items-center lg:justify-center">
          <section className="mx-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-bold text-coral">Calendar Import</p><h2 className="text-2xl font-black text-ink dark:text-white">Edit Before Saving</h2></div>
              <button onClick={() => setEditing(null)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
            </div>
            <div className="mt-5 space-y-3">
              <input value={editing.title} onChange={(event) => updateCandidate({ ...editing, title: event.target.value })} placeholder="Event name" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <input type="datetime-local" value={toLocalInput(editing.start)} onChange={(event) => updateCandidate({ ...editing, start: safeDateFromLocalInput(event.target.value).toISOString() })} className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <input type="datetime-local" value={editing.end ? toLocalInput(editing.end) : ""} onChange={(event) => updateCandidate({ ...editing, end: event.target.value ? safeDateFromLocalInput(event.target.value).toISOString() : undefined })} className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <input value={editing.location || ""} onChange={(event) => updateCandidate({ ...editing, location: event.target.value })} placeholder="Location" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <textarea value={editing.description || ""} onChange={(event) => updateCandidate({ ...editing, description: event.target.value })} placeholder="Notes" className="min-h-28 w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => setEditing(null)} className="min-h-11 rounded-xl bg-slate-100 font-bold dark:bg-slate-800">Cancel</button>
              <button onClick={() => void save(editing)} disabled={!editing.title.trim() || Boolean(savingId)} className="min-h-11 rounded-xl bg-coral font-black text-white disabled:opacity-50">{savingId ? "Saving..." : "Save Event"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
