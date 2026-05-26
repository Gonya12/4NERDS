import { Check, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { StatusChip } from "../components/StatusChip";
import { db } from "../services/storage/localDb";
import { listPendingCandidates, saveEvent, updateCandidateStatus } from "../services/sync/sharedRepository";
import type { Event, ParsedEventCandidate } from "../types/models";
import { displayDate } from "../utils/dateUtils";
import { findLikelyDuplicate } from "../utils/dedupe";
import { id, nowIso } from "../utils/normalize";

function candidateToEvent(candidate: ParsedEventCandidate): Event {
  const timestamp = nowIso();
  return {
    id: id("event"),
    sourceId: candidate.sourceId,
    organizerId: candidate.organizerId,
    name: candidate.eventName || "Untitled Event",
    startDate: candidate.startDate || new Date().toISOString(),
    endDate: candidate.endDate,
    timeText: candidate.timeText,
    venueName: candidate.venueName,
    city: candidate.city,
    state: candidate.state,
    registrationStatus: candidate.registrationStatus,
    registrationUrl: candidate.registrationUrl,
    sourceUrl: candidate.sourceUrl,
    sourceType: "website",
    confidence: candidate.confidence,
    needsReview: false,
    interested: false,
    maybe: false,
    notGoing: false,
    reminderEnabled: false,
    reminderOffsets: [7, 3, 1, 0],
    reminderNotificationIds: [],
    notes: [...(candidate.reasons || []), ...(candidate.warnings || [])].join("\n"),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function ReviewPage() {
  const [candidates, setCandidates] = useState<ParsedEventCandidate[]>([]);
  const navigate = useNavigate();
  async function load() {
    setCandidates(await listPendingCandidates());
  }
  useEffect(() => { void load(); }, []);

  async function save(candidate: ParsedEventCandidate) {
    const events = await db.events.toArray();
    const duplicate = findLikelyDuplicate(candidate, events);
    if (duplicate && !window.confirm("Possible duplicate found. Create anyway?")) return;
    await saveEvent(candidateToEvent(candidate));
    await updateCandidateStatus(candidate.id, "saved");
    await load();
  }

  async function discard(candidate: ParsedEventCandidate) {
    await updateCandidateStatus(candidate.id, "discarded");
    await load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-black text-ink">Review</h1>
        <p className="text-sm text-slate-500">Approve possible events before they hit the calendar.</p>
      </header>
      <section className="rounded-lg bg-white p-4 text-sm text-slate-600 shadow-soft">
        This app uses simple rules to detect events. Please review before saving.
      </section>
      {candidates.length === 0 ? <EmptyState title="Nothing to review right now." /> : null}
      <div className="space-y-3">
        {candidates.map((candidate) => (
          <article key={candidate.id} className="rounded-lg bg-white p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-ink">{candidate.eventName || "Possible Event"}</h2>
                <p className="mt-1 text-sm text-slate-600">{displayDate(candidate.startDate)} · {[candidate.venueName, candidate.city, candidate.state].filter(Boolean).join(" · ") || "Location unknown"}</p>
                <p className="mt-2 text-sm text-slate-500">{candidate.rawTextSnippet}</p>
              </div>
              <StatusChip value={candidate.confidence} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip value={candidate.registrationStatus} />
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Score {candidate.detectionScore ?? "n/a"}</span>
              {candidate.classification ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{candidate.classification.replace(/_/g, " ")}</span> : null}
              {(candidate.warnings || []).map((warning) => <span key={warning} className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">{warning}</span>)}
            </div>
            <details className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-bold text-ink">Why this was detected</summary>
              <div className="mt-2 space-y-2">
                <p><strong>Reasons:</strong> {(candidate.reasons || []).join("; ") || "No positive reasons recorded."}</p>
                <p><strong>Missing:</strong> {(candidate.missingFields || []).join(", ") || "None"}</p>
                <p><strong>Matched:</strong> {(candidate.matchedKeywords || []).join(", ") || "None"}</p>
              </div>
            </details>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={() => save(candidate)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-ink text-sm font-bold text-white"><Check size={16} /> Save</button>
              <button onClick={() => navigate(`/events/new?candidate=${candidate.id}`)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-slate-100 text-sm font-bold text-ink"><Pencil size={16} /> Edit</button>
              <button onClick={() => discard(candidate)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-rose-50 text-sm font-bold text-rose-700"><Trash2 size={16} /> Discard</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
