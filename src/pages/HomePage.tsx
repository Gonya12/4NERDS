import { CalendarDays, CalendarSync, Camera, CheckCircle2, DollarSign, HelpCircle, Package, Plus, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { EventCard } from "../components/EventCard";
import { InstallPrompt } from "../components/InstallPrompt";
import { LoadingScreen } from "../components/LoadingScreen";
import { SkeletonEventCard } from "../components/SkeletonEventCard";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { getCachedPlannerHomeEvents, listPlannerHomeEvents, listWorkers } from "../services/planner/plannerRepository";
import { appBuildTime, appVersion } from "../services/debug/debugLog";
import type { Event, Worker } from "../types/models";
import { effectiveConfirmedWorkerIds } from "../utils/availability";
import { eventTimingStatus } from "../utils/eventStatus";
import { eventDays } from "../utils/eventSchedule";
import { calculateEventProfit } from "../utils/financeMath";
import { calculatePaymentSummary, formatMoney } from "../utils/paymentMath";
import { eventStageAccentClasses, eventStageDescriptions } from "../utils/eventStage";
import { isPlannedEvent } from "../utils/eventCommitment";
import { actionCooldownRemainingSeconds, canRunAction, getSupabaseStatus, markActionRun, recordPageLoad } from "../utils/supabase";

export function HomePage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [showLegend, setShowLegend] = useState(false);

  async function load(manual = false) {
    recordPageLoad("Home");
    const key = "home-dashboard-sync";
    if (manual) {
      if (!canRunAction(key, 30_000)) {
        setSyncError(`Please wait ${actionCooldownRemainingSeconds(key, 30_000)}s before syncing again.`);
        return;
      }
      markActionRun(key);
    }
    setSyncing(true);
    setSyncMessage("Syncing...");
    setSyncError("");
    const [eventsResult, workersResult] = await Promise.allSettled([listPlannerHomeEvents(100), listWorkers()]);
    const failures: string[] = [];

    if (eventsResult.status === "fulfilled") {
      setEvents(eventsResult.value);
    } else {
      failures.push(formatDashboardFailure("listPlannerHomeEvents", "events", eventsResult.reason));
    }

    if (workersResult.status === "fulfilled") {
      setWorkers(workersResult.value);
    } else {
      failures.push(formatDashboardFailure("listWorkers", "workers", workersResult.reason));
    }

    const supabaseStatus = getSupabaseStatus();
    if (supabaseStatus.error && !failures.some((failure) => failure.includes(supabaseStatus.error))) {
      failures.push(`Partial sync warning:\n${supabaseStatus.error}`);
    }
    setSyncMessage("");
    setSyncError(failures.length ? buildDashboardErrorDetails(failures) : "");
    setLoading(false);
    setSyncing(false);
  }

  useEffect(() => {
    const cached = getCachedPlannerHomeEvents();
    if (cached.length) {
      setEvents(cached);
      setLoading(false);
    }
    void load(false);
  }, []);

  const upcoming = useMemo(() => events.filter((event) => eventTimingStatus(event.startDate) !== "Past"), [events]);
  const plannedUpcoming = useMemo(() => upcoming
    .filter((event) => {
      const planned = isPlannedEvent(event, workers);
      const payment = calculatePaymentSummary(event, workers);
      console.info("Planned event check", {
        name: event.name,
        event_stage: event.eventStage,
        registration_status: event.registrationStatus,
        totalPaid: payment.totalPaid,
        totalCost: payment.totalCost,
        isPlannedEvent: planned,
        startDate: event.startDate
      });
      return planned;
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate)), [upcoming, workers]);
  const completedEvents = useMemo(() => events.filter((event) => event.status === "completed" || eventTimingStatus(event.startDate) === "Past"), [events]);
  const highlighted = plannedUpcoming.filter((event) => ["Today", "Tomorrow", "This Week"].includes(eventTimingStatus(event.startDate)));
  const now = new Date();
  const projectedCosts = upcoming.reduce((sum, event) => sum + Number((event.priceOptions || []).find((option) => option.isSelected)?.price ?? event.eventCost ?? 0), 0);
  const upcomingEventDays = upcoming.flatMap((event) => eventDays(event).map((day) => ({ event, day }))).filter(({ day }) => new Date(`${day.date.slice(0, 10)}T23:59:59`).getTime() >= Date.now());
  const plannedDayKeys = new Set(upcomingEventDays.map(({ event, day }) => `${event.id}:${day.id}:${day.date.slice(0, 10)}`));
  const confirmedDayKeys = new Set(upcomingEventDays.filter(({ event, day }) => {
    const dayWorkers = event.eventDayWorkers || [];
    if (dayWorkers.length) return dayWorkers.some((item) => item.eventDayId === day.id);
    return (event.confirmedWorkerIds || []).length > 0;
  }).map(({ event, day }) => `${event.id}:${day.id}:${day.date.slice(0, 10)}`));
  const workersScheduled = new Set(upcoming.flatMap((event) => effectiveConfirmedWorkerIds(event))).size;

  const skeletonCards = (
    <div className="-mx-4 flex gap-3 overflow-hidden px-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:px-0">
      {[1, 2, 3].map((item) => (
        <div key={item} className="w-[84vw] max-w-[380px] shrink-0 lg:w-auto lg:max-w-none"><SkeletonEventCard /></div>
      ))}
    </div>
  );
  const monthlyProfit = completedEvents
    .filter((event) => {
      const date = new Date(event.startDate);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    })
    .reduce((sum, event) => sum + calculateEventProfit(event, event.finance).netProfit, 0);
  const checklistItems = upcoming.flatMap((event) => event.checklistItems || []);
  const checklistPercent = checklistItems.length ? Math.round((checklistItems.filter((item) => item.completed).length / checklistItems.length) * 100) : 0;

  return (
    <div className="space-y-4 lg:mx-auto lg:max-w-7xl">
      <header className="flex items-center justify-between gap-3 rounded-2xl bg-white/90 px-4 py-3 shadow-soft dark:bg-slate-900">
        <div className="min-w-0">
          <h1 className="text-xl font-black leading-tight text-ink dark:text-white">4 Nerds</h1>
          <p className="truncate text-xs font-bold text-slate-400 dark:text-slate-500">
            {syncing || syncMessage ? syncMessage || "Syncing..." : "Dashboard"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => setShowLegend(true)} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-slate-100 px-3 text-xs font-bold text-ink dark:bg-slate-800 dark:text-white"><HelpCircle size={15} /> Legend</button>
          <Link to="/settings" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-ink dark:bg-slate-800 dark:text-white" aria-label="Settings"><Settings size={18} /></Link>
        </div>
      </header>

      <InstallPrompt />
      <SyncStatusBadge syncing={syncing && events.length > 0} />
      {syncError ? <ErrorState message="Dashboard data could not be refreshed." details={syncError} onRetry={() => void load(true)} onSync={() => void load(true)} /> : null}

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-sky-50 p-3 shadow-soft dark:bg-sky-950/30">
          <CalendarDays className="text-sky-600 dark:text-sky-300" size={18} />
          {loading && !events.length ? <div className="mt-3 h-6 w-10 animate-pulse rounded bg-sky-200 dark:bg-sky-900" /> : <p className="mt-2 text-xl font-black text-ink dark:text-white">{plannedDayKeys.size}</p>}
          <p className="text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">Days Planned</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3 shadow-soft dark:bg-emerald-950/30">
          <CheckCircle2 className="text-emerald-600 dark:text-emerald-300" size={18} />
          {loading && !events.length ? <div className="mt-3 h-6 w-10 animate-pulse rounded bg-emerald-200 dark:bg-emerald-900" /> : <p className="mt-2 text-xl font-black text-ink dark:text-white">{confirmedDayKeys.size}</p>}
          <p className="text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">Days Confirmed</p>
        </div>
        <div className="rounded-2xl bg-orange-50 p-3 shadow-soft dark:bg-orange-950/30">
          <DollarSign className="text-orange-600 dark:text-orange-300" size={18} />
          {loading && !events.length ? <div className="mt-3 h-6 w-16 animate-pulse rounded bg-orange-200 dark:bg-orange-900" /> : <p className="mt-2 text-base font-black text-ink dark:text-white">{formatMoney(projectedCosts)}</p>}
          <p className="text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">Upcoming Cost</p>
        </div>
      </section>

      <section aria-label="Quick actions" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Link to="/events/new" className="flex min-h-16 items-center gap-3 rounded-2xl bg-coral p-3 text-white shadow-soft transition hover:-translate-y-0.5 active:scale-[0.98]">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15"><Plus size={20} /></span>
          <span className="text-sm font-black leading-tight">Add Event</span>
        </Link>
        <Link to="/sales" className="flex min-h-16 items-center gap-3 rounded-2xl bg-ink p-3 text-white shadow-soft transition hover:-translate-y-0.5 active:scale-[0.98] dark:bg-slate-900">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10"><Camera size={20} /></span>
          <span className="text-sm font-black leading-tight">Sales Control</span>
        </Link>
        <Link to="/buy" className="flex min-h-16 items-center gap-3 rounded-2xl bg-white p-3 text-ink shadow-soft transition hover:-translate-y-0.5 active:scale-[0.98] dark:bg-slate-900 dark:text-white">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300"><Package size={20} /></span>
          <span className="text-sm font-black leading-tight">Needs to Buy</span>
        </Link>
        <Link to="/nj-calendar" className="flex min-h-16 items-center gap-3 rounded-2xl bg-sky-600 p-3 text-white shadow-soft transition hover:-translate-y-0.5 active:scale-[0.98]">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15"><CalendarSync size={20} /></span>
          <span className="text-sm font-black leading-tight">NJ Calendar</span>
        </Link>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black text-ink dark:text-white">Next 5 Planned Events</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => void load(true)} disabled={syncing} className="rounded-full bg-white px-3 py-2 text-xs font-bold text-ink shadow-soft disabled:opacity-60 dark:bg-slate-900 dark:text-white">Sync</button>
            <Link to="/events" className="text-sm font-bold text-coral">View All Upcoming Events</Link>
          </div>
        </div>
        {loading ? <LoadingScreen label="Loading dashboard events...">{skeletonCards}</LoadingScreen> : plannedUpcoming.length === 0 ? (
          <EmptyState title="No planned events yet." action={<Link to="/events" className="rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white dark:bg-coral">View All Upcoming Events</Link>} />
        ) : (
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scroll-smooth lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 xl:grid-cols-5">
            {plannedUpcoming.slice(0, 5).map((event) => (
              <div key={event.id} className="w-[84vw] max-w-[380px] shrink-0 snap-start sm:w-[360px] lg:w-auto lg:max-w-none">
                <EventCard event={event} workers={workers} compact />
              </div>
            ))}
          </div>
        )}
      </section>

      {highlighted.length > 0 ? (
        <section className="rounded-2xl border border-orange-100 bg-orange-50 p-4 dark:border-orange-900/60 dark:bg-orange-950/25">
          <h2 className="font-black text-ink dark:text-white">Coming Up Soon</h2>
          <div className="mt-3 space-y-3">{highlighted.slice(0, 2).map((event) => <EventCard key={event.id} event={event} workers={workers} />)}</div>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Upcoming events</p>
          <p className="mt-2 text-xl font-black text-ink dark:text-white">{upcoming.length}</p>
        </div>
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Workers scheduled</p>
          <p className="mt-2 text-xl font-black text-ink dark:text-white">{workersScheduled}</p>
        </div>
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Profit this month</p>
          <p className={`mt-2 text-xl font-black ${monthlyProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatMoney(monthlyProfit)}</p>
        </div>
        <div className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Checklist completion</p>
          <p className="mt-2 text-xl font-black text-ink dark:text-white">{checklistPercent}%</p>
        </div>
      </section>

      <button onClick={() => navigate("/sales?mode=sale")} className="fixed bottom-24 right-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-coral text-white shadow-2xl transition active:scale-95 lg:bottom-8 lg:right-8" aria-label="Quick add sale">
        <Camera size={24} />
      </button>
      {showLegend ? (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm lg:items-center lg:justify-center">
          <section className="mx-auto w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-coral">Guide</p>
                <h2 className="text-2xl font-black text-ink dark:text-white">Event Stage Legend</h2>
              </div>
              <button onClick={() => setShowLegend(false)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
            </div>
            <div className="mt-4 space-y-2 text-sm font-bold text-slate-600 dark:text-slate-300">
              {(["new", "applied", "paid", "past"] as const).map((stage) => (
                <div key={stage} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">
                  <span className={`h-3 w-3 rounded-full ${eventStageAccentClasses[stage]}`} />
                  <span>{eventStageDescriptions[stage]}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function formatDashboardFailure(functionName: string, table: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown failure");
  if (message.includes("query failed")) return message;
  return [
    `${functionName} query failed on ${table}: ${message}`,
    `table: ${table}`,
    `function: ${functionName}`,
    `route: ${typeof window !== "undefined" ? window.location.pathname : "unknown"}`,
    `timestamp: ${new Date().toISOString()}`
  ].join("\n");
}

function buildDashboardErrorDetails(failures: string[]) {
  const status = getSupabaseStatus();
  const browser = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  const recentRequests = status.recentRequests
    .slice(0, 5)
    .map((entry) => `${entry.timestamp} | ${entry.route} | ${entry.functionName} | ${entry.table} | rows=${entry.rows ?? "n/a"}`)
    .join("\n");
  return [
    failures.join("\n\n"),
    "",
    "Dashboard debug",
    `app version: ${appVersion}`,
    `build: ${appBuildTime}`,
    `browser: ${browser}`,
    `mode: ${status.appMode}`,
    `connected: ${status.connected ? "yes" : "no"}`,
    `last failed query: ${status.lastFailedQuery || "none recorded"}`,
    recentRequests ? `recent requests:\n${recentRequests}` : "recent requests: none"
  ].join("\n");
}
