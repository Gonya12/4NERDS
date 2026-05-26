import { RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { refreshAllSources, refreshSource } from "../services/scrapers/sourceRunner";
import { deleteSource, listSources, saveSource } from "../services/sync/sharedRepository";
import type { Source, SourceType } from "../types/models";
import { id, nowIso } from "../utils/normalize";

const sourceTypes: SourceType[] = ["website", "event_page", "instagram_page", "facebook_page", "rss", "reddit", "manual", "other"];

const blankForm = {
  name: "",
  type: "website" as SourceType,
  url: "",
  defaultVenueName: "",
  defaultAddress: "",
  defaultCity: "",
  defaultState: "",
  notes: ""
};

export function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [form, setForm] = useState(blankForm);
  const [busy, setBusy] = useState(false);

  async function load() {
    setSources(await listSources());
  }
  useEffect(() => { void load(); }, []);

  async function addSource() {
    if (!form.name.trim()) return;
    const timestamp = nowIso();
    await saveSource({
      id: id("source"),
      name: form.name.trim(),
      type: form.type,
      url: form.url.trim() || undefined,
      defaultVenueName: form.defaultVenueName.trim() || undefined,
      defaultAddress: form.defaultAddress.trim() || undefined,
      defaultCity: form.defaultCity.trim() || undefined,
      defaultState: form.defaultState.trim() || undefined,
      checkFrequencyLabel: "Manual refresh only",
      enabled: true,
      notes: form.notes.trim(),
      foundCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    setForm(blankForm);
    await load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-black text-ink">Saved Organizer Sources</h1>
        <p className="text-sm text-slate-500">Save organizer pages once, then refresh them when you want new event candidates.</p>
      </header>

      <section className="rounded-lg bg-white p-4 shadow-soft">
        <h2 className="text-base font-bold">Add Organizer Source</h2>
        <div className="mt-3 space-y-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Organizer/source name, e.g. Woodbridge Card Show" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as SourceType })} className="w-full rounded-lg border border-slate-200 px-3 py-3">
            {sourceTypes.map((type) => <option key={type} value={type}>{type.replace("_", " ")}</option>)}
          </select>
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Source page URL" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
          <input value={form.defaultVenueName} onChange={(e) => setForm({ ...form, defaultVenueName: e.target.value })} placeholder="Default venue name" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
          <input value={form.defaultAddress} onChange={(e) => setForm({ ...form, defaultAddress: e.target.value })} placeholder="Default address" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
          <div className="grid grid-cols-2 gap-3">
            <input value={form.defaultCity} onChange={(e) => setForm({ ...form, defaultCity: e.target.value })} placeholder="Default city" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
            <input value={form.defaultState} onChange={(e) => setForm({ ...form, defaultState: e.target.value })} placeholder="State" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
          </div>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Organizer notes" className="min-h-20 w-full rounded-lg border border-slate-200 px-3 py-3" />
          <button onClick={addSource} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-bold text-white"><Save size={17} /> Save Source</button>
        </div>
      </section>

      <button onClick={async () => { setBusy(true); await refreshAllSources({ force: true }); await load(); setBusy(false); }} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-white font-bold text-ink shadow-soft">
        <RefreshCw size={18} className={busy ? "animate-spin" : ""} /> Refresh Now
      </button>

      {sources.length === 0 ? <EmptyState title="No sources yet. Add a website, event page, or Instagram organizer page." /> : null}
      <div className="space-y-3">
        {sources.map((source) => (
          <article key={source.id} className="rounded-lg bg-white p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <Link to={`/sources/${source.id}`} className="min-w-0 flex-1">
                <h2 className="font-bold text-ink">{source.name}</h2>
                <p className="text-sm text-slate-500">{source.type.replace("_", " ")} · {source.enabled ? "Enabled" : "Disabled"}{source.isDefault ? " · Default" : ""}</p>
                <p className="mt-1 text-xs text-slate-500">{source.defaultVenueName || source.defaultCity ? [source.defaultVenueName, source.defaultCity, source.defaultState].filter(Boolean).join(" · ") : "No default venue set"}</p>
                <p className="mt-1 text-xs text-slate-500">Last checked: {source.lastCheckedAt ? new Date(source.lastCheckedAt).toLocaleString() : "Never"}</p>
                <p className="mt-1 text-xs text-slate-500">{source.lastStatus || "Ready"} · {source.foundCount || 0} possible events · {source.checkFrequencyLabel || "Manual refresh only"}</p>
                {source.lastError ? <p className="mt-2 text-xs text-rose-700">{source.lastError}</p> : null}
              </Link>
              <input type="checkbox" checked={source.enabled} onChange={async (e) => { await saveSource({ ...source, enabled: e.target.checked, updatedAt: nowIso() }); await load(); }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={async () => { setBusy(true); await refreshSource(source, { force: true }); await load(); setBusy(false); }} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-slate-100 text-sm font-bold"><RefreshCw size={16} /> Refresh</button>
              <button onClick={async () => { await deleteSource(source.id); await load(); }} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-rose-50 text-sm font-bold text-rose-700"><Trash2 size={16} /> Delete</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
