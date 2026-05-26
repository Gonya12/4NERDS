import { Download, Plus, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addWorker, clearPlannerData, deleteWorker, listWorkers, saveWorker } from "../services/planner/plannerRepository";
import { exportBackup, importBackup } from "../services/storage/backupService";
import type { Worker } from "../types/models";
import { nowIso } from "../utils/normalize";

export function SettingsPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [newWorker, setNewWorker] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setWorkers(await listWorkers());
  }

  useEffect(() => { void load(); }, []);

  async function add() {
    if (!newWorker.trim()) return;
    await addWorker(newWorker);
    setNewWorker("");
    await load();
  }

  async function downloadBackup() {
    const data = await exportBackup();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `4-nerds-planner-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function clearAll() {
    if (!window.confirm("Clear all events and reset workers?")) return;
    await clearPlannerData();
    await load();
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold text-coral">Settings</p>
        <h1 className="text-3xl font-black text-ink">4 Nerds Planner</h1>
      </header>

      <section className="rounded-2xl bg-ink p-4 text-white shadow-soft">
        <p className="text-sm text-slate-300">App mode</p>
        <p className="mt-1 text-xl font-black">Manual Event Mode</p>
      </section>

      <section className="space-y-3 rounded-2xl bg-white/90 p-4 shadow-soft">
        <h2 className="font-black text-ink">Manage Workers</h2>
        <div className="flex gap-2">
          <input value={newWorker} onChange={(e) => setNewWorker(e.target.value)} placeholder="Add worker" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3" />
          <button onClick={add} className="inline-flex items-center gap-1 rounded-xl bg-ink px-4 font-bold text-white"><Plus size={17} /> Add</button>
        </div>
        <div className="space-y-2">
          {workers.map((worker) => (
            <div key={worker.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
              <input
                value={worker.name}
                onChange={async (e) => { await saveWorker({ ...worker, name: e.target.value, updatedAt: nowIso() }); await load(); }}
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-bold text-ink"
              />
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input type="checkbox" checked={worker.active} onChange={async (e) => { await saveWorker({ ...worker, active: e.target.checked, updatedAt: nowIso() }); await load(); }} />
                Active
              </label>
              <button onClick={async () => { await deleteWorker(worker.id); await load(); }} className="rounded-lg p-2 text-rose-700"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button onClick={downloadBackup} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft"><Download size={16} /> Export JSON</button>
        <button onClick={() => fileRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-bold shadow-soft"><Upload size={16} /> Import JSON</button>
        <button onClick={clearAll} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-rose-50 text-sm font-bold text-rose-700"><Trash2 size={16} /> Clear All Data</button>
      </section>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        await importBackup(await file.text());
        await load();
      }} />

      <section className="rounded-2xl bg-white/90 p-4 text-sm text-slate-600 shadow-soft">
        <h2 className="font-black text-ink">About</h2>
        <p className="mt-1">A private planning app for 4 Nerds vendor events and worker availability.</p>
      </section>
    </div>
  );
}
