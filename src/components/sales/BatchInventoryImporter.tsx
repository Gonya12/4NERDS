import { LoaderCircle, ScanLine, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Event, InventoryPurchase, OwnershipShare, PokemonProductCategory, PurchaseSource, Worker } from "../../types/models";
import type { CardMatch, CardScanStage, CardScanSuggestion } from "../../services/sales/cardScanService";
import { OwnershipEditor } from "./OwnershipEditor";
import { TcgplayerPricingPanel } from "./TcgplayerPricingPanel";

type QueueStatus = "not_scanned" | "analyzing" | "needs_review" | "ready_to_import" | "imported" | "failed";
type QueueItem = {
  id: string;
  file: File;
  preview: string;
  status: QueueStatus;
  stage?: CardScanStage;
  scan?: CardScanSuggestion;
  hash?: string;
  actualCost: string;
  error?: string;
};
type Props = {
  events: Event[];
  workers: Worker[];
  onClose: () => void;
  onImport: (input: Partial<InventoryPurchase>, file: File) => Promise<void>;
};

function manualSuggestion(): CardScanSuggestion {
  return {
    suggestedType: "raw_card",
    cardName: null,
    collectorNumber: null,
    cardSet: null,
    language: null,
    condition: null,
    stickerPrice: null,
    gradingCompany: null,
    grade: null,
    certificateNumber: null,
    labelInformation: null,
    barcodeText: null,
    overallConfidence: "low",
    fieldConfidence: {},
    warnings: ["Automatic analysis failed. Enter the visible information manually before approving this item."],
  };
}

function desktopConcurrency() {
  // OCR stays sequential on every device. This is below the two-item desktop
  // ceiling and avoids one scan timing out while it waits behind another.
  return 1;
}

