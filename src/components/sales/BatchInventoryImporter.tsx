import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleX,
  CopyCheck, Eye, Image as ImageIcon, LoaderCircle, RefreshCw, Search,
  Trash2, Upload, X,
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
  resolveBulkImportSourceImageUrl,
  retryBulkImportItems,
  updateBulkImportItem,
  uploadBulkImportFile,
  type BulkImportItem,
  type BulkImportJob,
} from "../../services/database/bulkInventoryImportRepository";
import {
  bulkItemMarketValue,
  bulkItemPricingVariants,
  bulkItemReviewIssues,
  filterBulkQueue,
  isBulkItemImportReady,
  pageBulkQueue,
  runWithConcurrency,
  sortBulkQueue,
  type BulkQueueFilter,
  type BulkQueueSort,
} from "../../utils/bulkInventoryImport";
import { formatMoney } from "../../utils/paymentMath";
import { searchPokemonCardsManually } from "../../services/sales/pokemonCardSearchService";
import { ImageLightbox } from "./ImageLightbox";
import { ManualCardSearch } from "./ManualCardSearch";
import { OwnershipEditor } from "./OwnershipEditor";

type Props = {
  workers: Worker[];
  onClose: () => void;
  onConfirmed: (purchase: InventoryPurchase) => void;
};

type ItemPatch = Parameters<typeof updateBulkImportItem>[1];
type ReviewScreen = "review" | "summary" | "importing" | "complete";
type LightboxState = { url: string; title: string } | null;

const conditions: CardCondition[] = ["Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged", "Unknown"];
const pageSize = 50;
const filterOptions: Array<{ value: BulkQueueFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "needs_review", label: "Needs Review" },
  { value: "failed", label: "Failed" },
  { value: "missing_variant", label: "Missing Variant" },
  { value: "missing_condition", label: "Missing Condition" },
  { value: "missing_price", label: "Missing Price" },
  { value: "stamped", label: "Stamped" },
  { value: "low_confidence", label: "Low Confidence" },
  { value: "possible_duplicate", label: "Possible Duplicate" },
];
const confirmedMarketForCondition = (baseMarket: number | null | undefined, condition: CardCondition | null | undefined) => condition === "Near Mint / NM" ? baseMarket ?? null : null;
const bulkVariantLabels: Record<string, string> = { normal: "Normal", holofoil: "Holofoil", reverseHolofoil: "Reverse Holo", "1stEditionNormal": "First Edition Normal", "1stEditionHolofoil": "First Edition Holo" };
const bulkVariantLabel = (value?: string | null) => value ? bulkVariantLabels[value] || value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()) : "Variant needed";
const confidenceLabel = (value?: BulkImportItem["overallConfidence"]) => value === "high" ? "High Confidence" : value === "medium" ? "Medium Confidence" : "Low Confidence";
const confidenceShort = (value?: BulkImportItem["overallConfidence"]) => value === "high" ? "High" : value === "medium" ? "Medium" : "Low";
const conditionLabels: Partial<Record<CardCondition, string>> = {
  "Near Mint / NM": "NM", "Lightly Played / LP": "LP", "Moderately Played / MP": "MP",
  "Heavily Played / HP": "HP", Damaged: "DMG", Mint: "Mint",
  Unknown: "Unknown",
};
const compactCondition = (value?: CardCondition) => value ? conditionLabels[value] || value : "Condition needed";

function statusLabel(item: BulkImportItem) {
  if (item.status === "confirmed") return "Imported";
  if (item.status === "failed") return "Failed";
  if (item.status === "processing") return "Processing";
  if (item.status === "waiting") return "Waiting";
  return isBulkItemImportReady(item) ? "Ready" : "Review required";
}

function statusClass(item: BulkImportItem) {
  if (item.status === "confirmed") return "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";
  if (item.status === "failed") return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200";
  if (isBulkItemImportReady(item)) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100";
}

function statusIcon(item: BulkImportItem) {
  if (item.status === "failed") return <CircleX size={15} />;
  if (isBulkItemImportReady(item)) return <CheckCircle2 size={15} />;
  return <AlertTriangle size={15} />;
}

function issueLabels(item: BulkImportItem) {
  const issues = bulkItemReviewIssues(item);
  const labels: string[] = [];
  if (issues.includes("match")) labels.push("Match needed");
  if (issues.includes("variant")) labels.push("Missing Variant");
  if (issues.includes("condition")) labels.push("Missing Condition");
  if (issues.includes("price")) labels.push("Missing Price");
  if (issues.includes("ownership")) labels.push("Ownership incomplete");
  if (item.status === "needs_review" && item.selectedCandidate) labels.push("Possible mismatch");
  if (item.possibleDuplicate) labels.push("Possible Duplicate Photo");
  return labels;
}

function blockingIssues(item: BulkImportItem) {
  return bulkItemReviewIssues(item).filter((issue) => issue !== "ambiguous");
}

function sharesForPreset(workers: Worker[], preset: "gonzalo" | "thiago" | "shared") {
  const gonzalo = workers.find((worker) => worker.name.toLowerCase() === "gonzalo");
  const thiago = workers.find((worker) => worker.name.toLowerCase() === "thiago");
  if (preset === "gonzalo") return gonzalo ? [{ workerId: gonzalo.id, ownershipPercentage: 100 }] : [];
  if (preset === "thiago") return thiago ? [{ workerId: thiago.id, ownershipPercentage: 100 }] : [];
  return gonzalo && thiago ? [{ workerId: gonzalo.id, ownershipPercentage: 50 }, { workerId: thiago.id, ownershipPercentage: 50 }] : [];
}

function ownershipLabel(item: BulkImportItem, workers: Worker[]) {
  if (!item.ownershipShares.length) return "Unassigned";
  return item.ownershipShares
    .map((share) => `${workers.find((worker) => worker.id === share.workerId)?.name || "Unknown"}${share.ownershipPercentage === 100 ? "" : ` ${share.ownershipPercentage}%`}`)
    .join(" / ");
}

