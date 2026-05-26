import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { EventCard } from "../components/EventCard";
import { listPlannerEvents, listWorkers } from "../services/planner/plannerRepository";
import type { Event, Worker } from "../types/models";
import { dayHeading, dayKey } from "../utils/dateUtils";

export function CalendarPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    async function load() {
      setEvents(await listPlannerEvents());
      setWorkers(await listWorkers());
    }
    void load();
  }, []);

  const groups = useMemo(() => events.reduce<Record<string, Event[]>>((acc, event) => {
    const key = dayKey(event.startDate);
    acc[key] = acc[key] || [];
    acc[key].push(event);
    return acc;
  }, {}), [events]);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold text-coral">Planner</p>
        <h1 className="text-3xl font-black text-ink">Events</h1>
      </header>
      {events.length === 0 ? <EmptyState title="No events yet. Add your first event from the Add Event tab." /> : null}
      {Object.entries(groups).map(([key, dayEvents]) => (
        <section key={key}>
          <h2 className="mb-3 text-sm font-black uppercase text-slate-500">{dayHeading(dayEvents[0].startDate)}</h2>
          <div className="space-y-3">{dayEvents.map((event) => <EventCard key={event.id} event={event} workers={workers} />)}</div>
        </section>
      ))}
    </div>
  );
}
