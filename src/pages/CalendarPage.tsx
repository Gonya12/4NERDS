import { CalendarDays, CalendarSync, MapPin, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "../components/ErrorState";
import { LoadingScreen } from "../components/LoadingScreen";
import { SkeletonCard } from "../components/SkeletonCard";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { getCachedPlannerHomeEvents, listPlannerEvents, listWorkers } from "../services/planner/plannerRepository";
import type { Event, EventDay, Worker } from "../types/models";
import { workersForDay } from "../utils/availability";
import { eventDays, formatEventDay } from "../utils/eventSchedule";
import { eventStage, eventStageAccentClasses, eventStageLabels } from "../utils/eventStage";

type CalendarFilter = "upcoming" | "week" | "month" | "imported" | "manual";

export function CalendarPage() {
  const [events, setEvents] = useState<Event[]>(() => getCachedPlannerHomeEvents());
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [filter, setFilter] = useState<CalendarFilter>("upcoming");
  const [loading, setLoading] = useState(events.length === 0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setSyncing(true);
    setError("");
    try {
      const [eventRows, workerRows] = await Promise.all([listPlannerEvents(), listWorkers()]);
      setEvents(eventRows);
      setWorkers(workerRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load events.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const agenda = useMemo(() => {
    const today = startOfDay(new Date());
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    return events
      .flatMap((event) => eventDays(event).map((day) => ({ event, day })))
      .filter(({ event, day }) => {
        const date = startOfDay(new Date(`${day.date.slice(0, 10)}T12:00:00`));
        if (filter === "upcoming") return date >= today;
        if (filter === "week") return date >= today && date < weekEnd;
        if (filter === "month") return date >= today && date < monthEnd;
        if (filter === "imported") return Boolean(event.importedFromCalendar);
        return !event.importedFromCalendar;
      })
      .sort((a, b) => a.day.date.localeCompare(b.day.date));
  }, [events, filter]);

  const groups = useMemo(() => agenda.reduce<Record<string, Array<{ event: Event; day: EventDay }>>>((acc, item) => {
    const key = item.day.date.slice(0, 10);
    acc[key] = [...(acc[key] || []), item];
    return acc;
  }, {}), [agenda]);

  function jumpToday() {
    setFilter("upcoming");
    window.setTimeout(() => document.getElementById(`agenda-${localDate(new Date())}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return (
    <div className="space-y-5 lg:mx-auto lg:max-w-6xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-coral">Planner</p>
          <h1 className="text-3xl font-black text-ink dark:text-white">Events Calendar</h1>
        </div>
        <Link to="/nj-calendar" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-ink shadow-soft dark:bg-slate-900 dark:text-white"><CalendarSync size={17} /> NJ Calendar</Link>
      </header>

      <section className="sticky top-0 z-10 -mx-4 space-y-3 border-y border-slate-200 bg-paper/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:mx-0 lg:rounded-2xl lg:border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2 overflow-x-auto">
            {(["upcoming", "week", "month", "imported", "manual"] as CalendarFilter[]).map((value) => (
              <button key={value} onClick={() => setFilter(value)} className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-black ${filter === value ? "bg-ink text-white dark:bg-coral" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>
                {value === "week" ? "This week" : value === "month" ? "This month" : value.charAt(0).toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <SyncStatusBadge syncing={syncing} />
        </div>
        <div className="flex gap-2">
          <button onClick={jumpToday} className="min-h-9 rounded-xl bg-white px-3 text-xs font-bold text-ink shadow-soft dark:bg-slate-900 dark:text-white">Today</button>
          <button onClick={load} disabled={syncing} className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-white px-3 text-xs font-bold text-ink shadow-soft disabled:opacity-50 dark:bg-slate-900 dark:text-white"><RefreshCw size={14} /> Refresh</button>
        </div>
      </section>

      {error ? <ErrorState message="Events could not be refreshed." details={error} onRetry={load} onSync={load} /> : null}
      {loading ? <LoadingScreen label="Loading calendar events..."><div className="grid gap-3 md:grid-cols-2"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div></LoadingScreen> : null}

      {!loading && agenda.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-7 text-center dark:border-slate-700 dark:bg-slate-900">
          <CalendarDays className="mx-auto text-coral" size={32} />
          <p className="mt-3 font-black text-ink dark:text-white">No events match this view.</p>
        </section>
      ) : null}

      {!loading && Object.entries(groups).map(([date, items]) => (
        <section id={`agenda-${date}`} key={date} className="scroll-mt-32">
          <h2 className="sticky top-[116px] z-[5] mb-2 bg-paper/95 py-2 text-sm font-black uppercase text-slate-500 backdrop-blur dark:bg-slate-950/95 dark:text-slate-400 lg:top-24">{dateHeading(date)}</h2>
          <div className="space-y-2">
            {items.map(({ event, day }) => <AgendaRow key={`${event.id}:${day.id}`} event={event} day={day} workers={workers} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function AgendaRow({ event, day, workers }: { event: Event; day: EventDay; workers: Worker[] }) {
  const stage = eventStage(event.eventStage);
  const confirmed = workersForDay(event, day.id, workers);
  return (
    <Link to={`/events/${event.id}`} className="relative block overflow-hidden rounded-2xl border border-white/70 bg-white/90 p-4 pl-5 shadow-soft transition active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${eventStageAccentClasses[stage]}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black text-white ${eventStageAccentClasses[stage]}`}>{eventStageLabels[stage]}</span>
            {event.importedFromCalendar ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700 dark:bg-sky-950 dark:text-sky-200">Imported</span> : null}
          </div>
          <h3 className="mt-2 font-black text-ink dark:text-white">{event.name}</h3>
          <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">{formatEventDay(day)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 dark:text-slate-400">
        <p className="flex items-center gap-2"><MapPin size={14} /> {[event.venueName, event.city, event.state].filter(Boolean).join(", ") || "Location not set"}</p>
        <p className="flex items-center gap-2"><Users size={14} /> {confirmed.length ? confirmed.map((worker) => worker.name).join(", ") : "Nobody confirmed"}</p>
      </div>
    </Link>
  );
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateHeading(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}
