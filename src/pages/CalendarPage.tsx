import {
  CalendarDays,
  CalendarRange,
  CalendarSync,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  List,
  MapPin,
  RefreshCw,
  Save,
  Users
} from "lucide-react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths
} from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { EventImageFrame } from "../components/EventImageFrame";
import { LoadingScreen } from "../components/LoadingScreen";
import { SkeletonCard } from "../components/SkeletonCard";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import {
  listCalendarCandidates,
  saveCalendarCandidate
} from "../services/database/calendarFeedRepository";
import { getCachedPlannerHomeEvents, listPlannerEventOptions, listWorkers } from "../services/planner/plannerRepository";
import type { CalendarImportCandidate, Event, EventDay, EventStage, Worker } from "../types/models";
import { effectiveConfirmedWorkerIds, workersForDay } from "../utils/availability";
import { isPaidOrConfirmedEvent } from "../utils/eventCommitment";
import { eventDays, formatEventDay } from "../utils/eventSchedule";
import { eventStageAccentClasses, eventStageLabels } from "../utils/eventStage";
import { calculatePaymentSummary, formatMoney } from "../utils/paymentMath";
import { actionCooldownRemainingSeconds, canRunAction, markActionRun, recordPageLoad } from "../utils/supabase";

type CalendarView = "month" | "agenda";
type CalendarFilter = "all" | "paid" | "new" | "applied" | "imported" | "manual" | "week" | "month";
type SavedEntry = { kind: "saved"; id: string; date: string; event: Event; day: EventDay };
type ImportEntry = { kind: "import"; id: string; date: string; candidate: CalendarImportCandidate };
type CalendarEntry = SavedEntry | ImportEntry;

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarPage() {
  const cached = getCachedPlannerHomeEvents();
  const [events, setEvents] = useState<Event[]>(cached);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [imports, setImports] = useState<CalendarImportCandidate[]>(() => pendingImports());
  const [view, setView] = useState<CalendarView>("month");
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [loading, setLoading] = useState(cached.length === 0);
  const [syncing, setSyncing] = useState(false);
  const [savingImportId, setSavingImportId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(manual = false) {
    recordPageLoad("Event Calendar");
    if (manual) {
      const key = "event-calendar-refresh";
      if (!canRunAction(key, 30_000)) {
        setError(`Please wait ${actionCooldownRemainingSeconds(key, 30_000)}s before refreshing again.`);
        return;
      }
      markActionRun(key);
    }
    setSyncing(true);
    setError("");
    try {
      const [eventRows, workerRows] = await Promise.all([listPlannerEventOptions(500), listWorkers()]);
      setEvents(eventRows);
      setWorkers(workerRows);
      setImports(pendingImports());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load events.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const entries = useMemo<CalendarEntry[]>(() => [
    ...events.flatMap((event) => eventDays(event).map((day): SavedEntry => ({
      kind: "saved",
      id: `${event.id}:${day.id}`,
      date: day.date.slice(0, 10),
      event,
      day
    }))),
    ...imports.map((candidate): ImportEntry => ({
      kind: "import",
      id: `import:${candidate.id}`,
      date: format(parseISO(candidate.start), "yyyy-MM-dd"),
      candidate
    }))
  ], [events, imports]);

  const filteredEntries = useMemo(() => entries.filter((entry) => matchesFilter(entry, filter, workers)), [entries, filter, workers]);
  const monthDays = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(visibleMonth)),
    end: endOfWeek(endOfMonth(visibleMonth))
  }), [visibleMonth]);
  const entriesByDate = useMemo(() => filteredEntries.reduce<Record<string, CalendarEntry[]>>((groups, entry) => {
    groups[entry.date] = [...(groups[entry.date] || []), entry];
    return groups;
  }, {}), [filteredEntries]);
  const selectedEntries = entriesByDate[format(selectedDate, "yyyy-MM-dd")] || [];
  const agendaEntries = useMemo(() => filteredEntries
    .filter((entry) => parseLocalDate(entry.date) >= startOfDay(new Date()))
    .sort(compareEntries), [filteredEntries]);
  const agendaGroups = useMemo(() => agendaEntries.reduce<Record<string, CalendarEntry[]>>((groups, entry) => {
    groups[entry.date] = [...(groups[entry.date] || []), entry];
    return groups;
  }, {}), [agendaEntries]);

  function goToday() {
    const today = startOfDay(new Date());
    setVisibleMonth(startOfMonth(today));
    setSelectedDate(today);
  }

  async function saveImport(candidate: CalendarImportCandidate) {
    setSavingImportId(candidate.id);
    setError("");
    setMessage("");
    try {
      await saveCalendarCandidate(candidate);
      setImports(pendingImports());
      await load();
      setMessage(`${candidate.title} was saved to My Events.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save imported event.");
    } finally {
      setSavingImportId("");
    }
  }

  return (
    <div className="space-y-4 lg:mx-auto lg:max-w-7xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-coral">All Upcoming Events</p>
          <h1 className="text-3xl font-black text-ink dark:text-white">Event Calendar</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Paid, planned, manual, and imported events in one place.</p>
        </div>
        <Link to="/nj-calendar" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-ink shadow-soft dark:bg-slate-900 dark:text-white"><CalendarSync size={17} /> <span className="hidden sm:inline">NJ Calendar</span></Link>
      </header>

      <section className="sticky top-0 z-20 -mx-4 space-y-3 border-y border-slate-200 bg-paper/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:mx-0 lg:rounded-2xl lg:border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-xl bg-white p-1 shadow-soft dark:bg-slate-900">
            <button onClick={() => setView("month")} className={viewButtonClass(view === "month")}><CalendarRange size={16} /> Month</button>
            <button onClick={() => setView("agenda")} className={viewButtonClass(view === "agenda")}><List size={16} /> Agenda</button>
          </div>
          <div className="flex items-center gap-2">
            <SyncStatusBadge syncing={syncing} />
            <button onClick={() => void load(true)} disabled={syncing} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-white px-3 text-xs font-bold text-ink shadow-soft disabled:opacity-50 dark:bg-slate-900 dark:text-white"><RefreshCw size={14} /> Refresh</button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["all", "paid", "new", "applied", "imported", "manual", "week", "month"] as CalendarFilter[]).map((value) => (
            <button key={value} onClick={() => setFilter(value)} className={filterButtonClass(filter === value)}>
              {filterLabel(value)}
            </button>
          ))}
        </div>
      </section>

      {error ? <ErrorState message="Events could not be refreshed." details={error} onRetry={() => void load(true)} onSync={() => void load(true)} /> : null}
      {message ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</p> : null}
      {loading ? <LoadingScreen label="Loading calendar events..."><div className="grid gap-3 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></div></LoadingScreen> : null}

      {!loading && view === "month" ? (
        <>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3 dark:border-slate-800">
              <button onClick={() => setVisibleMonth((month) => subMonths(month, 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800" aria-label="Previous month"><ChevronLeft size={19} /></button>
              <h2 className="text-lg font-black text-ink dark:text-white">{format(visibleMonth, "MMMM yyyy")}</h2>
              <div className="flex items-center gap-2">
                <button onClick={goToday} className="min-h-10 rounded-xl bg-slate-100 px-3 text-xs font-black dark:bg-slate-800">Today</button>
                <button onClick={() => setVisibleMonth((month) => addMonths(month, 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800" aria-label="Next month"><ChevronRight size={19} /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800">
              {weekdays.map((weekday) => <div key={weekday} className="py-2 text-center text-[10px] font-black uppercase text-slate-400 sm:text-xs">{weekday}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayEntries = entriesByDate[key] || [];
                const selected = isSameDay(day, selectedDate);
                const today = isSameDay(day, new Date());
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(startOfDay(day))}
                    className={`min-h-[74px] border-b border-r border-slate-100 p-1 text-left align-top transition sm:min-h-28 sm:p-2 lg:min-h-32 ${selected ? "bg-sky-50 ring-2 ring-inset ring-sky-400 dark:bg-sky-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"} ${isSameMonth(day, visibleMonth) ? "" : "bg-slate-50/60 text-slate-300 dark:bg-slate-950/40 dark:text-slate-700"}`}
                  >
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${today ? "bg-coral text-white" : "text-slate-600 dark:text-slate-300"}`}>{format(day, "d")}</span>
                    <div className="mt-1 space-y-1">
                      {dayEntries.slice(0, 2).map((entry) => <CalendarPill key={entry.id} entry={entry} workers={workers} />)}
                      {dayEntries.length > 2 ? <p className="truncate text-[9px] font-black text-slate-500 dark:text-slate-400">+{dayEntries.length - 2} more</p> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <DayDetails
            date={selectedDate}
            entries={selectedEntries}
            workers={workers}
            savingImportId={savingImportId}
            onSaveImport={saveImport}
          />
        </>
      ) : null}

      {!loading && view === "agenda" ? (
        agendaEntries.length === 0 ? <EmptyState title="No upcoming events match this view." /> : (
          <div className="space-y-6">
            {Object.entries(agendaGroups).map(([date, dayEntries]) => (
              <section key={date}>
                <h2 className="sticky top-[132px] z-10 mb-2 bg-paper/95 py-2 text-sm font-black uppercase text-slate-500 backdrop-blur dark:bg-slate-950/95 dark:text-slate-400 lg:top-28">{format(parseLocalDate(date), "EEEE, MMMM d")}</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {dayEntries.map((entry) => (
                    <AgendaCard key={entry.id} entry={entry} workers={workers} saving={entry.kind === "import" && savingImportId === entry.candidate.id} onSaveImport={saveImport} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function CalendarPill({ entry, workers }: { entry: CalendarEntry; workers: Worker[] }) {
  if (entry.kind === "import") {
    return <p className="truncate rounded bg-cyan-500 px-1 py-0.5 text-[9px] font-black text-white sm:text-[10px]">{entry.candidate.title}</p>;
  }
  const stage = stageForEntry(entry, workers);
  return <p className={`truncate rounded px-1 py-0.5 text-[9px] font-black text-white sm:text-[10px] ${eventStageAccentClasses[stage]}`}>{entry.event.name}</p>;
}

function DayDetails({ date, entries, workers, savingImportId, onSaveImport }: {
  date: Date;
  entries: CalendarEntry[];
  workers: Worker[];
  savingImportId: string;
  onSaveImport: (candidate: CalendarImportCandidate) => Promise<void>;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-soft dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <CalendarDays className="text-coral" size={20} />
        <h2 className="text-lg font-black text-ink dark:text-white">Events on {format(date, "MMMM d, yyyy")}</h2>
      </div>
      {entries.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-400 dark:bg-slate-950">No events this day.</p> : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {[...entries].sort(compareEntries).map((entry) => (
            <AgendaCard key={entry.id} entry={entry} workers={workers} saving={entry.kind === "import" && savingImportId === entry.candidate.id} onSaveImport={onSaveImport} />
          ))}
        </div>
      )}
    </section>
  );
}

function AgendaCard({ entry, workers, saving, onSaveImport }: {
  entry: CalendarEntry;
  workers: Worker[];
  saving: boolean;
  onSaveImport: (candidate: CalendarImportCandidate) => Promise<void>;
}) {
  if (entry.kind === "import") {
    const candidate = entry.candidate;
    return (
      <article className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-900 dark:bg-cyan-950/20">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-cyan-500 px-2.5 py-1 text-[11px] font-black text-white">Imported Feed</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">Not saved</span>
        </div>
        <h3 className="mt-3 text-lg font-black text-ink dark:text-white">{candidate.title}</h3>
        <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <p className="flex items-center gap-2"><Clock size={15} /> {formatImportedTime(candidate)}</p>
          <p className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0" /> {candidate.location || "Location not provided"}</p>
        </div>
        <button onClick={() => void onSaveImport(candidate)} disabled={saving} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-coral text-sm font-black text-white disabled:opacity-50"><Save size={16} /> {saving ? "Saving..." : "Save to My Events"}</button>
      </article>
    );
  }

  const { event, day } = entry;
  const stage = stageForEntry(entry, workers);
  const payment = calculatePaymentSummary(event, workers);
  const confirmed = workersForDay(event, day.id, workers);
  const initials = event.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <Link to={`/events/${event.id}`} className="group grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-soft transition hover:-translate-y-0.5 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[88px_1fr]">
      <EventImageFrame imageUrl={event.imageUrl} initials={initials} className="aspect-[4/5] max-h-32 sm:max-h-none" />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black text-white ${eventStageAccentClasses[stage]}`}>{eventStageLabels[stage]}</span>
          {event.importedFromCalendar ? <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-black text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200">Imported</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">Manual</span>}
        </div>
        <h3 className="mt-2 text-lg font-black text-ink dark:text-white">{event.name}</h3>
        <div className="mt-2 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
          <p className="flex items-center gap-2"><Clock size={15} /> {formatEventDay(day)}</p>
          <p className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0" /> {[event.venueName, event.city, event.state].filter(Boolean).join(", ") || "Location not set"}</p>
          <p className="flex items-center gap-2"><DollarSign size={15} /> {payment.totalCost > 0 ? `${formatMoney(payment.totalPaid)} / ${formatMoney(payment.totalCost)} paid` : "No event cost set"}</p>
          <p className="flex items-center gap-2"><Users size={15} /> {confirmed.length ? confirmed.map((worker) => worker.name).join(", ") : effectiveConfirmedWorkerIds(event).length ? "Workers confirmed for event" : "Nobody confirmed"}</p>
        </div>
        <p className="mt-3 text-xs font-black text-coral">Open Event</p>
      </div>
    </Link>
  );
}

function matchesFilter(entry: CalendarEntry, filter: CalendarFilter, workers: Worker[]) {
  const date = parseLocalDate(entry.date);
  const today = startOfDay(new Date());
  if (filter === "all") return true;
  if (filter === "imported") return entry.kind === "import" || entry.event.importedFromCalendar;
  if (filter === "manual") return entry.kind === "saved" && !entry.event.importedFromCalendar;
  if (filter === "week") {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    return date >= today && date <= end;
  }
  if (filter === "month") return date >= startOfMonth(today) && date <= endOfMonth(today);
  if (entry.kind === "import") return false;
  if (filter === "paid") return isPaidOrConfirmedEvent(entry.event, workers);
  if (filter === "new") return (entry.event.eventStage || "new") === "new";
  return entry.event.eventStage === "applied";
}

function stageForEntry(entry: SavedEntry, workers: Worker[]): EventStage {
  if (parseLocalDate(entry.date) < startOfDay(new Date())) return "past";
  if (isPaidOrConfirmedEvent(entry.event, workers)) return "paid";
  return entry.event.eventStage || "new";
}

function pendingImports() {
  return listCalendarCandidates().filter((candidate) => candidate.reviewStatus === "pending" && !candidate.duplicate);
}

function compareEntries(a: CalendarEntry, b: CalendarEntry) {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare) return dateCompare;
  const aTime = a.kind === "saved" ? a.day.startTime || "" : a.candidate.start;
  const bTime = b.kind === "saved" ? b.day.startTime || "" : b.candidate.start;
  return aTime.localeCompare(bTime);
}

function formatImportedTime(candidate: CalendarImportCandidate) {
  if (candidate.allDay) return `${format(parseISO(candidate.start), "EEE, MMM d")} · All day`;
  const start = parseISO(candidate.start);
  const end = candidate.end ? parseISO(candidate.end) : undefined;
  return `${format(start, "EEE, MMM d · h:mm a")}${end ? ` - ${format(end, isSameDay(start, end) ? "h:mm a" : "EEE, MMM d · h:mm a")}` : ""}`;
}

function parseLocalDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function filterLabel(filter: CalendarFilter) {
  const labels: Record<CalendarFilter, string> = {
    all: "All",
    paid: "Paid / Confirmed",
    new: "Not Applied",
    applied: "Applied / Reserved",
    imported: "Imported",
    manual: "Manual",
    week: "This Week",
    month: "This Month"
  };
  return labels[filter];
}

function filterButtonClass(active: boolean) {
  return `min-h-9 shrink-0 rounded-full px-3 text-xs font-black ${active ? "bg-ink text-white dark:bg-coral" : "bg-white text-slate-600 shadow-soft dark:bg-slate-900 dark:text-slate-300"}`;
}

function viewButtonClass(active: boolean) {
  return `inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black transition ${active ? "bg-ink text-white dark:bg-coral" : "text-slate-500 dark:text-slate-300"}`;
}
