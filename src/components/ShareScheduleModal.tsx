import { Check, Clipboard, Pencil, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Event, Worker } from "../types/models";
import {
  defaultScheduleOptions,
  generateScheduleMessage,
  selectConfirmedUpcomingSchedule,
  type ScheduleDateRange,
  type ScheduleMessageStyle,
  type ScheduleOptions
} from "../utils/shareSchedule";
import { ResponsiveModal } from "./sales/SalesDashboardPrimitives";

type Props = {
  open: boolean;
  events: Event[];
  workers: Worker[];
  loading?: boolean;
  warning?: string;
  onClose: () => void;
};

const styleChoices: Array<{ value: ScheduleMessageStyle; label: string; hint: string }> = [
  { value: "quick", label: "Quick List", hint: "Compact and easy to scan" },
  { value: "detailed", label: "Detailed", hint: "A polished event-by-event message" },
  { value: "worker", label: "Worker Message", hint: "Direct team availability request" }
];

const ranges: Array<{ value: ScheduleDateRange; label: string }> = [
  { value: "next", label: "Next event" },
  { value: "next_3", label: "Next 3 events" },
  { value: "this_month", label: "This month" },
  { value: "next_2_months", label: "Next 2 months" },
  { value: "next_3_months", label: "Next 3 months" },
  { value: "all", label: "All confirmed upcoming" },
  { value: "custom", label: "Custom range" }
];

