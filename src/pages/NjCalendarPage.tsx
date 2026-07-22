import {
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  MapPin,
  MapPinned,
  Pencil,
  RefreshCw,
  Save,
  TestTube2,
  X
} from "lucide-react";
import {
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek
} from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { SkeletonEventCard } from "../components/SkeletonEventCard";
import { njPokemonCalendar, njPokemonEventsMap } from "../data/njPokemonSources";
import {
  ignoreCalendarCandidate,
  listCalendarCandidates,
  listCalendarCandidatesForFeed,
  listCalendarFeeds,
  saveCalendarCandidate,
  saveCalendarCandidates,
  syncCalendarFeed,
  testCalendarFeed,
  type CalendarFeedTestResult
} from "../services/database/calendarFeedRepository";
import { listPlannerEvents } from "../services/planner/plannerRepository";
import type { CalendarFeed, CalendarImportCandidate, Event } from "../types/models";
import { displayDateTime } from "../utils/dateUtils";
import { actionCooldownRemainingSeconds, canRunAction, markActionRun, recordPageLoad } from "../utils/supabase";
import { safeDateFromLocalInput } from "../utils/browserCompat";

type Tab = "feed" | "review" | "saved";
type DateFilter = "upcoming" | "week" | "month";

export function NjCalendarPage() {
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [candidates, setCandidates] = useState<CalendarImportCandidate[]>([]);
  const [savedEvents, setSavedEvents] = useState<Event[]>([]);
  const [tab, setTab] = useState<Tab>("feed");
  const [filter, setFilter] = useState<DateFilter>("upcoming");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarImportCandidate | null>(null);
  const [editing, setEditing] = useState<CalendarImportCandidate | null>(null);
  const [savingId, setSavingId] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CalendarFeedTestResult | null>(null);

  async function load(autoSyncEmpty = false) {
    recordPageLoad("NJ Calendar");
    setError("");
    let activeFeed: CalendarFeed = defaultNjFeed();
    try {
      try {
        const feeds = await listCalendarFeeds();
        activeFeed = feeds.find((item) => item.id === njPokemonCalendar.id)
          || feeds.find((item) => item.icsUrl === njPokemonCalendar.icsUrl)
          || activeFeed;
      } catch (feedError) {
        const details = feedError instanceof Error ? feedError.message : String(feedError);
        console.warn("Calendar feed settings could not be loaded; using the built-in NJ feed.", details);
        setError(`Feed settings could not be loaded, so the built-in NJ feed is being used.\n${details}`);
      }
      setFeed(activeFeed);
      const cached = listCalendarCandidatesForFeed(activeFeed.id);
      setCandidates(cached);
      try {
        setSavedEvents(await loadSavedEvents(activeFeed.id));
      } catch (savedError) {
        const details = savedError instanceof Error ? savedError.message : String(savedError);
        console.warn("Saved calendar events could not be loaded.", details);
        setError((current) => [current, `Saved Events could not be loaded.\n${details}`].filter(Boolean).join("\n\n"));
      }
      if (autoSyncEmpty && activeFeed.enabled && cached.length === 0 && isFeedStale(activeFeed)) await runSync(activeFeed);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the NJ calendar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  async function runSync(target = feed) {
    if (!target) {
      setError("The NJ Pokemon calendar feed is not configured. Add it in Calendar Feed settings.");
      return;
    }
    const key = `calendar-sync:${target.id}`;
    if (!canRunAction(key, 60_000)) {
      setMessage(`Calendar sync was just run. Try again in ${actionCooldownRemainingSeconds(key, 60_000)}s.`);
      return;
    }
    markActionRun(key);
    setSyncing(true);
    setMessage("");
    setError("");
    try {
      const njFeed = { ...target, icsUrl: njPokemonCalendar.icsUrl };
      const result = await syncCalendarFeed(njFeed, setProgress);
      const feeds = await listCalendarFeeds();
      setFeed(feeds.find((item) => item.id === target.id) || target);
      setCandidates(listCalendarCandidatesForFeed(target.id));
      setSavedEvents(await loadSavedEvents(target.id));
      setMessage(`Found ${result.found} events. ${result.review} ready to review, ${result.duplicates} already saved.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Calendar sync failed.");
    } finally {
      setProgress("");
      setSyncing(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testCalendarFeed(njPokemonCalendar.icsUrl));
    } finally {
      setTesting(false);
    }
  }

  function reloadCandidates() {
    if (feed) setCandidates(listCalendarCandidatesForFeed(feed.id));
  }

  async function save(candidate: CalendarImportCandidate) {
    setSavingId(candidate.id);
    setError("");
    setMessage("");
    try {
      const event = await saveCalendarCandidate(candidate);
      setSavedEvents((current) => [event, ...current.filter((item) => item.id !== event.id)]);
      reloadCandidates();
      setSelected(null);
      setEditing(null);
      setMessage(`${candidate.title} was saved to My Events.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this event.");
    } finally {
      setSavingId("");
    }
  }

  function ignore(candidateId: string) {
    ignoreCalendarCandidate(candidateId);
    reloadCandidates();
    setSelected(null);
  }

  function updateCandidate(candidate: CalendarImportCandidate) {
    const all = listCalendarCandidates();
    saveCalendarCandidates(all.map((item) => item.id === candidate.id ? candidate : item));
    setCandidates((current) => current.map((item) => item.id === candidate.id ? candidate : item));
    setEditing(candidate);
  }

  const visibleCandidates = useMemo(() => candidates
    .filter((candidate) => candidate.reviewStatus !== "ignored")
    .filter((candidate) => matchesDateFilter(candidate.start, filter))
    .sort((a, b) => a.start.localeCompare(b.start)), [candidates, filter]);
  const pending = useMemo(() => candidates
    .filter((candidate) => candidate.reviewStatus === "pending" && !candidate.duplicate)
    .sort((a, b) => a.start.localeCompare(b.start)), [candidates]);
  const grouped = useMemo(() => groupCandidates(visibleCandidates), [visibleCandidates]);
  const savedUpcoming = useMemo(() => savedEvents
    .filter((event) => new Date(event.endDate || event.startDate).getTime() >= startOfDay(new Date()).getTime())
    .sort((a, b) => a.startDate.localeCompare(b.startDate)), [savedEvents]);

  return (
    <div className="page-shell space-y-4 lg:max-w-6xl">
      <header className="rounded-3xl bg-ink p-5 text-white shadow-soft dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-sky-300"><CalendarDays size={17} /> Public calendar</div>
            <h1 className="mt-1 text-3xl font-black">NJ Pokemon Events</h1>
            <p className="mt-1 text-sm text-slate-300">Imported from the public Google Calendar.</p>
          </div>
          <button
            onClick={() => void runSync()}
            disabled={syncing || !feed}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-black text-ink disabled:opacity-50"
          >
            <RefreshCw size={17} className={syncing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Sync Now</span>
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-300">
          <span>{feed?.lastCheckedAt ? `Last synced ${format(parseISO(feed.lastCheckedAt), "MMM d, h:mm a")}` : "Not synced yet"}</span>
          <span aria-hidden="true">·</span>
          <a href={njPokemonEventsMap.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300"><MapPinned size={14} /> Open Map</a>
          <a href={njPokemonCalendar.embedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300"><ExternalLink size={14} /> Original Calendar</a>
        </div>
      </header>

      {syncing ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
          <div className="flex items-center gap-3">
            <RefreshCw className="animate-spin text-sky-600 dark:text-sky-300" size={20} />
            <div>
              <p className="font-black text-ink dark:text-white">{progress || "Reading calendar feed..."}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Your saved events stay available while the feed updates.</p>
            </div>
          </div>
        </section>
      ) : null}
      {message ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</p> : null}
      {error ? <ErrorState message="The calendar could not be loaded." details={error} onRetry={() => void load()} onSync={() => void runSync()} /> : null}

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <button
          onClick={() => void runSync()}
          disabled={syncing || !feed}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-coral px-2 text-xs font-black text-white disabled:opacity-50"
        >
          <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> Sync Calendar
        </button>
        <button
          onClick={() => setTab("review")}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-2 text-xs font-black text-ink shadow-soft dark:bg-slate-900 dark:text-white"
        >
          <CalendarCheck size={16} /> Review Imports
        </button>
        <button
          onClick={() => void runTest()}
          disabled={testing}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-2 text-xs font-black text-ink shadow-soft disabled:opacity-50 dark:bg-slate-900 dark:text-white"
        >
          <TestTube2 size={16} /> {testing ? "Testing..." : "Test Feed"}
        </button>
        <a
          href={njPokemonEventsMap.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-2 text-center text-xs font-black text-ink shadow-soft dark:bg-slate-900 dark:text-white"
        >
          <MapPinned size={16} /> Open Map
        </a>
      </section>

      {testResult ? (
        <section className={`rounded-2xl border p-4 ${testResult.reachable ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"}`}>
          <div className="flex items-start gap-3">
            <TestTube2 className={testResult.reachable ? "text-emerald-600" : "text-rose-600"} size={20} />
            <div className="min-w-0 flex-1">
              <h2 className="font-black text-ink dark:text-white">Feed Test</h2>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <p>Feed reachable: <span className="text-ink dark:text-white">{testResult.reachable ? "Yes" : "No"}</span></p>
                <p>Events found: <span className="text-ink dark:text-white">{testResult.eventsFound}</span></p>
                <p>API reached: <span className="text-ink dark:text-white">{testResult.apiReached ? "Yes" : "No"}</span></p>
                <p>HTTP status: <span className="text-ink dark:text-white">{testResult.httpStatus || "No response"}</span></p>
                <p>Parser status: <span className="text-ink dark:text-white">{testResult.parserStatus}</span></p>
              </div>
              <details className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer font-black">Technical details</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-mono leading-5 dark:bg-slate-950/60">{testResult.details}</pre>
              </details>
            </div>
          </div>
        </section>
      ) : null}

      <nav className="grid grid-cols-3 rounded-2xl bg-white p-1 shadow-soft dark:bg-slate-900">
        <TabButton active={tab === "feed"} onClick={() => setTab("feed")} label="Feed Events" count={visibleCandidates.length} />
        <TabButton active={tab === "review"} onClick={() => setTab("review")} label="Review Imports" count={pending.length} />
        <TabButton active={tab === "saved"} onClick={() => setTab("saved")} label="Saved Events" count={savedUpcoming.length} />
      </nav>

      {tab === "feed" ? (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button onClick={() => setFilter("upcoming")} className={filterClass(filter === "upcoming")}>Upcoming</button>
            <button onClick={() => setFilter("week")} className={filterClass(filter === "week")}>This Week</button>
            <button onClick={() => setFilter("month")} className={filterClass(filter === "month")}>This Month</button>
            <button
              onClick={() => {
                setFilter("upcoming");
                window.setTimeout(() => document.getElementById(todayAnchor())?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
              }}
              className="ml-auto shrink-0 rounded-full bg-ink px-3 py-2 text-xs font-black text-white dark:bg-coral"
            >
              Today
            </button>
          </div>
          {loading && !candidates.length ? <AgendaSkeleton /> : grouped.length === 0 ? (
            <EmptyState
              title={feed ? "No feed events match this view. Sync the calendar to check again." : "NJ calendar feed is not configured."}
              action={feed
                ? <button onClick={() => void runSync()} className="rounded-xl bg-ink px-4 py-3 text-sm font-black text-white dark:bg-coral">Sync Calendar</button>
                : <Link to="/calendar-feeds" className="rounded-xl bg-ink px-4 py-3 text-sm font-black text-white dark:bg-coral">Manage Feeds</Link>}
            />
          ) : (
            <div className="space-y-6">
              {grouped.map(([date, items]) => (
                <section key={date} id={date} className="scroll-mt-5">
                  <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 bg-paper/95 py-2 backdrop-blur dark:bg-slate-950/95">
                    <span className="rounded-full bg-ink px-3 py-1.5 text-xs font-black text-white dark:bg-slate-800">{format(parseISO(date), "EEEE, MMMM d")}</span>
                    {isSameDay(parseISO(date), new Date()) ? <span className="text-xs font-black text-coral">Today</span> : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {items.map((candidate) => (
                      <FeedEventCard
                        key={candidate.id}
                        candidate={candidate}
                        saving={savingId === candidate.id}
                        onSave={() => void save(candidate)}
                        onIgnore={() => ignore(candidate.id)}
                        onDetails={() => setSelected(candidate)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === "review" ? (
        pending.length === 0 ? (
          <EmptyState title="Nothing is waiting for review." action={<button onClick={() => setTab("feed")} className="rounded-xl bg-ink px-4 py-3 text-sm font-black text-white dark:bg-coral">Browse Feed Events</button>} />
        ) : (
          <section className="grid gap-3 md:grid-cols-2">
            {pending.map((candidate) => (
              <article key={candidate.id} className="rounded-2xl bg-white p-4 shadow-soft dark:bg-slate-900">
                <CalendarEventSummary candidate={candidate} />
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button onClick={() => void save(candidate)} disabled={savingId === candidate.id} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-coral text-xs font-black text-white disabled:opacity-50"><Save size={14} /> Save</button>
                  <button onClick={() => setEditing(candidate)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 text-xs font-black dark:bg-slate-800"><Pencil size={14} /> Edit</button>
                  <button onClick={() => ignore(candidate.id)} className="min-h-11 rounded-xl bg-slate-100 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">Ignore</button>
                </div>
              </article>
            ))}
          </section>
        )
      ) : null}

      {tab === "saved" ? (
        loading && !savedEvents.length ? <AgendaSkeleton /> : savedUpcoming.length === 0 ? <EmptyState title="No calendar events have been saved yet." /> : (
          <section className="grid gap-3 md:grid-cols-2">
            {savedUpcoming.map((event) => (
              <Link key={event.id} to={`/events/${event.id}`} className="group rounded-2xl bg-white p-4 shadow-soft transition hover:-translate-y-0.5 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700 dark:bg-sky-950 dark:text-sky-200">Imported</span>
                    <h2 className="mt-3 text-lg font-black text-ink dark:text-white">{event.name}</h2>
                    <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">{displayDateTime(event.startDate)}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400"><MapPin size={15} /> {event.venueName || event.address || "Location not provided"}</p>
                    <p className="mt-3 text-xs font-black text-coral">Open Event</p>
                  </div>
                  <ChevronRight className="mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </section>
        )
      ) : null}

      {selected ? <DetailsSheet candidate={selected} saving={savingId === selected.id} onClose={() => setSelected(null)} onSave={() => void save(selected)} onIgnore={() => ignore(selected.id)} /> : null}
      {editing ? <EditSheet candidate={editing} saving={savingId === editing.id} onChange={updateCandidate} onClose={() => setEditing(null)} onSave={() => void save(editing)} /> : null}
    </div>
  );
}

function isFeedStale(feed: CalendarFeed) {
  if (!feed.lastCheckedAt) return true;
  return Date.now() - new Date(feed.lastCheckedAt).getTime() > 12 * 60 * 60 * 1000;
}

async function loadSavedEvents(feedId?: string) {
  const events = await listPlannerEvents();
  return events.filter((event) =>
    event.importedFromCalendar
    && (event.calendarFeedId === feedId || event.externalSource === "google_calendar_ics")
  );
}

function defaultNjFeed(): CalendarFeed {
  const timestamp = new Date().toISOString();
  return {
    id: njPokemonCalendar.id,
    name: njPokemonCalendar.name,
    icsUrl: njPokemonCalendar.icsUrl,
    enabled: true,
    autoImport: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function TabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`min-h-12 rounded-xl px-2 text-xs font-black transition ${active ? "bg-ink text-white dark:bg-coral" : "text-slate-500 dark:text-slate-400"}`}>
      <span className="block">{label}</span>
      <span className={`text-[10px] ${active ? "text-white/70" : "text-slate-400"}`}>{count}</span>
    </button>
  );
}

function FeedEventCard({ candidate, saving, onSave, onIgnore, onDetails }: {
  candidate: CalendarImportCandidate;
  saving: boolean;
  onSave: () => void;
  onIgnore: () => void;
  onDetails: () => void;
}) {
  const alreadySaved = candidate.duplicate || candidate.reviewStatus === "saved";
  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-slate-900">
      <CalendarEventSummary candidate={candidate} />
      <div className="mt-4 flex gap-2">
        <button onClick={onSave} disabled={alreadySaved || saving} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-coral px-3 text-xs font-black text-white disabled:bg-emerald-100 disabled:text-emerald-700 dark:disabled:bg-emerald-950 dark:disabled:text-emerald-200">
          {alreadySaved ? <><Check size={15} /> Saved</> : <><Save size={15} /> {saving ? "Saving..." : "Save to My Events"}</>}
        </button>
        <button onClick={onDetails} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-ink dark:bg-slate-800 dark:text-white" aria-label="View details"><Eye size={17} /></button>
        {!alreadySaved ? <button onClick={onIgnore} className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-100 px-3 text-xs font-black text-slate-500 dark:bg-slate-800 dark:text-slate-300">Ignore</button> : null}
      </div>
    </article>
  );
}

function CalendarEventSummary({ candidate }: { candidate: CalendarImportCandidate }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700 dark:bg-sky-950 dark:text-sky-200">Google Calendar</span>
        {candidate.duplicate || candidate.reviewStatus === "saved" ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">Saved</span> : null}
      </div>
      <h2 className="mt-3 text-lg font-black text-ink dark:text-white">{candidate.title}</h2>
      <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
        <p className="flex items-center gap-2"><Clock size={16} className="text-coral" /> {formatCandidateTime(candidate)}</p>
        <p className="flex items-start gap-2"><MapPin size={16} className="mt-0.5 shrink-0 text-coral" /> {candidate.location || "Location not provided"}</p>
      </div>
    </>
  );
}

function DetailsSheet({ candidate, saving, onClose, onSave, onIgnore }: {
  candidate: CalendarImportCandidate;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onIgnore: () => void;
}) {
  const alreadySaved = candidate.duplicate || candidate.reviewStatus === "saved";
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/60 p-4 backdrop-blur-sm lg:items-center lg:justify-center">
      <section className="mx-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-sm font-black text-coral">Google Calendar</p><h2 className="mt-1 text-2xl font-black text-ink dark:text-white">{candidate.title}</h2></div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          <p className="flex items-center gap-2"><CalendarCheck size={17} /> {displayDateTime(candidate.start)}</p>
          {candidate.end ? <p className="flex items-center gap-2"><Clock size={17} /> Ends {displayDateTime(candidate.end)}</p> : null}
          <p className="flex items-start gap-2"><MapPin size={17} className="mt-0.5 shrink-0" /> {candidate.location || "Location not provided"}</p>
        </div>
        {candidate.description ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{candidate.description}</p> : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onIgnore} disabled={alreadySaved} className="min-h-12 rounded-xl bg-slate-100 font-black text-slate-600 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300">Ignore</button>
          <button onClick={onSave} disabled={alreadySaved || saving} className="min-h-12 rounded-xl bg-coral font-black text-white disabled:bg-emerald-600">{alreadySaved ? "Already Saved" : saving ? "Saving..." : "Save to My Events"}</button>
        </div>
      </section>
    </div>
  );
}

function EditSheet({ candidate, saving, onChange, onClose, onSave }: {
  candidate: CalendarImportCandidate;
  saving: boolean;
  onChange: (candidate: CalendarImportCandidate) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/60 p-4 backdrop-blur-sm lg:items-center lg:justify-center">
      <section className="mx-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-sm font-bold text-coral">Calendar Import</p><h2 className="text-2xl font-black text-ink dark:text-white">Edit Before Saving</h2></div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="mt-5 space-y-3">
          <input value={candidate.title} onChange={(event) => onChange({ ...candidate, title: event.target.value })} placeholder="Event name" className={inputClass} />
          <input type="datetime-local" value={toLocalInput(candidate.start)} onChange={(event) => onChange({ ...candidate, start: safeDateFromLocalInput(event.target.value).toISOString() })} className={inputClass} />
          <input type="datetime-local" value={candidate.end ? toLocalInput(candidate.end) : ""} onChange={(event) => onChange({ ...candidate, end: event.target.value ? safeDateFromLocalInput(event.target.value).toISOString() : undefined })} className={inputClass} />
          <input value={candidate.location || ""} onChange={(event) => onChange({ ...candidate, location: event.target.value })} placeholder="Location" className={inputClass} />
          <textarea value={candidate.description || ""} onChange={(event) => onChange({ ...candidate, description: event.target.value })} placeholder="Notes" className={`${inputClass} min-h-28`} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onClose} className="min-h-11 rounded-xl bg-slate-100 font-bold dark:bg-slate-800">Cancel</button>
          <button onClick={onSave} disabled={!candidate.title.trim() || saving} className="min-h-11 rounded-xl bg-coral font-black text-white disabled:opacity-50">{saving ? "Saving..." : "Save Event"}</button>
        </div>
      </section>
    </div>
  );
}

function AgendaSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-44 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-3 md:grid-cols-2">
        <SkeletonEventCard />
        <SkeletonEventCard />
      </div>
    </div>
  );
}

function groupCandidates(candidates: CalendarImportCandidate[]) {
  const groups = new Map<string, CalendarImportCandidate[]>();
  candidates.forEach((candidate) => {
    const key = format(parseISO(candidate.start), "yyyy-MM-dd");
    groups.set(key, [...(groups.get(key) || []), candidate]);
  });
  return Array.from(groups.entries());
}

function matchesDateFilter(value: string, filter: DateFilter) {
  const date = parseISO(value);
  const now = new Date();
  if (isBefore(date, startOfDay(now))) return false;
  if (filter === "week") return !isBefore(date, startOfWeek(now)) && !isAfter(date, endOfWeek(now));
  if (filter === "month") return !isBefore(date, startOfMonth(now)) && !isAfter(date, endOfMonth(now));
  return true;
}

function formatCandidateTime(candidate: CalendarImportCandidate) {
  if (candidate.allDay) return "All day";
  const start = parseISO(candidate.start);
  if (!candidate.end) return format(start, "h:mm a");
  const end = parseISO(candidate.end);
  if (isSameDay(start, end)) return `${format(start, "h:mm a")} - ${format(end, "h:mm a")}`;
  return `${format(start, "MMM d, h:mm a")} - ${format(end, "MMM d, h:mm a")}`;
}

function todayAnchor() {
  return format(new Date(), "yyyy-MM-dd");
}

function filterClass(active: boolean) {
  return `shrink-0 rounded-full px-3 py-2 text-xs font-black transition ${active ? "bg-ink text-white dark:bg-coral" : "bg-white text-slate-500 shadow-soft dark:bg-slate-900 dark:text-slate-300"}`;
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-ink dark:border-slate-800 dark:bg-slate-950 dark:text-white";
