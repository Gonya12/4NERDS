import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EventImageUploader } from "../components/EventImageUploader";
import { listLocations } from "../services/database/locationRepository";
import { getPlannerEvent, savePlannerEvent } from "../services/planner/plannerRepository";
import type { Event, EventDay, Location, RegistrationStatus } from "../types/models";
import { id, nowIso } from "../utils/normalize";

const statuses: RegistrationStatus[] = ["open", "closed", "unknown", "sold_out", "waitlist"];

export function EventFormPage() {
  const { id: eventId } = useParams();
  const navigate = useNavigate();
  const [draftEventId] = useState(() => eventId && eventId !== "new" ? eventId : id("event"));
  const [form, setForm] = useState({
    name: "",
    date: new Date().toISOString().slice(0, 10),
    startTime: "",
    endTime: "",
    venueName: "",
    address: "",
    city: "",
    state: "",
    registrationUrl: "",
    sourceUrl: "",
    imageUrl: "",
    imagePath: "",
    locationId: "",
    locationInstagramHandle: "",
    organizerInstagramHandle: "",
    registrationStatus: "unknown" as RegistrationStatus,
    eventCost: "",
    notes: ""
  });
  const [eventDays, setEventDays] = useState<EventDay[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  function blankDay(date = form.date): EventDay {
    const timestamp = nowIso();
    return { id: id("day"), eventId: eventId || "", date, startTime: "", endTime: "", note: "", createdAt: timestamp, updatedAt: timestamp };
  }

  useEffect(() => {
    async function load() {
      setLocations(await listLocations());
      if (!eventId || eventId === "new") return;
      const event = await getPlannerEvent(eventId);
      if (!event) return;
      setForm({
        name: event.name,
        date: event.startDate.slice(0, 10),
        startTime: event.startTime || "",
        endTime: event.endTime || "",
        venueName: event.venueName || "",
        address: event.address || "",
        city: event.city || "",
        state: event.state || "",
        registrationUrl: event.registrationUrl || "",
        sourceUrl: event.sourceUrl || "",
        imageUrl: event.imageUrl || "",
        imagePath: event.imagePath || "",
        locationId: event.locationId || "",
        locationInstagramHandle: event.locationInstagramHandle || "",
        organizerInstagramHandle: event.organizerInstagramHandle || "",
        registrationStatus: event.registrationStatus,
        eventCost: String(event.eventCost || ""),
        notes: event.notes || ""
      });
      setEventDays(event.eventDays?.length ? event.eventDays : [{
        id: id("day"),
        eventId: event.id,
        date: event.startDate.slice(0, 10),
        startTime: event.startTime || "",
        endTime: event.endTime || "",
        createdAt: event.createdAt,
        updatedAt: event.updatedAt
      }]);
    }
    void load();
  }, [eventId]);

  useEffect(() => {
    if (!eventId || eventId === "new") setEventDays((days) => days.length ? days : [blankDay()]);
  }, []);

  function selectLocation(locationId: string) {
    const location = locations.find((item) => item.id === locationId);
    setForm({
      ...form,
      locationId,
      venueName: location?.venueName || form.venueName,
      address: location?.address || form.address,
      city: location?.city || form.city,
      state: location?.state || form.state,
      locationInstagramHandle: location?.instagramHandle || form.locationInstagramHandle
    });
  }

  async function save() {
    if (!form.name.trim()) return;
    const timestamp = nowIso();
    const existing = eventId && eventId !== "new" ? await getPlannerEvent(eventId) : undefined;
    const firstDay = eventDays[0] || blankDay();
    const event: Event = {
      id: existing?.id || draftEventId,
      name: form.name.trim(),
      startDate: new Date(`${firstDay.date}T${firstDay.startTime || "12:00"}`).toISOString(),
      startTime: firstDay.startTime,
      endTime: firstDay.endTime,
      venueName: form.venueName,
      address: form.address,
      city: form.city,
      state: form.state,
      registrationStatus: form.registrationStatus,
      status: existing?.status || "interested",
      registrationUrl: form.registrationUrl,
      sourceUrl: form.sourceUrl,
      imageUrl: form.imageUrl,
      imagePath: form.imagePath,
      locationId: form.locationId || undefined,
      locationInstagramHandle: form.locationInstagramHandle,
      organizerInstagramHandle: form.organizerInstagramHandle,
      sourceType: "manual",
      confidence: "high",
      needsReview: false,
      interested: false,
      maybe: false,
      notGoing: false,
      confirmedWorkerIds: existing?.confirmedWorkerIds || [],
      eventDays: eventDays.map((day) => ({ ...day, eventId: existing?.id || "", updatedAt: timestamp })),
      eventCost: Number(form.eventCost || 0),
      paymentRecords: existing?.paymentRecords || [],
      reminderEnabled: false,
      reminderOffsets: [7, 3, 1, 0],
      reminderNotificationIds: [],
      notes: form.notes,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };
    event.eventDays = eventDays.map((day) => ({ ...day, eventId: event.id, updatedAt: timestamp }));
    await savePlannerEvent(event);
    navigate(`/events/${event.id}`);
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold text-coral">Manual Event Mode</p>
        <h1 className="text-3xl font-black text-ink dark:text-white">{eventId && eventId !== "new" ? "Edit Event" : "Add Event"}</h1>
      </header>
      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Event name" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <select value={form.locationId} onChange={(e) => selectLocation(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-3">
          <option value="">Use common location</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <input value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} placeholder="Venue" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <div className="grid grid-cols-2 gap-3">
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
          <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        </div>
        <input value={form.registrationUrl} onChange={(e) => setForm({ ...form, registrationUrl: e.target.value })} placeholder="Vendor registration link" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="Source link" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <EventImageUploader eventId={draftEventId} imageUrl={form.imageUrl} onChange={(image) => setForm({ ...form, imageUrl: image.imageUrl || "", imagePath: image.imagePath || "" })} />
        <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value, imagePath: "" })} placeholder="Or paste image URL" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <div className="grid grid-cols-2 gap-3">
          <input value={form.locationInstagramHandle} onChange={(e) => setForm({ ...form, locationInstagramHandle: e.target.value })} placeholder="Location @handle" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
          <input value={form.organizerInstagramHandle} onChange={(e) => setForm({ ...form, organizerInstagramHandle: e.target.value })} placeholder="Organizer @handle" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        </div>
        <section className="space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950/70">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-black text-ink dark:text-white">Event Days</h2>
            <button onClick={() => setEventDays([...eventDays, blankDay(eventDays[eventDays.length - 1]?.date || form.date)])} className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white dark:bg-coral" type="button"><Plus size={14} /> Add Day</button>
          </div>
          {eventDays.map((day, index) => (
            <div key={day.id} className="space-y-2 rounded-xl bg-white p-3 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-ink dark:text-white">Day {index + 1}</p>
                {eventDays.length > 1 ? <button type="button" onClick={() => setEventDays(eventDays.filter((item) => item.id !== day.id))} className="rounded-lg p-2 text-rose-700"><Trash2 size={15} /></button> : null}
              </div>
              <input type="date" value={day.date.slice(0, 10)} onChange={(e) => setEventDays(eventDays.map((item) => item.id === day.id ? { ...item, date: e.target.value } : item))} className="w-full rounded-xl border border-slate-200 px-3 py-3" />
              <div className="grid grid-cols-2 gap-2">
                <input type="time" value={day.startTime || ""} onChange={(e) => setEventDays(eventDays.map((item) => item.id === day.id ? { ...item, startTime: e.target.value } : item))} className="w-full rounded-xl border border-slate-200 px-3 py-3" />
                <input type="time" value={day.endTime || ""} onChange={(e) => setEventDays(eventDays.map((item) => item.id === day.id ? { ...item, endTime: e.target.value } : item))} className="w-full rounded-xl border border-slate-200 px-3 py-3" />
              </div>
              <input value={day.note || ""} onChange={(e) => setEventDays(eventDays.map((item) => item.id === day.id ? { ...item, note: e.target.value } : item))} placeholder="Optional day note" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
            </div>
          ))}
        </section>
        <select value={form.registrationStatus} onChange={(e) => setForm({ ...form, registrationStatus: e.target.value as RegistrationStatus })} className="w-full rounded-xl border border-slate-200 px-3 py-3">
          {statuses.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}
        </select>
        <input type="number" min={0} step="0.01" value={form.eventCost} onChange={(e) => setForm({ ...form, eventCost: e.target.value })} placeholder="Event/table cost" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="min-h-28 w-full rounded-xl border border-slate-200 px-3 py-3" />
        <button onClick={save} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink text-sm font-black text-white transition active:scale-[0.99] dark:bg-coral"><Save size={18} /> Save Event</button>
      </section>
    </div>
  );
}
