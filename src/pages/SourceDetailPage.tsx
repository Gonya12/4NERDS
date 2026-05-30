import { ExternalLink, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EventCard } from "../components/EventCard";
import { StatusChip } from "../components/StatusChip";
import { shouldKeepDetectedCandidate, storeScrapeLog } from "../services/scrapers/detectionPolicy";
import { parseManualSourceUpdate } from "../services/scrapers/manualInstagramImport";
import { refreshSource } from "../services/scrapers/sourceRunner";
import { db } from "../services/storage/localDb";
import { getLastSyncTime, saveCandidate, saveSource as saveSourceRecord } from "../services/sync/sharedRepository";
import type { Event, ParsedEventCandidate, Source, SourceType } from "../types/models";
import { displayDate } from "../utils/dateUtils";
import { nowIso } from "../utils/normalize";

const sourceTypes: SourceType[] = ["website", "event_page", "instagram_page", "facebook_page", "rss", "reddit", "manual", "other"];

export function SourceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source>();
  const [events, setEvents] = useState<Event[]>([]);
  const [candidates, setCandidates] = useState<ParsedEventCandidate[]>([]);
  const [manualText, setManualText] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    const found = await db.sources.get(id);
    setSource(found);
    setEvents(await db.events.where("sourceId").equals(id).toArray());
    setCandidates(await db.candidates.where("sourceId").equals(id).reverse().sortBy("createdAt"));
  }

  useEffect(() => { void load(); }, [id]);

  async function saveSourceChanges() {
    if (!source) return;
    await saveSourceRecord({ ...source, updatedAt: nowIso(), checkFrequencyLabel: source.checkFrequencyLabel || "Manual refresh only" });
    await load();
  }

  async function refresh() {
    if (!source) return;
    setBusy(true);
    await refreshSource(source, { force: true });
    await load();
    setBusy(false);
  }

  async function addPastedUpdate() {
    if (!source || !manualText.trim()) return;
    const candidate = parseManualSourceUpdate(source, manualText);
    if (await shouldKeepDetectedCandidate(candidate)) {
      await saveCandidate(candidate);
      await saveSourceRecord({
        ...source,
        lastCheckedAt: nowIso(),
        lastStatus: "Pasted update sent to Review",
        foundCount: (source.foundCount || 0) + 1,
        lastError: "",
        updatedAt: nowIso()
      });
      setManualText("");
      navigate("/review");
      return;
    }
    await storeScrapeLog(candidate);
    await saveSourceRecord({
      ...source,
      lastCheckedAt: nowIso(),
      lastStatus: "Pasted update did not look like an event",
      foundCount: source.foundCount || 0,
      updatedAt: nowIso()
    });
    alert("That pasted update did not look like an event. It was stored in scrape logs.");
    await load();
  }

  if (!source) return <div className="text-sm text-slate-500">Loading source...</div>;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-semibold text-coral">Organizer Source</p>
        <h1 className="text-2xl font-black text-ink">{source.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{source.checkFrequencyLabel || "Manual refresh only"}</p>
      </header>

      <section className="space-y-3 rounded-lg bg-white p-4 shadow-soft">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{source.type.replace("_", " ")}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{source.enabled ? "Enabled" : "Disabled"}</span>
          {source.isDefault ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">Default</span> : null}
        </div>
        <p className="text-sm text-slate-600">Last checked: {source.lastCheckedAt ? new Date(source.lastCheckedAt).toLocaleString() : "Never"}</p>
        <p className="text-sm text-slate-600">Last sync: {getLastSyncTime() ? new Date(getLastSyncTime()).toLocaleString() : "Not synced"}</p>
        <p className="text-sm text-slate-600">Last result: {source.lastStatus || "Ready"}</p>
        {source.lastError ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{source.lastError}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={refresh} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ink text-sm font-bold text-white"><RefreshCw size={17} className={busy ? "animate-spin" : ""} /> Refresh</button>
          {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm font-bold text-ink"><ExternalLink size={17} /> Open</a> : null}
        </div>
      </section>

      <section className="space-y-3 rounded-lg bg-white p-4 shadow-soft">
        <h2 className="font-bold text-ink">Add Pasted Update</h2>
        <p className="text-sm text-slate-500">Use this when Instagram, Facebook, or a protected page cannot be read automatically.</p>
        <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="Paste latest post, caption, update, or page text from this organizer" className="min-h-36 w-full rounded-lg border border-slate-200 px-3 py-3" />
        <button onClick={addPastedUpdate} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-bold text-white"><Save size={17} /> Send to Review</button>
      </section>

      <section className="space-y-3 rounded-lg bg-white p-4 shadow-soft">
        <h2 className="font-bold text-ink">Edit Source</h2>
        <input value={source.name} onChange={(e) => setSource({ ...source, name: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-3" />
        <select value={source.type} onChange={(e) => setSource({ ...source, type: e.target.value as SourceType })} className="w-full rounded-lg border border-slate-200 px-3 py-3">
          {sourceTypes.map((type) => <option key={type} value={type}>{type.replace("_", " ")}</option>)}
        </select>
        <input value={source.url || ""} onChange={(e) => setSource({ ...source, url: e.target.value })} placeholder="Source URL" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
        <input value={source.defaultVenueName || ""} onChange={(e) => setSource({ ...source, defaultVenueName: e.target.value })} placeholder="Default venue" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
        <input value={source.defaultAddress || ""} onChange={(e) => setSource({ ...source, defaultAddress: e.target.value })} placeholder="Default address" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
        <div className="grid grid-cols-2 gap-3">
          <input value={source.defaultCity || ""} onChange={(e) => setSource({ ...source, defaultCity: e.target.value })} placeholder="Default city" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
          <input value={source.defaultState || ""} onChange={(e) => setSource({ ...source, defaultState: e.target.value })} placeholder="State" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
        </div>
        <textarea value={source.notes || ""} onChange={(e) => setSource({ ...source, notes: e.target.value })} placeholder="Organizer notes" className="min-h-20 w-full rounded-lg border border-slate-200 px-3 py-3" />
        <label className="flex items-center justify-between text-sm"><span>Enabled</span><input type="checkbox" checked={source.enabled} onChange={(e) => setSource({ ...source, enabled: e.target.checked })} /></label>
        <button onClick={saveSourceChanges} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm font-bold text-ink"><Save size={17} /> Save Changes</button>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold text-ink">Events Found From This Source</h2>
        {events.length === 0 ? <p className="rounded-lg bg-white p-4 text-sm text-slate-500 shadow-soft">No saved events from this source yet.</p> : events.map((event) => <EventCard key={event.id} event={event} />)}
      </section>

      <section className="space-y-3">
        <h2 className="font-bold text-ink">Review Candidates</h2>
        {candidates.length === 0 ? <p className="rounded-lg bg-white p-4 text-sm text-slate-500 shadow-soft">No candidates from this source yet.</p> : candidates.slice(0, 5).map((candidate) => (
          <Link to="/review" key={candidate.id} className="block rounded-lg bg-white p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-ink">{candidate.eventName || "Possible Event"}</h3>
                <p className="mt-1 text-sm text-slate-500">{displayDate(candidate.startDate)} · {candidate.reviewStatus}</p>
              </div>
              <StatusChip value={candidate.confidence} />
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