const detailToggles: Array<{ key: keyof ScheduleOptions; label: string; financial?: boolean }> = [
  { key: "includeTimes", label: "Event times" },
  { key: "includeAddress", label: "Address" },
  { key: "includeSetupTime", label: "Setup time" },
  { key: "includeBooth", label: "Table / booth" },
  { key: "includeConfirmedWorkers", label: "Confirmed workers" },
  { key: "includeWorkersNeeded", label: "Workers needed" },
  { key: "includeOrganizerInstagram", label: "Organizer Instagram" },
  { key: "includeMapsLink", label: "Google Maps link" },
  { key: "includeEventCost", label: "Event cost and paid", financial: true },
  { key: "includeAmountOwed", label: "Amount still owed", financial: true }
];

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function ShareScheduleModal({ open, events, workers, loading = false, warning = "", onClose }: Props) {
  const [options, setOptions] = useState<ScheduleOptions>(defaultScheduleOptions);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [slow, setSlow] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const rows = useMemo(() => selectConfirmedUpcomingSchedule(events, workers, options), [events, workers, options]);

  function regenerate() {
    setPreparing(true);
    setNotice("");
    window.setTimeout(() => {
      setMessage(generateScheduleMessage(rows, workers, options));
      setEditing(false);
      setPreparing(false);
    }, 0);
  }

  useEffect(() => {
    if (!open || (loading && !loadTimedOut)) return;
    regenerate();
    // A newly opened composer always starts from current canonical event data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, loadTimedOut]);

  useEffect(() => {
    if (!open || !loading) { setSlow(false); setLoadTimedOut(false); return; }
    setLoadTimedOut(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 3000);
    const timeoutTimer = window.setTimeout(() => setLoadTimedOut(true), 10_000);
    return () => { window.clearTimeout(slowTimer); window.clearTimeout(timeoutTimer); };
  }, [loading, open]);

  function updateOption<K extends keyof ScheduleOptions>(key: K, value: ScheduleOptions[K]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  function selectStyle(style: ScheduleMessageStyle) {
    setOptions((current) => style === "detailed" ? {
      ...current,
      style,
      includeTimes: true,
      includeAddress: true,
      includeSetupTime: true,
      includeBooth: true
    } : { ...current, style });
  }

  async function handleCopy() {
    await copyText(message);
    setNotice("Schedule copied");
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "4 Nerds Upcoming Event Schedule", text: message });
        setNotice("Share sheet opened");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await handleCopy();
  }

  const baseControl = "min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20";

  return <ResponsiveModal
    open={open}
    title="Share Upcoming Schedule"
    description="Build an editable message from events that are both paid and confirmed attending."
    onClose={onClose}
    size="lg"
  >
    {loading && !loadTimedOut ? <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-8 text-center">
      <RefreshCw className="animate-spin text-violet-300" size={28} />
      <p className="font-black text-white">Preparing confirmed event schedule…</p>
      {slow ? <p className="text-sm text-amber-300">Still loading upcoming events…</p> : null}
    </div> : <div className="space-y-5">
      {warning ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
        Some event data could not be refreshed. The schedule below uses the events that are currently available.
      </div> : null}
      {loadTimedOut ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">Loading took too long. The composer stopped waiting so you can close it or work with any currently available events.</div> : null}

      <section>
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Message style</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {styleChoices.map((choice) => <button key={choice.value} type="button" onClick={() => selectStyle(choice.value)} className={`rounded-xl border p-3 text-left transition ${options.style === choice.value ? "border-violet-400 bg-violet-500/15" : "border-slate-700 bg-slate-950 hover:border-slate-500"}`}>
            <span className="block text-sm font-black text-white">{choice.label}</span>
            <span className="mt-1 block text-xs text-slate-400">{choice.hint}</span>
          </button>)}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">Date range
          <select value={options.dateRange} onChange={(event) => updateOption("dateRange", event.target.value as ScheduleDateRange)} className={baseControl}>
            {ranges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-white">
          <input type="checkbox" checked={options.separateMultiDayEvents} onChange={(event) => updateOption("separateMultiDayEvents", event.target.checked)} className="size-4 accent-violet-500" />
          Show each multi-day event day separately
        </label>
        {options.dateRange === "custom" ? <>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">From
            <input type="date" value={options.customStart || ""} onChange={(event) => updateOption("customStart", event.target.value)} className={baseControl} />
          </label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">Through
            <input type="date" value={options.customEnd || ""} onChange={(event) => updateOption("customEnd", event.target.value)} className={baseControl} />
          </label>
        </> : null}
      </section>

      <details className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
        <summary className="cursor-pointer text-sm font-black text-white">Optional details</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {detailToggles.map((toggle) => <label key={toggle.key} className="flex min-h-10 items-center gap-3 rounded-lg px-2 text-sm text-slate-200 hover:bg-white/5">
            <input type="checkbox" checked={Boolean(options[toggle.key])} onChange={(event) => updateOption(toggle.key, event.target.checked)} className="size-4 accent-violet-500" />
            {toggle.label}{toggle.financial ? <span className="ml-auto text-[10px] font-black uppercase tracking-wider text-amber-300">Financial</span> : null}
          </label>)}
        </div>
      </details>

      {!rows.length ? <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-950/60 p-7 text-center">
        <p className="text-lg font-black text-white">There are no confirmed upcoming events to share.</p>
        <p className="mt-2 text-sm text-slate-400">Only future events that are fully paid and confirmed attending are included.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link to="/events?filter=paid" onClick={onClose} className="inline-flex min-h-11 items-center rounded-xl bg-violet-500 px-4 text-sm font-black text-white">View Upcoming Events</Link>
          <Link to="/events/new" onClick={onClose} className="inline-flex min-h-11 items-center rounded-xl border border-slate-600 px-4 text-sm font-black text-white">Add Event</Link>
        </div>
      </div> : <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Editable preview</p>
            <p className="mt-1 text-xs text-slate-500">{rows.length} event{rows.length === 1 ? "" : "s"} included · chronological order</p>
          </div>
          <button type="button" onClick={() => { setEditing(true); editorRef.current?.focus(); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-black text-violet-300 hover:bg-violet-500/10"><Pencil size={15} /> Edit Message</button>
        </div>
        <textarea ref={editorRef} value={message} onChange={(event) => { setMessage(event.target.value); setEditing(true); }} rows={12} aria-label="Schedule message" className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20" />
        {editing ? <p className="mt-1 text-xs text-slate-500">Your edits stay in this preview until you regenerate or close it.</p> : null}
      </section>}

      <div className="flex flex-col-reverse gap-2 border-t border-slate-800 pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm font-black text-slate-300 hover:bg-white/5">Close</button>
        <button type="button" onClick={regenerate} disabled={preparing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={16} className={preparing ? "animate-spin" : ""} /> Regenerate</button>
        <button type="button" onClick={() => void handleCopy()} disabled={!message} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-400/50 px-4 text-sm font-black text-violet-200 disabled:opacity-40"><Clipboard size={16} /> Copy Text</button>
        <button type="button" onClick={() => void handleShare()} disabled={!message} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-black text-white shadow-lg shadow-violet-950/40 disabled:opacity-40"><Share2 size={16} /> Share</button>
      </div>
      {notice ? <p role="status" className="flex items-center justify-end gap-2 text-sm font-bold text-emerald-300"><Check size={15} /> {notice}</p> : null}
    </div>}
  </ResponsiveModal>;
}
