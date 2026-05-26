import { CalendarCheck, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { EventCard } from "../components/EventCard";
import { InstallPrompt } from "../components/InstallPrompt";
import { listPlannerEvents, listWorkers } from "../services/planner/plannerRepository";
import type { Event, Worker } from "../types/models";
import { eventTimingStatus } from "../utils/eventStatus";
import { calculateEventProfit } from "../utils/financeMath";
import { formatMoney } from "../utils/paymentMath";

export function HomePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);

  async function load() {
    const [allEvents, allWorkers] = await Promise.all([listPlannerEvents(), listWorkers()]);
    setEvents(allEvents);
    setWorkers(allWorkers);
  }

  useEffect(() => { void load(); }, []);

  const upcoming = useMemo(() => events.filter((event) => eventTimingStatus(event.startDate) !== "Past"), [events]);
  const completedEvents = useMemo(() => events.filter((event) => event.status === "completed" || eventTimingStatus(event.startDate) === "Past"), [events]);
  const highlighted = upcoming.filter((event) => ["Today", "Tomorrow", "This Week"].includes(eventTimingStatus(event.startDate)));
  const confirmedCount = upcoming.filter((event) => (event.confirmedWorkerIds || []).length > 0).length;
  const now = new Date();
  const projectedCosts = upcoming.reduce((sum, event) => sum + Number(event.eventCost || 0), 0);
  const monthlyProfit = completedEvents
    .filter((event) => {
      const date = new Date(event.startDate);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    })
    .reduce((sum, event) => sum + calculateEventProfit(event, event.finance).netProfit, 0);
  const checklistItems = upcoming.flatMap((event) => event.checklistItems || []);
  const checklistPercent = checklistItems.length ? Math.round((checklistItems.filter((item) => item.completed).length / checklistItems.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <header className="rounded-3xl bg-ink p-5 text-white shadow-soft dark:bg-slate-900">
        <p className="text-sm font-bold text-orange-300">4 Nerds</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">Event Planner</h1>
        <p className="mt-2 text-sm text-slate-300">Plan vendor events and confirm who can work each show.</p>
      </header>

      <InstallPrompt />

      <section className="grid grid-cols-3 gap-3">
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

      <section className="grid grid-cols-2 gap-3">
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
        {upcoming.length === 0 ? (
          <EmptyState title="No upcoming events yet." action={<Link to="/events/new" className="rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white dark:bg-coral">Add Event</Link>} />
        ) : (
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            {upcoming.slice(0, 5).map((event) => (
              <div key={event.id} className="w-[82%] shrink-0 snap-start">
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
        {upcoming.length === 0 ? (
          <EmptyState title="No events yet. Add your first vendor event." action={<Link to="/events/new" className="rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white dark:bg-coral">Add Event</Link>} />
        ) : (
          <div className="space-y-3">{upcoming.slice(0, 6).map((event) => <EventCard key={event.id} event={event} workers={workers} />)}</div>
        )}
      </section>
    </div>
  );
}
