import { CopyPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { EventImageFrame } from "../components/EventImageFrame";
import { ErrorState } from "../components/ErrorState";
import { LoadingScreen } from "../components/LoadingScreen";
import { SkeletonEventCard } from "../components/SkeletonEventCard";
import { listPlannerPastPaidEventsPage, listWorkers, savePlannerEvent } from "../services/planner/plannerRepository";
import type { Event, Worker } from "../types/models";
import { dateRangeSummary } from "../utils/eventSchedule";
import { calculateEventProfit } from "../utils/financeMath";
import { id, nowIso } from "../utils/normalize";
import { formatMoney } from "../utils/paymentMath";

function names(event: Event, workers: Worker[]) {
  const ids = new Set(event.confirmedWorkerIds || []);
  return workers.filter((worker) => ids.has(worker.id)).map((worker) => worker.name).join(", ") || "Nobody listed";
}

export function PastEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  async function load(targetPage = 0, append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const [eventPage, workerRows] = await Promise.all([
        listPlannerPastPaidEventsPage(targetPage, 20),
        workers.length ? Promise.resolve(workers) : listWorkers()
      ]);
      setWorkers(workerRows);
      setEvents((current) => append ? [...current, ...eventPage.events] : eventPage.events);
      setHasMore(eventPage.hasMore);
      setPage(targetPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load past events.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function useAsTemplate(event: Event) {
    const timestamp = nowIso();
    const newId = id("event");
    await savePlannerEvent({
      ...event,
      id: newId,
      name: `${event.name} Copy`,
      status: "interested",
      eventStage: "new",
      confirmedWorkerIds: [],
      paymentRecords: [],
      finance: undefined,
      checklistItems: [],
      eventDays: (event.eventDays || []).map((day) => ({ ...day, id: id("day"), eventId: newId, createdAt: timestamp, updatedAt: timestamp })),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    navigate(`/events/${newId}/edit`);
  }

  return (
    <div className="space-y-5 lg:mx-auto lg:max-w-7xl">
      <header>
        <p className="text-sm font-bold text-coral">Insights</p>
        <h1 className="text-3xl font-black text-ink dark:text-white">Past Events</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Only paid, completed, or attended events are shown.</p>
      </header>
      {error ? <ErrorState message="Past events could not be loaded." details={error} onRetry={() => void load()} onSync={() => void load()} /> : null}
      {loading ? <LoadingScreen label="Loading past paid events..."><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <SkeletonEventCard key={item} />)}</div></LoadingScreen> : null}
      {!loading && events.length === 0 ? <EmptyState title="No paid or attended past events yet." /> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {events.map((event) => {
          const profit = calculateEventProfit(event, event.finance);
          const initials = event.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
          return (
            <article key={event.id} className="overflow-hidden rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
              <Link to={`/events/${event.id}`} className="block">
                <EventImageFrame imageUrl={event.imageUrl} initials={initials} className="aspect-[4/5] max-h-[620px]" />
                <h2 className="mt-3 text-lg font-black text-ink dark:text-white">{event.name}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{dateRangeSummary(event)} · {event.venueName || event.city || "Location not set"}</p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Worked by: {names(event, workers)}</p>
                <p className={`mt-2 text-sm font-black ${profit.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>Profit: {formatMoney(profit.netProfit)}</p>
                {event.notes ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{event.notes}</p> : null}
              </Link>
              <button onClick={() => useAsTemplate(event)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink text-sm font-bold text-white dark:bg-coral"><CopyPlus size={17} /> Use as template</button>
            </article>
          );
        })}
      </div>
      {hasMore ? (
        <button onClick={() => void load(page + 1, true)} disabled={loadingMore} className="min-h-11 w-full rounded-xl bg-white text-sm font-bold text-ink shadow-soft disabled:opacity-60 dark:bg-slate-900 dark:text-white">{loadingMore ? "Loading..." : "Load 20 more"}</button>
      ) : null}
    </div>
  );
}
