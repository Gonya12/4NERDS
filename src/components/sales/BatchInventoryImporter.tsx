import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, CopyCheck, Image as ImageIcon,
  LoaderCircle, RefreshCw, Search, Trash2, Upload, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardCondition, InventoryPurchase, OwnershipShare, Worker } from "../../types/models";
import {
  bulkItemPatchFromMatch,
  confirmBulkImportItem,
  createBulkImportJob,
  deleteBulkImportItems,
  finishBulkImportUpload,
  getBulkImportJob,
  listBulkImportItems,
  listBulkImportJobs,
  kickBulkImportWorker,
  retryBulkImportItems,
  updateBulkImportItem,
  uploadBulkImportFile,
  type BulkImportItem,
  type BulkImportJob,
} from "../../services/database/bulkInventoryImportRepository";
import {
  filterBulkQueue, pageBulkQueue, runWithConcurrency, sortBulkQueue,
  type BulkQueueFilter, type BulkQueueSort,
} from "../../utils/bulkInventoryImport";
import { formatMoney } from "../../utils/paymentMath";
import { ImageLightbox } from "./ImageLightbox";
import { ManualCardSearch } from "./ManualCardSearch";
import { OwnershipEditor } from "./OwnershipEditor";

type Props = {
  workers: Worker[];
  onClose: () => void;
  onConfirmed: (purchase: InventoryPurchase) => void;
};

const conditions: CardCondition[] = ["Mint", "Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged"];
const pageSize = 50;
const confirmedMarketForCondition = (baseMarket: number | null | undefined, condition: CardCondition | null | undefined) => condition === "Near Mint / NM" ? baseMarket ?? null : null;
const bulkVariantLabels: Record<string, string> = { normal: "Normal", holofoil: "Holo", reverseHolofoil: "Reverse Holo", "1stEditionNormal": "First Edition Normal", "1stEditionHolofoil": "First Edition Holo" };
const bulkVariantLabel = (value: string) => bulkVariantLabels[value] || value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());

function statusLabel(item: BulkImportItem) {
  if (item.status === "identified") return "Ready";
  if (item.status === "needs_review") return "Needs Review";
  if (item.status === "failed") return "Failed";
  if (item.status === "confirmed") return "Confirmed";
  if (item.status === "processing") return "Processing";
  return "Waiting";
}

function statusClass(item: BulkImportItem) {
  if (item.status === "identified") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  if (item.status === "failed") return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200";
  if (item.status === "needs_review") return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100";
  if (item.status === "confirmed") return "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function sharesForPreset(workers: Worker[], preset: "gonzalo" | "thiago" | "shared") {
  const gonzalo = workers.find((worker) => worker.name.toLowerCase() === "gonzalo");
  const thiago = workers.find((worker) => worker.name.toLowerCase() === "thiago");
  if (preset === "gonzalo") return gonzalo ? [{ workerId: gonzalo.id, ownershipPercentage: 100 }] : [];
  if (preset === "thiago") return thiago ? [{ workerId: thiago.id, ownershipPercentage: 100 }] : [];
  return gonzalo && thiago ? [{ workerId: gonzalo.id, ownershipPercentage: 50 }, { workerId: thiago.id, ownershipPercentage: 50 }] : [];
}

