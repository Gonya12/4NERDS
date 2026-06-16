import { CalendarCheck, Camera, CheckCircle2, ChevronDown, CopyPlus, DollarSign, Edit, ExternalLink, ImagePlus, Map, MessageSquare, Plus, QrCode, Star, Trash2, Users, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EventImageFrame } from "../components/EventImageFrame";
import { EventImageUploader } from "../components/EventImageUploader";
import { ErrorState } from "../components/ErrorState";
import { LoadingScreen } from "../components/LoadingScreen";
import { SkeletonCard } from "../components/SkeletonCard";
import { StatusChip } from "../components/StatusChip";
import { deleteChecklistItem, saveChecklistItem } from "../services/database/checklistRepository";
import { emptyReview, saveLiveNote, saveReview, saveSalesCategory } from "../services/database/eventExtrasRepository";
import { emptyFinance, saveFinance } from "../services/database/financeRepository";
import { deletePaymentRecord, savePaymentRecord } from "../services/database/paymentRepository";
import { deletePriceOption } from "../services/database/priceOptionRepository";
import { googleMapsDirectionsLink } from "../services/distance/mapLinks";
import { deletePlannerEvent, getPlannerEvent, listWorkers, savePlannerEvent } from "../services/planner/plannerRepository";
import { departureTime, estimateDriveMinutes } from "../services/travel/travelService";
import { getEventWeather, type WeatherSummary } from "../services/weather/weatherService";
import type { Event, EventChecklistItem, EventDayWorker, EventFinance, EventPriceOption, EventStage, EventStatus, PaymentRecord, PricingType, SplitMode, Worker } from "../types/models";
import { displayDate } from "../utils/dateUtils";
import { eventTimingStatus } from "../utils/eventStatus";
import { eventDays, formatEventDay } from "../utils/eventSchedule";
import { calculateEventProfit, checklistProgress } from "../utils/financeMath";
import { generateInstagramCaption } from "../utils/instagramCaption";
import { id as createId, nowIso } from "../utils/normalize";
import { calculatePaymentSummary, formatMoney } from "../utils/paymentMath";
import { availabilitySummaryByWorker, effectiveConfirmedWorkerIds, normalizeDayWorkerRows, workersForDay } from "../utils/availability";
import { eventStageAccentClasses, eventStageDescriptions, eventStageLabels } from "../utils/eventStage";
import { njPokemonEventsMap } from "../data/njPokemonSources";

function Accordion({ title, summary, icon, children }: { title: string; summary: string; icon?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="overflow-hidden rounded-2xl bg-white/90 shadow-soft dark:bg-slate-900">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="text-coral">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-black text-ink dark:text-white">{title}</span>
          <span className="mt-0.5 block truncate text-xs font-bold text-slate-500 dark:text-slate-400">{summary}</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="border-t border-slate-100 p-4 pt-3 dark:border-slate-800">{children}</div> : null}
    </section>
  );
}

