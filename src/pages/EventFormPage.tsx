import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EventImageUploader } from "../components/EventImageUploader";
import { listLocations } from "../services/database/locationRepository";
import { getPlannerEvent, savePlannerEvent } from "../services/planner/plannerRepository";
import type { Event, EventDay, EventPriceOption, Location, PricingType, RegistrationStatus } from "../types/models";
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
    packingNotes: "",
    boothNumber: "",
    setupTime: "",
    parkingNotes: "",
    floorSection: "",
    entryInstructions: "",
    registrationStatus: "unknown" as RegistrationStatus,
    eventCost: "",
    notes: ""
  });
  const [eventDays, setEventDays] = useState<EventDay[]>([]);
  const [priceOptions, setPriceOptions] = useState<EventPriceOption[]>([]);
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
        packingNotes: event.packingNotes || "",
        boothNumber: event.boothNumber || "",
        setupTime: event.setupTime || "",
        parkingNotes: event.parkingNotes || "",
        floorSection: event.floorSection || "",
        entryInstructions: event.entryInstructions || "",
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
      setPriceOptions(event.priceOptions || []);
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

  function addPriceOption() {
    const timestamp = nowIso();
    setPriceOptions([...priceOptions, {
      id: id("price"),
      eventId: draftEventId,
      label: "New Price Option",
      price: 0,
      pricingType: "flat",
      isSelected: !priceOptions.some((option) => option.isSelected),
      createdAt: timestamp,
      updatedAt: timestamp
    }]);
  }

  function updatePriceOption(optionId: string, patch: Partial<EventPriceOption>) {
    setPriceOptions(priceOptions.map((option) => option.id === optionId ? { ...option, ...patch, updatedAt: nowIso() } : option));
  }

  function selectPriceOption(optionId: string) {
    setPriceOptions(priceOptions.map((option) => ({ ...option, isSelected: option.id === optionId, updatedAt: nowIso() })));
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
      eventStage: existing?.eventStage || "new",
      registrationUrl: form.registrationUrl,
      sourceUrl: form.sourceUrl,
      imageUrl: form.imageUrl,
      imagePath: form.imagePath,
      locationId: form.locationId || undefined,
      locationInstagramHandle: form.locationInstagramHandle,
      organizerInstagramHandle: form.organizerInstagramHandle,
      packingNotes: form.packingNotes,
      boothNumber: form.boothNumber,
      setupTime: form.setupTime,
      parkingNotes: form.parkingNotes,
      floorSection: form.floorSection,
      entryInstructions: form.entryInstructions,
      sourceType: "manual",
      confidence: "high",
      needsReview: false,
      interested: false,
      maybe: false,
      notGoing: false,
      confirmedWorkerIds: existing?.confirmedWorkerIds || [],
      eventDays: eventDays.map((day) => ({ ...day, eventId: existing?.id || "", updatedAt: timestamp })),
      eventDayWorkers: existing?.eventDayWorkers || [],
      priceOptions: priceOptions.map((option) => ({ ...option, eventId: existing?.id || draftEventId, isSelected: option.isSelected })),
      splitMode: existing?.splitMode || "equal",
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
    event.priceOptions = priceOptions.map((option) => ({ ...option, eventId: event.id, updatedAt: timestamp }));
    await savePlannerEvent(event);
    navigate(`/events/${event.id}`);
  }

  return (
    <div className="space-y-5 lg:mx-auto lg:max-w-6xl">
      <header>
        <p className="text-sm font-bold text-coral">Manual Event Mode</p>
        <h1 className="text-3xl font-black text-ink dark:text-white">{eventId && eventId !== "new" ? "Edit Event" : "Add Event"}</h1>
      </header>
      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 dark:bg-slate-900">
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
        <section className="space-y-3 rounded-2xl bg-slate-50 p-3 lg:col-span-2 dark:bg-slate-950/70">
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
        <section className="space-y-3 rounded-2xl bg-slate-50 p-3 lg:col-span-2 dark:bg-slate-950/70">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-black text-ink dark:text-white">Price Options</h2>
            <button onClick={addPriceOption} className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white dark:bg-coral" type="button"><Plus size={14} /> Add Option</button>
          </div>
          {priceOptions.map((option) => (
            <div key={option.id} className={`space-y-2 rounded-xl border p-3 ${option.isSelected ? "border-coral bg-orange-50 dark:bg-orange-950/20" : "border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
              <div className="flex items-center justify-between gap-2">
                <input value={option.label} onChange={(e) => updatePriceOption(option.id, { label: e.target.value })} placeholder="Option label" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <button type="button" onClick={() => setPriceOptions(priceOptions.filter((item) => item.id !== option.id))} className="rounded-lg p-2 text-rose-700"><Trash2 size={15} /></button>
              </div>
              <input value={option.description || ""} onChange={(e) => updatePriceOption(option.id, { description: e.target.value })} placeholder="Description" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min={0} step="0.01" value={option.price || ""} onChange={(e) => updatePriceOption(option.id, { price: Number(e.target.value || 0) })} placeholder="Price" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <select value={option.pricingType} onChange={(e) => updatePriceOption(option.id, { pricingType: e.target.value as PricingType })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <option value="flat">Flat</option>
                  <option value="per_day">Per day</option>
                  <option value="package">Package</option>
                </select>
              </div>
              <button type="button" onClick={() => selectPriceOption(option.id)} className={`min-h-10 w-full rounded-xl text-sm font-bold ${option.isSelected ? "bg-coral text-white" : "bg-slate-100 text-ink dark:bg-slate-800 dark:text-white"}`}>
                {option.isSelected ? "Selected" : "Select option"}
              </button>
            </div>
          ))}
          {priceOptions.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No package pricing yet. The app will use the event/table cost above.</p> : null}
        </section>
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="min-h-28 w-full rounded-xl border border-slate-200 px-3 py-3" />
        <textarea value={form.packingNotes} onChange={(e) => setForm({ ...form, packingNotes: e.target.value })} placeholder="Inventory & packing notes" className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-3" />
        <section className="space-y-3 rounded-2xl bg-slate-50 p-3 lg:col-span-2 dark:bg-slate-950/70">
          <h2 className="font-black text-ink dark:text-white">Booth & Setup</h2>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.boothNumber} onChange={(e) => setForm({ ...form, boothNumber: e.target.value })} placeholder="Booth/table #" className="rounded-xl border border-slate-200 px-3 py-3" />
            <input value={form.setupTime} onChange={(e) => setForm({ ...form, setupTime: e.target.value })} placeholder="Setup time" className="rounded-xl border border-slate-200 px-3 py-3" />
          </div>
          <input value={form.floorSection} onChange={(e) => setForm({ ...form, floorSection: e.target.value })} placeholder="Floor section" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
          <textarea value={form.parkingNotes} onChange={(e) => setForm({ ...form, parkingNotes: e.target.value })} placeholder="Parking notes" className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-3" />
          <textarea value={form.entryInstructions} onChange={(e) => setForm({ ...form, entryInstructions: e.target.value })} placeholder="Entry instructions" className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-3" />
        </section>
        <button onClick={save} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink text-sm font-black text-white transition active:scale-[0.99] lg:col-span-2 dark:bg-coral"><Save size={18} /> Save Event</button>
      </section>
    </div>
  );
}