export function BatchInventoryImporter({ events, workers, onClose, onImport }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseSource, setPurchaseSource] = useState<PurchaseSource | "">("");
  const [eventId, setEventId] = useState("");
  const [purchasedByWorkerId, setPurchasedByWorkerId] = useState("");
  const [buyPercentage, setBuyPercentage] = useState("70");
  const [notes, setNotes] = useState("");
  const [ownershipShares, setOwnershipShares] = useState<OwnershipShare[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<QueueItem[]>([]);
  const mountedRef = useRef(true);
  itemsRef.current = items;
  const ownershipValid = !ownershipShares.length
    || Math.abs(ownershipShares.reduce((sum, share) => sum + share.ownershipPercentage, 0) - 100) < 0.001;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      queueMicrotask(() => {
        if (!mountedRef.current) {
          for (const item of itemsRef.current) URL.revokeObjectURL(item.preview);
          void import("../../services/sales/cardScanService").then(({ cancelCardScan }) => cancelCardScan());
        }
      });
    };
  }, []);

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file): QueueItem => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        status: "not_scanned",
        actualCost: "",
      }));
    setItems((current) => [...current, ...next]);
  }

  function removeItem(id: string) {
    setItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  function patchItem(id: string, patch: Partial<QueueItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function patchScan(id: string, patch: Partial<CardScanSuggestion>) {
    setItems((current) => current.map((item) => item.id === id && item.scan
      ? { ...item, scan: { ...item.scan, ...patch } }
      : item));
  }

  async function analyze() {
    const queue = items.filter((item) => item.status !== "imported");
    if (!queue.length) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let cursor = 0;
    setCompletedCount(0);
    setBusy(true);
    const { scanPokemonCard } = await import("../../services/sales/cardScanService");
    async function queueWorker() {
      while (cursor < queue.length && !controller.signal.aborted) {
        const item = queue[cursor++];
        patchItem(item.id, { status: "analyzing", error: undefined, stage: "Preparing image" });
        try {
          const result = await scanPokemonCard(item.file, "raw_card", undefined, false, {
            signal: controller.signal,
            onStage: (stage) => patchItem(item.id, { stage }),
          });
          let nextFile = item.file;
          let nextPreview = item.preview;
          if ("correctedFile" in result && result.correctedFile && result.cardDetected) {
            nextFile = result.correctedFile;
            nextPreview = URL.createObjectURL(nextFile);
            URL.revokeObjectURL(item.preview);
          }
          patchItem(item.id, {
            file: nextFile,
            preview: nextPreview,
            status: "needs_review",
            scan: result.suggestion,
            hash: result.hash,
            stage: undefined,
          });
        } catch (error) {
          if (controller.signal.aborted) break;
          patchItem(item.id, {
            status: "needs_review",
            scan: manualSuggestion(),
            stage: undefined,
            error: error instanceof Error ? error.message : "Local OCR could not read this image.",
          });
        } finally {
          setCompletedCount((count) => count + 1);
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(desktopConcurrency(), queue.length) }, () => queueWorker()));
    } finally {
      setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  async function cancelAnalysis() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const { cancelCardScan } = await import("../../services/sales/cardScanService");
    await cancelCardScan();
    setItems((current) => current.map((item) => item.status === "analyzing"
      ? { ...item, status: "not_scanned", stage: undefined, error: "Cancelled before review." }
      : item));
    setBusy(false);
  }

  async function chooseMatch(item: QueueItem, match: CardMatch) {
    if (!item.scan) return;
    patchItem(item.id, { error: undefined });
    try {
      const { confirmPokemonCardMatch } = await import("../../services/sales/cardScanService");
      const confirmed = await confirmPokemonCardMatch(item.scan, match);
      patchItem(item.id, { scan: confirmed, status: "needs_review" });
    } catch (error) {
      patchItem(item.id, { error: error instanceof Error ? error.message : "Could not confirm this card." });
    }
  }

  async function importReady() {
    if (!ownershipValid) return;
    setBusy(true);
    for (const item of items.filter((row) => row.status === "ready_to_import" && row.scan)) {
      try {
        const scan = item.scan!;
        const selectedPrice = scan.tcgplayerPricing?.variants.find((variant) => variant.variant === scan.tcgplayerPricing?.selectedVariant);
        const rawCard = (scan.suggestedType || "raw_card") === "raw_card";
        await onImport({
          itemName: scan.cardName || "Details pending",
          cardName: scan.cardName || undefined,
          collectorNumber: scan.collectorNumber || undefined,
          cardSet: scan.cardSet || undefined,
          cardLanguage: scan.language || undefined,
          cardCondition: scan.condition || undefined,
          stickerPrice: scan.stickerPrice ?? undefined,
          gradingCompany: scan.gradingCompany || undefined,
          grade: scan.grade || undefined,
          certificateNumber: scan.certificateNumber || undefined,
          category: (scan.suggestedType || "raw_card") as PokemonProductCategory,
          isRawCard: rawCard,
          quantity: 1,
          quantitySold: 0,
          totalCost: Number(item.actualCost || 0),
          marketValue: rawCard ? selectedPrice?.market : undefined,
          marketPriceSource: rawCard && selectedPrice?.market != null ? "TCGplayer" : undefined,
          marketPriceVariant: rawCard ? scan.tcgplayerPricing?.selectedVariant : undefined,
          marketPriceUpdatedAt: rawCard ? scan.tcgplayerPricing?.updatedAt : undefined,
          marketPriceCheckedAt: rawCard ? scan.tcgplayerPricing?.checkedAt : undefined,
          purchaseDate: new Date(`${purchaseDate}T12:00:00`).toISOString(),
          status: "in_stock",
          scanConfidence: scan.overallConfidence,
          scanStatus: "imported",
          imageHash: item.hash,
          scanResult: scan as unknown as Record<string, unknown>,
          purchaseSource: purchaseSource || undefined,
          eventId: eventId || undefined,
          purchasedByWorkerId: purchasedByWorkerId || undefined,
          buyPercentage: buyPercentage === "" ? undefined : Number(buyPercentage),
          notes: notes || undefined,
          ownershipShares,
        }, item.file);
        patchItem(item.id, { status: "imported" });
      } catch (error) {
        patchItem(item.id, { status: "failed", error: error instanceof Error ? error.message : "Import failed" });
      }
    }
    setBusy(false);
  }

  const pendingCount = items.filter((item) => item.status !== "imported").length;

  return <div
    onPaste={(event) => {
      const files = Array.from(event.clipboardData.items)
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (files.length) addFiles(files);
    }}
    className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm"
  >
    <section
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
      className="mx-auto my-4 w-full max-w-5xl space-y-4 rounded-3xl bg-white p-4 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between">
        <div><p className="eyebrow">Controlled review queue</p><h2 className="text-xl font-black">Batch Add Inventory</h2></div>
        <button onClick={onClose} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-ink px-4 text-sm font-black text-white">
          <Upload size={17} />Select images
          <input type="file" multiple accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />
        </label>
        <button disabled={!items.length || busy} onClick={() => void analyze()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white disabled:opacity-40"><ScanLine size={17} />Analyze Batch</button>
        {busy ? <button onClick={() => void cancelAnalysis()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-black text-white"><X size={17} />Cancel</button> : null}
      </div>
      <div className="grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-3 dark:bg-slate-950">
        <label className="text-xs font-bold">Purchase date<input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
        <label className="text-xs font-bold">Purchase source<select value={purchaseSource} onChange={(event) => setPurchaseSource(event.target.value as PurchaseSource | "")} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900"><option value="">Not set</option>{["card_show", "online", "local", "trade", "personal_inventory", "other"].map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</select></label>
        <label className="text-xs font-bold">Event<select value={eventId} onChange={(event) => setEventId(event.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900"><option value="">No event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
        <label className="text-xs font-bold">Purchased by<select value={purchasedByWorkerId} onChange={(event) => setPurchasedByWorkerId(event.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900"><option value="">Not set</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
        <label className="text-xs font-bold">Raw-card buy %<input type="number" min="0" value={buyPercentage} onChange={(event) => setBuyPercentage(event.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
        <label className="text-xs font-bold">Shared notes<input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
      </div>
      <OwnershipEditor workers={workers} shares={ownershipShares} totalCost={0} paidByWorkerId={purchasedByWorkerId} label="Shared ownership defaults" onChange={setOwnershipShares} />
      <p className="text-xs text-slate-500">
        {busy ? `Completed ${completedCount} of ${pendingCount}. Memory-safe sequential OCR queue.` : "Every image remains a separate draft with its own card, condition, finish, and actual cost."}
        {" "}Nothing imports until that row is reviewed and approved.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => <article key={item.id} className="space-y-2 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="relative">
            <img src={item.preview} alt="" className="h-40 w-full rounded-xl object-contain" />
            {item.status !== "imported" && !busy ? <button onClick={() => removeItem(item.id)} className="absolute right-1 top-1 rounded-full bg-black/70 p-1.5 text-white" aria-label="Remove image"><X size={14} /></button> : null}
          </div>
          <div className="flex items-center justify-between">
            <strong className="capitalize">{item.status.replace(/_/g, " ")}</strong>
            {item.scan ? <span className="text-xs">{item.scan.overallConfidence} confidence</span> : null}
          </div>
          {item.stage ? <p className="text-xs font-bold text-violet-700"><LoaderCircle className="mr-1 inline animate-spin" size={13} />{item.stage}</p> : null}
          {item.scan ? <div className="space-y-2">
            {item.scan.possibleMatches?.map((match) => <div key={match.id} className="flex gap-2 rounded-lg bg-violet-50 p-2 text-xs dark:bg-violet-950/30">
              {match.imageUrl ? <img src={match.imageUrl} alt="" className="h-20 w-14 object-contain" /> : null}
              <div><b>{match.cardName} · {match.collectorNumber}</b><p>{match.setName} · {match.matchScore}%</p><button onClick={() => void chooseMatch(item, match)} className="mt-1 rounded bg-violet-600 px-2 py-1 font-black text-white">Use This Card</button></div>
            </div>)}
            <input value={item.scan.cardName || ""} onChange={(event) => patchScan(item.id, { cardName: event.target.value })} placeholder="Confirmed/manual card name" className="w-full rounded-lg border p-2 dark:bg-slate-950" />
            <input value={item.scan.collectorNumber || ""} onChange={(event) => patchScan(item.id, { collectorNumber: event.target.value })} placeholder="Collector number" className="w-full rounded-lg border p-2 dark:bg-slate-950" />
            <input value={item.scan.cardSet || ""} onChange={(event) => patchScan(item.id, { cardSet: event.target.value })} placeholder="Set" className="w-full rounded-lg border p-2 dark:bg-slate-950" />
            <div className="grid grid-cols-2 gap-1">
              <select value={item.scan.condition || ""} onChange={(event) => patchScan(item.id, { condition: event.target.value as CardScanSuggestion["condition"] || null })} className="rounded-lg border p-2 text-xs dark:bg-slate-950"><option value="">Condition unknown</option>{["Mint", "Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged"].map((value) => <option key={value}>{value}</option>)}</select>
              <input type="number" min="0" step="0.01" value={item.scan.stickerPrice ?? ""} onChange={(event) => patchScan(item.id, { stickerPrice: event.target.value ? Number(event.target.value) : null })} placeholder="Sticker price" className="rounded-lg border p-2 text-xs dark:bg-slate-950" />
            </div>
            <input type="number" min="0" step="0.01" value={item.actualCost} onChange={(event) => patchItem(item.id, { actualCost: event.target.value })} placeholder="Actual bought price for this card" className="w-full rounded-lg border p-2 dark:bg-slate-950" />
            <TcgplayerPricingPanel suggestion={item.scan} isSlab={item.scan.suggestedType === "graded_card"} onChange={(scan) => patchItem(item.id, { scan })} />
            <button disabled={item.status === "imported" || Boolean(item.scan.possibleMatches?.length && !item.scan.cardName)} onClick={() => patchItem(item.id, { status: "ready_to_import" })} className="rounded-lg bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800 disabled:opacity-40">Approve draft for import</button>
          </div> : null}
          {item.error ? <p className="text-xs font-bold text-rose-600">{item.error}</p> : null}
        </article>)}
      </div>
      <button disabled={busy || !ownershipValid || !items.some((item) => item.status === "ready_to_import")} onClick={() => void importReady()} className="btn-primary min-h-12 w-full disabled:opacity-40">Import Approved Items</button>
    </section>
  </div>;
}
