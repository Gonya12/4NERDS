import { CalendarCheck, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { EventCard } from "../components/EventCard";
import { InstallPrompt } from "../components/InstallPrompt";
import { listPlannerEvents, listWorkers } from "../services/planner/plannerRepository";
import type { Event, Worker } from "../types/models";
import { eventTimingStatus } from "../utils/eventStatus";

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
  const highlighted = upcoming.filter((event) => ["Today", "Tomorrow", "This Week"].includes(eventTimingStatus(event.startDate)));
  const confirmedCount = upcoming.filter((event) => (event.confirmedWorkerIds || []).length > 0).length;

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
