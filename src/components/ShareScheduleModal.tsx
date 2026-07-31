import { Check, Clipboard, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Event, Worker } from "../types/models";
import { generateScheduleMessage, selectConfirmedUpcomingSchedule } from "../utils/shareSchedule";
import { ResponsiveModal } from "./sales/SalesDashboardPrimitives";

type Props = {
  open: boolean;
  events: Event[];
  workers: Worker[];
  loading?: boolean;
  warning?: string;
  onClose: () => void;
};

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
  const [message, setMessage] = useState("");
  const [slow, setSlow] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [notice, setNotice] = useState("");
  const rows = useMemo(() => selectConfirmedUpcomingSchedule(events, workers), [events, workers]);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (!open || (loading && !loadTimedOut)) return;
    setMessage(generateScheduleMessage(rows));
    setNotice("");
  }, [loadTimedOut, loading, open, rows]);

  useEffect(() => {
    if (!open || !loading) { setSlow(false); setLoadTimedOut(false); return; }
    setLoadTimedOut(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 3000);
    const timeoutTimer = window.setTimeout(() => setLoadTimedOut(true), 10_000);
    return () => { window.clearTimeout(slowTimer); window.clearTimeout(timeoutTimer); };
  }, [loading, open]);

  async function handleCopy() {
    await copyText(message);
    setNotice("Message copied");
  }

  async function handleShare() {
    try {
      await navigator.share({ title: "4 Nerds Upcoming Events", text: message });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        await handleCopy();
      }
    }
  }

  const waiting = loading && !loadTimedOut;

  return <ResponsiveModal
    open={open}
    title="Share Schedule"
    description="Copy an editable group-chat message covering paid/confirmed and applied/reserved events."
    onClose={onClose}
    size="lg"
  >
    {waiting ? <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-8 text-center">
      <RefreshCw className="animate-spin text-violet-300" size={28} />
      <p className="font-black text-white">Preparing paid event message…</p>
      {slow ? <p className="text-sm text-amber-300">Still loading upcoming events…</p> : null}
    </div> : <div className="space-y-4">
      {warning ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
        Some event data could not be refreshed. This message uses the paid events currently available.
      </div> : null}
      {loadTimedOut ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
        Loading took too long, so this message uses the event data currently available.
      </div> : null}

      {!rows.length ? <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-950/60 p-7 text-center">
        <p className="text-lg font-black text-white">There are currently no paid or applied upcoming events.</p>
      </div> : <>
        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">Message</span>
          <textarea
            value={message}
            onChange={(event) => { setMessage(event.target.value); setNotice(""); }}
            rows={16}
            aria-label="Editable paid event message"
            className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm leading-6 text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
          />
        </label>
        <p className="text-xs text-slate-500">Edit anything you want before copying it. Your event records will not be changed.</p>
      </>}

      <div className="flex flex-col-reverse gap-2 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm font-black text-slate-300 hover:bg-white/5">Close</button>
        {canShare && rows.length ? <button type="button" onClick={() => void handleShare()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-400/50 px-4 text-sm font-black text-violet-200"><Share2 size={17} /> Share</button> : null}
        <button type="button" onClick={() => void handleCopy()} disabled={!rows.length || !message} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-black text-white shadow-lg shadow-violet-950/40 disabled:opacity-40"><Clipboard size={17} /> Copy Message</button>
      </div>
      {notice ? <p role="status" className="flex items-center justify-end gap-2 text-sm font-bold text-emerald-300"><Check size={15} /> {notice}</p> : null}
    </div>}
  </ResponsiveModal>;
}
