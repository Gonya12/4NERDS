import { CalendarDays, DollarSign, MapPin, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { Event, Worker } from "../types/models";
import { eventTimingStatus } from "../utils/eventStatus";
import { shortScheduleSummary } from "../utils/eventSchedule";
import { checklistProgress } from "../utils/financeMath";
import { calculatePaymentSummary, formatMoney } from "../utils/paymentMath";
import { availabilitySummaryByWorker } from "../utils/availability";
import { EventImageFrame } from "./EventImageFrame";
import { StatusChip } from "./StatusChip";
import { memo } from "react";
import { eventStage, eventStageAccentClasses, eventStageCardClasses, eventStageLabels } from "../utils/eventStage";

function workerNames(event: Event, workers: Worker[]) {
  const ids = new Set(event.confirmedWorkerIds || []);
  return workers.filter((worker) => ids.has(worker.id)).map((worker) => worker.name);
}

function EventCardBase({ event, workers = [], compact = false }: { event: Event; workers?: Worker[]; compact?: boolean }) {
  const names = workerNames(event, workers);
  const availability = availabilitySummaryByWorker(event, workers);
  const timing = eventTimingStatus(event.startDate);
  const payment = calculatePaymentSummary(event, workers);
  const initials = event.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const stage = eventStage(event.eventStage);
  const checklist = checklistProgress(event);
  const paymentStatus = payment.confirmedWorkerCount === 0
    ? "Split unavailable until workers are confirmed"
    : payment.totalPaid === 0
      ? "No payments yet"
      : payment.totalRemaining <= 0
        ? payment.isOverpaid
          ? `Overpaid by ${formatMoney(payment.overpaidAmount)}`
          : "All paid"
        : `${formatMoney(payment.totalRemaining)} still owed`;

  return (
    <Link to={`/events/${event.id}`} className={`group relative block overflow-hidden rounded-2xl border shadow-soft backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99] ${compact ? "p-3" : "p-4"} ${eventStageCardClasses[stage]}`}>
      <span className={`absolute inset-y-0 left-0 w-1.5 ${eventStageAccentClasses[stage]}`} />
      <EventImageFrame imageUrl={event.imageUrl} initials={initials} className={`${compact ? "mb-3" : "mb-4"} aspect-[4/5] max-h-[620px]`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            <span className="rounded-full bg-ink px-3 py-1 text-xs font-bold text-white dark:bg-slate-700">{timing}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-bold text-white ${eventStageAccentClasses[stage]}`}>{eventStageLabels[stage]}</span>
            <StatusChip value={event.registrationStatus} />
          </div>
          <h3 className={`${compact ? "text-base" : "text-lg"} font-black leading-tight text-ink dark:text-white`}>{event.name}</h3>
        </div>
      </div>
      <div className={`${compact ? "mt-3" : "mt-4"} space-y-2 text-sm text-slate-600 dark:text-slate-300`}>
        <p className="flex items-center gap-2"><CalendarDays size={16} /> {shortScheduleSummary(event)}</p>
        <p className="flex items-center gap-2"><MapPin size={16} /> {[event.venueName, event.address, event.city, event.state].filter(Boolean).join(" · ") || "Location not set"}</p>
      </div>
      <div className={`${compact ? "mt-3" : "mt-4"} rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/70`}>
        <p className="flex items-center gap-2 font-bold text-ink dark:text-white"><Users size={16} /> Confirmed</p>
        <div className={`mt-1 space-y-1 ${availability.length || names.length ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
          {availability.length ? availability.slice(0, compact ? 2 : 3).map((item) => <p key={item.workerId}>{item.text}</p>) : <p>{names.length ? names.join(", ") : "Nobody confirmed yet"}</p>}
        </div>
        {!compact && checklist.total ? <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">{checklist.completed}/{checklist.total} tasks completed</p> : null}
        {!compact && event.packingNotes ? <p className="mt-1 text-xs font-bold text-coral">Packing notes added</p> : null}
      </div>
      <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
        <p className="flex items-center gap-2 font-bold text-ink dark:text-white"><DollarSign size={16} /> {payment.selectedPriceOption ? payment.selectedPriceOption.label : "Event cost"}: {formatMoney(payment.totalCost)}</p>
        <p className="mt-1 text-slate-700 dark:text-slate-300">Paid: {formatMoney(payment.totalPaid)} / {formatMoney(payment.totalCost)}</p>
        <p className={`mt-1 text-xs font-bold ${payment.totalRemaining > 0 ? "text-amber-700" : "text-emerald-700"}`}>{paymentStatus}</p>
        {!compact && payment.perWorkerSummary.slice(0, 2).map((worker) => (
          <p key={worker.workerId} className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {worker.workerName}: {worker.status === "owes" ? `owes ${formatMoney(worker.balance)}` : `paid ${formatMoney(worker.amountPaid)}, covered ${worker.percentOfTotalPaid.toFixed(0)}%`}
          </p>
        ))}
      </div>
    </Link>
  );
}

export const EventCard = memo(EventCardBase);
