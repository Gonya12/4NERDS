import { CalendarCheck, DollarSign, Edit, ExternalLink, Map, Plus, Trash2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { StatusChip } from "../components/StatusChip";
import { googleMapsDirectionsLink } from "../services/distance/mapLinks";
import { deletePlannerEvent, getPlannerEvent, listWorkers, savePlannerEvent } from "../services/planner/plannerRepository";
import type { Event, PaymentRecord, Worker } from "../types/models";
import { displayDate } from "../utils/dateUtils";
import { eventTimingStatus } from "../utils/eventStatus";
import { calculatePaymentSummary, formatMoney } from "../utils/paymentMath";
import { id, nowIso } from "../utils/normalize";

function WorkerModal({
  event,
  workers,
  onClose,
  onSave
}: {
  event: Event;
  workers: Worker[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(event.confirmedWorkerIds || []);

  function toggle(workerId: string) {
    setSelected((current) => current.includes(workerId) ? current.filter((id) => id !== workerId) : [...current, workerId]);
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
        <div className="mt-5 flex flex-wrap gap-2">
          {workers.filter((worker) => worker.active).map((worker) => {
            const active = selected.includes(worker.id);
            return (
              <button
                key={worker.id}
                onClick={() => toggle(worker.id)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${active ? "bg-ink text-white shadow-soft dark:bg-coral" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}
              >
                {worker.name}
              </button>
            );
          })}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button onClick={onClose} className="min-h-12 rounded-xl bg-slate-100 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Cancel</button>
          <button onClick={() => onSave(selected)} className="min-h-12 rounded-xl bg-coral font-black text-white">Save Availability</button>
        </div>
      </section>
    </div>
  );
}

function PaymentModal({
  event,
  workers,
  payment,
  onClose,
  onSave
}: {
  event: Event;
  workers: Worker[];
  payment?: PaymentRecord;
  onClose: () => void;
  onSave: (payment: PaymentRecord) => void;
}) {
  const confirmed = workers.filter((worker) => (event.confirmedWorkerIds || []).includes(worker.id));
  const fallbackWorkerId = confirmed[0]?.id || workers[0]?.id || "";
  const [workerId, setWorkerId] = useState(payment?.workerId || fallbackWorkerId);
  const [amountPaid, setAmountPaid] = useState(String(payment?.amountPaid || ""));
  const [paidAt, setPaidAt] = useState(payment?.paidAt?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(payment?.note || "");

  function save() {
    const timestamp = nowIso();
    onSave({
      id: payment?.id || id("payment"),
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
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-3">
            {confirmed.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
            {workers.filter((worker) => !(event.confirmedWorkerIds || []).includes(worker.id)).map((worker) => <option key={worker.id} value={worker.id}>{worker.name} (not confirmed)</option>)}
          </select>
          <input type="number" min={0} step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="Amount paid" className="w-full rounded-xl border border-slate-200 px-3 py-3" />
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-3" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-3" />
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
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [showWorkers, setShowWorkers] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | "new" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  async function load() {
    if (!id) return;
    setEvent(await getPlannerEvent(id));
    setWorkers(await listWorkers());
  }

  useEffect(() => { void load(); }, [id]);

  async function saveWorkers(workerIds: string[]) {
    if (!event) return;
    setErrorMessage("");
    console.log("selectedWorkerIds", workerIds);
    console.log("eventId", event.id);
    console.log("saving availability");
    const updated = { ...event, confirmedWorkerIds: workerIds, updatedAt: new Date().toISOString() };
    try {
      await savePlannerEvent(updated);
      const refreshed = await getPlannerEvent(event.id);
      setEvent(refreshed || updated);
      setShowWorkers(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save availability.";
      console.error("Supabase error:", message);
      setErrorMessage(message);
    }
  }

  async function savePayment(payment: PaymentRecord) {
    if (!event) return;
    const records = event.paymentRecords || [];
    const updatedRecords = records.some((record) => record.id === payment.id)
      ? records.map((record) => record.id === payment.id ? payment : record)
      : [...records, payment];
    const updated = { ...event, paymentRecords: updatedRecords, updatedAt: nowIso() };
    await savePlannerEvent(updated);
    setEvent(updated);
    setEditingPayment(null);
  }

  async function deletePayment(paymentId: string) {
    if (!event) return;
    const updated = { ...event, paymentRecords: (event.paymentRecords || []).filter((record) => record.id !== paymentId), updatedAt: nowIso() };
    await savePlannerEvent(updated);
    setEvent(updated);
  }

  async function remove() {
    if (!event || !window.confirm("Delete this event?")) return;
    await deletePlannerEvent(event.id);
    navigate("/events");
  }

  if (!event) return <div className="text-sm text-slate-500 dark:text-slate-400">Loading event...</div>;

  const confirmed = workers.filter((worker) => (event.confirmedWorkerIds || []).includes(worker.id));
  const destination = event.address || [event.venueName, event.city, event.state].filter(Boolean).join(", ");
  const paymentSummary = calculatePaymentSummary(event, workers);
  const confirmedIds = new Set(event.confirmedWorkerIds || []);
  const unconfirmedPaymentWarnings = (event.paymentRecords || [])
    .filter((record) => !confirmedIds.has(record.workerId))
    .map((record) => workers.find((worker) => worker.id === record.workerId)?.name || "Someone");

  return (
    <div className="space-y-5">
      <header className="rounded-3xl bg-ink p-5 text-white shadow-soft dark:bg-slate-900">
        <p className="text-sm font-bold text-orange-300">{eventTimingStatus(event.startDate)}</p>
        <h1 className="mt-1 text-3xl font-black leading-tight">{event.name}</h1>
        <p className="mt-2 text-sm text-slate-300">{displayDate(event.startDate)}{event.startTime ? ` · ${event.startTime}${event.endTime ? `-${event.endTime}` : ""}` : ""}</p>
      </header>

      <section className="flex flex-wrap gap-2 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <StatusChip value={event.registrationStatus} />
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{eventTimingStatus(event.startDate)}</span>
      </section>

      <section className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <h2 className="flex items-center gap-2 font-black text-ink dark:text-white"><Users size={18} /> Confirmed Workers</h2>
        <p className={`mt-2 text-sm ${confirmed.length ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>{confirmed.length ? confirmed.map((worker) => worker.name).join(", ") : "Nobody confirmed yet"}</p>
        {errorMessage ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{errorMessage}</p> : null}
        <button onClick={() => setShowWorkers(true)} className="mt-4 min-h-12 w-full rounded-xl bg-coral font-black text-white transition active:scale-[0.99]">I can work this event</button>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 text-sm text-slate-700 shadow-soft dark:bg-slate-900 dark:text-slate-300">
        <p><strong>Venue:</strong> {event.venueName || "Not set"}</p>
        <p><strong>Address:</strong> {[event.address, event.city, event.state].filter(Boolean).join(", ") || "Not set"}</p>
        <p><strong>Vendor registration:</strong> {event.registrationUrl || "Not set"}</p>
        <p><strong>Source:</strong> {event.sourceUrl || "Not set"}</p>
        <p><strong>Notes:</strong> {event.notes || "None"}</p>
      </section>

      <section className="space-y-4 rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-black text-ink dark:text-white"><DollarSign size={18} /> Payment Split</h2>
          <button onClick={() => setEditingPayment("new")} className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white dark:bg-coral"><Plus size={14} /> Add Payment</button>
        </div>
        {paymentSummary.confirmedWorkerCount === 0 ? (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">Add confirmed workers to calculate split.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70"><p className="text-slate-500 dark:text-slate-400">Total cost</p><p className="font-black text-ink dark:text-white">{formatMoney(paymentSummary.totalCost)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70"><p className="text-slate-500 dark:text-slate-400">Equal share</p><p className="font-black text-ink dark:text-white">{formatMoney(paymentSummary.equalSharePerWorker)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/30"><p className="text-slate-500 dark:text-slate-400">Total paid</p><p className="font-black text-emerald-700 dark:text-emerald-300">{formatMoney(paymentSummary.totalPaid)}</p></div>
              <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/30"><p className="text-slate-500 dark:text-slate-400">Remaining</p><p className="font-black text-amber-700 dark:text-amber-300">{formatMoney(Math.max(paymentSummary.totalRemaining, 0))}</p></div>
            </div>
            {paymentSummary.isOverpaid ? <p className="rounded-xl bg-orange-50 p-3 text-sm font-bold text-orange-700">Event is overpaid by {formatMoney(paymentSummary.overpaidAmount)}.</p> : null}
            {paymentSummary.internalBalanceNotes.map((note) => <p key={note} className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-800">Internal note: {note}</p>)}
            {unconfirmedPaymentWarnings.map((name) => <p key={name} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{name} has payment records but is no longer confirmed.</p>)}
            <div className="space-y-2">
              {paymentSummary.perWorkerSummary.map((worker) => (
                <div key={worker.workerId} className="rounded-xl border border-slate-100 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black text-ink dark:text-white">{worker.workerName}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${worker.status === "paid" ? "bg-emerald-100 text-emerald-800" : worker.status === "overpaid" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>{worker.status === "overpaid" ? "Covered extra" : worker.status}</span>
                  </div>
                  <p className="mt-2 text-slate-600 dark:text-slate-300">Expected {formatMoney(worker.expectedShare)} · Paid {formatMoney(worker.amountPaid)} · {worker.balance > 0 ? `Owes ${formatMoney(worker.balance)}` : worker.balance < 0 ? `Overpaid ${formatMoney(Math.abs(worker.balance))}` : "Paid up"}</p>
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
                  <p className="font-bold text-ink dark:text-white">{workers.find((worker) => worker.id === record.workerId)?.name || "Unknown"} · {formatMoney(record.amountPaid)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{record.note || "No note"}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditingPayment(record)} className="rounded-lg bg-white px-3 py-2 text-xs font-bold dark:bg-slate-800 dark:text-white">Edit</button>
                  <button onClick={() => deletePayment(record.id)} className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-2">
        {event.registrationUrl ? <a href={event.registrationUrl} target="_blank" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><CalendarCheck size={16} /> Register</a> : null}
        {event.sourceUrl ? <a href={event.sourceUrl} target="_blank" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><ExternalLink size={16} /> Source</a> : null}
        {destination ? <a href={googleMapsDirectionsLink(destination)} target="_blank" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><Map size={16} /> Map</a> : null}
        <Link to={`/events/${event.id}/edit`} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft dark:bg-slate-900 dark:text-white"><Edit size={16} /> Edit</Link>
        <button onClick={remove} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-rose-50 text-sm font-bold text-rose-700"><Trash2 size={16} /> Delete Event</button>
      </section>

      {showWorkers ? <WorkerModal event={event} workers={workers} onClose={() => setShowWorkers(false)} onSave={saveWorkers} /> : null}
      {editingPayment ? <PaymentModal event={event} workers={workers} payment={editingPayment === "new" ? undefined : editingPayment} onClose={() => setEditingPayment(null)} onSave={savePayment} /> : null}
    </div>
  );
}
