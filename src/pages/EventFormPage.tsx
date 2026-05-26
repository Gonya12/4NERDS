import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getPlannerEvent, savePlannerEvent } from "../services/planner/plannerRepository";
import type { Event, RegistrationStatus } from "../types/models";
import { id, nowIso } from "../utils/normalize";

const statuses: RegistrationStatus[] = ["open", "closed", "unknown", "sold_out", "waitlist"];

export function EventFormPage() {
  const { id: eventId } = useParams();
  const navigate = useNavigate();
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
    registrationStatus: "unknown" as RegistrationStatus,
    eventCost: "",
    notes: ""
  });

  useEffect(() => {
    async function load() {
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
        registrationStatus: event.registrationStatus,
        eventCost: String(event.eventCost || ""),
        notes: event.notes || ""
      });
    }
    void load();
  }, [eventId]);

  async function save() {
    if (!form.name.trim()) return;
    const timestamp = nowIso();
    const existing = eventId && eventId !== "new" ? await getPlannerEvent(eventId) : undefined;
    const event: Event = {
      id: existing?.id || id("event"),
      name: form.name.trim(),
      startDate: new Date(`${form.date}T${form.startTime || "12:00"}`).toISOString(),
      startTime: form.startTime,
      endTime: form.endTime,
      venueName: form.venueName,
      address: form.address,
      city: form.city,
      state: form.state,
      registrationStatus: form.registrationStatus,
      registrationUrl: form.registrationUrl,
      sourceUrl: form.sourceUrl,
      sourceType: "manual",
      confidence: "high",
      needsReview: false,
      interested: false,
      maybe: false,
      notGoing: false,
      confirmedWorkerIds: existing?.confirmedWorkerIds || [],
      eventCost: Number(form.eventCost || 0),
      paymentRecords: existing?.paymentRecords || [],
      reminderEnabled: false,
      reminderOffsets: [7, 3, 1, 0],
      reminderNotificationIds: [],
      notes: form.notes,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };
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
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <div className="grid grid-cols-2 gap-3">
          <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-3" />
          <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        </div>
        <input value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} placeholder="Venue" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <div className="grid grid-cols-2 gap-3">
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
          <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        </div>
        <input value={form.registrationUrl} onChange={(e) => setForm({ ...form, registrationUrl: e.target.value })} placeholder="Vendor registration link" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
        <input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="Source link" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
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