function buildCountSummary(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function selectedVariant(item: BulkImportItem) {
  if (item.marketVariant) return bulkVariantLabel(item.marketVariant);
  const variants = bulkItemPricingVariants(item);
  return variants.length === 1 ? bulkVariantLabel(variants[0].name) : "Variant needed";
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState("");
  const [manualSearchId, setManualSearchId] = useState("");
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const [busyAction, setBusyAction] = useState("");
  const [screen, setScreen] = useState<ReviewScreen>("review");
  const [showContinuePrompt, setShowContinuePrompt] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importResult, setImportResult] = useState({ added: 0, skipped: 0, value: 0, failed: 0 });
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

  const openJob = useCallback(async (jobId: string) => {
    setScreen("review");
    setSelectedIds([]);
    setFilter("all");
    await refreshJob(jobId);
  }, [refreshJob]);

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

  useEffect(() => setPage(1), [filter, sort]);

  const visible = useMemo(() => sortBulkQueue(filterBulkQueue(items, { filter }), sort), [items, filter, sort]);
  const paged = useMemo(() => pageBulkQueue(visible, page, pageSize), [visible, page]);
  const editing = items.find((item) => item.id === editingId);
  const manualItem = items.find((item) => item.id === manualSearchId);
  const readyItems = useMemo(() => items.filter((item) => item.status !== "confirmed" && isBulkItemImportReady(item)), [items]);
  const confirmedItems = useMemo(() => items.filter((item) => item.status === "confirmed"), [items]);
  const unresolvedItems = useMemo(() => items.filter((item) => item.status !== "confirmed" && !isBulkItemImportReady(item)), [items]);
  const processingCount = items.filter((item) => item.status === "waiting" || item.status === "processing").length;
  const reviewCount = readyItems.length + confirmedItems.length;
  const summaryItems = useMemo(() => [...confirmedItems, ...readyItems], [confirmedItems, readyItems]);
  const summaryMarketValue = summaryItems.reduce((sum, item) => sum + Number(bulkItemMarketValue(item) || 0) * item.quantity, 0);
  const conditionSummary = buildCountSummary(summaryItems.flatMap((item) => Array.from({ length: item.quantity }, () => compactCondition(item.condition))));
  const ownershipSummary = buildCountSummary(summaryItems.flatMap((item) => Array.from({ length: item.quantity }, () => ownershipLabel(item, workers))));
  const filterCounts = useMemo(() => new Map(filterOptions.map((option) => [option.value, filterBulkQueue(items, { filter: option.value }).length])), [items]);

  async function upload(filesLike: FileList | File[]) {
    const files = Array.from(filesLike).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (!files.length || uploading) return;
    setUploading(true);
    setError("");
    setMessage("");
    setScreen("review");
    setUploadProgress({ done: 0, total: files.length });
    try {
      const created = await createBulkImportJob({ count: files.length, game, language });
      setJob(created);
      const results = await runWithConcurrency(files.map((file, index) => () => uploadBulkImportFile(created, file, index)), 3, (done) => setUploadProgress({ done, total: files.length }));
      const failed = results.filter((result) => result.status === "rejected");
      await finishBulkImportUpload(created.id);
      await Promise.all([refreshJob(created.id), refreshJobs()]);
      setMessage(failed.length ? `${files.length - failed.length} photos queued. ${failed.length} upload${failed.length === 1 ? "" : "s"} failed and remain safely on your device.` : `${files.length} photos uploaded. Recognition is continuing in the background.`);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Bulk upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function patchItem(item: BulkImportItem, patch: ItemPatch) {
    setBusyAction(item.id);
    setError("");
    try {
      const saved = await updateBulkImportItem(item.id, patch);
      setItems((current) => current.map((row) => row.id === saved.id ? saved : row));
      return saved;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Item could not be updated.");
      return null;
    } finally {
      setBusyAction("");
    }
  }

  async function bulkPatch(patch: ItemPatch, targetIds = selectedIds) {
    const targets = items.filter((item) => targetIds.includes(item.id) && item.status !== "confirmed");
    if (!targets.length) return;
    setBusyAction("bulk");
    setError("");
    try {
      const results = await runWithConcurrency(targets.map((item) => async () => {
        if (patch.condition !== undefined) return updateBulkImportItem(item.id, { ...patch, adjustedMarket: confirmedMarketForCondition(item.baseMarket, patch.condition) });
        if (patch.baseMarket !== undefined) return updateBulkImportItem(item.id, { ...patch, adjustedMarket: item.condition === "Near Mint / NM" ? patch.baseMarket ?? null : item.adjustedMarket ?? null });
        return updateBulkImportItem(item.id, patch);
      }), 4);
      const saved = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const byId = new Map(saved.map((item) => [item.id, item]));
      setItems((current) => current.map((item) => byId.get(item.id) || item));
      setMessage(`${saved.length} card${saved.length === 1 ? "" : "s"} updated without another AI request.`);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Bulk update failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function markReviewed(item: BulkImportItem, advance = false) {
    const remaining = blockingIssues(item);
    if (remaining.length) {
      setError("Resolve the missing match, variant, condition, price, or ownership before marking this card ready.");
      return;
    }
    const saved = await patchItem(item, { status: "identified" });
    if (!saved || !advance) return;
    const index = items.findIndex((value) => value.id === item.id);
    const next = items.slice(index + 1).find((value) => value.status !== "confirmed") || items.slice(0, index).find((value) => value.status !== "confirmed");
    if (next) setEditingId(next.id);
    else setEditingId("");
  }

  async function confirmSelectedReview() {
    const targets = items.filter((item) => selectedIds.includes(item.id) && item.status !== "confirmed" && blockingIssues(item).length === 0);
    if (!targets.length) {
      setError("None of the selected cards have all required review details yet.");
      return;
    }
    await bulkPatch({ status: "identified" }, targets.map((item) => item.id));
  }

  async function setAllUnassignedToNm() {
    const targets = items.filter((item) => item.status !== "confirmed" && !item.condition);
    if (!targets.length) return;
    if (!window.confirm(`Set ${targets.length} unassigned card${targets.length === 1 ? "" : "s"} to Near Mint? Review the photos before confirming.`)) return;
    await bulkPatch({ condition: "Near Mint / NM" }, targets.map((item) => item.id));
  }

  async function retrySelected(ids = selectedIds) {
    const targets = items.filter((item) => ids.includes(item.id) && item.status !== "confirmed");
    if (!targets.length) return;
    if (!window.confirm(`Retry AI recognition for ${targets.length} image${targets.length === 1 ? "" : "s"}? This intentionally analyzes each selected image again.`)) return;
    setBusyAction("retry");
    setError("");
    try {
      await retryBulkImportItems(targets.map((item) => item.id));
      setMessage(`${targets.length} image${targets.length === 1 ? "" : "s"} requeued. Existing uploads are reused.`);
      if (job) await refreshJob(job.id);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Retry failed.");
    } finally {
      setBusyAction("");
    }
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
    } finally {
      setBusyAction("");
    }
  }

  function requestSummary() {
    if (processingCount) return;
    if (unresolvedItems.length) setShowContinuePrompt(true);
    else setScreen("summary");
  }

  async function confirmImport() {
    const targets = items.filter((item) => item.status !== "confirmed" && isBulkItemImportReady(item));
    setScreen("importing");
    setImportProgress({ done: 0, total: targets.length });
    setError("");
    const results = await runWithConcurrency(targets.map((item) => async () => {
      const saved = await confirmBulkImportItem(item);
      onConfirmed(saved);
      return saved;
    }), 2, (done) => setImportProgress({ done, total: targets.length }));
    const added = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - added;
    const importedIds = new Set(results.flatMap((result, index) => result.status === "fulfilled" ? [targets[index].id] : []));
    const value = [...confirmedItems, ...targets.filter((item) => importedIds.has(item.id))]
      .reduce((sum, item) => sum + Number(bulkItemMarketValue(item) || 0) * item.quantity, 0);
    if (job) await Promise.all([refreshJob(job.id), refreshJobs()]);
    setImportResult({ added, failed, skipped: unresolvedItems.length + failed, value });
    if (failed) setError(`${failed} card${failed === 1 ? "" : "s"} could not be added. Their review records were preserved for a safe retry.`);
    setScreen("complete");
  }

  const allPageSelected = paged.items.length > 0 && paged.items.every((item) => selectedIds.includes(item.id));
  const selectedCount = selectedIds.length;

  return <div
    className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/75 p-0 backdrop-blur-sm sm:p-3"
    onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length && screen === "review") void upload(files); }}
  >
    <section
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); if (screen === "review") void upload(event.dataTransfer.files); }}
      className="mx-auto min-h-dvh w-full max-w-[1500px] bg-white p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:my-3 sm:min-h-0 sm:rounded-3xl sm:p-5 sm:pb-24 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-30 -mx-3 -mt-3 flex items-start gap-3 border-b border-slate-200 bg-white/95 p-3 backdrop-blur sm:-mx-5 sm:-mt-5 sm:rounded-t-3xl sm:p-5 dark:border-slate-800 dark:bg-slate-900/95">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Existing-owned raw cards</p>
          <h2 className="text-xl font-black sm:text-2xl">{screen === "summary" ? "Import Summary" : screen === "importing" ? "Adding to Inventory" : screen === "complete" ? "Import Complete" : "Bulk Scan Review"}</h2>
          <p className="text-xs text-slate-500">{job ? `${job.uploadedCount} card${job.uploadedCount === 1 ? "" : "s"} scanned` : "Scan many cards, verify each match, then import once."}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close bulk importer" className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={19} /></button>
      </header>

      {error ? <div role="alert" className="mt-4 rounded-2xl border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">{error}</div> : null}
      {message && screen === "review" ? <div role="status" className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">{message}</div> : null}

      {screen === "review" ? <div className="mt-4 grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 p-4 text-center dark:border-violet-800 dark:bg-violet-950/20">
            <Upload className="mx-auto text-violet-600" size={28} />
            <p className="mt-2 font-black">Drop 200+ card photos</p><p className="text-xs text-slate-500">JPEG, PNG, or WebP. Review batches are independent of transaction-photo limits.</p>
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
              {jobs.map((value) => <button type="button" key={value.id} onClick={() => void openJob(value.id)} className={`w-full rounded-xl border p-2 text-left text-xs ${job?.id === value.id ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30" : "border-slate-200 dark:border-slate-700"}`}><span className="block font-black">{new Date(value.createdAt).toLocaleString()}</span><span>{value.status} · {value.processedCount}/{value.uploadedCount} processed</span></button>)}
              {!jobs.length ? <p className="text-xs text-slate-500">No bulk imports yet.</p> : null}
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-3">
          {!job ? <div className="flex min-h-72 items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-800 dark:bg-slate-950"><div><ImageIcon className="mx-auto text-slate-400" size={40} /><h3 className="mt-3 text-lg font-black">Start with card photos</h3><p className="mt-1 max-w-md text-sm text-slate-500">The upload creates a durable review job. No inventory records are created until the final confirmation.</p></div></div> : <>
            <section className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {[["Scanned", job.uploadedCount], ["Processed", job.processedCount], ["Ready", readyItems.length], ["Needs Review", unresolvedItems.filter((item) => item.status !== "failed").length], ["Failed", items.filter((item) => item.status === "failed").length]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-2 text-center dark:bg-slate-950"><b className="block text-lg">{value}</b><span className="text-[11px] text-slate-500">{label}</span></div>)}
            </section>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className="block h-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all" style={{ width: `${job.uploadedCount ? Math.min(100, job.processedCount / job.uploadedCount * 100) : 0}%` }} /></div>
            {processingCount ? <p className="rounded-xl bg-violet-50 p-3 text-xs font-bold text-violet-800 dark:bg-violet-950/30 dark:text-violet-200">Processing cards · {job.processedCount} / {job.uploadedCount}. You can review completed matches while the queue continues.</p> : null}
            {job.status === "uploading" && job.uploadedCount > 0 && !uploading ? <button type="button" disabled={busyAction === "resume"} onClick={() => {
              setBusyAction("resume");
              void finishBulkImportUpload(job.id).then(() => Promise.all([refreshJob(job.id), refreshJobs()])).then(() => setMessage(`${job.uploadedCount} already-uploaded photos resumed safely.`)).catch((unknownError) => setError(unknownError instanceof Error ? unknownError.message : "Import could not resume.")).finally(() => setBusyAction(""));
            }} className="min-h-11 w-full rounded-xl bg-amber-500 px-4 text-sm font-black text-slate-950">Resume processing {job.uploadedCount} uploaded photo{job.uploadedCount === 1 ? "" : "s"}</button> : null}

            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {filterOptions.map((option) => <button key={option.value} type="button" onClick={() => setFilter(option.value)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${filter === option.value ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{option.label} <span className="opacity-70">{filterCounts.get(option.value) || 0}</span></button>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={sort} onChange={(event) => setSort(event.target.value as BulkQueueSort)} className="rounded-full border bg-white px-3 py-2 text-xs font-bold dark:bg-slate-950"><option value="upload">Upload order</option><option value="status">Issues first</option><option value="confidence">Lowest confidence</option><option value="name">Card name</option><option value="market">Highest market</option></select>
              <button type="button" disabled={!items.some((item) => item.status !== "confirmed" && !item.condition)} onClick={() => void setAllUnassignedToNm()} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black disabled:opacity-40 dark:bg-slate-800">Set all unassigned to NM</button>
              <button type="button" disabled={!items.some((item) => item.status !== "confirmed")} onClick={() => setEditingId(items.find((item) => item.status !== "confirmed")?.id || "")} className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:opacity-40 dark:bg-white dark:text-slate-950"><Eye size={14} /> Review One by One</button>
            </div>

            {selectedCount ? <div className="sticky top-[5.2rem] z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-violet-300 bg-white/95 p-2 shadow-lg backdrop-blur dark:bg-slate-900/95"><b className="mr-auto text-sm">{selectedCount} selected</b>
              <select aria-label="Bulk condition" defaultValue="" onChange={(event) => { if (event.target.value) void bulkPatch({ condition: event.target.value as CardCondition }); event.currentTarget.value = ""; }} className="rounded-lg border p-2 text-xs dark:bg-slate-950"><option value="">Set condition…</option>{conditions.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="Bulk language" defaultValue="" onChange={(event) => { if (event.target.value) void bulkPatch({ recognizedLanguage: event.target.value }); event.currentTarget.value = ""; }} className="rounded-lg border p-2 text-xs dark:bg-slate-950"><option value="">Set language…</option><option value="en">English</option><option value="ja">Japanese</option></select>
              <button type="button" onClick={() => void bulkPatch({ ownershipShares: sharesForPreset(workers, "gonzalo") })} className="rounded-lg bg-slate-100 p-2 text-xs font-black dark:bg-slate-800">Gonzalo</button>
              <button type="button" onClick={() => void bulkPatch({ ownershipShares: sharesForPreset(workers, "thiago") })} className="rounded-lg bg-slate-100 p-2 text-xs font-black dark:bg-slate-800">Thiago</button>
              <button type="button" onClick={() => void bulkPatch({ ownershipShares: sharesForPreset(workers, "shared") })} className="rounded-lg bg-slate-100 p-2 text-xs font-black dark:bg-slate-800">50/50</button>
              <button type="button" onClick={() => void confirmSelectedReview()} className="rounded-lg bg-emerald-100 p-2 text-xs font-black text-emerald-800"><Check size={14} className="inline" /> Confirm Selected</button>
              <button type="button" disabled={busyAction === "retry"} onClick={() => void retrySelected()} className="rounded-lg bg-amber-100 p-2 text-xs font-black text-amber-900"><RefreshCw size={14} className="inline" /> Retry Selected</button>
              <button type="button" onClick={() => void removeSelected()} className="rounded-lg bg-rose-100 p-2 text-xs font-black text-rose-800"><Trash2 size={14} className="inline" /> Delete</button>
            </div> : null}

            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-950">
                <input type="checkbox" aria-label="Select page" checked={allPageSelected} onChange={(event) => setSelectedIds((current) => event.target.checked ? Array.from(new Set([...current, ...paged.items.map((item) => item.id)])) : current.filter((id) => !paged.items.some((item) => item.id === id)))} />
                <span className="font-black">Select this page</span>
                <button type="button" onClick={() => setSelectedIds(visible.map((item) => item.id))} className="ml-auto font-bold text-violet-700 dark:text-violet-300">Select all {visible.length}</button>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {paged.items.map((item) => {
                  const providerImage = item.selectedCandidate?.imageSmall || item.selectedCandidate?.imageLarge;
                  const labels = issueLabels(item);
                  return <article key={item.id} className="group flex min-h-28 items-center gap-2 p-2 transition hover:bg-slate-50 sm:gap-3 sm:p-3 dark:hover:bg-slate-950/60">
                    <input type="checkbox" aria-label={`Select ${item.selectedCandidate?.name || item.originalFilename}`} checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? Array.from(new Set([...current, item.id])) : current.filter((id) => id !== item.id))} />
                    <button type="button" onClick={() => setLightbox({ url: item.sourceImageUrl, title: `Uploaded photo · ${item.originalFilename}` })} className="relative shrink-0 overflow-hidden rounded-lg bg-slate-950">
                      <img loading="lazy" decoding="async" src={item.thumbnailUrl || item.sourceImageUrl} alt="Uploaded card" width="64" height="88" className="h-20 w-14 object-cover sm:h-24 sm:w-16" />
                      <span className="absolute inset-x-0 bottom-0 bg-black/65 py-0.5 text-[9px] font-black uppercase text-white">Photo</span>
                    </button>
                    <button type="button" disabled={!providerImage} onClick={() => providerImage && setLightbox({ url: providerImage, title: `Provider reference · ${item.selectedCandidate?.name || "Card"}` })} className="relative shrink-0 overflow-hidden rounded-lg bg-slate-100 disabled:opacity-60 dark:bg-slate-800">
                      {providerImage ? <img loading="lazy" decoding="async" src={providerImage} alt="Provider card reference" width="64" height="88" className="h-20 w-14 object-contain sm:h-24 sm:w-16" /> : <div className="flex h-20 w-14 items-center justify-center text-[9px] font-bold text-slate-500 sm:h-24 sm:w-16">No match</div>}
                      <span className="absolute inset-x-0 bottom-0 bg-white/85 py-0.5 text-[9px] font-black uppercase text-slate-700 dark:bg-slate-950/85 dark:text-slate-200">Card</span>
                    </button>
                    <button type="button" onClick={() => setEditingId(item.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-start gap-2"><b className="min-w-0 flex-1 truncate text-sm sm:text-base">{item.selectedCandidate?.name || item.recognizedName || (item.status === "processing" ? "Analyzing…" : "Unidentified card")}</b><span className={`hidden items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black sm:inline-flex ${statusClass(item)}`}>{statusIcon(item)} {statusLabel(item)}</span></div>
                      <p className="truncate text-xs text-slate-500">{item.selectedCandidate?.setName || item.recognizedSet || "Set unknown"} · #{item.selectedCandidate?.collectorNumber || item.selectedCandidate?.cardCode || item.recognizedCollectorNumber || "—"}</p>
                      <p className="mt-1 truncate text-xs font-bold">{compactCondition(item.condition)} · {selectedVariant(item)} · Market: {bulkItemMarketValue(item) == null ? "—" : formatMoney(Number(bulkItemMarketValue(item)))}</p>
                      <div className="mt-1 flex flex-wrap gap-1"><span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-black sm:hidden ${statusClass(item)}`}>{statusIcon(item)} {statusLabel(item)}</span><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold dark:bg-slate-800">AI: {confidenceShort(item.overallConfidence)}</span>{labels.slice(0, 3).map((label) => <span key={label} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">{label}</span>)}</div>
                      {item.status === "needs_review" && item.alternativeCandidates.length ? <p className="mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">{item.alternativeCandidates.length + 1} possible versions · compare both images</p> : null}
                    </button>
                    <ChevronRight className="shrink-0 text-slate-400" size={18} />
                  </article>;
                })}
                {!paged.items.length ? <p className="p-8 text-center text-sm text-slate-500">No cards match this filter.</p> : null}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs"><span>{visible.length} matching · page {paged.page} of {paged.pageCount}</span><div className="flex gap-2"><button type="button" disabled={paged.page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg bg-slate-100 p-2 disabled:opacity-40 dark:bg-slate-800"><ChevronLeft size={16} /></button><button type="button" disabled={paged.page >= paged.pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg bg-slate-100 p-2 disabled:opacity-40 dark:bg-slate-800"><ChevronRight size={16} /></button></div></div>
          </>}
        </main>
      </div> : null}

      {screen === "summary" ? <ImportSummary
        total={items.length}
        ready={readyItems.length}
        alreadyImported={confirmedItems.length}
        skipped={unresolvedItems.length}
        marketValue={summaryMarketValue}
        ownership={ownershipSummary}
        conditions={conditionSummary}
        onBack={() => setScreen("review")}
        onConfirm={() => void confirmImport()}
      /> : null}

      {screen === "importing" ? <div className="mx-auto mt-16 max-w-xl rounded-3xl border border-slate-200 p-8 text-center dark:border-slate-800"><LoaderCircle className="mx-auto animate-spin text-violet-600" size={42} /><h3 className="mt-4 text-xl font-black">Adding to inventory…</h3><p className="mt-1 text-sm text-slate-500">{importProgress.done} / {importProgress.total}</p><div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className="block h-full bg-emerald-500 transition-all" style={{ width: `${importProgress.total ? importProgress.done / importProgress.total * 100 : 0}%` }} /></div><p className="mt-4 text-xs text-slate-500">Each card uses a stable inventory ID, so retrying cannot create a duplicate.</p></div> : null}

      {screen === "complete" ? <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/20"><CheckCircle2 className="mx-auto text-emerald-600" size={48} /><h3 className="mt-3 text-2xl font-black">Import Complete</h3><p className="mt-2 text-lg font-bold">{importResult.added} card{importResult.added === 1 ? "" : "s"} added to inventory</p><p className="mt-4 text-xs font-black uppercase tracking-wide text-slate-500">Estimated Inventory Market Value</p><p className="text-3xl font-black">{formatMoney(importResult.value)}</p><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{importResult.skipped} skipped{importResult.failed ? ` · ${importResult.failed} safe to retry` : ""}</p><div className="mt-6 grid gap-2 sm:grid-cols-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-slate-950 px-4 font-black text-white dark:bg-white dark:text-slate-950">View Inventory</button><button type="button" disabled={!importResult.skipped} onClick={() => { setScreen("review"); setFilter("all"); }} className="min-h-12 rounded-xl bg-white px-4 font-black disabled:opacity-40 dark:bg-slate-900">Review Skipped Cards</button><button type="button" onClick={() => { setJob(undefined); setItems([]); setSelectedIds([]); setScreen("review"); setMessage(""); setError(""); }} className="min-h-12 rounded-xl bg-violet-600 px-4 font-black text-white">Start Another Scan</button></div></div> : null}

      {screen === "review" && job ? <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"><div className="mx-auto flex max-w-4xl items-center gap-3"><div className="min-w-0 flex-1"><b className="block text-sm">{reviewCount} / {items.length} reviewed</b><span className="block truncate text-xs text-slate-500">{processingCount ? `${processingCount} still processing` : unresolvedItems.length ? `${unresolvedItems.length} card${unresolvedItems.length === 1 ? "" : "s"} still need review` : "Everything is ready for the final summary"}</span></div><button type="button" disabled={Boolean(processingCount) || !items.length} onClick={requestSummary} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-violet-600 px-5 font-black text-white disabled:opacity-40">Next <ArrowRight size={18} /></button></div></div> : null}

      {showContinuePrompt ? <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/75 p-4"><section role="dialog" aria-modal="true" aria-label="Unresolved cards" className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900"><AlertTriangle className="text-amber-500" size={32} /><h3 className="mt-3 text-xl font-black">{unresolvedItems.length} cards still need review</h3><p className="mt-2 text-sm text-slate-500">Unresolved cards will be clearly listed as skipped. They will not be added to inventory unless you resolve them and return to the summary.</p><div className="mt-5 grid gap-2"><button type="button" onClick={() => { setShowContinuePrompt(false); setFilter("needs_review"); }} className="min-h-12 rounded-xl bg-violet-600 px-4 font-black text-white">Review Issues</button><button type="button" onClick={() => { setShowContinuePrompt(false); setScreen("summary"); }} className="min-h-12 rounded-xl bg-slate-100 px-4 font-black dark:bg-slate-800">Continue Anyway</button></div></section></div> : null}

      {editing ? <ItemReview
        item={editing}
        workers={workers}
        itemNumber={items.findIndex((value) => value.id === editing.id) + 1}
        itemCount={items.length}
        busy={busyAction === editing.id}
        onClose={() => setEditingId("")}
        onOpenImage={(url, title) => setLightbox({ url, title })}
        onSearch={() => setManualSearchId(editing.id)}
        onPatch={(patch) => void patchItem(editing, patch)}
        onLooksGood={() => void markReviewed(editing, true)}
        onRetry={() => void retrySelected([editing.id])}
        onChoose={(match) => {
          const matched = bulkItemPatchFromMatch(match);
          void patchItem(editing, { ...matched, condition: editing.condition || null, adjustedMarket: editing.condition === "Near Mint / NM" && matched.baseMarket != null ? Number(matched.baseMarket) : editing.condition === "Near Mint / NM" ? null : editing.adjustedMarket ?? null });
        }}
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
          if (match) void patchItem(manualItem, { ...bulkItemPatchFromMatch(match), status: "needs_review", recognizedName: suggestion.cardName, recognizedCollectorNumber: suggestion.collectorNumber, recognizedSet: suggestion.cardSet });
          else void patchItem(manualItem, { status: "needs_review", recognizedName: suggestion.cardName, recognizedCollectorNumber: suggestion.collectorNumber, recognizedSet: suggestion.cardSet });
          setManualSearchId("");
        }}
      />
      <ImageLightbox imageUrl={lightbox?.url} title={lightbox?.title || "Card image"} onClose={() => setLightbox(null)} />
    </section>
  </div>;
}

function ImportSummary({ total, ready, alreadyImported, skipped, marketValue, ownership, conditions: conditionCounts, onBack, onConfirm }: {
  total: number;
  ready: number;
  alreadyImported: number;
  skipped: number;
  marketValue: number;
  ownership: Array<[string, number]>;
  conditions: Array<[string, number]>;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return <div className="mx-auto mt-8 max-w-3xl space-y-4">
    <section className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800">
      <p className="eyebrow">Final check</p><h3 className="text-2xl font-black">Only ready cards will be added</h3><p className="mt-1 text-sm text-slate-500">This import changes inventory quantity and market value only. It does not create revenue, expense, profit, trade, or transaction records.</p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Cards", total], ["Ready", ready], ["Already added", alreadyImported], ["Skipped", skipped]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950"><span className="text-xs font-bold text-slate-500">{label}</span><b className="block text-2xl">{value}</b></div>)}</div>
      <div className="mt-4 rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/25"><span className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Estimated Inventory Market Value</span><b className="mt-1 block text-3xl">{formatMoney(marketValue)}</b><p className="mt-1 text-xs text-slate-500">Inventory value only—not revenue or realized profit.</p></div>
    </section>
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-3xl border border-slate-200 p-4 dark:border-slate-800"><h4 className="font-black">Ownership</h4><div className="mt-3 space-y-2">{ownership.map(([label, count]) => <div key={label} className="flex justify-between text-sm"><span>{label}</span><b>{count}</b></div>)}{!ownership.length ? <p className="text-sm text-slate-500">No ready cards</p> : null}</div></section>
      <section className="rounded-3xl border border-slate-200 p-4 dark:border-slate-800"><h4 className="font-black">Conditions</h4><div className="mt-3 space-y-2">{conditionCounts.map(([label, count]) => <div key={label} className="flex justify-between text-sm"><span>{label}</span><b>{count}</b></div>)}{!conditionCounts.length ? <p className="text-sm text-slate-500">No ready cards</p> : null}</div></section>
    </div>
    {skipped ? <p className="rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{skipped} unresolved card{skipped === 1 ? "" : "s"} will remain in the durable review queue and will not enter inventory.</p> : null}
    <div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={onBack} className="min-h-12 rounded-xl bg-slate-100 px-4 font-black dark:bg-slate-800">Back to Review</button><button type="button" disabled={!ready} onClick={onConfirm} className="min-h-12 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-40">Confirm & Add to Inventory</button></div>
  </div>;
}

function LegacyItemReview({ item, workers, itemNumber, itemCount, busy, onClose, onOpenImage, onSearch, onPatch, onLooksGood, onRetry, onChoose, onPrevious, onNext }: {
  item: BulkImportItem;
  workers: Worker[];
  itemNumber: number;
  itemCount: number;
  busy: boolean;
  onClose: () => void;
  onOpenImage: (url: string, title: string) => void;
  onSearch: () => void;
  onPatch: (patch: ItemPatch) => void;
  onLooksGood: () => void;
  onRetry: () => void;
  onChoose: (match: NonNullable<BulkImportItem["selectedCandidate"]>) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const [costMode, setCostMode] = useState<"unknown" | "amount" | "zero">(item.zeroCostBasisConfirmed ? "zero" : item.costBasis != null ? "amount" : "unknown");
  const [cost, setCost] = useState(item.costBasis == null ? "" : String(item.costBasis));
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setCostMode(item.zeroCostBasisConfirmed ? "zero" : item.costBasis != null ? "amount" : "unknown"); setCost(item.costBasis == null ? "" : String(item.costBasis)); }, [item.id, item.costBasis, item.zeroCostBasisConfirmed]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
      if (event.key.toLowerCase() === "a" && item.status !== "confirmed" && blockingIssues(item).length === 0) onLooksGood();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [item, onLooksGood, onNext, onPrevious]);
  const candidateImage = item.selectedCandidate?.imageLarge || item.selectedCandidate?.imageSmall;
  const pricingVariants = bulkItemPricingVariants(item);
  const ownershipValid = !item.ownershipShares.length || Math.abs(item.ownershipShares.reduce((sum, share) => sum + share.ownershipPercentage, 0) - 100) < 0.001;
  const pricingReady = Boolean(item.condition) && (pricingVariants.length <= 1 || Boolean(item.marketVariant)) && bulkItemMarketValue(item) != null;
  const readyToMark = Boolean(item.selectedCandidate) && ownershipValid && pricingReady && !["failed", "waiting", "processing"].includes(item.status);
  const providerHasStamped = pricingVariants.some((variant) => /stamp/i.test(variant.name || variant.variant || ""));
  const stamped = /stamp/i.test(item.marketVariant || "");
  const candidateFallbackMarket = pricingVariants.length === 1
    ? pricingVariants[0].market ?? null
    : pricingVariants.length === 0 ? item.selectedCandidate?.pricing?.market ?? null : null;
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/70 sm:items-center sm:p-4">
    <section
      onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={(event) => { const start = touchStart.current; const touch = event.changedTouches[0]; touchStart.current = null; if (!start || !touch) return; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx > 0) onPrevious(); else onNext(); } }}
      className="max-h-[96dvh] w-full max-w-5xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-3xl dark:bg-slate-900"
    >
      <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-white/95 p-1 backdrop-blur dark:bg-slate-900/95"><button type="button" onClick={onPrevious} aria-label="Previous card" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><ChevronLeft size={18} /></button><div className="min-w-0 flex-1"><p className="eyebrow">Card {itemNumber} of {itemCount}</p><h3 className="truncate text-lg font-black">{item.selectedCandidate?.name || item.recognizedName || "Unidentified card"}</h3></div><button type="button" onClick={onNext} aria-label="Next card" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><ChevronRight size={18} /></button><button type="button" onClick={onClose} aria-label="Close review" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></header>
      {item.possibleDuplicate ? <p className="mt-3 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900"><CopyCheck size={16} className="mr-1 inline" />Possible Duplicate Photo. The same source image hash appeared before; identical card IDs alone are never treated as duplicates.</p> : null}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-4">
        <button type="button" onClick={() => onOpenImage(item.sourceImageUrl, `Uploaded photo · ${item.originalFilename}`)} className="rounded-2xl bg-slate-950 p-2"><p className="mb-1 text-[10px] font-black uppercase tracking-wide text-white">Your uploaded photo</p><img src={item.sourceImageUrl} alt="Uploaded card" className="h-64 w-full object-contain sm:h-80" /><span className="text-xs font-bold text-white">Tap to enlarge</span></button>
        <button type="button" disabled={!candidateImage} onClick={() => candidateImage && onOpenImage(candidateImage, `Provider reference · ${item.selectedCandidate?.name || "Card"}`)} className="rounded-2xl bg-slate-50 p-2 text-left disabled:opacity-60 dark:bg-slate-950"><p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Provider reference</p>{candidateImage ? <img src={candidateImage} alt="Provider card" className="h-64 w-full object-contain sm:h-80" /> : <div className="flex h-64 items-center justify-center text-sm text-slate-500 sm:h-80">No exact candidate chosen</div>}<b className="block truncate text-xs sm:text-sm">{item.selectedCandidate?.name || "Search for a match"}</b><span className="block truncate text-[10px] text-slate-500 sm:text-xs">{item.selectedCandidate?.setName} · #{item.selectedCandidate?.collectorNumber || item.selectedCandidate?.cardCode || "—"}</span></button>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">Compare artwork, set, number, language, foil, edition, and stamps. Tap either image to inspect it.</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-bold">Recognized card name<input key={`${item.id}-name`} defaultValue={item.recognizedName || item.selectedCandidate?.name || ""} onBlur={(event) => onPatch({ recognizedName: event.target.value.trim() || null })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
        <label className="text-xs font-bold">Collector number<input key={`${item.id}-number`} defaultValue={item.recognizedCollectorNumber || item.selectedCandidate?.collectorNumber || item.selectedCandidate?.cardCode || ""} onBlur={(event) => onPatch({ recognizedCollectorNumber: event.target.value.trim() || null })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
        <label className="text-xs font-bold">Set<input key={`${item.id}-set`} defaultValue={item.recognizedSet || item.selectedCandidate?.setName || ""} onBlur={(event) => onPatch({ recognizedSet: event.target.value.trim() || null })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
      </div>

      {pricingVariants.length > 1 ? <label className="mt-3 block text-xs font-bold">Choose Printing<select value={item.marketVariant || ""} onChange={(event) => { const variant = pricingVariants.find((value) => value.name === event.target.value); const baseMarket = variant?.market ?? null; onPatch({ marketVariant: variant?.name || null, baseMarket, adjustedMarket: item.condition === "Near Mint / NM" ? baseMarket : null }); }} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950"><option value="">Choose the physical printing</option>{pricingVariants.map((variant) => <option key={variant.name} value={variant.name}>{bulkVariantLabel(variant.name)}</option>)}</select></label> : pricingVariants.length === 1 && !stamped ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-bold dark:bg-slate-950">Printing: {bulkVariantLabel(pricingVariants[0].name)} <span className="font-normal text-slate-500">(provider-supported)</span></p> : null}

      {!providerHasStamped && item.selectedCandidate ? <div className="mt-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-800"><p className="text-xs font-black">Stamped card?</p><p className="text-[11px] text-slate-500">Use the physical card photo. Provider pricing does not list a separate stamped record, so a stamped copy requires a manually confirmed market value.</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => onPatch({ marketVariant: "stamped/manual", baseMarket: null, adjustedMarket: null, marketSource: "Manual stamped confirmation" })} className={`rounded-lg px-3 py-2 text-xs font-black ${stamped ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>Yes, stamped</button><button type="button" onClick={() => onPatch({ marketVariant: pricingVariants[0]?.name || null, baseMarket: candidateFallbackMarket, adjustedMarket: item.condition === "Near Mint / NM" ? candidateFallbackMarket : null, marketSource: item.selectedCandidate?.pricing?.source || item.marketSource || null })} className={`rounded-lg px-3 py-2 text-xs font-black ${!stamped ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>No</button></div></div> : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="text-xs font-bold">Condition<select value={item.condition || ""} onChange={(event) => { const condition = event.target.value as CardCondition | ""; onPatch({ condition: condition || null, adjustedMarket: confirmedMarketForCondition(item.baseMarket, condition || null) }); }} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950"><option value="">Unknown</option>{conditions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-bold">Provider NM market<input type="number" min="0" step="0.01" disabled={stamped} value={item.baseMarket ?? ""} onChange={(event) => { const value = event.target.value === "" ? undefined : Number(event.target.value); onPatch({ baseMarket: value ?? null, adjustedMarket: item.condition === "Near Mint / NM" ? value ?? null : item.adjustedMarket ?? null }); }} className="mt-1 w-full rounded-xl border p-3 disabled:opacity-50 dark:bg-slate-950" /></label>
        <label className="text-xs font-bold">Confirmed market<input type="number" min="0" step="0.01" disabled={!stamped && item.condition === "Near Mint / NM" && item.baseMarket != null} value={!stamped && item.condition === "Near Mint / NM" && item.baseMarket != null ? item.baseMarket : item.adjustedMarket ?? ""} onChange={(event) => onPatch({ adjustedMarket: event.target.value === "" ? null : Number(event.target.value) })} placeholder={!stamped && item.condition === "Near Mint / NM" && item.baseMarket != null ? "Uses provider market" : "Required"} className="mt-1 w-full rounded-xl border p-3 disabled:opacity-60 dark:bg-slate-950" /></label>
        <label className="text-xs font-bold">Quantity<input type="number" min="1" value={item.quantity} onChange={(event) => onPatch({ quantity: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-800"><p className="font-black">Cost basis</p><p className="text-xs text-slate-500">Unknown stays unknown. It is never silently converted to $0.</p><div className="mt-2 flex flex-wrap gap-2">{([["unknown", "Unknown"], ["amount", "Enter amount"], ["zero", "Confirm $0"]] as const).map(([value, label]) => <button type="button" key={value} onClick={() => { setCostMode(value); if (value === "unknown") onPatch({ costBasis: null, zeroCostBasisConfirmed: false }); if (value === "zero") onPatch({ costBasis: 0, zeroCostBasisConfirmed: true }); }} className={`rounded-lg px-3 py-2 text-xs font-black ${costMode === value ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{label}</button>)}</div>{costMode === "amount" ? <div className="mt-2 flex gap-2"><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Actual historical cost" className="min-w-0 flex-1 rounded-xl border p-3 dark:bg-slate-950" /><button type="button" onClick={() => onPatch({ costBasis: Number(cost), zeroCostBasisConfirmed: Number(cost) === 0 })} className="rounded-xl bg-violet-600 px-4 font-black text-white">Save</button></div> : null}</div>
      <div className="mt-3"><OwnershipEditor workers={workers} shares={item.ownershipShares} totalCost={item.costBasis || 0} label="Inventory ownership" onChange={(ownershipShares: OwnershipShare[]) => onPatch({ ownershipShares })} /></div>

      {item.alternativeCandidates.length ? <div className="mt-3"><div className="flex items-end justify-between"><div><p className="font-black">Likely Matches</p><p className="text-xs text-slate-500">One tap changes the provider match without calling OpenAI.</p></div><button type="button" onClick={onSearch} className="text-xs font-black text-violet-700 dark:text-violet-300">Search All Pokémon Cards</button></div><div className="mt-2 flex gap-2 overflow-x-auto pb-2">{item.alternativeCandidates.map((match, index) => <button type="button" key={`${match.provider}:${match.providerCardId}`} onClick={() => onChoose(match)} className="w-36 shrink-0 rounded-xl border border-slate-200 p-2 text-left dark:border-slate-700">{match.imageSmall ? <img loading="lazy" src={match.imageSmall} alt="" className="mx-auto h-32 object-contain" /> : null}<b className="mt-1 block truncate text-xs">{index + 1}. {match.name}</b><span className="block truncate text-[11px] text-slate-500">{match.setName} · #{match.collectorNumber || match.cardCode || "—"}</span><span className="text-[10px] font-bold text-slate-500">{confidenceLabel(match.matchConfidence)}</span></button>)}</div></div> : null}

      {!readyToMark ? <p className="mt-3 rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Choose the exact match, printing, condition, market value, and valid ownership before marking this card ready.</p> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-3"><button type="button" onClick={onSearch} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 font-black dark:bg-slate-800"><Search size={17} /> Wrong Match / Search</button>{item.status === "failed" ? <button type="button" onClick={onRetry} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-100 px-4 font-black text-amber-900"><RefreshCw size={17} /> Retry AI Recognition</button> : <div className="hidden sm:block" />}<button type="button" disabled={busy || !readyToMark || item.status === "confirmed"} onClick={onLooksGood} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-40"><Check size={18} /> {item.status === "confirmed" ? "Already imported" : "Looks Good"}</button></div>
      <p className="mt-2 text-center text-[11px] text-slate-500">Looks Good advances to the next card. Normal review, candidate changes, search, variants, condition, and pricing use zero OpenAI credits.</p>
    </section>
  </div>;
}

type BulkCandidate = NonNullable<BulkImportItem["selectedCandidate"]>;

function providerCandidateMarket(candidate: BulkCandidate, variantName?: string) {
  const variants = candidate.pricing?.variants || [];
  if (variantName) return variants.find((variant) => variant.name === variantName)?.market;
  if (variants.length === 1) return variants[0].market;
  return variants.length === 0 ? candidate.pricing?.market : undefined;
}

function prioritizedAlternatives(item: BulkImportItem, searched: BulkCandidate[] = []) {
  const recognizedName = String(item.recognizedName || item.selectedCandidate?.name || "").trim().toLocaleLowerCase();
  const unique = new Map<string, BulkCandidate>();
  [...item.alternativeCandidates, ...searched].forEach((candidate) => unique.set(`${candidate.provider}:${candidate.providerCardId}`, candidate));
  return [...unique.values()]
    .filter((candidate) => candidate.providerCardId !== item.selectedCandidate?.providerCardId)
    .sort((left, right) => {
      const leftExact = left.name.trim().toLocaleLowerCase() === recognizedName ? 1 : 0;
      const rightExact = right.name.trim().toLocaleLowerCase() === recognizedName ? 1 : 0;
      return rightExact - leftExact || Number(right.matchScore || 0) - Number(left.matchScore || 0);
    })
    .slice(0, 10);
}

function ItemReview({ item, workers, itemNumber, itemCount, busy, onClose, onOpenImage, onSearch, onPatch, onLooksGood, onRetry, onChoose, onPrevious, onNext }: {
  item: BulkImportItem;
  workers: Worker[];
  itemNumber: number;
  itemCount: number;
  busy: boolean;
  onClose: () => void;
  onOpenImage: (url: string, title: string) => void;
  onSearch: () => void;
  onPatch: (patch: ItemPatch) => void;
  onLooksGood: () => void;
  onRetry: () => void;
  onChoose: (match: BulkCandidate) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const [stage, setStage] = useState<"match" | "alternatives" | "inventory">("match");
  const [costMode, setCostMode] = useState<"unknown" | "amount" | "zero">(item.zeroCostBasisConfirmed ? "zero" : item.costBasis != null ? "amount" : "unknown");
  const [cost, setCost] = useState(item.costBasis == null ? "" : String(item.costBasis));
  const [searchedAlternatives, setSearchedAlternatives] = useState<BulkCandidate[]>([]);
  const [alternativesLoading, setAlternativesLoading] = useState(false);
  const [alternativesError, setAlternativesError] = useState("");
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousIdentity = useRef(`${item.id}:${item.selectedCandidate?.providerCardId || ""}`);
  const hydratedIdentity = useRef("");

  useEffect(() => {
    setStage("match");
    setCostMode(item.zeroCostBasisConfirmed ? "zero" : item.costBasis != null ? "amount" : "unknown");
    setCost(item.costBasis == null ? "" : String(item.costBasis));
    setSearchedAlternatives([]);
    setAlternativesError("");
  }, [item.id, item.costBasis, item.zeroCostBasisConfirmed]);

  useEffect(() => {
    if (stage !== "alternatives" || searchedAlternatives.length || alternativesLoading || !item.recognizedName) return;
    const controller = new AbortController();
    setAlternativesLoading(true);
    setAlternativesError("");
    void searchPokemonCardsManually({
      game: item.recognizedCardGame === "one_piece" ? "one_piece" : "pokemon",
      language: item.recognizedLanguage === "ja" ? "ja" : "en",
      name: item.recognizedName,
      query: item.recognizedName,
      page: 1,
      pageSize: 10,
      disableCorrection: true,
    }, controller.signal).then((result) => setSearchedAlternatives(result.matches)).catch((unknownError) => {
      if (!controller.signal.aborted) setAlternativesError(unknownError instanceof Error ? unknownError.message : "Additional provider matches could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setAlternativesLoading(false); });
    return () => controller.abort();
  }, [alternativesLoading, item.recognizedCardGame, item.recognizedLanguage, item.recognizedName, searchedAlternatives.length, stage]);

  useEffect(() => {
    const identity = `${item.id}:${item.selectedCandidate?.providerCardId || ""}`;
    if (identity !== previousIdentity.current) setStage("match");
    previousIdentity.current = identity;
  }, [item.id, item.selectedCandidate?.providerCardId]);

  useEffect(() => {
    const candidate = item.selectedCandidate;
    if (!candidate) return;
    const variants = candidate.pricing?.variants || [];
    const automaticVariant = variants.length === 1 ? variants[0] : undefined;
    const automaticMarket = automaticVariant?.market ?? (variants.length === 0 ? candidate.pricing?.market : undefined);
    const identity = `${item.id}:${candidate.providerCardId}`;
    if (import.meta.env.DEV && hydratedIdentity.current !== identity) console.info("[Bulk Import Review] selected provider record", {
      providerCardId: candidate.providerCardId,
      cardName: candidate.name,
      set: candidate.setName,
      collectorNumber: candidate.collectorNumber || candidate.cardCode,
      pricingVariants: variants.map((variant) => ({ variant: variant.name, market: variant.market ?? null })),
      selectedVariant: item.marketVariant || automaticVariant?.name || null,
      marketPrice: item.baseMarket ?? automaticMarket ?? null,
    });
    if (hydratedIdentity.current === identity) return;
    hydratedIdentity.current = identity;
    if ((!item.marketVariant && automaticVariant) || (item.baseMarket == null && automaticMarket != null)) onPatch({
      marketVariant: item.marketVariant || automaticVariant?.name || null,
      baseMarket: item.baseMarket ?? automaticMarket ?? null,
      adjustedMarket: item.condition === "Near Mint / NM" ? item.adjustedMarket ?? automaticMarket ?? null : item.adjustedMarket ?? null,
      marketSource: item.marketSource || candidate.pricing?.source || (candidate.provider === "pokemontcg" ? "TCGplayer" : candidate.provider),
      marketCurrency: item.marketCurrency || candidate.pricing?.currency || "USD",
      marketCheckedAt: item.marketCheckedAt || candidate.pricing?.updatedAt || new Date().toISOString(),
    });
  }, [item, onPatch]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)) return;
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
      if (event.key.toLowerCase() === "y" && stage === "match" && item.selectedCandidate) setStage("inventory");
      if (event.key.toLowerCase() === "n" && stage === "match") setStage("alternatives");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [item.selectedCandidate, onNext, onPrevious, stage]);

  const candidate = item.selectedCandidate;
  const candidateImage = candidate?.imageLarge || candidate?.imageSmall;
  const pricingVariants = bulkItemPricingVariants(item);
  const providerMarket = candidate ? providerCandidateMarket(candidate, item.marketVariant) ?? item.baseMarket : undefined;
  const identityReady = Boolean(candidate) && (pricingVariants.length <= 1 || Boolean(item.marketVariant));
  const ownershipValid = item.ownershipShares.length > 0 && Math.abs(item.ownershipShares.reduce((sum, share) => sum + share.ownershipPercentage, 0) - 100) < 0.001;
  const pricingReady = Boolean(item.condition) && (item.condition === "Unknown" || bulkItemMarketValue(item) != null);
  const readyToMark = Boolean(candidate) && ownershipValid && pricingReady && !["failed", "waiting", "processing"].includes(item.status);
  const alternatives = prioritizedAlternatives(item, searchedAlternatives);
  const stamped = /stamp/i.test(item.marketVariant || "");
  const priceUnavailableReason = pricingVariants.length > 1 && !item.marketVariant
    ? "Choose the finish to load its provider market price."
    : item.marketVariant && providerMarket == null
      ? "Pricing unavailable — the selected finish has no mapped market value."
      : "Market price unavailable — the provider returned no market value.";

  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/70 sm:items-center sm:p-4">
    <section
      onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={(event) => { const start = touchStart.current; const touch = event.changedTouches[0]; touchStart.current = null; if (!start || !touch) return; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx > 0) onPrevious(); else onNext(); } }}
      className="max-h-[96dvh] w-full max-w-5xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-3xl sm:p-5 dark:bg-slate-900"
    >
      <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 border-b border-slate-100 bg-white/95 p-1 pb-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button type="button" onClick={onPrevious} aria-label="Previous card" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><ChevronLeft size={18} /></button>
        <div className="min-w-0 flex-1"><p className="eyebrow">Reviewing {itemNumber} of {itemCount}</p><h3 className="truncate text-lg font-black">{stage === "alternatives" ? "Other Possible Matches" : stage === "inventory" ? "Inventory Details" : "Review Match"}</h3></div>
        <button type="button" onClick={onNext} aria-label="Next card" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><ChevronRight size={18} /></button>
        <button type="button" onClick={onClose} aria-label="Close review" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
      </header>
      {item.possibleDuplicate ? <p className="mt-3 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900"><CopyCheck size={16} className="mr-1 inline" />Possible Duplicate Photo. The source image hash appeared before; identical card IDs alone are never treated as duplicates.</p> : null}

      {stage === "match" ? <MatchConfirmation
        item={item} candidate={candidate} candidateImage={candidateImage} pricingVariants={pricingVariants}
        providerMarket={providerMarket} identityReady={identityReady} priceUnavailableReason={priceUnavailableReason}
        onOpenImage={onOpenImage} onPatch={onPatch} onCorrect={() => setStage("inventory")}
        onWrong={() => setStage("alternatives")} onSearch={onSearch} onRetry={onRetry}
      /> : null}
      {stage === "alternatives" ? <AlternativeMatches item={item} alternatives={alternatives} loading={alternativesLoading} error={alternativesError} onOpenImage={onOpenImage} onSearch={onSearch} onChoose={onChoose} /> : null}
      {stage === "inventory" ? <InventoryConfirmation
        item={item} workers={workers} candidateImage={candidateImage} pricingVariants={pricingVariants}
        providerMarket={providerMarket} stamped={stamped} costMode={costMode} cost={cost}
        readyToMark={readyToMark} busy={busy} onPatch={onPatch} onCostMode={setCostMode}
        onCost={setCost} onBack={() => setStage("match")} onLooksGood={onLooksGood}
      /> : null}
    </section>
  </div>;
}

function MatchConfirmation({ item, candidate, candidateImage, pricingVariants, providerMarket, identityReady, priceUnavailableReason, onOpenImage, onPatch, onCorrect, onWrong, onSearch, onRetry }: {
  item: BulkImportItem;
  candidate?: BulkCandidate;
  candidateImage?: string;
  pricingVariants: ReturnType<typeof bulkItemPricingVariants>;
  providerMarket?: number;
  identityReady: boolean;
  priceUnavailableReason: string;
  onOpenImage: (url: string, title: string) => void;
  onPatch: (patch: ItemPatch) => void;
  onCorrect: () => void;
  onWrong: () => void;
  onSearch: () => void;
  onRetry: () => void;
}) {
  return <>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-4">
      <BulkSourcePhoto item={item} onOpenImage={onOpenImage} />
      <button type="button" disabled={!candidateImage} onClick={() => candidateImage && onOpenImage(candidateImage, `Official provider card · ${candidate?.name || "Card"}`)} className="rounded-2xl bg-slate-50 p-2 text-left disabled:opacity-60 dark:bg-slate-950">
        <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Official Provider Card</p>
        {candidateImage ? <img src={candidateImage} alt="Provider card" className="h-64 w-full object-contain sm:h-80" /> : <div className="flex h-64 items-center justify-center text-sm text-slate-500 sm:h-80">No exact candidate selected</div>}
      </button>
    </div>
    {candidate ? <section className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1"><h4 className="text-xl font-black">{candidate.name}</h4><p className="font-bold text-slate-600 dark:text-slate-300">{candidate.setName || "Set unavailable"} · #{candidate.collectorNumber || candidate.cardCode || "—"}</p><p className="mt-1 text-xs text-slate-500">{candidate.rarity || "Rarity unavailable"} · {candidate.language === "ja" ? "Japanese" : "English"} · {candidate.provider} · ID {candidate.providerCardId}</p></div>
        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800 dark:bg-violet-950 dark:text-violet-200">AI {confidenceLabel(item.overallConfidence)}</span>
      </div>
      {pricingVariants.length > 1 ? <div className="mt-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">Finish / variant</p><div className="mt-2 flex flex-wrap gap-2">{pricingVariants.map((variant) => <button type="button" key={variant.name} onClick={() => { const market = variant.market ?? null; onPatch({ marketVariant: variant.name, baseMarket: market, adjustedMarket: item.condition === "Near Mint / NM" ? market : item.adjustedMarket ?? null, marketSource: candidate.pricing?.source || item.marketSource || "TCGplayer", marketCheckedAt: candidate.pricing?.updatedAt || new Date().toISOString() }); }} className={`rounded-xl border px-3 py-2 text-left text-xs ${item.marketVariant === variant.name ? "border-violet-600 bg-violet-50 font-black text-violet-800 dark:bg-violet-950" : "border-slate-200 dark:border-slate-700"}`}><span className="block font-black">{bulkVariantLabel(variant.name)}</span><span>{variant.market == null ? "Market —" : formatMoney(variant.market)}</span></button>)}</div></div> : <p className="mt-3 text-sm"><b>Finish:</b> {bulkVariantLabel(item.marketVariant || pricingVariants[0]?.name || "standard")}</p>}
      <div className="mt-4 grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-2">
        <div><p className="text-xs font-black uppercase tracking-wide text-slate-400">{item.marketSource || candidate.pricing?.source || "Provider"} Market</p>{providerMarket == null ? <p className="mt-1 text-sm font-bold text-amber-300">{priceUnavailableReason}</p> : <p className="text-3xl font-black">{formatMoney(providerMarket)}</p>}</div>
        <div className="text-xs text-slate-300"><p><b>Source:</b> {item.marketSource || candidate.pricing?.source || candidate.provider}</p><p><b>Variant:</b> {bulkVariantLabel(item.marketVariant || pricingVariants[0]?.name)}</p><p><b>Last checked:</b> {item.marketCheckedAt || candidate.pricing?.updatedAt ? new Date(item.marketCheckedAt || candidate.pricing?.updatedAt || "").toLocaleString() : "Unavailable"}</p></div>
      </div>
      <p className="mt-4 text-center text-lg font-black">Is this the correct card and printing?</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" disabled={!identityReady} onClick={onCorrect} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-40"><Check size={19} /> Yes, This Is It <kbd className="rounded bg-emerald-800 px-1.5 py-0.5 text-[10px]">Y</kbd></button><button type="button" onClick={onWrong} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-rose-100 px-4 font-black text-rose-800 dark:bg-rose-950 dark:text-rose-100"><X size={19} /> No, Wrong Card <kbd className="rounded bg-rose-200 px-1.5 py-0.5 text-[10px] dark:bg-rose-900">N</kbd></button></div>
      {!identityReady ? <p className="mt-2 text-center text-xs font-bold text-amber-700">Choose the physical finish before confirming this provider record.</p> : null}
    </section> : <section className="mt-4 rounded-2xl bg-amber-50 p-5 text-center dark:bg-amber-950/30"><AlertTriangle className="mx-auto text-amber-600" /><h4 className="mt-2 font-black">Needs Manual Review</h4><p className="text-sm text-slate-600 dark:text-slate-300">The uploaded photo and recognized {item.recognizedName || "card details"} are preserved, but no exact provider record is selected.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={onWrong} className="min-h-12 rounded-xl bg-slate-950 px-4 font-black text-white">View Possible Matches</button><button type="button" onClick={onSearch} className="min-h-12 rounded-xl bg-violet-600 px-4 font-black text-white">Search Manually</button></div>{item.status === "failed" ? <button type="button" onClick={onRetry} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-100 px-4 font-black text-amber-900"><RefreshCw size={17} /> Retry AI Recognition</button> : null}</section>}
  </>;
}

function AlternativeMatches({ item, alternatives, loading, error, onOpenImage, onSearch, onChoose }: { item: BulkImportItem; alternatives: BulkCandidate[]; loading: boolean; error: string; onOpenImage: (url: string, title: string) => void; onSearch: () => void; onChoose: (match: BulkCandidate) => void }) {
  return <>
    <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[10rem_minmax(0,1fr)] dark:bg-slate-950"><BulkSourcePhoto item={item} onOpenImage={onOpenImage} compact /><div className="min-w-0 self-center"><p className="text-xs font-black uppercase tracking-wide text-slate-500">Recognized</p><h4 className="truncate text-lg font-black">{item.recognizedName || "Name unavailable"}</h4><p className="truncate text-sm text-slate-500">{item.recognizedSet || "Set unknown"} · #{item.recognizedCollectorNumber || "—"}</p><p className="mt-2 text-xs text-slate-500">The original uploaded photo remains attached while you compare or search for another match.</p></div></div>
    <div className="mt-4 flex items-end justify-between gap-3"><div><h4 className="text-lg font-black">Other Possible Matches</h4><p className="text-xs text-slate-500">Same-name records are prioritized. Selecting one reuses provider results and does not call AI.</p></div><button type="button" onClick={onSearch} className="shrink-0 text-xs font-black text-violet-700 dark:text-violet-300"><Search size={15} className="inline" /> Search Manually</button></div>
    {loading ? <p className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-violet-700"><LoaderCircle size={15} className="animate-spin" /> Loading up to 10 same-name provider records…</p> : null}
    {error ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Stored alternatives remain available. Additional search failed: {error}</p> : null}
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{alternatives.map((match) => { const market = providerCandidateMarket(match); return <button type="button" key={`${match.provider}:${match.providerCardId}`} onClick={() => onChoose(match)} className="rounded-2xl border border-slate-200 p-2 text-left transition hover:border-violet-500 hover:bg-violet-50 dark:border-slate-700 dark:hover:bg-violet-950/30">{match.imageSmall || match.imageLarge ? <img loading="lazy" src={match.imageSmall || match.imageLarge} alt={match.name} className="mx-auto h-40 w-full object-contain" /> : <div className="flex h-40 items-center justify-center text-xs text-slate-500">No provider image</div>}<b className="mt-2 block truncate text-sm">{match.name}</b><span className="block truncate text-xs text-slate-500">{match.setName || "Set unknown"} · #{match.collectorNumber || match.cardCode || "—"}</span><span className="mt-1 block text-xs font-black">Market {market == null ? "—" : formatMoney(market)}</span><span className="block text-[10px] text-slate-500">{confidenceLabel(match.matchConfidence)} · score {Math.round(match.matchScore || 0)}</span><span className="mt-2 block rounded-lg bg-violet-600 py-2 text-center text-xs font-black text-white">Use This Card</span></button>; })}</div>
    {!alternatives.length ? <p className="mt-4 rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500 dark:bg-slate-950">No additional provider candidates were returned. Use the prefilled manual search.</p> : null}
    <button type="button" onClick={onSearch} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 font-black text-white"><Search size={18} /> Search Manually with Recognized Details</button>
  </>;
}

function BulkSourcePhoto({ item, onOpenImage, compact = false }: { item: BulkImportItem; onOpenImage: (url: string, title: string) => void; compact?: boolean }) {
  const [imageUrl, setImageUrl] = useState(item.sourceImageUrl);
  const [loading, setLoading] = useState(Boolean(item.sourceImageUrl || item.sourceImagePath));
  const [failed, setFailed] = useState(!item.sourceImageUrl && !item.sourceImagePath);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    setImageUrl(item.sourceImageUrl);
    setLoading(Boolean(item.sourceImageUrl || item.sourceImagePath));
    setFailed(!item.sourceImageUrl && !item.sourceImagePath);
    setResolving(false);
    if (!item.sourceImageUrl && item.sourceImagePath) {
      setResolving(true);
      void resolveBulkImportSourceImageUrl(item.sourceImagePath).then((url) => {
        setImageUrl(url);
        setFailed(false);
        setLoading(true);
      }).catch(() => {
        setLoading(false);
        setFailed(true);
      }).finally(() => setResolving(false));
    }
  }, [item.id, item.sourceImagePath, item.sourceImageUrl]);

  async function retry() {
    setResolving(true);
    setLoading(true);
    setFailed(false);
    try {
      const nextUrl = await resolveBulkImportSourceImageUrl(item.sourceImagePath, item.sourceImageUrl);
      setImageUrl(nextUrl);
    } catch {
      setLoading(false);
      setFailed(true);
    } finally {
      setResolving(false);
    }
  }

  const imageHeight = compact ? "h-48 sm:h-52" : "h-64 sm:h-80";
  return <div className={`relative overflow-hidden rounded-2xl bg-slate-950 p-2 ${compact ? "w-full" : ""}`} data-bulk-source-item-id={item.id}>
    <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-white">Our Uploaded Photo</p>
    {loading && !failed ? <div role="status" aria-label="Loading original photo" className={`skeleton-shimmer absolute inset-x-2 top-7 z-10 ${imageHeight} rounded-xl bg-slate-800`} /> : null}
    {failed ? <div className={`flex ${imageHeight} flex-col items-center justify-center rounded-xl bg-slate-900 p-4 text-center text-white`}><ImageIcon size={28} className="text-slate-500" /><p className="mt-2 text-sm font-black">Original photo unavailable</p><button type="button" disabled={resolving} onClick={() => void retry()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-black text-slate-950 disabled:opacity-50"><RefreshCw size={15} className={resolving ? "animate-spin" : ""} /> Retry</button></div> : imageUrl ? <button type="button" disabled={loading} onClick={() => onOpenImage(imageUrl, `View Original Photo · ${item.originalFilename}`)} className="block w-full disabled:cursor-wait"><img key={`${item.id}:${imageUrl}`} src={imageUrl} alt={`Original uploaded photo for ${item.originalFilename}`} onLoad={() => { setLoading(false); setFailed(false); }} onError={() => { setLoading(false); setFailed(true); }} className={`${imageHeight} w-full object-contain`} /><span className="text-xs font-bold text-white">Click to enlarge</span></button> : null}
  </div>;
}

function InventoryConfirmation({ item, workers, candidateImage, pricingVariants, providerMarket, stamped, costMode, cost, readyToMark, busy, onPatch, onCostMode, onCost, onBack, onLooksGood }: {
  item: BulkImportItem;
  workers: Worker[];
  candidateImage?: string;
  pricingVariants: ReturnType<typeof bulkItemPricingVariants>;
  providerMarket?: number;
  stamped: boolean;
  costMode: "unknown" | "amount" | "zero";
  cost: string;
  readyToMark: boolean;
  busy: boolean;
  onPatch: (patch: ItemPatch) => void;
  onCostMode: (mode: "unknown" | "amount" | "zero") => void;
  onCost: (value: string) => void;
  onBack: () => void;
  onLooksGood: () => void;
}) {
  return <>
    <section className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
      {candidateImage ? <img src={candidateImage} alt="Confirmed provider card" className="h-24 w-16 object-contain" /> : null}
      <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wide text-emerald-700">Provider match selected</p><h4 className="truncate text-lg font-black">{item.selectedCandidate?.name}</h4><p className="truncate text-sm text-slate-600 dark:text-slate-300">{item.selectedCandidate?.setName} · #{item.selectedCandidate?.collectorNumber || item.selectedCandidate?.cardCode || "—"} · {bulkVariantLabel(item.marketVariant || pricingVariants[0]?.name)}</p><p className="font-black">Provider base market: {providerMarket == null ? "Unavailable" : formatMoney(providerMarket)}</p></div>
      <button type="button" onClick={onBack} className="rounded-lg bg-white px-3 py-2 text-xs font-black dark:bg-slate-900">Change</button>
    </section>
    <section className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      <h4 className="font-black">Condition</h4><p className="text-xs text-slate-500">Condition is separate from identity. NM starts with provider market; played conditions use your confirmed value.</p>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{conditions.map((condition) => <button type="button" key={condition} onClick={() => onPatch({ condition, adjustedMarket: condition === "Near Mint / NM" ? providerMarket ?? null : null })} className={`min-h-11 rounded-xl px-2 text-xs font-black ${item.condition === condition ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{compactCondition(condition)}</button>)}</div>
      {item.condition && item.condition !== "Unknown" ? <label className="mt-3 block text-xs font-bold">Confirmed inventory market<input type="number" min="0" step="0.01" disabled={item.condition === "Near Mint / NM" && providerMarket != null && !stamped} value={item.condition === "Near Mint / NM" && providerMarket != null && !stamped ? providerMarket : item.adjustedMarket ?? ""} onChange={(event) => onPatch({ adjustedMarket: event.target.value === "" ? null : Number(event.target.value) })} placeholder={providerMarket == null ? "Provider price unavailable — enter value if known" : "Required for played condition"} className="mt-1 w-full rounded-xl border p-3 disabled:opacity-60 dark:bg-slate-950" /></label> : item.condition === "Unknown" ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-950">Condition is explicitly unknown. Provider base market is preserved, but no condition-adjusted inventory value is invented.</p> : null}
    </section>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-black">Quantity<input type="number" min="1" value={item.quantity} onChange={(event) => onPatch({ quantity: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label>
      <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800"><p className="font-black">Cost basis</p><p className="text-xs text-slate-500">Optional when unknown; never converted to $0.</p><div className="mt-2 flex flex-wrap gap-2">{([["unknown", "Unknown"], ["amount", "Enter amount"], ["zero", "Confirm $0"]] as const).map(([value, label]) => <button type="button" key={value} onClick={() => { onCostMode(value); if (value === "unknown") onPatch({ costBasis: null, zeroCostBasisConfirmed: false }); if (value === "zero") onPatch({ costBasis: 0, zeroCostBasisConfirmed: true }); }} className={`rounded-lg px-3 py-2 text-xs font-black ${costMode === value ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{label}</button>)}</div>{costMode === "amount" ? <div className="mt-2 flex gap-2"><input type="number" min="0" step="0.01" value={cost} onChange={(event) => onCost(event.target.value)} placeholder="Historical cost" className="min-w-0 flex-1 rounded-xl border p-3 dark:bg-slate-950" /><button type="button" disabled={cost === "" || Number(cost) < 0} onClick={() => onPatch({ costBasis: Number(cost), zeroCostBasisConfirmed: Number(cost) === 0 })} className="rounded-xl bg-violet-600 px-4 font-black text-white disabled:opacity-40">Save</button></div> : null}</div>
    </div>
    <div className="mt-4"><OwnershipEditor workers={workers} shares={item.ownershipShares} totalCost={item.costBasis || 0} label="Inventory ownership" onChange={(ownershipShares: OwnershipShare[]) => onPatch({ ownershipShares })} /></div>
    {!readyToMark ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Choose a condition, assign exactly 100% ownership, and provide a confirmed market value when the condition requires one.</p> : null}
    <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={onBack} className="min-h-12 rounded-xl bg-slate-100 px-4 font-black dark:bg-slate-800">Back to Match</button><button type="button" disabled={busy || !readyToMark || item.status === "confirmed"} onClick={onLooksGood} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-40"><Check size={18} /> {item.status === "confirmed" ? "Already Imported" : "Save & Next →"}</button></div>
    <p className="mt-2 text-center text-[11px] text-slate-500">Y/N confirm the match. Left/right arrows move between cards. Provider searches and review edits do not rerun AI recognition.</p>
  </>;
}