function WorkerModal({ event, workers, onClose, onSave }: { event: Event; workers: Worker[]; onClose: () => void; onSave: (rows: EventDayWorker[]) => void }) {
  const days = eventDays(event);
  const initialRows = event.eventDayWorkers?.length
    ? event.eventDayWorkers
    : (event.confirmedWorkerIds || []).flatMap((workerId) => days.map((day) => ({
      id: createId("day_worker"),
      eventId: event.id,
      eventDayId: day.id,
      workerId,
      createdAt: nowIso(),
      updatedAt: nowIso()
    })));
  const [selected, setSelected] = useState(() => new Set(initialRows.map((row) => `${row.workerId}:${row.eventDayId}`)));

  function toggle(workerId: string, dayId: string) {
    setSelected((current) => {
      const next = new Set(current);
      const key = `${workerId}:${dayId}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    const timestamp = nowIso();
    const rows = Array.from(selected).map((key) => {
      const [workerId, eventDayId] = key.split(":");
      return { id: createId("day_worker"), eventId: event.id, eventDayId, workerId, createdAt: timestamp, updatedAt: timestamp };
    });
    onSave(normalizeDayWorkerRows(event.id, rows));
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm">
      <section className="mx-auto w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-coral">Availability</p>
            <h2 className="text-2xl font-black text-ink dark:text-white">Who can work this event?</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="mt-5 space-y-3">
          {workers.filter((worker) => worker.active).map((worker) => {
            return (
              <div key={worker.id} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950/70">
                <p className="text-sm font-black text-ink dark:text-white">{worker.name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {days.map((day) => {
                    const active = selected.has(`${worker.id}:${day.id}`);
                    return (
                      <button key={day.id} onClick={() => toggle(worker.id, day.id)} className={`rounded-full px-3 py-2 text-xs font-bold transition ${active ? "bg-ink text-white shadow-soft dark:bg-coral" : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-200"}`}>
                        {new Date(`${day.date.slice(0, 10)}T12:00:00`).toLocaleDateString([], { weekday: "short" })}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button onClick={onClose} className="min-h-12 rounded-xl bg-slate-100 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Cancel</button>
          <button onClick={save} className="min-h-12 rounded-xl bg-coral font-black text-white">Save Availability</button>
        </div>
      </section>
    </div>
  );
}

function PaymentModal({ event, workers, payment, onClose, onSave }: { event: Event; workers: Worker[]; payment?: PaymentRecord; onClose: () => void; onSave: (payment: PaymentRecord) => void }) {
  const confirmedIds = new Set(effectiveConfirmedWorkerIds(event));
  const confirmed = workers.filter((worker) => confirmedIds.has(worker.id));
  const fallbackWorkerId = confirmed[0]?.id || workers[0]?.id || "";
  const [workerId, setWorkerId] = useState(payment?.workerId || fallbackWorkerId);
  const [amountPaid, setAmountPaid] = useState(String(payment?.amountPaid || ""));
  const [paidAt, setPaidAt] = useState(payment?.paidAt?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(payment?.note || "");

  function save() {
    const timestamp = nowIso();
    onSave({
      id: payment?.id || createId("payment"),
      eventId: event.id,
      workerId,
      amountPaid: Number(amountPaid || 0),
      paidAt: paidAt ? new Date(`${paidAt}T12:00`).toISOString() : undefined,
      note,
      createdAt: payment?.createdAt || timestamp,
      updatedAt: timestamp
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm">
      <section className="mx-auto w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-coral">Payment</p>
            <h2 className="text-2xl font-black text-ink dark:text-white">{payment ? "Edit Payment" : "Add Payment"}</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="mt-5 space-y-3">
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
            {confirmed.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
            {workers.filter((worker) => !confirmedIds.has(worker.id)).map((worker) => <option key={worker.id} value={worker.id}>{worker.name} (not confirmed)</option>)}
          </select>
          <input type="number" min={0} step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="Amount paid" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button onClick={onClose} className="min-h-12 rounded-xl bg-slate-100 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Cancel</button>
          <button onClick={save} className="min-h-12 rounded-xl bg-coral font-black text-white">Save Payment</button>
        </div>
      </section>
    </div>
  );
}

export function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event>();
  const [loading, setLoading] = useState(true);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [showWorkers, setShowWorkers] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | "new" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [caption, setCaption] = useState("");
  const [newChecklistLabel, setNewChecklistLabel] = useState("");
  const [liveNoteText, setLiveNoteText] = useState("");
  const [weather, setWeather] = useState<WeatherSummary>();
  const [qrUrl, setQrUrl] = useState("");
  const captionRef = useRef<HTMLElement>(null);
  const paymentRef = useRef<HTMLElement>(null);
  const qrRef = useRef<HTMLElement>(null);

  async function load() {
    if (!id) return;
    setErrorMessage("");
    try {
      const [eventRow, workerRows] = await Promise.all([getPlannerEvent(id), listWorkers()]);
      setEvent(eventRow);
      setWorkers(workerRows);
      if (!eventRow) setErrorMessage("This event could not be found.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load event.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  useEffect(() => {
    if (!event) return;
    const address = [event.address, event.city, event.state].filter(Boolean).join(", ");
    void getEventWeather(address, event.startDate).then(setWeather).catch(() => setWeather(undefined));
  }, [event?.id, event?.address, event?.city, event?.state, event?.startDate]);

  function jump(ref: React.RefObject<HTMLElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveWorkers(dayWorkerRows: EventDayWorker[]) {
    if (!event) return;
    setErrorMessage("");
    const workerIds = Array.from(new Set(dayWorkerRows.map((row) => row.workerId)));
    const updated = { ...event, confirmedWorkerIds: workerIds, eventDayWorkers: dayWorkerRows, updatedAt: new Date().toISOString() };
    try {
      await savePlannerEvent(updated);
      const refreshed = await getPlannerEvent(event.id);
      setEvent(refreshed || updated);
      setShowWorkers(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      console.error("Supabase error:", message);
      setErrorMessage(message);
    }
  }

  async function removeAvailability(workerId: string, dayId?: string) {
    if (!event) return;
    const nextRows = (event.eventDayWorkers || []).filter((row) => !(row.workerId === workerId && (!dayId || row.eventDayId === dayId)));
    const nextWorkerIds = Array.from(new Set(nextRows.map((row) => row.workerId)));
    const updated = { ...event, eventDayWorkers: nextRows, confirmedWorkerIds: nextWorkerIds, updatedAt: nowIso() };
    try {
      await savePlannerEvent(updated);
      setEvent(await getPlannerEvent(event.id) || updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not remove availability.");
    }
  }

  async function clearAvailability() {
    if (!event) return;
    const updated = { ...event, eventDayWorkers: [], confirmedWorkerIds: [], updatedAt: nowIso() };
    try {
      await savePlannerEvent(updated);
      setEvent(await getPlannerEvent(event.id) || updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not clear availability.");
    }
  }

  async function savePayment(payment: PaymentRecord) {
    if (!event) return;
    const records = event.paymentRecords || [];
    const updatedRecords = records.some((record) => record.id === payment.id) ? records.map((record) => record.id === payment.id ? payment : record) : [...records, payment];
    const updated = { ...event, paymentRecords: updatedRecords, updatedAt: nowIso() };
    try {
      await savePaymentRecord(payment);
      const refreshed = await getPlannerEvent(event.id);
      setEvent(refreshed || updated);
      setEditingPayment(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      console.error("Supabase error:", message);
      setErrorMessage(message);
    }
  }

  async function deletePayment(paymentId: string) {
    if (!event) return;
    const updated = { ...event, paymentRecords: (event.paymentRecords || []).filter((record) => record.id !== paymentId), updatedAt: nowIso() };
    try {
      await deletePaymentRecord(paymentId);
      const refreshed = await getPlannerEvent(event.id);
      setEvent(refreshed || updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete payment.");
    }
  }

  async function remove() {
    if (!event || !window.confirm("Delete this event?")) return;
    await deletePlannerEvent(event.id);
    navigate("/events");
  }

  async function updateEventStatus(status: EventStatus) {
    if (!event) return;
    const updated = { ...event, status, updatedAt: nowIso() };
    try {
      await savePlannerEvent(updated);
      setEvent(await getPlannerEvent(event.id) || updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update event status.");
    }
  }

  async function updateEventStage(stage: EventStage) {
    if (!event) return;
    const updated = { ...event, eventStage: stage, updatedAt: nowIso() };
    console.info("Updating event stage", { eventId: event.id, eventName: event.name, event_stage: stage });
    setEvent(updated);
    try {
      await savePlannerEvent(updated);
      setEvent(await getPlannerEvent(event.id) || updated);
    } catch (error) {
      setEvent(event);
      setErrorMessage(error instanceof Error ? error.message : "Could not update event stage.");
    }
  }

  async function saveChecklist(item: EventChecklistItem) {
    if (!event) return;
    try {
      await saveChecklistItem(item);
      setEvent(await getPlannerEvent(event.id) || event);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save checklist item.");
    }
  }

  async function addChecklistItem() {
    if (!event || !newChecklistLabel.trim()) return;
    const timestamp = nowIso();
    await saveChecklist({ id: createId("checklist"), eventId: event.id, label: newChecklistLabel.trim(), completed: false, createdAt: timestamp, updatedAt: timestamp });
    setNewChecklistLabel("");
  }

  async function removeChecklistItem(itemId: string) {
    if (!event) return;
    try {
      await deleteChecklistItem(itemId);
      setEvent(await getPlannerEvent(event.id) || event);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete checklist item.");
    }
  }

  async function saveFinanceField(patch: Partial<EventFinance>) {
    if (!event) return;
    try {
      const finance = { ...(event.finance || emptyFinance(event.id)), ...patch, eventId: event.id };
      await saveFinance(finance);
      setEvent(await getPlannerEvent(event.id) || { ...event, finance });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save finance.");
    }
  }

  async function saveEventImage(image: { imageUrl?: string; imagePath?: string }) {
    if (!event) return;
    const updated = { ...event, imageUrl: image.imageUrl, imagePath: image.imagePath, updatedAt: nowIso() };
    try {
      await savePlannerEvent(updated);
      setEvent(await getPlannerEvent(event.id) || updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save image.");
    }
  }

  async function addLiveNote() {
    if (!event || !liveNoteText.trim()) return;
    const timestamp = nowIso();
    try {
      await saveLiveNote({ id: createId("note"), eventId: event.id, content: liveNoteText.trim(), createdAt: timestamp, updatedAt: timestamp });
      setLiveNoteText("");
      setEvent(await getPlannerEvent(event.id) || event);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save live note.");
    }
  }

  async function updateSalesCategory(categoryId: string, amount: number) {
    if (!event) return;
    const item = (event.salesCategories || []).find((sale) => sale.id === categoryId);
    if (!item) return;
    try {
      await saveSalesCategory({ ...item, amount, updatedAt: nowIso() });
      setEvent(await getPlannerEvent(event.id) || event);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save category sale.");
    }
  }

  async function updateReview(patch: Partial<NonNullable<Event["review"]>>) {
    if (!event) return;
    try {
      const review = { ...(event.review || emptyReview(event.id)), ...patch, eventId: event.id };
      await saveReview(review);
      setEvent(await getPlannerEvent(event.id) || { ...event, review });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save review.");
    }
  }

  async function duplicateEvent() {
    if (!event) return;
    const timestamp = nowIso();
    const newId = createId("event");
    const copy = {
      ...event,
      id: newId,
      name: `${event.name} Copy`,
      status: "interested" as const,
      externalSource: undefined,
      externalSourceId: undefined,
      calendarFeedId: undefined,
      importedFromCalendar: false,
      manuallyEdited: false,
      paymentRecords: [],
      finance: undefined,
      review: undefined,
      liveNotes: [],
      confirmedWorkerIds: event.confirmedWorkerIds || [],
      eventDays: (event.eventDays || []).map((day) => ({ ...day, id: createId("day"), eventId: newId, createdAt: timestamp, updatedAt: timestamp })),
      checklistItems: (event.checklistItems || []).map((item) => ({ ...item, id: createId("checklist"), eventId: newId, completed: false, createdAt: timestamp, updatedAt: timestamp })),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await savePlannerEvent(copy);
    navigate(`/events/${newId}/edit`);
  }

  async function savePriceOptions(options: EventPriceOption[]) {
    if (!event) return;
    const normalized = options.map((option, index) => ({ ...option, isSelected: option.isSelected && options.findIndex((item) => item.isSelected) === index, updatedAt: nowIso() }));
    const updated = { ...event, priceOptions: normalized, eventCost: normalized.find((option) => option.isSelected)?.price ?? event.eventCost, updatedAt: nowIso() };
    try {
      await savePlannerEvent(updated);
      setEvent(await getPlannerEvent(event.id) || updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save price options.");
    }
  }

  async function addPriceOption() {
    if (!event) return;
    const timestamp = nowIso();
    const option: EventPriceOption = {
      id: createId("price"),
      eventId: event.id,
      label: "New Price Option",
      price: 0,
      pricingType: "flat",
      isSelected: !(event.priceOptions || []).some((item) => item.isSelected),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await savePriceOptions([...(event.priceOptions || []), option]);
  }

  async function updatePriceOption(optionId: string, patch: Partial<EventPriceOption>) {
    if (!event) return;
    const options = (event.priceOptions || []).map((option) => option.id === optionId ? { ...option, ...patch, updatedAt: nowIso() } : option);
    await savePriceOptions(options);
  }

  async function selectPriceOption(optionId: string) {
    if (!event) return;
    const options = (event.priceOptions || []).map((option) => ({ ...option, isSelected: option.id === optionId, updatedAt: nowIso() }));
    await savePriceOptions(options);
  }

  async function removePriceOption(optionId: string) {
    if (!event) return;
    try {
      await deletePriceOption(optionId);
      const options = (event.priceOptions || []).filter((option) => option.id !== optionId);
      const normalized = options.some((option) => option.isSelected) || !options.length ? options : options.map((option, index) => ({ ...option, isSelected: index === 0 }));
      const updated = { ...event, priceOptions: normalized, updatedAt: nowIso() };
      await savePlannerEvent(updated);
      setEvent(await getPlannerEvent(event.id) || updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete price option.");
    }
  }

  if (loading) return (
    <LoadingScreen label="Loading event details..."><div className="space-y-4 lg:mx-auto lg:max-w-7xl">
      <div className="animate-pulse overflow-hidden rounded-3xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <div className="aspect-[4/5] max-h-[65vh] rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="mt-4 h-8 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="mt-2 h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="grid gap-3 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>
    </div></LoadingScreen>
  );
  if (!event) return <ErrorState message="Event details could not be loaded." details={errorMessage} onRetry={load} onSync={load} />;

  const effectiveWorkerIds = effectiveConfirmedWorkerIds(event);
  const confirmed = workers.filter((worker) => effectiveWorkerIds.includes(worker.id));
  const destination = event.address || [event.venueName, event.city, event.state].filter(Boolean).join(", ");
  const paymentSummary = calculatePaymentSummary(event, workers);
  const checklist = checklistProgress(event);
  const finance = event.finance || emptyFinance(event.id);
  const profit = calculateEventProfit(event, finance);
  const confirmedIds = new Set(effectiveWorkerIds);
  const driveMinutes = estimateDriveMinutes(event.distanceMiles);
  const leaveBy = departureTime(event.startDate, event.setupTime, driveMinutes);
  const totalCategorySales = (event.salesCategories || []).reduce((sum, sale) => sum + Number(sale.amount || 0), 0);
  const initials = event.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const unconfirmedPaymentWarnings = (event.paymentRecords || []).filter((record) => !confirmedIds.has(record.workerId)).map((record) => workers.find((worker) => worker.id === record.workerId)?.name || "Someone");
  const availabilityByWorker = availabilitySummaryByWorker(event, workers);
  const workerSummary = availabilityByWorker.length ? availabilityByWorker.map((item) => item.text).join(" / ") : "Nobody confirmed yet";
  const scheduleSummary = eventDays(event).map((day) => formatEventDay(day)).join(" / ");
  const boothSummary = event.boothNumber || event.floorSection || event.setupTime || "Not set";
  const notesSummary = event.packingNotes ? "Packing notes added" : "No notes yet";
  const reviewAverage = event.review ? [event.review.overallRating, event.review.trafficRating, event.review.organizerRating, event.review.profitRating].filter(Boolean).reduce((sum, value) => sum + Number(value), 0) / Math.max(1, [event.review.overallRating, event.review.trafficRating, event.review.organizerRating, event.review.profitRating].filter(Boolean).length) : 0;
  const selectedPrice = paymentSummary.selectedPriceOption;
  const currentStage = event.eventStage || "new";
  const isDatePast = eventTimingStatus(event.startDate) === "Past";

  return (
    <div className="space-y-4 lg:mx-auto lg:grid lg:max-w-7xl lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-5 lg:space-y-0">
      <header className="overflow-hidden rounded-3xl bg-ink text-white shadow-soft lg:col-start-1 dark:bg-slate-900">
        <EventImageFrame imageUrl={event.imageUrl} initials={initials} className="aspect-[4/5] max-h-[72vh] rounded-none" />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <StatusChip value={event.registrationStatus} />
            {event.importedFromCalendar ? <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-200">Imported from Calendar</span> : null}
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">{eventTimingStatus(event.startDate)}</span>
            <select value={event.status || "interested"} onChange={(e) => updateEventStatus(e.target.value as EventStatus)} className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-white">
              {["interested", "registered", "paid", "preparing", "completed", "skipped"].map((status) => <option key={status} value={status} className="text-ink">{status}</option>)}
            </select>
          </div>
          <div>
            <h1 className="text-3xl font-black leading-tight">{event.name}</h1>
            <p className="mt-1 text-sm text-slate-300">{displayDate(event.startDate)}{event.startTime ? ` | ${event.startTime}${event.endTime ? `-${event.endTime}` : ""}` : ""}</p>
            <p className="mt-2 text-sm font-bold text-orange-200">{workerSummary}</p>
          </div>
        </div>
      </header>

      <nav className="sticky top-0 z-20 -mx-4 border-y border-slate-200 bg-paper/95 px-4 py-2 backdrop-blur lg:top-6 lg:col-start-2 lg:row-span-2 lg:mx-0 lg:rounded-2xl lg:border lg:bg-white/90 lg:p-3 lg:shadow-soft dark:border-slate-800 dark:bg-slate-950/95 lg:dark:bg-slate-900">
        <div className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-2 lg:overflow-visible lg:pb-0">
          <Link to={`/events/${event.id}/edit`} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><Edit size={15} /> Edit</Link>
          {destination ? <a href={googleMapsDirectionsLink(destination)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><Map size={15} /> Map</a> : event.importedFromCalendar ? <a href={njPokemonEventsMap.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><Map size={15} /> NJ Events Map</a> : null}
          <button onClick={() => jump(captionRef)} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><MessageSquare size={15} /> IG Caption</button>
          <button onClick={() => setEditingPayment("new")} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-coral px-3 text-sm font-bold text-white shadow-soft"><DollarSign size={15} /> Add Payment</button>
          <Link to={`/sales?mode=sale&eventId=${encodeURIComponent(event.id)}`} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-ink px-3 text-sm font-bold text-white shadow-soft dark:bg-coral"><Camera size={15} /> Quick Sale</Link>
          <button onClick={() => jump(qrRef)} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><QrCode size={15} /> QR</button>
          <button onClick={duplicateEvent} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><CopyPlus size={15} /> Duplicate</button>
        </div>
      </nav>

      {errorMessage ? <p className="rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700 lg:col-span-2 dark:bg-rose-950/40 dark:text-rose-200">{errorMessage}</p> : null}

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft lg:col-start-1 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-ink dark:text-white">Event Stage</h2>
            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">{eventStageDescriptions[currentStage]}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold text-white ${eventStageAccentClasses[currentStage]}`}>{eventStageLabels[currentStage]}</span>
        </div>
        {isDatePast && currentStage !== "past" ? <p className="rounded-xl bg-sky-50 p-3 text-xs font-bold text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">This event date is in the past. You may want to mark it Past.</p> : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["new", "applied", "paid", "past"] as EventStage[]).map((stage) => (
            <button key={stage} onClick={() => updateEventStage(stage)} className={`min-h-10 rounded-xl px-3 text-xs font-black transition ${currentStage === stage ? `${eventStageAccentClasses[stage]} text-white shadow-soft` : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200"}`}>
              {eventStageLabels[stage]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 text-sm text-slate-700 shadow-soft lg:col-start-1 dark:bg-slate-900 dark:text-slate-300">
        <h2 className="font-black text-ink dark:text-white">Schedule</h2>
        <div className="space-y-1">{eventDays(event).map((day) => <p key={day.id}>{formatEventDay(day)}</p>)}</div>
        <div className="grid gap-1 pt-2">
          <p><strong>Venue:</strong> {event.venueName || "Not set"}</p>
          <p><strong>Address:</strong> {[event.address, event.city, event.state].filter(Boolean).join(", ") || "Not set"}</p>
        </div>
      </section>

      <section className="rounded-2xl bg-white/90 p-4 shadow-soft lg:col-start-1 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 font-black text-ink dark:text-white"><Users size={18} /> Confirmed Workers</h2>
        <div className="mt-3 space-y-3">
          {eventDays(event).map((day) => {
            const dayWorkers = workersForDay(event, day.id, workers);
            return (
              <div key={day.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
                <p className="text-sm font-black text-ink dark:text-white">{formatEventDay(day)}</p>
                {dayWorkers.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {dayWorkers.map((worker) => (
                      <span key={worker.id} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {worker.name}
                        <button onClick={() => removeAvailability(worker.id, day.id)} className="rounded-full text-slate-400 hover:text-rose-600"><X size={13} /></button>
                      </span>
                    ))}
                  </div>
                ) : <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Nobody confirmed for this day.</p>}
              </div>
            );
          })}
        </div>
        {availabilityByWorker.length ? (
          <div className="mt-3 rounded-xl bg-orange-50 p-3 text-xs font-bold text-orange-800 dark:bg-orange-950/30 dark:text-orange-200">
            {availabilityByWorker.map((item) => <p key={item.workerId}>{item.text}</p>)}
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setShowWorkers(true)} className="min-h-11 rounded-xl bg-coral font-black text-white transition active:scale-[0.99]">I can work this event</button>
          <button onClick={clearAvailability} className="min-h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Clear all</button>
        </div>
      </section>

      <section ref={paymentRef} className="scroll-mt-20 space-y-4 rounded-2xl bg-white/90 p-4 shadow-soft lg:col-start-1 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-black text-ink dark:text-white"><DollarSign size={18} /> Payment Split</h2>
          <button onClick={() => setEditingPayment("new")} className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-ink px-3 text-xs font-bold text-white dark:bg-coral"><Plus size={14} /> Add</button>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/70">
          <p className="font-bold text-ink dark:text-white">Selected price: {selectedPrice ? `${selectedPrice.label} | ${formatMoney(selectedPrice.price)}` : `Manual event cost | ${formatMoney(event.eventCost || 0)}`}</p>
          <label className="mt-2 block text-xs font-bold text-slate-500 dark:text-slate-400">
            Split mode
            <select value={event.splitMode || "equal"} onChange={(e) => savePlannerEvent({ ...event, splitMode: e.target.value as SplitMode, updatedAt: nowIso() }).then(() => load())} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white">
              <option value="equal">Equal per confirmed worker</option>
              <option value="weighted_by_days">Weighted by days worked</option>
            </select>
          </label>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{event.splitMode === "weighted_by_days" ? "Weighted split uses each worker's day count." : "Advanced day-based split available by switching to weighted mode."}</p>
        </div>
        {paymentSummary.confirmedWorkerCount === 0 ? (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">Add confirmed workers to calculate split.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70"><p className="text-slate-500 dark:text-slate-400">Total cost</p><p className="font-black text-ink dark:text-white">{formatMoney(paymentSummary.totalCost)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70"><p className="text-slate-500 dark:text-slate-400">Equal share</p><p className="font-black text-ink dark:text-white">{formatMoney(paymentSummary.equalSharePerWorker)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/30"><p className="text-slate-500 dark:text-slate-400">Paid</p><p className="font-black text-emerald-700 dark:text-emerald-300">{formatMoney(paymentSummary.totalPaid)}</p></div>
              <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/30"><p className="text-slate-500 dark:text-slate-400">Remaining</p><p className="font-black text-amber-700 dark:text-amber-300">{formatMoney(Math.max(paymentSummary.totalRemaining, 0))}</p></div>
            </div>
            {paymentSummary.isOverpaid ? <p className="rounded-xl bg-orange-50 p-3 text-sm font-bold text-orange-700 dark:bg-orange-950/30 dark:text-orange-200">Event is overpaid by {formatMoney(paymentSummary.overpaidAmount)}.</p> : null}
            {paymentSummary.internalBalanceNotes.map((note) => <p key={note} className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">Internal note: {note}</p>)}
            {unconfirmedPaymentWarnings.map((name) => <p key={name} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{name} has payment records but is no longer confirmed.</p>)}
            <div className="space-y-2">
              {paymentSummary.perWorkerSummary.map((worker) => (
                <div key={worker.workerId} className="rounded-xl border border-slate-100 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black text-ink dark:text-white">{worker.workerName}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${worker.status === "paid" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : worker.status === "overpaid" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>{worker.status === "overpaid" ? "Covered extra" : worker.status}</span>
                  </div>
                  <p className="mt-2 text-slate-600 dark:text-slate-300">Expected {formatMoney(worker.expectedShare)} | Paid {formatMoney(worker.amountPaid)} | {worker.balance > 0 ? `Owes ${formatMoney(worker.balance)}` : worker.balance < 0 ? `Overpaid ${formatMoney(Math.abs(worker.balance))}` : "Paid up"}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Covered {worker.percentOfTotalPaid.toFixed(2)}% of total cost</p>
                </div>
              ))}
            </div>
          </>
        )}
        {(event.paymentRecords || []).length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-black text-ink dark:text-white">Payment Records</h3>
            {(event.paymentRecords || []).map((record) => (
              <div key={record.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/70">
                <div>
                  <p className="font-bold text-ink dark:text-white">{workers.find((worker) => worker.id === record.workerId)?.name || "Unknown"} | {formatMoney(record.amountPaid)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{record.note || "No note"}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditingPayment(record)} className="rounded-lg bg-white px-3 py-2 text-xs font-bold dark:bg-slate-800 dark:text-white">Edit</button>
                  <button onClick={() => deletePayment(record.id)} className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section ref={captionRef} className="scroll-mt-20 space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft lg:col-start-1 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-black text-ink dark:text-white">Instagram Caption</h2>
          <button onClick={() => setCaption(generateInstagramCaption(event))} className="rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white dark:bg-coral">Generate</button>
        </div>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Generate a caption to edit and copy." className="min-h-32 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
        <button onClick={() => navigator.clipboard.writeText(caption)} disabled={!caption} className="min-h-11 w-full rounded-xl bg-slate-100 text-sm font-bold text-ink disabled:opacity-50 dark:bg-slate-800 dark:text-white">Copy Caption</button>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft lg:col-start-2 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-black text-ink dark:text-white">Price Options</h2>
          <button onClick={addPriceOption} className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-ink px-3 text-xs font-bold text-white dark:bg-coral"><Plus size={14} /> Add</button>
        </div>
        {(event.priceOptions || []).length ? (
          <div className="space-y-3">
            {(event.priceOptions || []).map((option) => (
              <div key={option.id} className={`space-y-2 rounded-2xl border p-3 ${option.isSelected ? "border-coral bg-orange-50 dark:bg-orange-950/20" : "border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <input value={option.label} onChange={(e) => updatePriceOption(option.id, { label: e.target.value })} className="w-full bg-transparent text-sm font-black text-ink outline-none dark:text-white" />
                    <input value={option.description || ""} onChange={(e) => updatePriceOption(option.id, { description: e.target.value })} placeholder="Description" className="mt-1 w-full bg-transparent text-xs text-slate-500 outline-none dark:text-slate-400" />
                  </div>
                  <button onClick={() => removePriceOption(option.id)} className="rounded-lg p-2 text-rose-700 dark:text-rose-300"><Trash2 size={15} /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" min={0} step="0.01" value={option.price || ""} onChange={(e) => updatePriceOption(option.id, { price: Number(e.target.value || 0) })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                  <select value={option.pricingType} onChange={(e) => updatePriceOption(option.id, { pricingType: e.target.value as PricingType })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white">
                    <option value="flat">Flat</option>
                    <option value="per_day">Per day</option>
                    <option value="package">Package</option>
                  </select>
                </div>
                <button onClick={() => selectPriceOption(option.id)} className={`min-h-10 w-full rounded-xl text-sm font-bold ${option.isSelected ? "bg-coral text-white" : "bg-white text-ink dark:bg-slate-800 dark:text-white"}`}>
                  {option.isSelected ? `Selected | ${formatMoney(option.price)}` : "Select option"}
                </button>
              </div>
            ))}
          </div>
        ) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">No price options yet. Payment split uses the manual event cost.</p>}
      </section>

      <div className="space-y-3 lg:col-start-2">
        <Accordion title="Inventory & Packing Notes" summary={notesSummary} icon={<ImagePlus size={18} />}>
          <textarea value={event.packingNotes || ""} onChange={(e) => savePlannerEvent({ ...event, packingNotes: e.target.value, updatedAt: nowIso() }).then(() => load())} placeholder="Bring slabs, binders, tablecloth..." className="min-h-28 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
        </Accordion>

        <Accordion title="Booth & Setup" summary={boothSummary} icon={<CalendarCheck size={18} />}>
          <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
            <p><strong>Booth:</strong> {event.boothNumber || "Not set"}</p>
            <p><strong>Setup:</strong> {event.setupTime || "Not set"}</p>
            <p><strong>Section:</strong> {event.floorSection || "Not set"}</p>
            <p><strong>Parking:</strong> {event.parkingNotes || "Not set"}</p>
            <p><strong>Entry:</strong> {event.entryInstructions || "Not set"}</p>
          </div>
        </Accordion>

        <Accordion title="Weather" summary={weather ? `${weather.label}, ${weather.rainChance}% rain` : "Unavailable"} icon={<Map size={18} />}>
          <p className="text-lg font-black text-ink dark:text-white">{weather ? `${weather.icon} ${weather.label}` : "Unavailable"}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{weather?.rainChance !== undefined ? `${weather.rainChance}% rain chance` : "Forecast appears when available."}</p>
        </Accordion>

        <Accordion title="Travel" summary={leaveBy ? `Leave by ${leaveBy}` : driveMinutes ? `${driveMinutes} min estimate` : "Open maps for ETA"} icon={<Map size={18} />}>
          <p className="text-sm text-slate-600 dark:text-slate-300">{driveMinutes ? `${driveMinutes} min estimate` : "Open maps for ETA"}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{leaveBy ? `Leave by ${leaveBy}` : "Set setup time for a leave-by estimate."}</p>
        </Accordion>

        <Accordion title="Live Team Notes" summary={(event.liveNotes || []).length ? `${event.liveNotes?.length} notes` : "No notes yet"} icon={<MessageSquare size={18} />}>
          <div className="space-y-2">
            {(event.liveNotes || []).slice(0, 5).map((note) => <p key={note.id} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-950/70 dark:text-slate-300">{note.content}</p>)}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={liveNoteText} onChange={(e) => setLiveNoteText(e.target.value)} placeholder="Add a live note" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <button onClick={addLiveNote} className="rounded-xl bg-ink px-4 font-bold text-white dark:bg-coral"><Plus size={17} /></button>
          </div>
        </Accordion>

        <Accordion title="Preparation Checklist" summary={`${checklist.completed}/${checklist.total} completed`} icon={<CheckCircle2 size={18} />}>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-coral transition-all" style={{ width: `${checklist.percent}%` }} />
          </div>
          <div className="mt-3 space-y-2">
            {(event.checklistItems || []).map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-950/70">
                <input type="checkbox" checked={item.completed} onChange={(e) => saveChecklist({ ...item, completed: e.target.checked, updatedAt: nowIso() })} />
                <span className={`min-w-0 flex-1 text-sm ${item.completed ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>{item.label}</span>
                <button onClick={() => removeChecklistItem(item.id)} className="rounded-lg p-2 text-rose-700 dark:text-rose-300"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newChecklistLabel} onChange={(e) => setNewChecklistLabel(e.target.value)} placeholder="Add custom item" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <button onClick={addChecklistItem} className="rounded-xl bg-ink px-4 font-bold text-white dark:bg-coral"><Plus size={17} /></button>
          </div>
        </Accordion>

        <Accordion title="Profit Tracker" summary={formatMoney(profit.netProfit)} icon={<DollarSign size={18} />}>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={0} step="0.01" value={finance.totalSales || ""} onChange={(e) => saveFinanceField({ totalSales: Number(e.target.value || 0) })} placeholder="Total sales" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <input type="number" min={0} step="0.01" value={event.eventCost || ""} onChange={(e) => savePlannerEvent({ ...event, eventCost: Number(e.target.value || 0), updatedAt: nowIso() }).then(() => load())} placeholder="Event/table cost" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <input type="number" min={0} step="0.01" value={finance.gasCost || ""} onChange={(e) => saveFinanceField({ gasCost: Number(e.target.value || 0) })} placeholder="Gas" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <input type="number" min={0} step="0.01" value={finance.foodCost || ""} onChange={(e) => saveFinanceField({ foodCost: Number(e.target.value || 0) })} placeholder="Food" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <input type="number" min={0} step="0.01" value={finance.miscCost || ""} onChange={(e) => saveFinanceField({ miscCost: Number(e.target.value || 0) })} placeholder="Misc" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <input type="number" min={0} step="0.01" value={finance.totalExpenses || ""} onChange={(e) => saveFinanceField({ totalExpenses: Number(e.target.value || 0) })} placeholder="Other expenses" className="rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
          </div>
          <textarea value={finance.profitNotes || ""} onChange={(e) => saveFinanceField({ profitNotes: e.target.value })} placeholder="Profit notes" className="mt-3 min-h-20 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70"><p className="text-slate-500">Gross</p><p className="font-black">{formatMoney(profit.totalSales)}</p></div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70"><p className="text-slate-500">Expenses</p><p className="font-black">{formatMoney(profit.totalExpenses)}</p></div>
            <div className={`rounded-xl p-3 ${profit.netProfit >= 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"}`}><p>Profit</p><p className="font-black">{formatMoney(profit.netProfit)}</p></div>
          </div>
        </Accordion>

        <Accordion title="Sales by Category" summary={formatMoney(totalCategorySales)} icon={<DollarSign size={18} />}>
          <div className="space-y-2">
            {(event.salesCategories || []).map((sale) => (
              <div key={sale.id} className="grid grid-cols-[1fr_120px] items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">{sale.category}</span>
                <input type="number" min={0} step="0.01" value={sale.amount || ""} onChange={(e) => updateSalesCategory(sale.id, Number(e.target.value || 0))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              </div>
            ))}
          </div>
        </Accordion>

        <Accordion title="Event Review" summary={reviewAverage ? `${reviewAverage.toFixed(1)} stars` : "No rating yet"} icon={<Star size={18} />}>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["overallRating", "Overall"],
              ["trafficRating", "Traffic"],
              ["organizerRating", "Organizer"],
              ["profitRating", "Profit"]
            ].map(([key, label]) => (
              <label key={key} className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {label}
                <input type="number" min={0} max={5} step={0.5} value={Number((event.review as any)?.[key] || "")} onChange={(e) => updateReview({ [key]: Number(e.target.value || 0) } as any)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              </label>
            ))}
          </div>
          <textarea value={event.review?.notes || ""} onChange={(e) => updateReview({ notes: e.target.value })} placeholder="Great traffic but expensive tables..." className="mt-3 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
        </Accordion>

        <Accordion title="Event Image" summary={event.imageUrl ? "Image added" : "No image yet"} icon={<ImagePlus size={18} />}>
          <EventImageUploader eventId={event.id} imageUrl={event.imageUrl} onChange={saveEventImage} />
        </Accordion>

        <Accordion title="QR Utilities" summary="Event, map, register, 4 Nerds" icon={<QrCode size={18} />}>
          <section ref={qrRef} className="scroll-mt-20 grid grid-cols-2 gap-2">
            <button onClick={() => setQrUrl(window.location.href)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><QrCode size={16} /> Event QR</button>
            {destination ? <button onClick={() => setQrUrl(googleMapsDirectionsLink(destination))} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><QrCode size={16} /> Map QR</button> : null}
            {event.registrationUrl ? <button onClick={() => setQrUrl(event.registrationUrl || "")} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><QrCode size={16} /> Register QR</button> : null}
            <button onClick={() => setQrUrl("https://www.instagram.com/4nerds")} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><QrCode size={16} /> 4 Nerds QR</button>
          </section>
        </Accordion>
      </div>

      <section className="grid grid-cols-2 gap-2 lg:col-start-2">
        {event.registrationUrl ? <a href={event.registrationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><CalendarCheck size={16} /> Register</a> : null}
        {event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><ExternalLink size={16} /> Source</a> : null}
        <button onClick={remove} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-rose-50 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200"><Trash2 size={16} /> Delete Event</button>
      </section>

      {qrUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <section className="w-full max-w-xs rounded-3xl bg-white p-5 text-center shadow-2xl dark:bg-slate-900">
            <button onClick={() => setQrUrl("")} className="ml-auto block rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
            <img alt="QR code" className="mx-auto mt-3 h-56 w-56" src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrUrl)}`} />
            <p className="mt-3 break-all text-sm font-bold text-ink dark:text-white">{qrUrl}</p>
          </section>
        </div>
      ) : null}

      {showWorkers ? <WorkerModal event={event} workers={workers} onClose={() => setShowWorkers(false)} onSave={saveWorkers} /> : null}
      {editingPayment ? <PaymentModal event={event} workers={workers} payment={editingPayment === "new" ? undefined : editingPayment} onClose={() => setEditingPayment(null)} onSave={savePayment} /> : null}
    </div>
  );
}
