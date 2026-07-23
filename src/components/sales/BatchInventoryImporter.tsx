import { ScanLine, Upload, X } from "lucide-react";
import { useState } from "react";
import type { InventoryPurchase, PokemonProductCategory } from "../../types/models";
import { scanPokemonCard, type CardScanSuggestion } from "../../services/sales/cardScanService";

type QueueItem = { id: string; file: File; preview: string; status: "not_scanned" | "analyzing" | "needs_review" | "ready_to_import" | "imported" | "failed"; scan?: CardScanSuggestion; hash?: string; error?: string };
type Props = { onClose: () => void; onImport: (input: Partial<InventoryPurchase>, file: File) => Promise<void> };

export function BatchInventoryImporter({ onClose, onImport }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files).filter((file) => file.type.startsWith("image/")).map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: "not_scanned" as const }));
    setItems((current) => [...current, ...next]);
  }

  async function analyze() {
    setBusy(true);
    for (const item of items.filter((row) => row.status !== "imported")) {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "analyzing" } : row));
      try {
        const result = await scanPokemonCard(item.file, "raw_card");
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "needs_review", scan: result.suggestion, hash: result.hash } : row));
      } catch (error) {
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "failed", error: error instanceof Error ? error.message : "Scan failed" } : row));
      }
    }
    setBusy(false);
  }

  async function importReady() {
    setBusy(true);
    for (const item of items.filter((row) => row.status === "ready_to_import" && row.scan)) {
      try {
        const scan = item.scan!;
        await onImport({
          itemName: scan.cardName || "Details pending", cardName: scan.cardName || undefined, collectorNumber: scan.collectorNumber || undefined,
          cardSet: scan.cardSet || undefined, cardLanguage: scan.language || undefined, cardCondition: scan.condition || undefined,
          stickerPrice: scan.stickerPrice ?? undefined, gradingCompany: scan.gradingCompany || undefined, grade: scan.grade || undefined,
          certificateNumber: scan.certificateNumber || undefined, category: (scan.suggestedType || "raw_card") as PokemonProductCategory,
          isRawCard: (scan.suggestedType || "raw_card") === "raw_card", quantity: 1, quantitySold: 0, totalCost: 0,
          purchaseDate: new Date(`${purchaseDate}T12:00:00`).toISOString(), status: "in_stock", scanConfidence: scan.overallConfidence,
          scanStatus: "imported", imageHash: item.hash, scanResult: scan as unknown as Record<string, unknown>,
        }, item.file);
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "imported" } : row));
      } catch (error) {
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "failed", error: error instanceof Error ? error.message : "Import failed" } : row));
      }
    }
    setBusy(false);
  }

  return <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm"><section className="mx-auto my-4 w-full max-w-5xl space-y-4 rounded-3xl bg-white p-4 dark:bg-slate-900">
    <div className="flex items-center justify-between"><div><p className="eyebrow">Controlled review queue</p><h2 className="text-xl font-black">Batch Add Inventory</h2></div><button onClick={onClose} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></div>
    <div className="flex flex-wrap gap-2"><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-ink px-4 text-sm font-black text-white"><Upload size={17} />Select images<input type="file" multiple accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => event.target.files && addFiles(event.target.files)} /></label><button disabled={!items.length || busy} onClick={() => void analyze()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white disabled:opacity-40"><ScanLine size={17} />Analyze Batch</button><label className="text-xs font-bold">Purchase date<input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} className="ml-2 rounded-lg border p-2 dark:bg-slate-950" /></label></div>
    <p className="text-xs text-slate-500">Analysis runs one image at a time to control cost. Nothing imports until you review and mark it ready.</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className="space-y-2 rounded-2xl border border-slate-200 p-3 dark:border-slate-700"><img src={item.preview} alt="" className="h-40 w-full rounded-xl object-contain" /><div className="flex items-center justify-between"><strong className="capitalize">{item.status.replace(/_/g, " ")}</strong>{item.scan ? <span className="text-xs">{item.scan.overallConfidence} confidence</span> : null}</div>{item.scan ? <div className="space-y-1"><input value={item.scan.cardName || ""} onChange={(event) => setItems((current) => current.map((row) => row.id === item.id && row.scan ? { ...row, scan: { ...row.scan, cardName: event.target.value } } : row))} placeholder="Card name" className="w-full rounded-lg border p-2 dark:bg-slate-950" /><input value={item.scan.collectorNumber || ""} onChange={(event) => setItems((current) => current.map((row) => row.id === item.id && row.scan ? { ...row, scan: { ...row.scan, collectorNumber: event.target.value } } : row))} placeholder="Collector number" className="w-full rounded-lg border p-2 dark:bg-slate-950" /><p className="text-xs">{item.scan.condition || "Condition unknown"} · Sticker {item.scan.stickerPrice == null ? "unknown" : `$${item.scan.stickerPrice}`}</p><button disabled={item.status === "imported"} onClick={() => setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "ready_to_import" } : row))} className="rounded-lg bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800">Approve for import</button></div> : null}{item.error ? <p className="text-xs font-bold text-rose-600">{item.error}</p> : null}</article>)}</div>
    <button disabled={busy || !items.some((item) => item.status === "ready_to_import")} onClick={() => void importReady()} className="btn-primary min-h-12 w-full disabled:opacity-40">Import Approved Items</button>
  </section></div>;
}
