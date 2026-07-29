import {
  ArrowLeft, ArrowRight, Camera, Check, ChevronDown, ChevronUp, Copy, ImagePlus, Link2,
  PackagePlus, RefreshCcw, Save, Search, ShieldAlert, Trash2, Upload, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorState } from "../components/ErrorState";
import { ImageLightbox } from "../components/sales/ImageLightbox";
import { ManualCardSearch } from "../components/sales/ManualCardSearch";
import { OwnershipEditor } from "../components/sales/OwnershipEditor";
import { ConfirmDialog, LoadingOverlay, ProgressSteps, type ProgressStep } from "../components/sales/SalesDashboardPrimitives";
import { listPlannerEventOptions } from "../services/planner/plannerRepository";
import {
  blankTrade, blankTradeItem, completeTrade, getCachedTrades, listTrades, reverseTrade, saveTrade, type TransactionSaveStage
} from "../services/database/tradeRepository";
import { getCachedInventoryPurchases, listInventoryPurchases } from "../services/database/inventoryPurchaseRepository";
import { listOwnershipShares } from "../services/database/ownershipRepository";
import { listWorkers } from "../services/database/workerRepository";
import { saveTransactionImage, type ImageUploadStage } from "../services/images/saleImageService";
import type { Event, InventoryPurchase, OwnershipShare, PokemonProductCategory, TradeItem, TradeTransaction, Worker } from "../types/models";
import { formatMoney } from "../utils/paymentMath";
import { pokemonCategoryLabels } from "../utils/salesControl";
import { allocateBasis, ownershipIsValid, tradeSummary } from "../utils/tradeMath";

const inputClass = "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-ink outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white";
const steps = ["Trade information", "We Gave", "We Received", "Cash adjustment", "Ownership & cost", "Review & Complete"];
const tradeSaveSteps: ProgressStep[] = [
  { id: "transaction", label: "Saving transaction & items" },
  { id: "inventory", label: "Updating outgoing inventory" },
  { id: "ownership", label: "Creating incoming inventory" },
  { id: "finalizing", label: "Saving lineage & final status" }
];
const tradeImageSteps: ProgressStep[] = [
  { id: "preparing", label: "Preparing" },
  { id: "compressing", label: "Compressing" },
  { id: "uploading", label: "Uploading" },
  { id: "saving", label: "Saving reference" }
];
const localTradeDraftKey = "4nerds:transaction-draft:trade";
type LocalTradeDraft = { trade: TradeTransaction; step: number; savedAt: string };
function readLocalTradeDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(localTradeDraftKey) || "null") as LocalTradeDraft | null;
    return value?.trade?.id ? value : undefined;
  } catch {
    return undefined;
  }
}

function localInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function money(value: number, onChange: (value: number) => void) {
  return <input type="number" min="0" step="0.01" value={value || ""} onChange={(event) => onChange(Math.max(0, Number(event.target.value || 0)))} className={inputClass} />;
}
function statusClass(status: TradeTransaction["status"]) {
  return status === "completed" ? "bg-emerald-100 text-emerald-700" : status === "draft" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
}
function itemImage(item: TradeItem) { return item.imageUrl || ""; }

