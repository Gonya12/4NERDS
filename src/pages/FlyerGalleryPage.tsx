import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EventImageFrame } from "../components/EventImageFrame";
import { listPlannerEvents } from "../services/planner/plannerRepository";
import type { Event } from "../types/models";
import { dateRangeSummary } from "../utils/eventSchedule";

export function FlyerGalleryPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void listPlannerEvents().then(setEvents);
  }, []);

  const filtered = useMemo(() => events
    .filter((event) => event.imageUrl)
    .filter((event) => `${event.name} ${event.venueName} ${event.city} ${new Date(event.startDate).getFullYear()}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.startDate.localeCompare(a.startDate)), [events, query]);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold text-coral">Archive</p>
        <h1 className="text-3xl font-black text-ink dark:text-white">Past Flyers</h1>
      </header>
      <label className="flex items-center gap-2 rounded-2xl bg-white/90 px-3 py-2 shadow-soft dark:bg-slate-900">
        <Search size={17} className="text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search year, location, event" className="min-w-0 flex-1 border-0 bg-transparent px-0" />
      </label>
      <section className="grid grid-cols-2 gap-3">
        {filtered.map((event) => (
          <Link key={event.id} to={`/events/${event.id}`} className="rounded-2xl bg-white/90 p-2 shadow-soft dark:bg-slate-900">
            <EventImageFrame imageUrl={event.imageUrl} initials={event.name.slice(0, 2)} className="aspect-[4/5]" />
            <p className="mt-2 line-clamp-2 text-sm font-black text-ink dark:text-white">{event.name}</p>
            <p className="text-xs text-slate-500">{dateRangeSummary(event)}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
