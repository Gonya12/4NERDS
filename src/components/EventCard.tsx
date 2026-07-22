import { ArrowUpRight, CalendarDays, CheckCircle2, DollarSign, MapPin, Users } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router-dom";
import type { Event, Worker } from "../types/models";
import { availabilitySummaryByWorker } from "../utils/availability";
import { eventStage, eventStageAccentClasses, eventStageCardClasses, eventStageLabels } from "../utils/eventStage";
import { checklistProgress } from "../utils/financeMath";
import { calculatePaymentSummary, formatMoney } from "../utils/paymentMath";
import { shortScheduleSummary } from "../utils/eventSchedule";
import { eventTimingStatus } from "../utils/eventStatus";
import { EventImageFrame } from "./EventImageFrame";
import { StatusChip } from "./StatusChip";

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
  const paidPercent = payment.totalCost > 0 ? Math.min((payment.totalPaid / payment.totalCost) * 100, 100) : 0;
  const paymentStatus = payment.confirmedWorkerCount === 0
    ? "Split unavailable"
    : payment.totalPaid === 0
      ? "No payments yet"
      : payment.totalRemaining <= 0
        ? payment.isOverpaid
          ? `Overpaid by ${formatMoney(payment.overpaidAmount)}`
          : "All paid"
        : `${formatMoney(payment.totalRemaining)} left`;

  return (
    <Link
      to={`/events/${event.id}`}
      aria-label={`Open ${event.name}`}
      className={`group relative block overflow-hidden rounded-panel border shadow-card backdrop-blur-sm transition duration-240 ease-premium hover:-translate-y-1 hover:shadow-elevated active:scale-[0.99] ${compact ? "p-3" : "p-3 sm:p-4"} ${eventStageCardClasses[stage]}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${eventStageAccentClasses[stage]}`} aria-hidden="true" />
      <div className={!compact ? "sm:grid sm:grid-cols-[minmax(160px,220px)_minmax(0,1fr)] sm:gap-4" : ""}>
        <EventImageFrame imageUrl={event.imageUrl} initials={initials} className={compact ? "mb-3 aspect-[4/3] max-h-[280px]" : "mb-4 aspect-[4/5] max-h-[620px] sm:mb-0"} />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap gap-1.5">
                <span className="status-pill bg-night-850 text-white dark:bg-slate-700">{timing}</span>
                <span className={`status-pill text-white ${eventStageAccentClasses[stage]}`}>{eventStageLabels[stage]}</span>
                {event.importedFromCalendar ? <span className="status-pill bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200">Imported</span> : null}
                <StatusChip value={event.registrationStatus} />
              </div>
              <h3 className={`${compact ? "text-[17px]" : "text-xl"} font-black leading-tight text-ink transition-colors group-hover:text-orange-700 dark:text-white dark:group-hover:text-orange-300`}>{event.name}</h3>
            </div>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 text-slate-400 transition duration-180 group-hover:border-orange-300 group-hover:bg-orange-50 group-hover:text-coral dark:border-slate-700 dark:bg-night-850 dark:group-hover:border-orange-500/50 dark:group-hover:bg-orange-950/30"><ArrowUpRight size={17} /></span>
          </div>

          <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 shrink-0 text-coral" size={16} /><span>{shortScheduleSummary(event)}</span></p>
            <p className="flex items-start gap-2"><MapPin className="mt-0.5 shrink-0 text-sky-500" size={16} /><span className="min-w-0 break-words">{[event.venueName, event.address, event.city, event.state].filter(Boolean).join(" | ") || "Location not set"}</span></p>
          </div>

          <div className="surface-muted mt-3 p-3 text-sm">
            <p className="flex items-center gap-2 font-bold text-ink dark:text-white"><Users className="text-violet-500" size={16} /> Confirmed team</p>
            <div className={`mt-1.5 space-y-1 ${availability.length || names.length ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
              {availability.length ? availability.slice(0, compact ? 2 : 3).map((item) => <p key={item.workerId}>{item.text}</p>) : <p>{names.length ? names.join(", ") : "Nobody confirmed yet"}</p>}
            </div>
            {!compact && checklist.total ? <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400"><CheckCircle2 size={14} /> {checklist.completed}/{checklist.total} tasks completed</p> : null}
            {!compact && event.packingNotes ? <p className="mt-1 text-xs font-bold text-coral">Packing notes added</p> : null}
          </div>

          <div className="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/80 p-3 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/20">
            {payment.totalCost > 0 ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-1.5 font-bold text-ink dark:text-white"><DollarSign className="shrink-0 text-emerald-600" size={16} /><span className="truncate">{payment.selectedPriceOption ? payment.selectedPriceOption.label : "Event cost"}</span></p>
                  <p className="shrink-0 font-black text-ink dark:text-white">{formatMoney(payment.totalCost)}</p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950"><span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${paidPercent}%` }} /></div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-600 dark:text-slate-300">{formatMoney(payment.totalPaid)} paid</span>
                  <span className={`font-bold ${payment.totalRemaining > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>{paymentStatus}</span>
                </div>
              </>
            ) : (
              <p className="flex items-center gap-2 font-bold text-slate-600 dark:text-slate-300"><DollarSign className="text-slate-400" size={16} /> No event cost set</p>
            )}
            {!compact && payment.perWorkerSummary.slice(0, 2).map((worker) => (
              <p key={worker.workerId} className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {worker.workerName}: {worker.status === "owes" ? `owes ${formatMoney(worker.balance)}` : `paid ${formatMoney(worker.amountPaid)}, covered ${worker.percentOfTotalPaid.toFixed(0)}%`}
              </p>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

export const EventCard = memo(EventCardBase);