export function TradePage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedId = params.id;
  const [trades, setTrades] = useState<TradeTransaction[]>(getCachedTrades());
  const [inventory, setInventory] = useState<InventoryPurchase[]>(getCachedInventoryPurchases());
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TradeTransaction["status"]>("all");
  const [editor, setEditor] = useState<TradeTransaction>();
  const [detail, setDetail] = useState<TradeTransaction>();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveStage, setSaveStage] = useState<TransactionSaveStage | undefined>(undefined);
  const [saveComplete, setSaveComplete] = useState(false);
  const [recoverableDraft, setRecoverableDraft] = useState<LocalTradeDraft | undefined>(() => readLocalTradeDraft());
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false);

  async function load() {
    setLoading(true); setError("");
    const results = await Promise.allSettled([
      listTrades(), listInventoryPurchases(1000), listPlannerEventOptions(), listWorkers()
    ]);
    const errors: string[] = [];
    const tradeRows = results[0].status === "fulfilled" ? results[0].value : trades;
    const inventoryRows = results[1].status === "fulfilled" ? results[1].value : inventory;
    const eventRows = results[2].status === "fulfilled" ? results[2].value : events;
    const workerRows = results[3].status === "fulfilled" ? results[3].value : workers;
    results.forEach((result, index) => {
      if (result.status === "rejected") errors.push(`${["Trades", "Inventory", "Events", "Workers"][index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });
    let hydrated = inventoryRows;
    try {
      const ownership = await listOwnershipShares(inventoryRows.map((row) => row.id), []);
      hydrated = inventoryRows.map((row) => ({ ...row, ownershipShares: ownership.inventory.get(row.id) || [] }));
    } catch (caught) {
      errors.push(`Ownership: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
    const tradeOnlyRows = tradeRows.filter((row) => row.transactionType === "trade" || row.transactionType === "cash_trade");
    setTrades(tradeOnlyRows); setInventory(hydrated); setEvents(eventRows); setWorkers(workerRows);
    if (requestedId) setDetail(tradeOnlyRows.find((row) => row.id === requestedId));
    if (searchParams.get("new")) {
      const next = blankTrade();
      next.transactionType = searchParams.get("new") === "cash_trade" ? "cash_trade" : "trade";
      next.itemMode = searchParams.get("items") === "single" ? "single" : "multiple";
      setEditor(next); setStep(0);
    }
    if (errors.length) setError(errors.join("\n"));
    setLoading(false);
  }
  useEffect(() => { void load(); }, [requestedId]);
  useEffect(() => {
    if (!loading || trades.length) { setShowLoading(false); return; }
    const timer = window.setTimeout(() => setShowLoading(true), 180);
    return () => window.clearTimeout(timer);
  }, [loading, trades.length]);
  useEffect(() => {
    if (!editor || editor.status !== "draft" || (!editor.items.length && !editor.tradePartner && !editor.notes && !editor.generalImageUrl)) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(localTradeDraftKey, JSON.stringify({ trade: editor, step, savedAt: new Date().toISOString() } satisfies LocalTradeDraft));
      } catch {
        setMessage("This trade is too large for local recovery. Use Save Draft to keep it in Supabase.");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [editor, step]);
  useEffect(() => {
    if (!editor || saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editor, saving]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return trades.filter((trade) => statusFilter === "all" || trade.status === statusFilter).filter((trade) =>
      !term || trade.tradePartner?.toLowerCase().includes(term) || trade.items.some((item) => `${item.itemName} ${item.collectorNumber || ""} ${item.cardSet || ""}`.toLowerCase().includes(term))
    );
  }, [trades, search, statusFilter]);
  const completed = trades.filter((row) => row.status === "completed");
  const month = new Date().toISOString().slice(0, 7);
  const monthTrades = completed.filter((row) => row.tradeDate.startsWith(month));
  const monthTotals = monthTrades.reduce((acc, row) => {
    const summary = tradeSummary(row);
    return { incoming: acc.incoming + summary.incomingAgreed, outgoing: acc.outgoing + summary.outgoingAgreed, gain: acc.gain + summary.estimatedGainLoss, received: acc.received + row.cashReceived, paid: acc.paid + row.cashPaid };
  }, { incoming: 0, outgoing: 0, gain: 0, received: 0, paid: 0 });

  function openNew(source?: TradeTransaction) {
    const next = source ? {
      ...source, id: crypto.randomUUID(), status: "draft" as const, completedAt: undefined, reversedAt: undefined,
      tradeDate: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      items: source.items.map((item) => ({ ...item, id: crypto.randomUUID(), tradeTransactionId: "", inventoryPurchaseId: item.direction === "outgoing" ? item.inventoryPurchaseId : undefined, createdInventoryPurchaseId: undefined }))
    } : blankTrade();
    next.items = next.items.map((item) => ({ ...item, tradeTransactionId: next.id }));
    setEditor(next); setDetail(undefined); setStep(0); setMessage("");
  }
  function openExisting(trade: TradeTransaction) {
    if (trade.status === "draft") { setEditor(structuredClone(trade)); setStep(0); }
    else setDetail(trade);
  }
  async function persistDraft() {
    if (!editor) return;
    setSaving(true); setMessage(""); setSaveStage("transaction");
    try {
      const saved = await saveTrade(editor);
      setEditor(saved); setTrades((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      localStorage.setItem(localTradeDraftKey, JSON.stringify({ trade: saved, step, savedAt: new Date().toISOString() } satisfies LocalTradeDraft));
      setMessage("Draft saved.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Draft could not be saved."); }
    finally { setSaving(false); setSaveStage(undefined); }
  }
  async function finish() {
    if (!editor) return;
    const incoming = editor.items.filter((item) => item.direction === "incoming");
    if (incoming.some((item) => !ownershipIsValid(item))) { setMessage("Assign ownership totaling 100% to every incoming item."); setStep(4); return; }
    if (incoming.some((item) => !item.itemName.trim())) { setMessage("Every incoming item needs a name."); setStep(2); return; }
    setSaving(true); setMessage(""); setSaveComplete(false); setSaveStage("transaction");
    try {
      const result = await completeTrade(editor, inventory, setSaveStage);
      localStorage.removeItem(localTradeDraftKey);
      setRecoverableDraft(undefined);
      setSaveComplete(true);
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      setEditor(undefined); setDetail(result.trade); setTrades((rows) => [result.trade, ...rows.filter((row) => row.id !== result.trade.id)]);
      await load();
      setMessage("Trade completed. Outgoing inventory is Traded Out and incoming inventory is In Stock.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Trade could not be completed."); }
    finally { setSaving(false); setSaveStage(undefined); setSaveComplete(false); }
  }
  async function reverseCurrent() {
    if (!detail || !confirm("Reverse this completed trade? The original history will remain and inventory availability will be adjusted safely.")) return;
    setSaving(true);
    try {
      const saved = await reverseTrade(detail, inventory);
      setDetail(saved); setTrades((rows) => rows.map((row) => row.id === saved.id ? saved : row)); await load();
      setMessage("Trade reversed. The original record and audit history remain.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Trade could not be reversed."); }
    finally { setSaving(false); }
  }

  if (loading && !trades.length) return <div className="page-shell min-w-0 py-10" aria-busy="true">
    {showLoading ? <LoadingOverlay inline label="Preparing trade workspace…" detail="Loading available inventory, transaction history, and ownership options." onRetry={() => void load()} onCancel={() => navigate("/sales", { replace: true })} /> : null}
  </div>;
  if (editor) {
    const saveStageIndex = saveStage === "transaction" || saveStage === "items" ? 0 : saveStage === "inventory" ? 1 : saveStage === "ownership" ? 2 : 3;
    return <>
      {recoverableDraft ? <section className="fixed inset-x-3 top-3 z-[75] mx-auto max-w-2xl rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-xl dark:border-amber-800 dark:bg-amber-950">
        <p className="font-black text-amber-900 dark:text-amber-100">An unfinished trade draft is available</p>
        <p className="text-sm text-amber-700 dark:text-amber-300">Saved locally {new Date(recoverableDraft.savedAt).toLocaleString()}.</p>
        <div className="mt-2 flex gap-2"><button type="button" onClick={() => { setEditor(recoverableDraft.trade); setStep(recoverableDraft.step); setRecoverableDraft(undefined); }} className="btn-primary">Resume Draft</button><button type="button" onClick={() => setDiscardDraftOpen(true)} className="btn-secondary">Discard</button></div>
      </section> : null}
      <TradeEditor trade={editor} onChange={setEditor} inventory={inventory} events={events} workers={workers} step={step} onStep={setStep} saving={saving} message={message} onSave={() => void persistDraft()} onComplete={() => void finish()} onClose={() => setEditor(undefined)} />
      {saveStage ? <div className="fixed inset-x-3 bottom-24 z-[70] mx-auto max-w-2xl"><ProgressSteps steps={tradeSaveSteps} activeStep={saveStageIndex} complete={saveComplete} /></div> : null}
      <ConfirmDialog open={discardDraftOpen} title="Discard recovered trade?" description="The locally recovered trade will be removed. Supabase drafts are not affected." confirmLabel="Discard Draft" onConfirm={() => { localStorage.removeItem(localTradeDraftKey); setRecoverableDraft(undefined); setDiscardDraftOpen(false); }} onCancel={() => setDiscardDraftOpen(false)} />
    </>;
  }
  if (detail) return <TradeDetail trade={detail} trades={trades} inventory={inventory} events={events} workers={workers} saving={saving} message={message} onBack={() => { setDetail(undefined); navigate("/sales/trades"); }} onDuplicate={() => openNew(detail)} onReverse={() => void reverseCurrent()} />;

  return <div className="page-shell min-w-0 overflow-x-hidden">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><Link to="/sales" className="mb-2 inline-flex items-center gap-1 text-sm font-black text-violet-600"><ArrowLeft size={16} /> Sales Control</Link><p className="eyebrow">Inventory exchange</p><h1 className="text-3xl font-black text-ink dark:text-white">Trade Control</h1><p className="mt-1 text-sm text-slate-500">Draft, complete, search, reverse, and trace multi-item trades.</p></div>
      <button onClick={() => openNew()} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-violet-600 px-4 font-black text-white"><PackagePlus size={18} /> New Trade</button>
    </header>
    {error ? <ErrorState message="Some Trade Control data could not be refreshed. Cached sections remain available." details={error} onRetry={() => void load()} /> : null}
    {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p> : null}

    <section className="surface-card p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={(event) => event.currentTarget.parentElement?.classList.toggle("trade-collapsed")}><span><p className="eyebrow">Trade overview</p><h2 className="text-lg font-black">This month</h2></span><ChevronDown size={20} /></button>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[["Trades", monthTrades.length], ["Value Traded In", formatMoney(monthTotals.incoming)], ["Value Traded Out", formatMoney(monthTotals.outgoing)], ["Estimated Gain/Loss", formatMoney(monthTotals.gain)], ["Trade Cash Received", formatMoney(monthTotals.received)], ["Trade Cash Paid", formatMoney(monthTotals.paid)]].map(([label, value]) => <div key={label} className="rounded-xl bg-violet-50 p-3 dark:bg-violet-950/25"><p className="text-xs font-bold text-violet-600">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>)}
      </div>
    </section>

    <section className="surface-card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="eyebrow">Trade history</p><h2 className="text-xl font-black">All transactions</h2></div><div className="flex gap-2 text-xs font-black"><span>{trades.filter((row) => row.status === "draft").length} Drafts</span><span>·</span><span>{completed.length} Completed</span></div></div>
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]"><label className="relative"><Search size={17} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Partner, card, collector number, set…" className={`${inputClass} pl-10`} /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className={inputClass}><option value="all">All statuses</option><option value="draft">Draft</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="reversed">Reversed</option></select></div>
      <div className="space-y-2">{filtered.map((trade) => {
        const summary = tradeSummary(trade);
        return <button key={trade.id} onClick={() => openExisting(trade)} className="w-full rounded-2xl border border-slate-200 p-3 text-left transition hover:border-violet-400 dark:border-slate-800">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-black">{trade.tradePartner || "Unnamed trade partner"}</p><p className="text-xs text-slate-500">{new Date(trade.tradeDate).toLocaleString()} {trade.eventId ? `· ${events.find((row) => row.id === trade.eventId)?.name || "Event"}` : ""}</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-black capitalize ${statusClass(trade.status)}`}>{trade.status === "draft" ? "Continue Draft" : trade.status}</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><span><b>{summary.outgoing.length}</b> given · {formatMoney(summary.outgoingAgreed)}</span><span><b>{summary.incoming.length}</b> received · {formatMoney(summary.incomingAgreed)}</span><span>Cash {formatMoney(trade.cashReceived - trade.cashPaid)}</span><span className={summary.estimatedGainLoss >= 0 ? "text-emerald-600" : "text-rose-600"}>Est. {formatMoney(summary.estimatedGainLoss)}</span></div>
        </button>;
      })}{!filtered.length ? <p className="py-8 text-center text-sm font-bold text-slate-500">{trades.length ? "No matching trades." : "No trades yet."}</p> : null}</div>
    </section>
  </div>;
}

type EditorProps = {
  trade: TradeTransaction; inventory: InventoryPurchase[]; events: Event[]; workers: Worker[]; step: number; saving: boolean; message: string;
  onChange: (trade: TradeTransaction) => void; onStep: (step: number) => void; onSave: () => void; onComplete: () => void; onClose: () => void;
};
function TradeEditor(props: EditorProps) {
  const { trade, onChange } = props;
  const summary = tradeSummary(trade);
  const [inventorySearch, setInventorySearch] = useState("");
  const [editingItem, setEditingItem] = useState<TradeItem>();
  const [manualSearch, setManualSearch] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string }>();
  const [uploadStage, setUploadStage] = useState<ImageUploadStage | undefined>(undefined);
  const fileToDataUrl = async (file: File) => {
    await saveTrade(trade);
    const result = await saveTransactionImage(file, trade.id, editingItem?.id, editingItem ? "item" : "transaction", setUploadStage);
    window.setTimeout(() => setUploadStage(undefined), 650);
    return result.imageUrl;
  };
  const uploadStageIndex = uploadStage === "preparing" ? 0 : uploadStage === "compressing" ? 1 : uploadStage === "uploading" ? 2 : 3;
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<TradeTransaction>) => onChange({ ...trade, ...patch });
  const updateItem = (item: TradeItem) => update({ items: trade.items.map((row) => row.id === item.id ? item : row) });
  const removeItem = (id: string) => update({ items: trade.items.filter((row) => row.id !== id) });
  const available = props.inventory.filter((row) => row.status === "in_stock" && row.quantity > row.quantitySold).filter((row) => {
    const term = inventorySearch.toLowerCase();
    return !term || `${row.itemName} ${row.cardName || ""} ${row.collectorNumber || ""} ${row.cardSet || ""} ${row.certificateNumber || ""} ${row.pokemonTcgCardId || ""} ${row.id}`.toLowerCase().includes(term);
  });
  const addOutgoing = (purchase: InventoryPurchase) => {
    if (trade.items.some((item) => item.direction === "outgoing" && item.inventoryPurchaseId === purchase.id)) return;
    const item = { ...blankTradeItem(trade.id, "outgoing"), inventoryPurchaseId: purchase.id, itemName: purchase.itemName, itemType: purchase.category, quantity: Math.max(1, purchase.quantity - purchase.quantitySold), marketValue: Number(purchase.marketValue || 0), agreedTradeValue: Number(purchase.marketValue || 0), historicalCostBasis: Number(purchase.totalCost || 0), allocatedCostBasis: Number(purchase.totalCost || 0), imageUrl: purchase.frontImageUrl || purchase.imageUrl, imagePath: purchase.frontImagePath || purchase.imagePath, backImageUrl: purchase.backImageUrl, backImagePath: purchase.backImagePath, collectorNumber: purchase.collectorNumber, cardSet: purchase.cardSet, pokemonTcgCardId: purchase.pokemonTcgCardId, cardCondition: purchase.cardCondition, gradingCompany: purchase.gradingCompany, grade: purchase.grade, certificateNumber: purchase.certificateNumber, ownershipShares: purchase.ownershipShares || [] };
    update({ items: [...trade.items, item] });
  };
  const addIncoming = () => { const item = blankTradeItem(trade.id, "incoming"); update({ items: [...trade.items, item] }); setEditingItem(item); };
  const suggestOwnership = (method: "market" | "agreed" | "cost" | "equal") => {
    const contributions = new Map<string, number>();
    const outgoing = summary.outgoing;
    outgoing.forEach((item) => item.ownershipShares.forEach((share) => {
      const base = method === "market" ? item.marketValue : method === "agreed" ? item.agreedTradeValue : method === "cost" ? item.historicalCostBasis : 1;
      contributions.set(share.workerId, (contributions.get(share.workerId) || 0) + base * share.ownershipPercentage / 100);
    }));
    if (method === "equal") props.workers.slice(0, 2).forEach((worker) => contributions.set(worker.id, 1));
    const total = Array.from(contributions.values()).reduce((sum, value) => sum + value, 0);
    if (!total) return;
    const shares: OwnershipShare[] = Array.from(contributions.entries()).map(([workerId, value]) => ({ workerId, ownershipPercentage: Math.round(value / total * 10000) / 100 }));
    const rounding = 100 - shares.reduce((sum, share) => sum + share.ownershipPercentage, 0);
    if (shares.length) shares[shares.length - 1].ownershipPercentage += rounding;
    if (confirm(`Apply suggested ownership (${shares.map((share) => `${props.workers.find((worker) => worker.id === share.workerId)?.name}: ${share.ownershipPercentage}%`).join(", ")}) to all incoming items?`)) update({ items: trade.items.map((item) => item.direction === "incoming" ? { ...item, ownershipShares: shares } : item) });
  };
  const allocate = (method: "market" | "agreed" | "equal") => {
    const basis = summary.outgoingCostBasis + trade.cashPaid - trade.cashReceived;
    const allocated = allocateBasis(Math.max(0, basis), summary.incoming, method);
    update({ items: trade.items.map((item) => allocated.find((row) => row.id === item.id) || item) });
  };
  async function pasteImage() {
    try {
      const clipboardItems = await navigator.clipboard?.read?.();
      const clipboardItem = clipboardItems?.find((item) => item.types.some((type) => type.startsWith("image/")));
      const imageType = clipboardItem?.types.find((type) => type.startsWith("image/"));
      if (!clipboardItem || !imageType || !editingItem) return;
      const blob = await clipboardItem.getType(imageType);
      const file = new File([blob], "pasted-trade-image.png", { type: imageType });
      const url = await fileToDataUrl(file); const item = { ...editingItem, imageUrl: url }; setEditingItem(item); updateItem(item);
    } catch {
      setUploadStage(undefined);
    }
  }
  async function chooseImage(file?: File) {
    if (!file || !editingItem) return;
    try {
      const url = await fileToDataUrl(file);
      const item = { ...editingItem, imageUrl: url }; setEditingItem(item); updateItem(item);
    } catch {
      setUploadStage(undefined);
    }
  }

  return <div className="page-shell min-w-0 overflow-x-hidden pb-28">
    <header className="flex items-start justify-between gap-3"><div><p className="eyebrow">Trade editor · Draft</p><h1 className="text-2xl font-black">{steps[props.step]}</h1></div><button onClick={props.onClose} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={19} /></button></header>
    <div className="flex gap-1 overflow-x-auto pb-1">{steps.map((label, index) => <button key={label} onClick={() => props.onStep(index)} title={label} className={`h-2 min-w-10 flex-1 rounded-full ${index <= props.step ? "bg-violet-600" : "bg-slate-200 dark:bg-slate-800"}`} />)}</div>
    {props.message ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">{props.message}</p> : null}
    {uploadStage ? <ProgressSteps steps={tradeImageSteps} activeStep={uploadStageIndex} complete={uploadStage === "complete"} title="Uploading image" /> : null}

    {props.step === 0 ? <section className="surface-card grid gap-3 p-4 sm:grid-cols-2">
      <label><span className="mb-1 block text-xs font-black">Trade date and time</span><input type="datetime-local" value={localInput(trade.tradeDate)} onChange={(event) => update({ tradeDate: new Date(event.target.value).toISOString() })} className={inputClass} /></label>
      <label><span className="mb-1 block text-xs font-black">Event (optional)</span><select value={trade.eventId || ""} onChange={(event) => update({ eventId: event.target.value || undefined })} className={inputClass}><option value="">No event</option>{props.events.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label><span className="mb-1 block text-xs font-black">Trade partner/customer</span><input value={trade.tradePartner || ""} onChange={(event) => update({ tradePartner: event.target.value })} className={inputClass} /></label>
      <label><span className="mb-1 block text-xs font-black">Entered by worker</span><select value={trade.enteredByWorkerId || ""} onChange={(event) => update({ enteredByWorkerId: event.target.value || undefined })} className={inputClass}><option value="">Unassigned</option>{props.workers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="sm:col-span-2"><span className="mb-1 block text-xs font-black">Notes</span><textarea value={trade.notes || ""} onChange={(event) => update({ notes: event.target.value })} rows={3} className={inputClass} /></label>
      <label className="sm:col-span-2"><span className="mb-1 block text-xs font-black">General trade photo / proof screenshot</span><input type="file" accept="image/*" capture="environment" onChange={async (event) => { const file = event.target.files?.[0]; if (file) update({ generalImageUrl: await fileToDataUrl(file) }); }} className={inputClass} />{trade.generalImageUrl ? <button onClick={() => setPreview({ url: trade.generalImageUrl!, title: "Trade photo" })} className="mt-2 text-sm font-black text-violet-600">View large image</button> : null}</label>
    </section> : null}

    {props.step === 1 ? <section className="space-y-3"><div className="surface-card p-4"><h2 className="text-lg font-black text-orange-600">WE GAVE</h2><p className="text-sm text-slate-500">Only available inventory can be selected.</p><label className="relative mt-3 block"><Search size={17} className="absolute left-3 top-3.5 text-slate-400" /><input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Name, API ID, collector #, set, certificate, inventory ID…" className={`${inputClass} pl-10`} /></label><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{available.map((purchase) => <button key={purchase.id} onClick={() => addOutgoing(purchase)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-2 text-left dark:border-slate-800">{purchase.imageUrl ? <img src={purchase.imageUrl} className="size-14 rounded-lg object-contain" /> : <div className="size-14 rounded-lg bg-slate-100" />}<span className="min-w-0 flex-1"><b className="block truncate">{purchase.itemName}</b><small className="block truncate text-slate-500">#{purchase.collectorNumber || "—"} · {purchase.cardSet || "No set"} · {formatMoney(purchase.marketValue || 0)} market · {formatMoney(purchase.totalCost)} basis</small></span><PackagePlus size={18} className="text-violet-600" /></button>)}</div></div><ItemList title="Selected outgoing items" items={summary.outgoing} workers={props.workers} onEdit={setEditingItem} onRemove={removeItem} /></section> : null}

    {props.step === 2 ? <section className="space-y-3"><div className="surface-card flex items-center justify-between gap-3 p-4"><div><h2 className="text-lg font-black text-emerald-600">WE RECEIVED</h2><p className="text-sm text-slate-500">Each item creates a separate inventory record.</p></div><button onClick={addIncoming} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-black text-white"><PackagePlus size={17} /> Add Item</button></div><ItemList title="Incoming items" items={summary.incoming} workers={props.workers} onEdit={setEditingItem} onRemove={removeItem} /></section> : null}

    {props.step === 3 ? <section className="surface-card grid gap-4 p-4 sm:grid-cols-2"><label><span className="mb-1 block font-black">Cash paid</span>{money(trade.cashPaid, (cashPaid) => update({ cashPaid }))}<small className="text-slate-500">Trade cash paid; never a duplicate purchase.</small></label><label><span className="mb-1 block font-black">Cash received</span>{money(trade.cashReceived, (cashReceived) => update({ cashReceived }))}<small className="text-slate-500">Trade cash received; not normal sales revenue.</small></label></section> : null}

    {props.step === 4 ? <section className="space-y-3"><div className="surface-card p-4"><h2 className="font-black">Ownership allocation assistant</h2><p className="text-sm text-slate-500">Suggestions require confirmation and can be changed per item.</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{(["agreed", "market", "cost", "equal"] as const).map((method) => <button key={method} onClick={() => suggestOwnership(method)} className="rounded-xl bg-violet-100 px-2 py-2 text-xs font-black capitalize text-violet-700">{method === "cost" ? "Cost basis" : method}</button>)}</div></div><div className="surface-card p-4"><h2 className="font-black">Cost-basis allocation</h2><p className="text-sm text-slate-500">Trade basis: {formatMoney(Math.max(0, summary.outgoingCostBasis + trade.cashPaid - trade.cashReceived))}. The final item receives any rounding remainder.</p><div className="mt-3 grid grid-cols-3 gap-2">{(["market", "agreed", "equal"] as const).map((method) => <button key={method} onClick={() => allocate(method)} className="rounded-xl bg-cyan-100 px-2 py-2 text-xs font-black capitalize text-cyan-700">{method}</button>)}</div></div><ItemList title="Confirm each incoming item" items={summary.incoming} workers={props.workers} onEdit={setEditingItem} onRemove={removeItem} /></section> : null}

    {props.step === 5 ? <section className="space-y-3"><TradeSummaryCard trade={trade} /><div className="surface-card p-4"><h2 className="font-black">Completion checks</h2><ul className="mt-2 space-y-2 text-sm font-bold"><li className={summary.outgoing.length ? "text-emerald-600" : "text-rose-600"}>{summary.outgoing.length ? "✓" : "○"} At least one outgoing item</li><li className={summary.incoming.length ? "text-emerald-600" : "text-rose-600"}>{summary.incoming.length ? "✓" : "○"} At least one incoming item</li><li className={summary.incoming.every(ownershipIsValid) ? "text-emerald-600" : "text-rose-600"}>{summary.incoming.every(ownershipIsValid) ? "✓" : "○"} Incoming ownership totals 100%</li><li className="text-violet-600">Trade values will not be counted as normal sales revenue.</li></ul></div></section> : null}

    {editingItem ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 sm:items-center sm:p-4"><section className="max-h-[94dvh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 dark:bg-slate-900 sm:rounded-3xl">
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">{editingItem.direction === "incoming" ? "Incoming item" : "Outgoing item"}</h2><button onClick={() => setEditingItem(undefined)} className="rounded-full bg-slate-100 p-2"><X size={18} /></button></div>
      <div className="grid gap-3 sm:grid-cols-2"><label><span className="text-xs font-black">Item name</span><input value={editingItem.itemName} onChange={(event) => { const item = { ...editingItem, itemName: event.target.value }; setEditingItem(item); updateItem(item); }} className={inputClass} /></label><label><span className="text-xs font-black">Item type</span><select value={editingItem.itemType} onChange={(event) => { const item = { ...editingItem, itemType: event.target.value as PokemonProductCategory }; setEditingItem(item); updateItem(item); }} className={inputClass}>{Object.entries(pokemonCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="text-xs font-black">Quantity</span><input type="number" min="1" value={editingItem.quantity} onChange={(event) => { const item = { ...editingItem, quantity: Math.max(1, Number(event.target.value)) }; setEditingItem(item); updateItem(item); }} className={inputClass} /></label><label><span className="text-xs font-black">Collector number</span><input value={editingItem.collectorNumber || ""} onChange={(event) => { const item = { ...editingItem, collectorNumber: event.target.value }; setEditingItem(item); updateItem(item); }} className={inputClass} /></label><label><span className="text-xs font-black">Set</span><input value={editingItem.cardSet || ""} onChange={(event) => { const item = { ...editingItem, cardSet: event.target.value }; setEditingItem(item); updateItem(item); }} className={inputClass} /></label><label><span className="text-xs font-black">Market value</span>{money(editingItem.marketValue, (marketValue) => { const item = { ...editingItem, marketValue }; setEditingItem(item); updateItem(item); })}</label><label><span className="text-xs font-black">Agreed trade value</span>{money(editingItem.agreedTradeValue, (agreedTradeValue) => { const item = { ...editingItem, agreedTradeValue }; setEditingItem(item); updateItem(item); })}</label><label><span className="text-xs font-black">{editingItem.direction === "outgoing" ? "Historical cost basis" : "Allocated cost basis"}</span>{money(editingItem.direction === "outgoing" ? editingItem.historicalCostBasis : editingItem.allocatedCostBasis, (value) => { const item = editingItem.direction === "outgoing" ? { ...editingItem, historicalCostBasis: value } : { ...editingItem, allocatedCostBasis: value }; setEditingItem(item); updateItem(item); })}</label><label><span className="text-xs font-black">Grading company</span><input value={editingItem.gradingCompany || ""} onChange={(event) => { const item = { ...editingItem, gradingCompany: event.target.value }; setEditingItem(item); updateItem(item); }} className={inputClass} /></label><label><span className="text-xs font-black">Grade / certificate</span><input value={[editingItem.grade, editingItem.certificateNumber].filter(Boolean).join(" / ")} onChange={(event) => { const [grade, certificateNumber] = event.target.value.split("/").map((value) => value.trim()); const item = { ...editingItem, grade, certificateNumber }; setEditingItem(item); updateItem(item); }} className={inputClass} /></label></div>
      {editingItem.direction === "incoming" ? <><div className="grid grid-cols-3 gap-2"><button onClick={() => fileRef.current?.click()} className="rounded-xl bg-slate-100 p-2 text-xs font-black"><Upload size={16} className="mx-auto mb-1" /> Upload / Take Photo</button><button onClick={() => void pasteImage()} className="rounded-xl bg-slate-100 p-2 text-xs font-black"><ImagePlus size={16} className="mx-auto mb-1" /> Paste Image</button><button onClick={() => setManualSearch(true)} className="rounded-xl bg-slate-100 p-2 text-xs font-black"><Search size={16} className="mx-auto mb-1" /> Search Card</button></div><input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => void chooseImage(event.target.files?.[0])} />{editingItem.imageUrl ? <button onClick={() => setPreview({ url: editingItem.imageUrl!, title: editingItem.itemName })}><img src={editingItem.imageUrl} className="h-40 w-full rounded-xl object-contain" /></button> : null}</> : null}
      {editingItem.direction === "incoming" ? <label><span className="text-xs font-black">Trade percentage</span><input type="number" min="0" max="100" step=".1" value={editingItem.tradePercentage ?? 100} onChange={(event) => { const tradePercentage = Number(event.target.value || 0); const item = { ...editingItem, tradePercentage, agreedTradeValue: Math.round(editingItem.marketValue * tradePercentage) / 100 }; setEditingItem(item); updateItem(item); }} className={inputClass} /><small className="block text-slate-500">Accepted value: {formatMoney(editingItem.marketValue * (editingItem.tradePercentage ?? 100) / 100)}</small></label> : null}
      <OwnershipEditor workers={props.workers} shares={editingItem.ownershipShares} totalCost={editingItem.direction === "incoming" ? editingItem.allocatedCostBasis : editingItem.historicalCostBasis} label={`${editingItem.direction === "incoming" ? "Incoming" : "Outgoing"} item ownership`} onChange={(ownershipShares) => { const item = { ...editingItem, ownershipShares }; setEditingItem(item); updateItem(item); }} />
      <label><span className="text-xs font-black">Notes</span><textarea value={editingItem.notes || ""} onChange={(event) => { const item = { ...editingItem, notes: event.target.value }; setEditingItem(item); updateItem(item); }} className={inputClass} /></label>
      <button onClick={() => setEditingItem(undefined)} className="btn-primary w-full"><Check size={17} /> Done</button>
    </section></div> : null}
    {manualSearch && editingItem ? <ManualCardSearch open category={editingItem.itemType} initialName={editingItem.itemName} initialCollectorNumber={editingItem.collectorNumber} initialSet={editingItem.cardSet} onClose={() => setManualSearch(false)} onApply={(suggestion) => { const item = { ...editingItem, itemName: suggestion.cardName || editingItem.itemName, collectorNumber: suggestion.collectorNumber || undefined, cardSet: suggestion.cardSet || undefined, cardCondition: suggestion.condition || undefined, gradingCompany: suggestion.gradingCompany || undefined, grade: suggestion.grade || undefined, certificateNumber: suggestion.certificateNumber || undefined }; setEditingItem(item); updateItem(item); setManualSearch(false); }} /> : null}
    {preview ? <ImageLightbox imageUrl={preview.url} title={preview.title} onClose={() => setPreview(undefined)} /> : null}

    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:left-64"><div className="mx-auto flex max-w-5xl items-center gap-2"><button onClick={() => props.onStep(Math.max(0, props.step - 1))} disabled={props.step === 0} className="inline-flex min-h-12 items-center gap-1 rounded-xl bg-slate-100 px-3 font-black disabled:opacity-40 dark:bg-slate-800"><ArrowLeft size={17} /> Back</button><div className="min-w-0 flex-1 text-center text-xs font-black"><span className="block truncate">Given {formatMoney(summary.outgoingAgreed + trade.cashPaid)} · Received {formatMoney(summary.incomingAgreed + trade.cashReceived)}</span><span className={summary.agreedDifference >= 0 ? "text-emerald-600" : "text-rose-600"}>Difference {formatMoney(summary.agreedDifference)}</span></div><button onClick={props.onSave} disabled={props.saving} className="inline-flex min-h-12 items-center gap-1 rounded-xl bg-amber-100 px-3 font-black text-amber-800"><Save size={17} /><span className="hidden sm:inline">Save Draft</span></button>{props.step < 5 ? <button onClick={() => props.onStep(props.step + 1)} className="inline-flex min-h-12 items-center gap-1 rounded-xl bg-violet-600 px-3 font-black text-white">Next <ArrowRight size={17} /></button> : <button onClick={props.onComplete} disabled={props.saving} className="inline-flex min-h-12 items-center gap-1 rounded-xl bg-emerald-600 px-3 font-black text-white"><Check size={17} /> Complete</button>}</div></div>
  </div>;
}

function ItemList({ title, items, workers, onEdit, onRemove }: { title: string; items: TradeItem[]; workers: Worker[]; onEdit: (item: TradeItem) => void; onRemove: (id: string) => void }) {
  return <section className="surface-card p-4"><h3 className="mb-3 font-black">{title}</h3><div className="space-y-2">{items.map((item) => <article key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2 dark:border-slate-800">{itemImage(item) ? <img src={itemImage(item)} className="size-14 rounded-lg object-contain" /> : <div className="size-14 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1"><b className="truncate">{item.itemName || "Unnamed item"}</b><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${item.direction === "incoming" ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>{item.direction === "incoming" ? "INCOMING" : "OUTGOING"}</span></div><p className="text-xs text-slate-500">{formatMoney(item.agreedTradeValue)} agreed · {item.ownershipShares.map((share) => `${workers.find((worker) => worker.id === share.workerId)?.name || "Owner"} ${share.ownershipPercentage}%`).join(", ") || "Unassigned"}</p></div><button onClick={() => onEdit(item)} className="rounded-lg bg-violet-100 px-2 py-2 text-xs font-black text-violet-700">Edit</button><button onClick={() => onRemove(item.id)} aria-label="Remove item" className="rounded-lg bg-rose-50 p-2 text-rose-600"><Trash2 size={16} /></button></article>)}{!items.length ? <p className="py-4 text-center text-sm font-bold text-slate-500">No items yet.</p> : null}</div></section>;
}

function TradeSummaryCard({ trade }: { trade: TradeTransaction }) {
  const row = tradeSummary(trade);
  return <section className="surface-card p-4"><p className="eyebrow">Live trade summary</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-orange-50 p-3 dark:bg-orange-950/20"><h3 className="font-black text-orange-700">WE GAVE</h3><p className="text-sm">Market: <b>{formatMoney(row.outgoingMarket)}</b></p><p className="text-sm">Agreed: <b>{formatMoney(row.outgoingAgreed)}</b></p><p className="text-sm">Original basis: <b>{formatMoney(row.outgoingCostBasis)}</b></p><p className="text-sm">Cash paid: <b>{formatMoney(row.cashPaid)}</b></p></div><div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/20"><h3 className="font-black text-emerald-700">WE RECEIVED</h3><p className="text-sm">Market: <b>{formatMoney(row.incomingMarket)}</b></p><p className="text-sm">Agreed: <b>{formatMoney(row.incomingAgreed)}</b></p><p className="text-sm">Allocated basis: <b>{formatMoney(row.incomingCostBasis)}</b></p><p className="text-sm">Cash received: <b>{formatMoney(row.cashReceived)}</b></p></div></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">{[["Agreed difference", row.agreedDifference], ["Market difference", row.marketDifference], ["Cash difference", row.cashDifference], ["Estimated gain/loss", row.estimatedGainLoss], ["Inventory value change", row.netInventoryValueChange]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><small className="block text-slate-500">{label}</small><b className={Number(value) >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatMoney(Number(value))}</b></div>)}</div></section>;
}

function TradeDetail({ trade, trades, inventory, events, workers, saving, message, onBack, onDuplicate, onReverse }: { trade: TradeTransaction; trades: TradeTransaction[]; inventory: InventoryPurchase[]; events: Event[]; workers: Worker[]; saving: boolean; message: string; onBack: () => void; onDuplicate: () => void; onReverse: () => void }) {
  const [chainOpen, setChainOpen] = useState(false);
  const summary = tradeSummary(trade);
  const chainIds = new Set<string>();
  const frontier = trade.items.flatMap((item) => [item.inventoryPurchaseId, item.createdInventoryPurchaseId]).filter(Boolean) as string[];
  let changed = true;
  while (changed) {
    changed = false;
    trades.forEach((row) => {
      if (chainIds.has(row.id)) return;
      const ids = row.items.flatMap((item) => [item.inventoryPurchaseId, item.createdInventoryPurchaseId]).filter(Boolean) as string[];
      if (ids.some((value) => frontier.includes(value))) { chainIds.add(row.id); ids.forEach((value) => { if (!frontier.includes(value)) frontier.push(value); }); changed = true; }
    });
  }
  const chain = trades.filter((row) => chainIds.has(row.id)).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  function exportTrade() {
    const rows = [["Direction", "Item", "Collector Number", "Market Value", "Agreed Value", "Cost Basis", "Ownership"], ...trade.items.map((item) => [item.direction, item.itemName, item.collectorNumber || "", item.marketValue, item.agreedTradeValue, item.direction === "outgoing" ? item.historicalCostBasis : item.allocatedCostBasis, item.ownershipShares.map((share) => `${workers.find((row) => row.id === share.workerId)?.name || share.workerId} ${share.ownershipPercentage}%`).join("; ")])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const link = document.createElement("a"); link.href = url; link.download = `trade-${trade.tradeDate.slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="page-shell min-w-0 overflow-x-hidden"><header><button onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-sm font-black text-violet-600"><ArrowLeft size={16} /> Trade History</button><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Trade detail</p><h1 className="text-2xl font-black">{trade.tradePartner || "Unnamed trade partner"}</h1><p className="text-sm text-slate-500">{new Date(trade.tradeDate).toLocaleString()} · {events.find((row) => row.id === trade.eventId)?.name || "No event"} · Entered by {workers.find((row) => row.id === trade.enteredByWorkerId)?.name || "Unassigned"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(trade.status)}`}>{trade.status}</span></div></header>{message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p> : null}<TradeSummaryCard trade={trade} /><div className="grid gap-3 lg:grid-cols-2"><ItemList title="We Gave" items={summary.outgoing} workers={workers} onEdit={() => undefined} onRemove={() => undefined} /><ItemList title="We Received" items={summary.incoming} workers={workers} onEdit={() => undefined} onRemove={() => undefined} /></div>{trade.generalImageUrl ? <section className="surface-card p-4"><h2 className="font-black">Images & notes</h2><img src={trade.generalImageUrl} className="mt-2 max-h-72 w-full rounded-xl object-contain" /><p className="mt-3 whitespace-pre-wrap text-sm">{trade.notes || "No notes."}</p></section> : trade.notes ? <section className="surface-card p-4"><h2 className="font-black">Notes</h2><p className="mt-2 whitespace-pre-wrap text-sm">{trade.notes}</p></section> : null}<section className="surface-card p-4"><button onClick={() => setChainOpen(!chainOpen)} className="flex w-full items-center justify-between font-black"><span className="inline-flex items-center gap-2"><Link2 size={18} /> View Trade Chain</span>{chainOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>{chainOpen ? <div className="mt-3 space-y-2">{chain.map((row, index) => <div key={row.id} className="rounded-xl bg-violet-50 p-3 text-sm dark:bg-violet-950/20"><b>{index ? "→ " : ""}{row.items.filter((item) => item.direction === "outgoing").map((item) => item.itemName).join(" + ")} → {row.items.filter((item) => item.direction === "incoming").map((item) => item.itemName).join(" + ")}</b><p className="text-xs text-slate-500">{new Date(row.tradeDate).toLocaleDateString()} · values preserved at transaction time</p></div>)}{!chain.length ? <p className="text-sm text-slate-500">No connected trades yet.</p> : null}</div> : null}</section><section className="grid grid-cols-2 gap-2 sm:grid-cols-4"><button onClick={onDuplicate} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-100 font-black text-violet-700"><Copy size={17} /> Duplicate</button><button onClick={exportTrade} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 font-black"><Upload size={17} /> Export</button><button onClick={() => setChainOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-100 font-black text-cyan-700"><Link2 size={17} /> Chain</button>{trade.status === "completed" ? <button onClick={onReverse} disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-100 font-black text-rose-700"><RefreshCcw size={17} /> Reverse Trade</button> : null}</section></div>;
}
