import { CalendarCheck, CalendarDays, Camera, CheckCircle2, DollarSign, Plus, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { EventCard } from "../components/EventCard";
import { InstallPrompt } from "../components/InstallPrompt";
import { getCachedPlannerHomeEvents, listPlannerHomeEvents, listWorkers } from "../services/planner/plannerRepository";
import type { Event, Worker } from "../types/models";
import { effectiveConfirmedWorkerIds } from "../utils/availability";
import { eventTimingStatus } from "../utils/eventStatus";
import { eventDays } from "../utils/eventSchedule";
import { calculateEventProfit } from "../utils/financeMath";
import { formatMoney } from "../utils/paymentMath";
import { eventStageAccentClasses, eventStageDescriptions } from "../utils/eventStage";

export function HomePage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [showSalesMenu, setShowSalesMenu] = useState(false);

  async function load() {
    setSyncing(true);
    setSyncMessage("Syncing...");
    try {
      const [allEvents, allWorkers] = await Promise.all([listPlannerHomeEvents(10), listWorkers()]);
      setEvents(allEvents);
      setWorkers(allWorkers);
      setSyncMessage("");
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    const cached = getCachedPlannerHomeEvents();
    if (cached.length) {
      setEvents(cached);
      setLoading(false);
    }
    void listWorkers().then(setWorkers);
    void load();
  }, []);

  const upcoming = useMemo(() => events.filter((event) => eventTimingStatus(event.startDate) !== "Past"), [events]);
  const completedEvents = useMemo(() => events.filter((event) => event.status === "completed" || eventTimingStatus(event.startDate) === "Past"), [events]);
  const highlighted = upcoming.filter((event) => ["Today", "Tomorrow", "This Week"].includes(eventTimingStatus(event.startDate)));
  const confirmedCount = upcoming.filter((event) => (event.confirmedWorkerIds || []).length > 0).length;
  const now = new Date();
  const projectedCosts = upcoming.reduce((sum, event) => sum + Number((event.priceOptions || []).find((option) => option.isSelected)?.price ?? event.eventCost ?? 0), 0);
  const upcomingEventDays = upcoming.flatMap((event) => eventDays(event).map((day) => ({ event, day }))).filter(({ day }) => new Date(`${day.date.slice(0, 10)}T23:59:59`).getTime() >= Date.now());
  const plannedDayKeys = new Set(upcomingEventDays.map(({ event, day }) => `${event.id}:${day.id}:${day.date.slice(0, 10)}`));
  const confirmedDayKeys = new Set(upcomingEventDays.filter(({ event, day }) => {
    const dayWorkers = event.eventDayWorkers || [];
    if (dayWorkers.length) return dayWorkers.some((item) => item.eventDayId === day.id);
    return (event.confirmedWorkerIds || []).length > 0;
  }).map(({ event, day }) => `${event.id}:${day.id}:${day.date.slice(0, 10)}`));
  const workersScheduled = new Set(upcoming.flatMap((event) => effectiveConfirmedWorkerIds(event))).size;

  const skeletonCards = (
    <div className="space-y-3">
      {[1, 2, 3].map((item) => (
        <div key={item} className="animate-pulse rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <div className="aspect-[4/5] rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="mt-4 h-5 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-2 h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
  const monthlyProfit = completedEvents
    .filter((event) => {
      const date = new Date(event.startDate);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    })
    .reduce((sum, event) => sum + calculateEventProfit(event, event.finance).netProfit, 0);
  const checklistItems = upcoming.flatMap((event) => event.checklistItems || []);
  const checklistPercent = checklistItems.length ? Math.round((checklistItems.filter((item) => item.completed).length / checklistItems.length) * 100) : 0;

  return (
    <div className="space-y-6 lg:mx-auto lg:max-w-7xl">
      <header className="rounded-3xl bg-ink p-5 text-white shadow-soft dark:bg-slate-900">
        <p className="text-sm font-bold text-orange-300">4 Nerds</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">Event Planner</h1>
        <p className="mt-2 text-sm text-slate-300">Plan vendor events and confirm who can work each show.</p>
      </header>

      <InstallPrompt />
      <section className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <h2 className="font-black text-ink dark:text-white">Event Stage Legend</h2>
        <div className="mt-3 grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-2 lg:grid-cols-4 dark:text-slate-300">
          {(["new", "applied", "paid", "past"] as const).map((stage) => (
            <div key={stage} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-950/70">
              <span className={`h-3 w-3 rounded-full ${eventStageAccentClasses[stage]}`} />
              <span>{eventStageDescriptions[stage]}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="flex items-center justify-between gap-3">
        {syncing || syncMessage ? <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{syncMessage || "Syncing..."}</p> : <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Showing latest saved schedule</p>}
        <button onClick={load} disabled={syncing} className="rounded-full bg-white px-3 py-2 text-xs font-bold text-ink shadow-soft disabled:opacity-60 dark:bg-slate-900 dark:text-white">Sync Now</button>
      </div>

      <section className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
        <div className="min-w-32 rounded-2xl bg-sky-50 p-4 shadow-soft dark:bg-sky-950/30">
          <CalendarDays className="text-sky-600 dark:text-sky-300" size={20} />
          <p className="mt-3 text-2xl font-black text-ink dark:text-white">{plannedDayKeys.size}</p>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Days Planned</p>
        </div>
        <div className="min-w-32 rounded-2xl bg-emerald-50 p-4 shadow-soft dark:bg-emerald-950/30">
          <CheckCircle2 className="text-emerald-600 dark:text-emerald-300" size={20} />
          <p className="mt-3 text-2xl font-black text-ink dark:text-white">{confirmedDayKeys.size}</p>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Days Confirmed</p>
        </div>
        <div className="min-w-32 rounded-2xl bg-violet-50 p-4 shadow-soft dark:bg-violet-950/30">
          <CalendarCheck className="text-violet-600 dark:text-violet-300" size={20} />
          <p className="mt-3 text-2xl font-black text-ink dark:text-white">{upcoming.length}</p>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Upcoming Events</p>
        </div>
        <div className="min-w-40 rounded-2xl bg-orange-50 p-4 shadow-soft dark:bg-orange-950/30">
          <DollarSign className="text-orange-600 dark:text-orange-300" size={20} />
          <p className="mt-3 text-2xl font-black text-ink dark:text-white">{formatMoney(projectedCosts)}</p>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Upcoming Cost</p>
        </div>
        <div className="min-w-36 rounded-2xl bg-slate-50 p-4 shadow-soft dark:bg-slate-900">
          <Users className="text-slate-600 dark:text-slate-300" size={20} />
          <p className="mt-3 text-2xl font-black text-ink dark:text-white">{workersScheduled}</p>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Workers Scheduled</p>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3 lg:grid-cols-6">
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <CalendarCheck className="text-coral" size={20} />
          <p className="mt-3 text-2xl font-black text-ink dark:text-white">{upcoming.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Upcoming</p>
        </div>
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <Users className="text-emerald-600" size={20} />
          <p className="mt-3 text-2xl font-black text-ink dark:text-white">{confirmedCount}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Staffed</p>
        </div>
        <Link to="/events/new" className="flex flex-col justify-between rounded-2xl bg-coral p-4 text-white shadow-soft transition active:scale-[0.98]">
          <Plus size={22} />
          <span className="text-sm font-black">Add Event</span>
        </Link>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Projected costs</p>
          <p className="mt-2 text-xl font-black text-ink dark:text-white">{formatMoney(projectedCosts)}</p>
        </div>
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Profit this month</p>
          <p className={`mt-2 text-xl font-black ${monthlyProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatMoney(monthlyProfit)}</p>
        </div>
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Events completed</p>
          <p className="mt-2 text-xl font-black text-ink dark:text-white">{completedEvents.length}</p>
        </div>
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Checklist completion</p>
          <p className="mt-2 text-xl font-black text-ink dark:text-white">{checklistPercent}%</p>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black text-ink dark:text-white">Next 5 Events</h2>
          <Link to="/events" className="text-sm font-bold text-coral">View all</Link>
        </div>
        {loading ? skeletonCards : upcoming.length === 0 ? (
          <EmptyState title="No upcoming events yet." action={<Link to="/events/new" className="rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white dark:bg-coral">Add Event</Link>} />
        ) : (
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 xl:grid-cols-5">
            {upcoming.slice(0, 5).map((event) => (
              <div key={event.id} className="w-[82%] shrink-0 snap-start lg:w-auto">
                <EventCard event={event} workers={workers} />
              </div>
            ))}
          </div>
        )}
      </section>

      {highlighted.length > 0 ? (
        <section className="rounded-2xl border border-orange-100 bg-orange-50 p-4 dark:border-orange-900/60 dark:bg-orange-950/25">
          <h2 className="font-black text-ink dark:text-white">Coming Up Soon</h2>
          <div className="mt-3 space-y-3">{highlighted.slice(0, 2).map((event) => <EventCard key={event.id} event={event} workers={workers} />)}</div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black text-ink dark:text-white">Upcoming Events</h2>
          <Link to="/events" className="text-sm font-bold text-coral">View all</Link>
        </div>
        {loading ? skeletonCards : upcoming.length === 0 ? (
          <EmptyState title="No events yet. Add your first vendor event." action={<Link to="/events/new" className="rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white dark:bg-coral">Add Event</Link>} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{upcoming.slice(0, 6).map((event) => <EventCard key={event.id} event={event} workers={workers} />)}</div>
        )}
      </section>

      <button onClick={() => setShowSalesMenu(true)} className="fixed bottom-24 right-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-coral text-white shadow-2xl transition active:scale-95 lg:bottom-8 lg:right-8">
        <Camera size={24} />
      </button>
      {showSalesMenu ? (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm lg:items-center lg:justify-center">
          <section className="mx-auto w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-coral">Sales Control</p>
                <h2 className="text-2xl font-black text-ink dark:text-white">What do you want to open?</h2>
              </div>
              <button onClick={() => setShowSalesMenu(false)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
            </div>
            <div className="mt-5 grid gap-3">
              <button onClick={() => navigate("/sales?mode=sale")} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-coral font-black text-white"><Camera size={18} /> Sale</button>
              <button onClick={() => navigate("/sales")} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ink font-black text-white dark:bg-slate-800"><Users size={18} /> Control</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