export function BatchInventoryImporter({ workers, onClose, onConfirmed }: Props) {
  const [jobs, setJobs] = useState<BulkImportJob[]>([]);
  const [job, setJob] = useState<BulkImportJob>();
  const [items, setItems] = useState<BulkImportItem[]>([]);
  const [game, setGame] = useState<"pokemon" | "one_piece">("pokemon");
  const [language, setLanguage] = useState<"en" | "ja">("en");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<BulkQueueFilter>("all");
  const [sort, setSort] = useState<BulkQueueSort>("upload");
  const [lowOnly, setLowOnly] = useState(false);
  const [missingPriceOnly, setMissingPriceOnly] = useState(false);
  const [missingConditionOnly, setMissingConditionOnly] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState("");
  const [manualSearchId, setManualSearchId] = useState("");
  const [lightboxId, setLightboxId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshJobs = useCallback(async () => {
    const loaded = await listBulkImportJobs();
    setJobs(loaded);
    return loaded;
  }, []);

  const refreshJob = useCallback(async (jobId: string) => {
    const [nextJob, nextItems] = await Promise.all([getBulkImportJob(jobId), listBulkImportItems(jobId)]);
    setJob(nextJob);
    setItems(nextItems);
    return nextJob;
  }, []);

  useEffect(() => {
    void refreshJobs().then((loaded) => {
      const resumable = loaded.find((value) => value.status !== "completed" && value.status !== "cancelled");
      if (resumable) void refreshJob(resumable.id);
    }).catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : "Bulk imports could not be loaded."));
  }, [refreshJob, refreshJobs]);

  useEffect(() => {
    if (!job || !["queued", "processing", "review"].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void refreshJob(job.id).then((next) => {
        if (next.status === "completed" || next.status === "review") void refreshJobs();
      }).catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : "Queue refresh failed."));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [job, refreshJob, refreshJobs]);

  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.status)) return;
    void kickBulkImportWorker().catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : "Background worker could not resume."));
  }, [job?.id, job?.status]);

  useEffect(() => setPage(1), [filter, sort, lowOnly, missingPriceOnly, missingConditionOnly, duplicatesOnly]);

  const visible = useMemo(() => sortBulkQueue(filterBulkQueue(items, {
    filter, lowConfidenceOnly: lowOnly, missingPriceOnly, missingConditionOnly, duplicatesOnly,
  }), sort), [items, filter, sort, lowOnly, missingPriceOnly, missingConditionOnly, duplicatesOnly]);
  const paged = useMemo(() => pageBulkQueue(visible, page, pageSize), [visible, page]);
  const editing = items.find((item) => item.id === editingId);
  const manualItem = items.find((item) => item.id === manualSearchId);
  const lightbox = items.find((item) => item.id === lightboxId);

  async function upload(filesLike: FileList | File[]) {
    const files = Array.from(filesLike).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (!files.length || uploading) return;
    setUploading(true);
    setError("");
    setMessage("");
    setUploadProgress({ done: 0, total: files.length });
    try {
      const created = await createBulkImportJob({ count: files.length, game, language });
      setJob(created);
      const results = await runWithConcurrency(files.map((file, index) => () => uploadBulkImportFile(created, file, index)), 3, (done) => setUploadProgress({ done, total: files.length }));
      const failed = results.filter((result) => result.status === "rejected");
      await finishBulkImportUpload(created.id);
      await Promise.all([refreshJob(created.id), refreshJobs()]);
      setMessage(failed.length ? `${files.length - failed.length} photos queued. ${failed.length} upload${failed.length === 1 ? "" : "s"} failed and were not discarded from your device.` : `${files.length} photos uploaded. Recognition is continuing in the background.`);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Bulk upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function patchItem(item: BulkImportItem, patch: Parameters<typeof updateBulkImportItem>[1]) {
    setBusyAction(item.id);
    setError("");
    try {
      const saved = await updateBulkImportItem(item.id, patch);
      setItems((current) => current.map((row) => row.id === saved.id ? saved : row));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Item could not be updated.");
    } finally {
      setBusyAction("");
    }
  }

  async function bulkPatch(patch: Parameters<typeof updateBulkImportItem>[1]) {
    const targets = items.filter((item) => selectedIds.includes(item.id) && item.status !== "confirmed");
    if (!targets.length) return;
    setBusyAction("bulk");
    setError("");
    try {
      const saved = await Promise.all(targets.map((item) => {
        if (patch.condition !== undefined) return updateBulkImportItem(item.id, { ...patch, adjustedMarket: confirmedMarketForCondition(item.baseMarket, patch.condition) });
        if (patch.baseMarket !== undefined) return updateBulkImportItem(item.id, { ...patch, adjustedMarket: item.condition === "Near Mint / NM" ? patch.baseMarket ?? null : item.adjustedMarket ?? null });
        return updateBulkImportItem(item.id, patch);
      }));
      const byId = new Map(saved.map((item) => [item.id, item]));
      setItems((current) => current.map((item) => byId.get(item.id) || item));
      setMessage(`${saved.length} items updated.`);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Bulk update failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function confirmOne(item: BulkImportItem) {
    setBusyAction(item.id);
    setError("");
    try {
      const purchase = await confirmBulkImportItem(item);
      onConfirmed(purchase);
      await refreshJob(item.jobId);
      setMessage(`${purchase.itemName || purchase.cardName || "Card"} added to inventory without creating a transaction.`);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Item confirmation failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function confirmReady(onlyIds?: string[]) {
    const targets = items.filter((item) => item.status === "identified" && item.selectedCandidate && (!onlyIds || onlyIds.includes(item.id)));
    if (!targets.length) return;
    setBusyAction("confirm-ready");
    setError("");
    let confirmed = 0;
    const failures: string[] = [];
    for (const item of targets) {
      try {
        onConfirmed(await confirmBulkImportItem(item));
        confirmed += 1;
      } catch (unknownError) {
        failures.push(unknownError instanceof Error ? unknownError.message : "Unknown confirmation error");
      }
    }
    await refreshJob(targets[0].jobId);
    setBusyAction("");
    setMessage(`${confirmed} high-confidence item${confirmed === 1 ? "" : "s"} added to inventory.`);
    if (failures.length) setError(`${failures.length} item${failures.length === 1 ? "" : "s"} could not be confirmed: ${failures[0]}`);
  }

  async function retrySelected(ids = selectedIds) {
    if (!ids.length) return;
    setBusyAction("retry");
    try {
      await retryBulkImportItems(ids);
      setMessage(`${ids.length} item${ids.length === 1 ? "" : "s"} requeued. Only recognition/search will run again; photos will not re-upload.`);
      if (job) await refreshJob(job.id);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Retry failed.");
    } finally { setBusyAction(""); }
  }

  async function removeSelected() {
    const targets = items.filter((item) => selectedIds.includes(item.id) && item.status !== "confirmed");
    if (!targets.length || !window.confirm(`Delete ${targets.length} queued item${targets.length === 1 ? "" : "s"} and its stored source image?`)) return;
    setBusyAction("delete");
    try {
      await deleteBulkImportItems(targets);
      setSelectedIds([]);
      if (job) await refreshJob(job.id);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Delete failed.");
    } finally { setBusyAction(""); }
  }

  const allPageSelected = paged.items.length > 0 && paged.items.every((item) => selectedIds.includes(item.id));
  const selectedCount = selectedIds.length;

  return <div
    className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/75 p-0 backdrop-blur-sm sm:p-3"
    onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) void upload(files); }}
  >
    <section
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }}
      className="mx-auto min-h-dvh w-full max-w-[1500px] bg-white p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:my-3 sm:min-h-0 sm:rounded-3xl sm:p-5 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-20 -mx-3 -mt-3 flex items-start gap-3 border-b border-slate-200 bg-white/95 p-3 backdrop-blur sm:-mx-5 sm:-mt-5 sm:rounded-t-3xl sm:p-5 dark:border-slate-800 dark:bg-slate-900/95">
        <div className="min-w-0 flex-1"><p className="eyebrow">Durable inventory queue</p><h2 className="text-xl font-black sm:text-2xl">Bulk Inventory Import</h2><p className="text-xs text-slate-500">Upload first, process safely, review uncertain cards, then add confirmed items to inventory.</p></div>
        <button type="button" onClick={onClose} aria-label="Close bulk importer" className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={19} /></button>
      </header>

      {error ? <div role="alert" className="mt-4 rounded-2xl border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">{error}</div> : null}
      {message ? <div role="status" className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">{message}</div> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 p-4 text-center dark:border-violet-800 dark:bg-violet-950/20">
            <Upload className="mx-auto text-violet-600" size={28} />
            <p className="mt-2 font-black">Drop 200+ card photos</p><p className="text-xs text-slate-500">JPEG, PNG, or WebP. This queue is independent of transaction-photo limits.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select value={game} disabled={uploading} onChange={(event) => { const next = event.target.value as "pokemon" | "one_piece"; setGame(next); if (next === "one_piece") setLanguage("en"); }} className="rounded-xl border bg-white p-2 text-sm dark:bg-slate-950"><option value="pokemon">Pokémon</option><option value="one_piece">One Piece</option></select>
              <select value={language} disabled={uploading || game === "one_piece"} onChange={(event) => setLanguage(event.target.value as "en" | "ja")} className="rounded-xl border bg-white p-2 text-sm dark:bg-slate-950"><option value="en">English</option><option value="ja">Japanese</option></select>
            </div>
            <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-black text-white disabled:opacity-50">{uploading ? <LoaderCircle className="animate-spin" size={17} /> : <Upload size={17} />}{uploading ? `Uploading ${uploadProgress.done}/${uploadProgress.total}` : "Choose Photos"}</button>
            <input ref={inputRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => event.target.files && void upload(event.target.files)} />
            {uploading ? <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100"><span className="block h-full bg-violet-600 transition-all" style={{ width: `${uploadProgress.total ? uploadProgress.done / uploadProgress.total * 100 : 0}%` }} /></div> : null}
          </div>

          <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
            <p className="font-black">Import history</p>
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
              {jobs.map((value) => <button type="button" key={value.id} onClick={() => void refreshJob(value.id)} className={`w-full rounded-xl border p-2 text-left text-xs ${job?.id === value.id ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30" : "border-slate-200 dark:border-slate-700"}`}><span className="block font-black">{new Date(value.createdAt).toLocaleString()}</span><span>{value.status} · {value.processedCount}/{value.uploadedCount} processed</span></button>)}
              {!jobs.length ? <p className="text-xs text-slate-500">No bulk imports yet.</p> : null}
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-3">
          {!job ? <div className="flex min-h-72 items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-800 dark:bg-slate-950"><div><ImageIcon className="mx-auto text-slate-400" size={40} /><h3 className="mt-3 text-lg font-black">Start with card photos</h3><p className="mt-1 max-w-md text-sm text-slate-500">The upload creates a durable job immediately. You can close this screen and return while recognition continues.</p></div></div> : <>
            <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[['Uploaded', job.uploadedCount], ['Processed', job.processedCount], ['Ready', job.readyCount], ['Review', job.needsReviewCount], ['Failed', job.failedCount], ['Confirmed', job.confirmedCount]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-2 text-center dark:bg-slate-950"><b className="block text-lg">{value}</b><span className="text-[11px] text-slate-500">{label}</span></div>)}
            </section>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className="block h-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all" style={{ width: `${job.uploadedCount ? Math.min(100, job.processedCount / job.uploadedCount * 100) : 0}%` }} /></div>
            {job.status === "uploading" && job.uploadedCount > 0 && !uploading ? <button type="button" disabled={busyAction === "resume"} onClick={() => {
              setBusyAction("resume");
              void finishBulkImportUpload(job.id).then(() => Promise.all([refreshJob(job.id), refreshJobs()])).then(() => setMessage(`${job.uploadedCount} already-uploaded photos resumed safely.`)).catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : "Import could not resume.")).finally(() => setBusyAction(""));
            }} className="min-h-11 w-full rounded-xl bg-amber-500 px-4 text-sm font-black text-slate-950">Resume processing {job.uploadedCount} uploaded photo{job.uploadedCount === 1 ? "" : "s"}</button> : null}
            <div className="flex flex-wrap gap-2">
              {([['all', 'All'], ['ready', 'Ready'], ['needs_review', 'Needs Review'], ['failed', 'Failed'], ['confirmed', 'Confirmed']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-2 text-xs font-black ${filter === value ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{label}</button>)}
              <select value={sort} onChange={(event) => setSort(event.target.value as BulkQueueSort)} className="rounded-full border bg-white px-3 text-xs font-bold dark:bg-slate-950"><option value="upload">Upload order</option><option value="status">Status</option><option value="confidence">Lowest confidence</option><option value="name">Card name</option><option value="market">Highest market</option></select>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <label className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950"><input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} /> Low confidence</label>
              <label className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950"><input type="checkbox" checked={missingPriceOnly} onChange={(event) => setMissingPriceOnly(event.target.checked)} /> Missing price</label>
              <label className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950"><input type="checkbox" checked={missingConditionOnly} onChange={(event) => setMissingConditionOnly(event.target.checked)} /> Missing condition</label>
              <label className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950"><input type="checkbox" checked={duplicatesOnly} onChange={(event) => setDuplicatesOnly(event.target.checked)} /> Possible duplicate</label>
            </div>

            {selectedCount ? <div className="sticky top-[5.2rem] z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-violet-300 bg-white/95 p-2 shadow-lg backdrop-blur dark:bg-slate-900/95"><b className="mr-auto text-sm">{selectedCount} selected</b>
              <select aria-label="Bulk condition" defaultValue="" onChange={(event) => { if (event.target.value) void bulkPatch({ condition: event.target.value as CardCondition }); event.currentTarget.value = ""; }} className="rounded-lg border p-2 text-xs dark:bg-slate-950"><option value="">Set condition…</option>{conditions.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="Bulk language" defaultValue="" onChange={(event) => { if (event.target.value) void bulkPatch({ recognizedLanguage: event.target.value }); event.currentTarget.value = ""; }} className="rounded-lg border p-2 text-xs dark:bg-slate-950"><option value="">Set language…</option><option value="en">English</option><option value="ja">Japanese</option></select>
              <button type="button" onClick={() => void bulkPatch({ ownershipShares: sharesForPreset(workers, "gonzalo") })} className="rounded-lg bg-slate-100 p-2 text-xs font-black dark:bg-slate-800">Gonzalo</button>
              <button type="button" onClick={() => void bulkPatch({ ownershipShares: sharesForPreset(workers, "thiago") })} className="rounded-lg bg-slate-100 p-2 text-xs font-black dark:bg-slate-800">Thiago</button>
              <button type="button" onClick={() => void bulkPatch({ ownershipShares: sharesForPreset(workers, "shared") })} className="rounded-lg bg-slate-100 p-2 text-xs font-black dark:bg-slate-800">50/50</button>
              <button type="button" onClick={() => { const raw = window.prompt("Set provider base market for selected cards:"); if (raw !== null && raw.trim() !== "" && Number(raw) >= 0) void bulkPatch({ baseMarket: Number(raw) }); }} className="rounded-lg bg-slate-100 p-2 text-xs font-black dark:bg-slate-800">Set market</button>
              <button type="button" onClick={() => { const raw = window.prompt("Set actual cost basis for selected cards. Enter 0 only to explicitly confirm a true $0 basis:"); if (raw !== null && raw.trim() !== "" && Number(raw) >= 0) void bulkPatch({ costBasis: Number(raw), zeroCostBasisConfirmed: Number(raw) === 0 }); }} className="rounded-lg bg-slate-100 p-2 text-xs font-black dark:bg-slate-800">Set cost</button>
              <button type="button" onClick={() => void confirmReady(selectedIds)} className="rounded-lg bg-emerald-100 p-2 text-xs font-black text-emerald-800">Approve selected</button>
              <button type="button" onClick={() => void retrySelected()} className="rounded-lg bg-amber-100 p-2 text-xs font-black text-amber-900"><RefreshCw size={14} className="inline" /> Retry AI Recognition</button>
              <button type="button" onClick={() => void removeSelected()} className="rounded-lg bg-rose-100 p-2 text-xs font-black text-rose-800"><Trash2 size={14} className="inline" /> Delete</button>
            </div> : null}

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[940px] text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950"><tr><th className="p-2"><input type="checkbox" aria-label="Select page" checked={allPageSelected} onChange={(event) => setSelectedIds((current) => event.target.checked ? Array.from(new Set([...current, ...paged.items.map((item) => item.id)])) : current.filter((id) => !paged.items.some((item) => item.id === id)))} /></th><th className="p-2">Photo</th><th className="p-2">Card / Set</th><th className="p-2">Number</th><th className="p-2">Condition</th><th className="p-2">Market</th><th className="p-2">Confidence</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr></thead>
                <tbody>{paged.items.map((item) => <tr key={item.id} className="border-t border-slate-200 align-middle dark:border-slate-800">
                  <td className="p-2"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td>
                  <td className="p-2"><button type="button" onClick={() => setLightboxId(item.id)}><img loading="lazy" src={item.thumbnailUrl || item.sourceImageUrl} alt={item.originalFilename} className="h-16 w-12 rounded-lg object-cover" /></button></td>
                  <td className="max-w-56 p-2"><b className="block truncate">{item.selectedCandidate?.name || item.recognizedName || "Analyzing…"}</b><span className="block truncate text-slate-500">{item.selectedCandidate?.setName || item.recognizedSet || "Set unknown"}</span>{item.possibleDuplicate ? <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-1 font-bold text-amber-900"><CopyCheck size={12} /> Exact photo duplicate</span> : null}</td>
                  <td className="p-2">{item.selectedCandidate?.cardCode || item.selectedCandidate?.collectorNumber || item.recognizedCollectorNumber || "—"}</td>
                  <td className="p-2">{item.condition || "Unknown"}</td>
                  <td className="p-2"><b>{item.adjustedMarket == null ? "Missing" : formatMoney(item.adjustedMarket)}</b>{item.baseMarket != null && item.condition ? <span className="block text-slate-500">Base {formatMoney(item.baseMarket)}</span> : null}</td>
                  <td className="p-2"><b className="capitalize">{item.overallConfidence || "—"}</b>{item.candidateScore != null ? <span className="block text-slate-500">{item.candidateScore}% match</span> : null}</td>
                  <td className="p-2"><span className={`rounded-full px-2 py-1 font-black ${statusClass(item)}`}>{statusLabel(item)}</span>{item.errorMessage ? <span className="mt-1 block max-w-40 text-rose-600">{item.errorMessage}</span> : null}</td>
                  <td className="p-2"><div className="flex gap-1"><button type="button" onClick={() => setEditingId(item.id)} className="rounded-lg bg-slate-100 px-2 py-2 font-black dark:bg-slate-800">Review</button>{item.status === "identified" ? <button type="button" disabled={busyAction === item.id} onClick={() => void confirmOne(item)} className="rounded-lg bg-emerald-600 px-2 py-2 font-black text-white">Approve</button> : null}{item.status === "failed" || item.status === "needs_review" ? <button type="button" onClick={() => void retrySelected([item.id])} className="rounded-lg bg-amber-100 px-2 py-2 font-black text-amber-900">Retry AI Recognition</button> : null}</div></td>
                </tr>)}</tbody>
              </table>
              {!paged.items.length ? <p className="p-8 text-center text-sm text-slate-500">No items match these filters.</p> : null}
            </div>
            <div className="flex items-center justify-between text-xs"><span>{visible.length} matching · page {paged.page} of {paged.pageCount}</span><div className="flex gap-2"><button type="button" disabled={paged.page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg bg-slate-100 p-2 disabled:opacity-40 dark:bg-slate-800"><ChevronLeft size={16} /></button><button type="button" disabled={paged.page >= paged.pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg bg-slate-100 p-2 disabled:opacity-40 dark:bg-slate-800"><ChevronRight size={16} /></button></div></div>
            <button type="button" disabled={busyAction === "confirm-ready" || !items.some((item) => item.status === "identified")} onClick={() => void confirmReady()} className="min-h-12 w-full rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-40">{busyAction === "confirm-ready" ? "Confirming…" : `Confirm All High-Confidence (${items.filter((item) => item.status === "identified").length})`}</button>
          </>}
        </main>
      </div>

      {editing ? <ItemReview
        item={editing}
        workers={workers}
        busy={busyAction === editing.id}
        onClose={() => setEditingId("")}
        onLightbox={() => setLightboxId(editing.id)}
        onSearch={() => setManualSearchId(editing.id)}
        onPatch={(patch) => void patchItem(editing, patch)}
        onConfirm={() => void confirmOne(editing)}
        onChoose={(match) => { const matched = bulkItemPatchFromMatch(match); void patchItem(editing, { ...matched, condition: editing.condition || null, adjustedMarket: editing.condition === "Near Mint / NM" && matched.baseMarket != null ? Number(matched.baseMarket) : editing.condition === "Near Mint / NM" ? null : editing.adjustedMarket ?? null }); }}
        onPrevious={() => { const index = items.findIndex((value) => value.id === editing.id); setEditingId(items[Math.max(0, index - 1)]?.id || editing.id); }}
        onNext={() => { const index = items.findIndex((value) => value.id === editing.id); setEditingId(items[Math.min(items.length - 1, index + 1)]?.id || editing.id); }}
      /> : null}

      <ManualCardSearch
        open={Boolean(manualItem)} category="raw_card"
        initialName={manualItem?.recognizedName || ""}
        initialCollectorNumber={manualItem?.recognizedCollectorNumber || ""}
        initialSet={manualItem?.recognizedSet || ""}
        initialGame={manualItem?.recognizedCardGame === "one_piece" ? "one_piece" : "pokemon"}
        initialLanguage={manualItem?.recognizedLanguage === "ja" ? "ja" : "en"}
        onClose={() => setManualSearchId("")}
        onApply={(suggestion) => {
          if (!manualItem) return;
          const match = suggestion.possibleMatches?.find((value) => value.providerCardId === suggestion.providerCardId) || suggestion.possibleMatches?.[0];
          if (match) void patchItem(manualItem, { ...bulkItemPatchFromMatch(match), status: "identified", recognizedName: suggestion.cardName, recognizedCollectorNumber: suggestion.collectorNumber, recognizedSet: suggestion.cardSet });
          else void patchItem(manualItem, { status: "needs_review", recognizedName: suggestion.cardName, recognizedCollectorNumber: suggestion.collectorNumber, recognizedSet: suggestion.cardSet });
          setManualSearchId("");
        }}
      />
      <ImageLightbox imageUrl={lightbox?.sourceImageUrl} title={lightbox?.selectedCandidate?.name || lightbox?.originalFilename || "Bulk import photo"} onClose={() => setLightboxId("")} />
    </section>
  </div>;
}

function ItemReview({ item, workers, busy, onClose, onLightbox, onSearch, onPatch, onConfirm, onChoose, onPrevious, onNext }: {
  item: BulkImportItem;
  workers: Worker[];
  busy: boolean;
  onClose: () => void;
  onLightbox: () => void;
  onSearch: () => void;
  onPatch: (patch: Parameters<typeof updateBulkImportItem>[1]) => void;
  onConfirm: () => void;
  onChoose: (match: NonNullable<BulkImportItem["selectedCandidate"]>) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const [costMode, setCostMode] = useState<"unknown" | "amount" | "zero">(item.zeroCostBasisConfirmed ? "zero" : item.costBasis != null ? "amount" : "unknown");
  const [cost, setCost] = useState(item.costBasis == null ? "" : String(item.costBasis));
  useEffect(() => { setCostMode(item.zeroCostBasisConfirmed ? "zero" : item.costBasis != null ? "amount" : "unknown"); setCost(item.costBasis == null ? "" : String(item.costBasis)); }, [item.id, item.costBasis, item.zeroCostBasisConfirmed]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
      if (event.key.toLowerCase() === "a" && item.selectedCandidate && item.status !== "confirmed") onConfirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [item, onConfirm, onNext, onPrevious]);
  const candidateImage = item.selectedCandidate?.imageLarge || item.selectedCandidate?.imageSmall;
  const pricingVariants = item.selectedCandidate?.pricing?.variants || [];
  const ownershipValid = !item.ownershipShares.length || Math.abs(item.ownershipShares.reduce((sum, share) => sum + share.ownershipPercentage, 0) - 100) < 0.001;
  const pricingReady = Boolean(item.condition)
    && (pricingVariants.length <= 1 || Boolean(item.marketVariant))
    && (item.condition === "Near Mint / NM" ? item.baseMarket != null || item.adjustedMarket != null : item.adjustedMarket != null);
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/70 sm:items-center sm:p-4">
    <section className="max-h-[96dvh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-3xl dark:bg-slate-900">
      <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-white/95 p-1 backdrop-blur dark:bg-slate-900/95"><button type="button" onClick={onPrevious} className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><ChevronLeft size={18} /></button><div className="min-w-0 flex-1"><p className="eyebrow">Review item {item.uploadOrder + 1}</p><h3 className="truncate text-lg font-black">{item.selectedCandidate?.name || item.recognizedName || "Unidentified card"}</h3></div><button type="button" onClick={onNext} className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><ChevronRight size={18} /></button><button type="button" onClick={onClose} className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></header>
      {item.possibleDuplicate ? <p className="mt-3 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900"><AlertTriangle size={16} className="mr-1 inline" />This exact photo hash already appears in this job. It is a warning only; matching provider IDs are not treated as duplicates.</p> : null}
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <button type="button" onClick={onLightbox} className="rounded-2xl bg-slate-950 p-2"><img src={item.sourceImageUrl} alt="Uploaded card" className="h-80 w-full object-contain" /><span className="text-xs font-bold text-white">Open full image</span></button>
        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950"><p className="text-xs font-black uppercase tracking-wide text-slate-500">Selected catalog card</p>{candidateImage ? <img src={candidateImage} alt="Provider card" className="mx-auto h-64 object-contain" /> : <div className="flex h-64 items-center justify-center text-sm text-slate-500">No exact candidate chosen</div>}<p className="font-black">{item.selectedCandidate?.name || "Search for a match"}</p><p className="text-xs text-slate-500">{item.selectedCandidate?.setName} {item.selectedCandidate?.cardCode || item.selectedCandidate?.collectorNumber}{item.selectedCandidate?.hp ? ` · ${item.selectedCandidate.hp} HP` : ""}</p></div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-bold">Recognized card name<input key={`${item.id}-name`} defaultValue={item.recognizedName || item.selectedCandidate?.name || ""} onBlur={(event) => onPatch({ recognizedName: event.target.value.trim() || null })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
        <label className="text-xs font-bold">Collector number<input key={`${item.id}-number`} defaultValue={item.recognizedCollectorNumber || item.selectedCandidate?.collectorNumber || item.selectedCandidate?.cardCode || ""} onBlur={(event) => onPatch({ recognizedCollectorNumber: event.target.value.trim() || null })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
        <label className="text-xs font-bold">Set<input key={`${item.id}-set`} defaultValue={item.recognizedSet || item.selectedCandidate?.setName || ""} onBlur={(event) => onPatch({ recognizedSet: event.target.value.trim() || null })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
      </div>
      {pricingVariants.length > 1 ? <label className="mt-3 block text-xs font-bold">Choose Printing<select value={item.marketVariant || ""} onChange={(event) => { const variant = pricingVariants.find((value) => value.name === event.target.value); const baseMarket = variant?.market ?? null; onPatch({ marketVariant: variant?.name || null, baseMarket, adjustedMarket: item.condition === "Near Mint / NM" ? baseMarket : item.adjustedMarket ?? null }); }} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950"><option value="">Choose the physical printing</option>{pricingVariants.map((variant) => <option key={variant.name} value={variant.name}>{bulkVariantLabel(variant.name)}</option>)}</select></label> : pricingVariants.length === 1 ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-bold dark:bg-slate-950">Printing: {bulkVariantLabel(pricingVariants[0].name)} <span className="font-normal text-slate-500">(selected automatically)</span></p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="text-xs font-bold">Condition<select value={item.condition || ""} onChange={(event) => { const condition = event.target.value as CardCondition | ""; onPatch({ condition: condition || null, adjustedMarket: confirmedMarketForCondition(item.baseMarket, condition || null) }); }} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950"><option value="">Unknown</option>{conditions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-bold">Provider NM market<input type="number" min="0" step="0.01" value={item.baseMarket ?? ""} onChange={(event) => { const value = event.target.value === "" ? undefined : Number(event.target.value); onPatch({ baseMarket: value ?? null, adjustedMarket: item.condition === "Near Mint / NM" ? value ?? null : item.adjustedMarket ?? null }); }} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
        <label className="text-xs font-bold">Confirmed market<input type="number" min="0" step="0.01" disabled={item.condition === "Near Mint / NM" && item.baseMarket != null} value={item.condition === "Near Mint / NM" && item.baseMarket != null ? item.baseMarket : item.adjustedMarket ?? ""} onChange={(event) => onPatch({ adjustedMarket: event.target.value === "" ? null : Number(event.target.value) })} placeholder={item.condition === "Near Mint / NM" && item.baseMarket != null ? "Uses provider market" : "Required for this condition"} className="mt-1 w-full rounded-xl border p-3 disabled:opacity-60 dark:bg-slate-950" /></label>
        <label className="text-xs font-bold">Quantity<input type="number" min="1" value={item.quantity} onChange={(event) => onPatch({ quantity: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
      </div>
      <div className="mt-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-800"><p className="font-black">Cost basis</p><p className="text-xs text-slate-500">Unknown is preserved as unknown. It is never silently converted to $0.</p><div className="mt-2 flex flex-wrap gap-2">{([['unknown', 'Unknown'], ['amount', 'Enter amount'], ['zero', 'Confirm $0']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => { setCostMode(value); if (value === "unknown") onPatch({ costBasis: null, zeroCostBasisConfirmed: false }); if (value === "zero") onPatch({ costBasis: 0, zeroCostBasisConfirmed: true }); }} className={`rounded-lg px-3 py-2 text-xs font-black ${costMode === value ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{label}</button>)}</div>{costMode === "amount" ? <div className="mt-2 flex gap-2"><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Actual historical cost" className="min-w-0 flex-1 rounded-xl border p-3 dark:bg-slate-950" /><button type="button" onClick={() => onPatch({ costBasis: Number(cost), zeroCostBasisConfirmed: Number(cost) === 0 })} className="rounded-xl bg-violet-600 px-4 font-black text-white">Save</button></div> : null}</div>
      <div className="mt-3"><OwnershipEditor workers={workers} shares={item.ownershipShares} totalCost={item.costBasis || 0} label="Inventory ownership" onChange={(ownershipShares: OwnershipShare[]) => onPatch({ ownershipShares })} /></div>
      {item.alternativeCandidates.length ? <div className="mt-3"><p className="font-black">Other likely matches</p><div className="mt-2 flex gap-2 overflow-x-auto pb-2">{item.alternativeCandidates.map((match) => <button type="button" key={`${match.provider}:${match.providerCardId}`} onClick={() => onChoose(match)} className="w-36 shrink-0 rounded-xl border border-slate-200 p-2 text-left dark:border-slate-700">{match.imageSmall ? <img loading="lazy" src={match.imageSmall} alt="" className="mx-auto h-32 object-contain" /> : null}<b className="mt-1 block truncate text-xs">{match.name}</b><span className="text-[11px] text-slate-500">{match.setName} · {match.matchScore}%</span></button>)}</div></div> : null}
      {!pricingReady ? <p className="mt-3 rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Choose the printing and condition, then confirm the market value before approval.</p> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={onSearch} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 font-black text-white"><Search size={17} /> Search / replace match</button><button type="button" disabled={busy || !item.selectedCandidate || !ownershipValid || !pricingReady || item.status === "confirmed"} onClick={onConfirm} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-40"><Check size={18} /> {item.status === "confirmed" ? "Already confirmed" : "Approve to inventory"}</button></div>
      <p className="mt-2 text-center text-[11px] text-slate-500">Keyboard: ←/→ navigate · A approves. Confirmation creates inventory only—no transaction, revenue, or profit record.</p>
    </section>
  </div>;
}
