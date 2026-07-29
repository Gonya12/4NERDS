import { ArrowLeft, ArrowRight, Check, Copy, PackagePlus, Save, ScanLine, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ImageAttachmentField } from "../components/sales/ImageAttachmentField";
import { CardScanPanel } from "../components/sales/CardScanPanel";
import { ManualCardSearch } from "../components/sales/ManualCardSearch";
import { IncomingBatchPricing } from "../components/sales/IncomingBatchPricing";
import { TransactionItemPricing } from "../components/sales/TransactionItemPricing";
import { OwnershipEditor } from "../components/sales/OwnershipEditor";
import { ConfirmDialog, LoadingOverlay, ProgressSteps, ResponsiveModal, Toast, type ProgressStep } from "../components/sales/SalesDashboardPrimitives";
import { listInventoryPurchases } from "../services/database/inventoryPurchaseRepository";
import { listOwnershipShares } from "../services/database/ownershipRepository";
import {
  completeFinancialTransaction, blankTrade, blankTradeItem, saveFinancialTransactionDraft, saveTrade,
  type TransactionSaveStage
} from "../services/database/tradeRepository";
import { listWorkers } from "../services/database/workerRepository";
import { listPlannerEventOptions } from "../services/planner/plannerRepository";
import { saveTransactionImage, type ImageUploadStage } from "../services/images/saleImageService";
import type { BusinessExpenseCategory, CardCondition, Event, FinancialTransactionType, InventoryPurchase, OwnershipShare, PokemonProductCategory, PurchaseSource, SalePaymentMethod, TradeItem, TradeTransaction, TransactionImageAttachment, TransactionImageType, Worker } from "../types/models";
import { formatMoney } from "../utils/paymentMath";
import { applyCardSuggestionToItem, pricingFromInventory } from "../utils/cardPricing";
import { expenseCategoryLabels, pokemonCategoryLabels, purchaseSourceLabels } from "../utils/salesControl";
import { allocateTransactionTotal, transactionReview, type AllocationMethod } from "../utils/transactionMath";
import { ownershipIsValid } from "../utils/tradeMath";

const input = "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-base outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950";
const moneyInput = (value: number | undefined, onChange: (value: number) => void) => <input type="number" min="0" step=".01" value={value || ""} onChange={(event) => onChange(Number(event.target.value || 0))} className={input} />;
const saveSteps: ProgressStep[] = [
  { id: "transaction", label: "Saving transaction" },
  { id: "items", label: "Saving items & photos" },
  { id: "inventory", label: "Updating inventory & ownership" },
  { id: "finalizing", label: "Finalizing records" }
];
type LocalTransactionDraft = { transaction: TradeTransaction; step: number; savedAt: string };
function readLocalTransactionDraft(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null") as LocalTransactionDraft | null;
    return parsed?.transaction?.id ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function UnifiedTransactionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requestedType = (params.get("type") || "sale") as FinancialTransactionType;
  const requestedMode = params.get("items") === "multiple" ? "multiple" : "single";
  const draftKey = `4nerds:transaction-draft:${requestedType}`;
  const savedLocalDraft = useMemo(() => readLocalTransactionDraft(draftKey), [draftKey]);
  const initial = useMemo(() => ({ ...blankTrade(), transactionType: requestedType, itemMode: requestedMode as TradeTransaction["itemMode"], pricingMode: "individual" as const, paymentMethod: "cash" as SalePaymentMethod, purchaseSource: (params.get("source") || undefined) as PurchaseSource | undefined, expenseCategory: (params.get("category") || undefined) as BusinessExpenseCategory | undefined }), [requestedType, requestedMode]);
  const [transaction, setTransaction] = useState<TradeTransaction>(initial);
  const [inventory, setInventory] = useState<InventoryPurchase[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TradeItem>();
  const [manualSearch, setManualSearch] = useState(false);
  const [scanFile, setScanFile] = useState<File>();
  const [message, setMessage] = useState("");
  const [draftSaveError, setDraftSaveError] = useState("");
  const [imageUploadError, setImageUploadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [showPreparing, setShowPreparing] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draftAvailable, setDraftAvailable] = useState(Boolean(savedLocalDraft));
  const [confirmMode, setConfirmMode] = useState<"discard" | "exit" | undefined>(undefined);
  const [saveStage, setSaveStage] = useState<TransactionSaveStage | undefined>(undefined);
  const [saveComplete, setSaveComplete] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "warning" | "info" } | undefined>(undefined);
  const [allocation, setAllocation] = useState<AllocationMethod>("market");
  const [busyImageFields, setBusyImageFields] = useState<Set<string>>(() => new Set());
  const review = transactionReview(transaction);
  const typeLabel = transaction.transactionType === "sale" ? "Sold" : transaction.transactionType === "purchase" ? "Inventory Purchase" : "Business Cost";
  const workflowTitle = transaction.itemMode === "multiple"
    ? transaction.transactionType === "sale" ? "Multi-Item Sale" : transaction.transactionType === "purchase" ? "Inventory Lot Purchase" : "Multi-Cost Transaction"
    : typeLabel;
  const hasUnsavedDraft = Boolean(transaction.items.length || transaction.tradePartner || transaction.notes || transaction.generalImageUrl || transaction.eventId);
  const saveStageIndex = saveStage === "transaction" ? 0 : saveStage === "items" ? 1 : saveStage === "inventory" || saveStage === "ownership" ? 2 : 3;
  const transactionImages = transaction.images || [];
  const generalImages = transactionImages.filter((image) => image.imageType === "general");
  const proofImages = transactionImages.filter((image) => image.imageType === "proof" || image.imageType === "receipt");
  const sharedImage = generalImages[0];
  const imageUploading = busyImageFields.size > 0;
  const onImageBusyChange = useCallback((fieldId: string, active: boolean) => {
    setBusyImageFields((current) => {
      const next = new Set(current);
      if (active) next.add(fieldId);
      else next.delete(fieldId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) console.info("[transaction-flow] editor mounted", { type: requestedType, mode: requestedMode });
  }, [requestedMode, requestedType]);

  async function uploadImage(file: File, imageType: TransactionImageType, onProgress: (stage: ImageUploadStage) => void, itemId?: string) {
    setDraftSaveError("");
    setImageUploadError("");
    let persisted: TradeTransaction;
    try {
      persisted = itemId
        ? await saveTrade(transaction, { syncImages: false })
        : await saveFinancialTransactionDraft(transaction);
      if (persisted.id !== transaction.id) setTransaction(persisted);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The transaction draft could not be saved.";
      setDraftSaveError(detail);
      throw new Error("Image upload is waiting for the transaction draft to save. Retry after the transaction error is resolved.");
    }
    try {
      const result = await saveTransactionImage(file, persisted.id, itemId, imageType, onProgress);
      return {
        id: result.id,
        transactionId: persisted.id,
        transactionItemId: itemId,
        imageType,
        imageUrl: result.imageUrl,
        imagePath: result.imagePath,
        sortOrder: 0
      } satisfies TransactionImageAttachment;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The image could not be uploaded.";
      setImageUploadError(detail);
      throw error;
    }
  }

  async function changeTransactionImages(types: TransactionImageType[], next: TransactionImageAttachment[]) {
    const images = [...(transaction.images || []).filter((image) => !types.includes(image.imageType)), ...next];
    const general = images.find((image) => image.imageType === "general");
    const proof = images.find((image) => image.imageType === "proof" || image.imageType === "receipt");
    const updated = {
      ...transaction,
      images,
      generalImageUrl: general?.imageUrl || (transaction.transactionType === "expense" ? proof?.imageUrl : undefined),
      generalImagePath: general?.imagePath || (transaction.transactionType === "expense" ? proof?.imagePath : undefined),
      proofImageUrl: proof?.imageUrl,
      proofImagePath: proof?.imagePath
    };
    setTransaction(updated);
    try {
      await saveFinancialTransactionDraft(updated);
      setDraftSaveError("");
    } catch (error) {
      setDraftSaveError(error instanceof Error ? error.message : "The transaction draft could not be updated.");
    }
  }

  async function changeItemImages(item: TradeItem, types: TransactionImageType[], next: TransactionImageAttachment[]) {
    const images = [...(item.images || []).filter((image) => !types.includes(image.imageType)), ...next];
    const front = images.find((image) => image.imageType !== "back");
    const back = images.find((image) => image.imageType === "back");
    const updated = {
      ...item,
      images,
      imageUrl: front?.imageUrl,
      imagePath: front?.imagePath,
      backImageUrl: back?.imageUrl,
      backImagePath: back?.imagePath
    };
    setEditing(updated);
    const nextTransaction = { ...transaction, items: transaction.items.map((row) => row.id === item.id ? updated : row) };
    setTransaction(nextTransaction);
    try {
      await saveTrade(nextTransaction);
      setDraftSaveError("");
    } catch (error) {
      setDraftSaveError(error instanceof Error ? error.message : "The transaction draft could not be updated.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    setPreparing(true);
    setShowPreparing(false);
    const indicatorTimer = window.setTimeout(() => {
      if (!cancelled) setShowPreparing(true);
    }, 180);
    void Promise.allSettled([listInventoryPurchases(1000), listPlannerEventOptions(), listWorkers()]).then(async ([inventoryResult, eventResult, workerResult]) => {
      const errors: string[] = [];
      if (inventoryResult.status === "fulfilled") {
        try {
          const ownership = await listOwnershipShares(inventoryResult.value.map((row) => row.id), []);
          if (!cancelled) setInventory(inventoryResult.value.map((row) => ({ ...row, ownershipShares: ownership.inventory.get(row.id) || [] })));
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "Ownership options could not be loaded.");
          if (!cancelled) setInventory(inventoryResult.value);
        }
      } else errors.push("Available inventory could not be loaded.");
      if (eventResult.status === "fulfilled" && !cancelled) setEvents(eventResult.value);
      else if (eventResult.status === "rejected") errors.push("Event options could not be loaded.");
      if (workerResult.status === "fulfilled" && !cancelled) setWorkers(workerResult.value);
      else if (workerResult.status === "rejected") errors.push("Ownership options could not be loaded.");
      if (!cancelled && errors.length) setMessage(errors.join(" "));
    }).finally(() => {
      if (!cancelled) {
        setPreparing(false);
        setShowPreparing(false);
      }
    });
    return () => {
      cancelled = true;
      window.clearTimeout(indicatorTimer);
    };
  }, [loadAttempt]);
  useEffect(() => {
    if (draftAvailable || !hasUnsavedDraft || transaction.status !== "draft") return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ transaction, step, savedAt: new Date().toISOString() } satisfies LocalTransactionDraft));
      } catch {
        setToast({ message: "This draft is too large for local recovery, but you can still save it to Supabase.", tone: "warning" });
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draftAvailable, draftKey, hasUnsavedDraft, step, transaction]);
  useEffect(() => {
    if (!hasUnsavedDraft || busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, hasUnsavedDraft]);

  const available = inventory.filter((row) => row.status === "in_stock").filter((row) => !search || `${row.itemName} ${row.collectorNumber || ""} ${row.cardSet || ""} ${row.id}`.toLowerCase().includes(search.toLowerCase()));
  const updateItem = (item: TradeItem) => setTransaction((row) => ({ ...row, items: row.items.map((value) => value.id === item.id ? item : value) }));
  const addSaleItem = (purchase: InventoryPurchase) => {
    if (transaction.items.some((item) => item.inventoryPurchaseId === purchase.id)) { setMessage("That inventory item is already selected."); return; }
    const item: TradeItem = {
      ...blankTradeItem(transaction.id, "outgoing"), inventoryPurchaseId: purchase.id, itemName: purchase.itemName,
      itemType: purchase.category, quantity: Math.max(1, purchase.quantity - purchase.quantitySold),
      marketValue: Number(purchase.marketValue || 0), historicalCostBasis: purchase.totalCost,
      soldPrice: Number(purchase.marketValue || 0), imageUrl: purchase.frontImageUrl || purchase.imageUrl,
      imagePath: purchase.frontImagePath || purchase.imagePath, collectorNumber: purchase.collectorNumber,
      cardSet: purchase.cardSet, cardSetId: purchase.cardSetId, cardSetCode: purchase.cardSetCode,
      cardRarity: purchase.cardRarity, cardLanguage: purchase.cardLanguage, pokemonTcgCardId: purchase.pokemonTcgCardId,
      officialCardImageUrl: purchase.officialCardImageUrl, tcgplayerUrl: purchase.tcgplayerUrl,
      marketPriceSource: purchase.marketPriceSource, marketPriceVariant: purchase.marketPriceVariant,
      marketPriceUpdatedAt: purchase.marketPriceUpdatedAt, marketPriceCheckedAt: purchase.marketPriceCheckedAt,
      tcgplayerPricing: pricingFromInventory(purchase), targetBuyPercentage: purchase.buyPercentage,
      targetBuyPrice: purchase.targetBuyPrice, cardSelectionSource: "inventory",
      cardCondition: purchase.cardCondition, gradingCompany: purchase.gradingCompany, grade: purchase.grade,
      certificateNumber: purchase.certificateNumber, ownershipShares: purchase.ownershipShares || []
    };
    setTransaction((row) => ({ ...row, items: row.itemMode === "single" ? [item] : [...row.items, item] }));
  };
  const addIncoming = () => {
    const item = { ...blankTradeItem(transaction.id, transaction.transactionType === "expense" ? "expense" : "incoming"), ownershipShares: [] };
    setTransaction((row) => ({ ...row, items: row.itemMode === "single" ? [item] : [...row.items, item] })); setEditing(item);
  };
  const addManualCard = () => {
    const direction = transaction.transactionType === "sale" ? "outgoing" : transaction.transactionType === "expense" ? "expense" : "incoming";
    const item = { ...blankTradeItem(transaction.id, direction), ownershipShares: [] };
    setTransaction((row) => ({ ...row, items: row.itemMode === "single" ? [item] : [...row.items, item] }));
    setEditing(item);
    setManualSearch(true);
  };
  const addScannedCard = (file: File) => {
    const direction = transaction.transactionType === "sale" ? "outgoing" : "incoming";
    const item = { ...blankTradeItem(transaction.id, direction), ownershipShares: [] };
    setTransaction((row) => ({ ...row, items: row.itemMode === "single" ? [item] : [...row.items, item] }));
    setEditing(item);
    setScanFile(file);
  };
  const allocate = () => {
    const field = transaction.transactionType === "sale" ? "soldPrice" : "boughtPrice";
    setTransaction((row) => ({ ...row, items: allocateTransactionTotal(row.items, Number(row.bundleTotal || 0), allocation, field) }));
  };
  async function complete() {
    setMessage("");
    const relevant = transaction.transactionType === "expense" ? transaction.items : transaction.items.filter((item) => item.itemName.trim());
    if (!relevant.length) { setMessage("Add at least one item or expense description."); return; }
    if (transaction.transactionType !== "expense" && relevant.some((item) => !ownershipIsValid(item))) { setMessage("Every item must have ownership totaling 100%."); return; }
    if (transaction.pricingMode === "bundle_total" && Math.abs(review.bundleDifference) > .009) { setMessage("Allocate the complete bundle total before saving."); return; }
    setBusy(true);
    setSaveComplete(false);
    setSaveStage("transaction");
    try {
      await completeFinancialTransaction(transaction, inventory, setSaveStage);
      localStorage.removeItem(draftKey);
      setSaveComplete(true);
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      navigate("/sales", { replace: true });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Transaction could not be completed."); }
    finally { setBusy(false); setSaveStage(undefined); setSaveComplete(false); }
  }
  async function saveDraft() {
    setBusy(true); setSaveStage("transaction"); setDraftSaveError("");
    try {
      await saveTrade(transaction);
      localStorage.setItem(draftKey, JSON.stringify({ transaction, step, savedAt: new Date().toISOString() } satisfies LocalTransactionDraft));
      setToast({ message: "Draft saved. You can safely return to it later.", tone: "success" });
    } catch (error) { setDraftSaveError(error instanceof Error ? error.message : "Draft could not be saved."); }
    finally { setBusy(false); setSaveStage(undefined); }
  }
  function requestExit() {
    if (imageUploading) {
      setToast({ message: "Wait for the active image upload to finish or cancel it before leaving.", tone: "warning" });
      return;
    }
    if (hasUnsavedDraft) setConfirmMode("exit");
    else navigate("/sales");
  }
  function resolveConfirmation() {
    if (confirmMode === "discard") {
      localStorage.removeItem(draftKey);
      setDraftAvailable(false);
      setToast({ message: "Recovered draft discarded.", tone: "info" });
    } else if (confirmMode === "exit") {
      navigate("/sales");
    }
    setConfirmMode(undefined);
  }

  if (preparing) return <div className="page-shell min-w-0 py-10" aria-busy="true">
    {showPreparing ? <LoadingOverlay
      inline
      label={`Preparing ${typeLabel.toLowerCase()} form…`}
      detail={transaction.transactionType === "sale" ? "Loading available inventory and ownership options." : "Loading transaction and ownership options."}
      onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
      onCancel={() => navigate("/sales", { replace: true })}
    /> : null}
  </div>;

  return <div className="page-shell min-w-0 overflow-x-hidden pb-28">
    <header className="flex items-start justify-between gap-3"><div><Link to="/sales" onClick={(event) => { if (hasUnsavedDraft) { event.preventDefault(); setConfirmMode("exit"); } }} className="inline-flex items-center gap-1 text-sm font-black text-violet-600"><ArrowLeft size={16} /> Sales Control</Link><p className="eyebrow mt-2">Unified transaction · {transaction.itemMode === "multiple" ? "Multiple Items / Lot" : "Single Item"}</p><h1 className="text-2xl font-black">{workflowTitle}</h1></div><button type="button" onClick={requestExit} aria-label="Close transaction" className="rounded-full bg-slate-100 p-2"><X size={18} /></button></header>
    {draftAvailable && savedLocalDraft ? <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="font-black text-amber-900 dark:text-amber-100">An unfinished {typeLabel.toLowerCase()} draft is available</p>
      <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">Saved locally {new Date(savedLocalDraft.savedAt).toLocaleString()}.</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setTransaction(savedLocalDraft.transaction); setStep(savedLocalDraft.step); setDraftAvailable(false); setToast({ message: "Draft restored.", tone: "success" }); }} className="btn-primary">Resume Draft</button><button type="button" onClick={() => setConfirmMode("discard")} className="btn-secondary">Discard Draft</button></div>
    </section> : null}
    <div className="grid grid-cols-3 gap-1">{["Shared Info", "Items", "Review"].map((label, index) => <button key={label} disabled={imageUploading} onClick={() => setStep(index)} className={`min-h-11 rounded-xl text-xs font-black disabled:opacity-50 ${step === index ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{index + 1}. {label}</button>)}</div>
    {message ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">{message}</p> : null}
    {draftSaveError ? <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800"><span className="block text-xs uppercase tracking-wide">Transaction draft error</span>{draftSaveError}</p> : null}
    {imageUploadError ? <p role="alert" className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm font-bold text-orange-800"><span className="block text-xs uppercase tracking-wide">Image upload error</span>{imageUploadError}</p> : null}

    {step === 0 ? <section className="surface-card grid gap-3 p-4 sm:grid-cols-2">
      <label><span className="text-xs font-black">Date and time</span><input type="datetime-local" value={new Date(new Date(transaction.tradeDate).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(event) => setTransaction({ ...transaction, tradeDate: new Date(event.target.value).toISOString() })} className={input} /></label>
      <label><span className="text-xs font-black">Event</span><select value={transaction.eventId || ""} onChange={(event) => setTransaction({ ...transaction, eventId: event.target.value || undefined })} className={input}><option value="">No event</option>{events.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label><span className="text-xs font-black">Customer / seller / vendor</span><input value={transaction.tradePartner || ""} onChange={(event) => setTransaction({ ...transaction, tradePartner: event.target.value })} className={input} /></label>
      {transaction.transactionType === "sale" ? <label><span className="text-xs font-black">Payment method</span><select value={transaction.paymentMethod || "cash"} onChange={(event) => setTransaction({ ...transaction, paymentMethod: event.target.value as SalePaymentMethod })} className={input}>{["cash","zelle","venmo","cash_app","paypal","card","other"].map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</select></label> : null}
      {transaction.transactionType === "purchase" ? <label><span className="text-xs font-black">Purchase source</span><select value={transaction.purchaseSource || "other"} onChange={(event) => setTransaction({ ...transaction, purchaseSource: event.target.value as PurchaseSource })} className={input}>{Object.entries(purchaseSourceLabels).filter(([value]) => value !== "trade").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
      {transaction.transactionType === "expense" ? <label><span className="text-xs font-black">Expense category</span><select value={transaction.expenseCategory || "other"} onChange={(event) => setTransaction({ ...transaction, expenseCategory: event.target.value as BusinessExpenseCategory })} className={input}>{Object.entries(expenseCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
      <label><span className="text-xs font-black">{transaction.transactionType === "sale" ? "Entered by" : "Who paid"}</span><select value={(transaction.transactionType === "sale" ? transaction.enteredByWorkerId : transaction.paidByWorkerId) || ""} onChange={(event) => setTransaction({ ...transaction, ...(transaction.transactionType === "sale" ? { enteredByWorkerId: event.target.value || undefined } : { paidByWorkerId: event.target.value || undefined }) })} className={input}><option value="">Unassigned</option>{workers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <ImageAttachmentField
        label="Transaction photos"
        description="Add a group photo for the entire transaction. It can be reused by individual items without uploading it again."
        attachments={generalImages}
        imageType="general"
        transactionId={transaction.id}
        multiple
        maxImages={5}
        onUpload={(file, imageType, onProgress) => uploadImage(file, imageType, onProgress)}
        onChange={(images) => changeTransactionImages(["general"], images)}
        onBusyChange={onImageBusyChange}
      />
      <ImageAttachmentField
        label={transaction.transactionType === "expense" ? "Receipt or table-fee proof" : "Receipt, payment, or transaction proof"}
        description="Optional receipt, payment screenshot, or proof of the complete transaction."
        attachments={proofImages}
        imageType={transaction.transactionType === "expense" ? "receipt" : "proof"}
        transactionId={transaction.id}
        multiple
        maxImages={3}
        onUpload={(file, imageType, onProgress) => uploadImage(file, imageType, onProgress)}
        onChange={(images) => changeTransactionImages(["proof", "receipt"], images)}
        onBusyChange={onImageBusyChange}
      />
      <label className="sm:col-span-2"><span className="text-xs font-black">Notes</span><textarea value={transaction.notes || ""} onChange={(event) => setTransaction({ ...transaction, notes: event.target.value })} rows={3} className={input} /></label>
    </section> : null}

    {step === 1 ? <section className="space-y-3">
      {transaction.transactionType === "sale" ? <div className="surface-card p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-black">Search Existing Inventory</h2><p className="text-xs text-slate-500">Selected inventory cannot be added twice.</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-700">{transaction.items.length} selected</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, collector number, set, inventory ID…" className={`${input} mt-3`} /><div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{available.map((row) => <button type="button" key={row.id} disabled={transaction.items.some((item) => item.inventoryPurchaseId === row.id)} onClick={() => addSaleItem(row)} className="flex w-full items-center gap-2 rounded-xl border p-2 text-left disabled:opacity-40">{row.imageUrl ? <img src={row.imageUrl} className="size-12 rounded-lg object-contain" /> : <div className="size-12 rounded-lg bg-slate-100" />}<span className="min-w-0 flex-1"><b className="block truncate">{row.itemName}</b><small>{formatMoney(row.totalCost)} basis · {formatMoney(row.marketValue || 0)} market</small></span><PackagePlus size={17} /></button>)}</div></div> : null}
      <div className="surface-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-black">Items</h2><p className="text-xs text-slate-500">Add any number of items and edit each item independently.</p></div><span className="text-sm font-black">{transaction.items.length} item{transaction.items.length === 1 ? "" : "s"}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3">
        {transaction.transactionType !== "sale" ? <button type="button" onClick={addIncoming} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 font-black text-white"><PackagePlus size={17} /> {transaction.transactionType === "expense" ? "Add Cost" : "Add Item"}</button> : null}
        {transaction.transactionType !== "expense" ? <button type="button" onClick={addManualCard} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-100 px-3 font-black text-violet-800"><Search size={17} /> Search Pokémon</button> : null}
        {transaction.transactionType !== "expense" ? <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 font-black text-slate-800"><ScanLine size={17} /> Scan Card<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) addScannedCard(file); event.currentTarget.value = ""; }} /></label> : null}
        {transaction.transactionType === "sale" ? <button type="button" onClick={() => { const item = { ...blankTradeItem(transaction.id, "outgoing"), ownershipShares: [] }; setTransaction((row) => ({ ...row, items: [...row.items, item] })); setEditing(item); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 font-black text-slate-800"><PackagePlus size={17} /> Enter Manually</button> : null}
      </div></div>
      {transaction.transactionType !== "expense" && transaction.itemMode === "multiple" ? <div className="surface-card grid gap-2 p-4 sm:grid-cols-[1fr_1fr_auto]"><select value={transaction.pricingMode} onChange={(event) => setTransaction({ ...transaction, pricingMode: event.target.value as TradeTransaction["pricingMode"] })} className={input}><option value="individual">Individual Prices</option><option value="bundle_total">Bundle Total</option></select>{transaction.pricingMode === "bundle_total" ? <>{moneyInput(transaction.bundleTotal, (bundleTotal) => setTransaction({ ...transaction, bundleTotal }))}<select value={allocation} onChange={(event) => setAllocation(event.target.value as AllocationMethod)} className={input}><option value="market">Market Value</option><option value="equal">Equal Split</option><option value="cost">Cost Basis</option><option value="custom">Custom</option></select><button type="button" onClick={allocate} className="min-h-11 rounded-xl bg-violet-600 px-3 font-black text-white sm:col-span-3">Allocate {formatMoney(transaction.bundleTotal || 0)}</button></> : null}{transaction.transactionType === "purchase" ? <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-black sm:col-span-3"><input type="checkbox" checked={Boolean(transaction.keepAsBundle)} onChange={(event) => setTransaction({ ...transaction, keepAsBundle: event.target.checked })} className="size-4" /> Keep this lot as one bundled inventory record</label> : null}</div> : null}
      {transaction.transactionType === "purchase" && transaction.itemMode === "multiple" ? <IncomingBatchPricing items={transaction.items} mode="purchase" onApply={(items) => setTransaction({ ...transaction, items })} /> : null}
      <div className="space-y-2">{transaction.items.map((item) => <article key={item.id} className="surface-card grid gap-3 p-3 sm:grid-cols-[4rem_1fr_auto] sm:items-center">
        {item.imageUrl || transaction.generalImageUrl ? <img src={item.imageUrl || transaction.generalImageUrl} alt="" className="size-16 rounded-xl object-contain" /> : <div className="grid size-16 place-items-center rounded-xl bg-slate-100 text-slate-400"><PackagePlus size={20} /></div>}
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="truncate">{item.itemName || "Details pending"}</b><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${item.direction === "outgoing" ? "bg-orange-100 text-orange-700" : item.direction === "incoming" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>{item.direction}</span></div><div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-4"><span>Qty <b className="text-slate-700">{item.quantity}</b></span><span>Market <b className="text-slate-700">{formatMoney(item.marketValue)}</b></span><span>Basis <b className="text-slate-700">{formatMoney(item.historicalCostBasis || item.allocatedCostBasis)}</b></span><span>{transaction.transactionType === "sale" ? "Sold" : "Cost"} <b className="text-slate-700">{formatMoney(transaction.transactionType === "sale" ? item.soldPrice || 0 : item.boughtPrice || 0)}</b></span></div><p className="mt-1 truncate text-xs text-slate-500">{item.ownershipShares.map((share) => `${workers.find((row) => row.id === share.workerId)?.name || "Owner"} ${share.ownershipPercentage}%`).join(", ") || "Ownership unassigned"}</p></div>
        <div className="flex items-center justify-end gap-1"><button type="button" onClick={() => setEditing(item)} className="min-h-10 rounded-lg bg-violet-100 px-3 text-xs font-black text-violet-700">Edit</button><button type="button" onClick={() => { const duplicateId = crypto.randomUUID(); const duplicate = { ...item, id: duplicateId, inventoryPurchaseId: undefined, images: item.images?.map((image) => ({ ...image, id: crypto.randomUUID(), transactionItemId: duplicateId })) }; setTransaction({ ...transaction, items: [...transaction.items, duplicate] }); }} aria-label={`Duplicate ${item.itemName || "item"}`} className="grid size-10 place-items-center rounded-lg bg-slate-100"><Copy size={15} /></button><button type="button" onClick={() => setTransaction({ ...transaction, items: transaction.items.filter((row) => row.id !== item.id) })} aria-label={`Remove ${item.itemName || "item"}`} className="grid size-10 place-items-center rounded-lg bg-rose-50 text-rose-600"><Trash2 size={15} /></button></div>
      </article>)}</div>
    </section> : null}

    {step === 2 ? <section className="space-y-3"><div className="surface-card p-4"><p className="eyebrow">Transaction Review</p><h2 className="text-xl font-black">{typeLabel} · {transaction.items.length} item{transaction.items.length === 1 ? "" : "s"}</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Cash received", transaction.transactionType === "sale" ? review.sold : 0],["Cash paid", transaction.transactionType === "purchase" ? review.bought : transaction.transactionType === "expense" ? Number(transaction.bundleTotal || 0) : 0],["Cost basis", review.basis],["Gross profit", review.grossProfit]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-3"><small className="block text-slate-500">{label}</small><b>{formatMoney(Number(value))}</b></div>)}</div>{transaction.pricingMode === "bundle_total" && Math.abs(review.bundleDifference) > .009 ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">Bundle allocation is off by {formatMoney(review.bundleDifference)}.</p> : null}{transaction.items.some((item) => transaction.transactionType !== "expense" && !ownershipIsValid(item)) ? <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">One or more item ownership splits do not total 100%.</p> : null}{transaction.items.some((item) => !item.historicalCostBasis && transaction.transactionType === "sale") ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">One or more sold items has a missing cost basis.</p> : null}</div><div className="surface-card p-4"><h3 className="font-black">Owner profit shares</h3>{Array.from(review.ownerProfit.entries()).map(([workerId, amount]) => <p key={workerId} className="mt-1 text-sm">{workers.find((row) => row.id === workerId)?.name || "Owner"}: <b>{formatMoney(amount)}</b></p>)}{!review.ownerProfit.size ? <p className="text-sm text-slate-500">Calculated from each item’s ownership after items are assigned.</p> : null}</div></section> : null}

    <ResponsiveModal
      open={Boolean(editing)}
      title="Transaction Item"
      description="Add item details, ownership, and optional front and back photos."
      onClose={() => { setEditing(undefined); setManualSearch(false); setScanFile(undefined); }}
      size="md"
      dismissible={!imageUploading}
    >
      {editing ? <div className="space-y-3">
        <label>
          <span className="text-xs font-black">Item / description</span>
          <input value={editing.itemName} onChange={(event) => {
            const item = { ...editing, itemName: event.target.value };
            setEditing(item);
            updateItem(item);
          }} className={input} />
        </label>
        {transaction.transactionType !== "expense" ? <>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setManualSearch(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-100 px-3 text-sm font-black text-violet-800"><Search size={16} /> Search Pokémon</button>
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 text-sm font-black text-slate-800"><ScanLine size={16} /> Scan Card<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { setScanFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          </div>
          {scanFile ? <div className="rounded-2xl border border-violet-200 p-3"><CardScanPanel imageFile={scanFile} category={editing.itemType} inventory={inventory} onRetakePhoto={() => setScanFile(undefined)} onApply={(suggestion) => {
            const item = applyCardSuggestionToItem(editing, suggestion, "scanner");
            setEditing(item);
            updateItem(item);
            setScanFile(undefined);
          }} /></div> : null}
          <div className="grid grid-cols-2 gap-2">
            <label><span className="text-xs font-black">Item type</span><select value={editing.itemType} onChange={(event) => {
              const item = { ...editing, itemType: event.target.value as PokemonProductCategory };
              setEditing(item);
              updateItem(item);
            }} className={input}>{Object.entries(pokemonCategoryLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span className="text-xs font-black">Market value</span>{moneyInput(editing.marketValue, (marketValue) => {
              const item = { ...editing, marketValue };
              setEditing(item);
              updateItem(item);
            })}</label>
            <label><span className="text-xs font-black">{transaction.transactionType === "sale" ? "Sold price" : "Bought price"}</span>{moneyInput(transaction.transactionType === "sale" ? editing.soldPrice : editing.boughtPrice, (value) => {
              const item = transaction.transactionType === "sale" ? { ...editing, soldPrice: value } : { ...editing, boughtPrice: value, allocatedCostBasis: value };
              setEditing(item);
              updateItem(item);
            })}</label>
            {transaction.transactionType === "sale" ? <label><span className="text-xs font-black">Original Cost Basis</span>{editing.inventoryPurchaseId ? <input type="number" value={editing.historicalCostBasis} readOnly className={`${input} bg-slate-100`} /> : moneyInput(editing.historicalCostBasis, (historicalCostBasis) => {
              const item = { ...editing, historicalCostBasis };
              setEditing(item);
              updateItem(item);
            })}{editing.inventoryPurchaseId ? <small className="block text-slate-500">Historical cost basis loaded from inventory</small> : null}</label> : null}
            <label><span className="text-xs font-black">Collector number</span><input value={editing.collectorNumber || ""} onChange={(event) => {
              const item = { ...editing, collectorNumber: event.target.value };
              setEditing(item);
              updateItem(item);
            }} className={input} /></label>
            <label><span className="text-xs font-black">Quantity</span><input type="number" min="1" step="1" value={editing.quantity} onChange={(event) => {
              const item = { ...editing, quantity: Math.max(1, Number(event.target.value || 1)) };
              setEditing(item);
              updateItem(item);
            }} className={input} /></label>
            <label><span className="text-xs font-black">Set</span><input value={editing.cardSet || ""} onChange={(event) => {
              const item = { ...editing, cardSet: event.target.value };
              setEditing(item);
              updateItem(item);
            }} className={input} /></label>
            <label><span className="text-xs font-black">Condition</span><input value={editing.cardCondition || ""} onChange={(event) => {
              const item = { ...editing, cardCondition: (event.target.value || undefined) as CardCondition | undefined };
              setEditing(item);
              updateItem(item);
            }} className={input} /></label>
          </div>
          <TransactionItemPricing item={editing} context={transaction.transactionType === "sale" ? "sale" : "purchase"} onChange={(item) => { setEditing(item); updateItem(item); }} />
          <OwnershipEditor workers={workers} shares={editing.ownershipShares} totalCost={transaction.transactionType === "sale" ? editing.historicalCostBasis : Number(editing.boughtPrice || 0)} onChange={(ownershipShares: OwnershipShare[]) => {
            const item = { ...editing, ownershipShares };
            setEditing(item);
            updateItem(item);
          }} />
        </> : <label><span className="text-xs font-black">Amount</span>{moneyInput(editing.boughtPrice, (boughtPrice) => {
          const item = { ...editing, boughtPrice, allocatedCostBasis: boughtPrice };
          setEditing(item);
          setTransaction((current) => {
            const items = current.items.map((value) => value.id === item.id ? item : value);
            return { ...current, items, bundleTotal: items.reduce((sum, value) => sum + Number(value.boughtPrice || 0), 0) };
          });
        })}</label>}
        <ImageAttachmentField
          label="Item front / detail photos"
          description="Use an individual photo, a crop, or link the transaction group photo."
          attachments={(editing.images || []).filter((image) => image.imageType === "front" || image.imageType === "item" || image.imageType === "crop")}
          imageType="front"
          transactionId={transaction.id}
          transactionItemId={editing.id}
          multiple
          maxImages={3}
          reusableAttachment={sharedImage}
          onUpload={(file, imageType, onProgress) => uploadImage(file, imageType, onProgress, editing.id)}
          onChange={(images) => changeItemImages(editing, ["front", "item", "crop"], images)}
          onBusyChange={onImageBusyChange}
        />
        <ImageAttachmentField
          label="Slab back photo"
          description="Optional back or certification-label photo."
          attachments={(editing.images || []).filter((image) => image.imageType === "back")}
          imageType="back"
          transactionId={transaction.id}
          transactionItemId={editing.id}
          maxImages={1}
          onUpload={(file, imageType, onProgress) => uploadImage(file, imageType, onProgress, editing.id)}
          onChange={(images) => changeItemImages(editing, ["back"], images)}
          onBusyChange={onImageBusyChange}
        />
        <button type="button" disabled={imageUploading} onClick={() => setEditing(undefined)} className="btn-primary w-full disabled:opacity-50"><Check size={17} /> Done</button>
      </div> : null}
    </ResponsiveModal>
    {manualSearch && editing ? <ManualCardSearch
      open
      category={editing.itemType}
      initialName={editing.itemName}
      initialCollectorNumber={editing.collectorNumber}
      initialSet={editing.cardSet}
      onClose={() => setManualSearch(false)}
      onApply={(suggestion) => {
        const item = applyCardSuggestionToItem(editing, suggestion, "manual");
        setEditing(item);
        updateItem(item);
        setManualSearch(false);
      }}
    /> : null}

    {saveStage ? <div className="fixed inset-x-3 bottom-24 z-[70] mx-auto max-w-2xl"><ProgressSteps steps={saveSteps} activeStep={saveStageIndex} complete={saveComplete} /></div> : null}
    <Toast open={Boolean(toast)} message={toast?.message || ""} tone={toast?.tone} onDismiss={() => setToast(undefined)} />
    <ConfirmDialog open={Boolean(confirmMode)} title={confirmMode === "discard" ? "Discard recovered draft?" : "Leave this transaction?"} description={confirmMode === "discard" ? "The locally recovered transaction will be removed." : "Your local draft will remain available when you return."} confirmLabel={confirmMode === "discard" ? "Discard Draft" : "Leave Transaction"} tone={confirmMode === "discard" ? "danger" : "warning"} onConfirm={resolveConfirmation} onCancel={() => setConfirmMode(undefined)} />
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:bg-slate-950/95 lg:left-64"><div className="mx-auto flex max-w-4xl gap-2"><button onClick={() => setStep(Math.max(0, step - 1))} disabled={!step || busy || imageUploading} className="min-h-12 rounded-xl bg-slate-100 px-3 font-black disabled:opacity-40"><ArrowLeft size={17} /></button><button onClick={() => void saveDraft()} disabled={busy || imageUploading} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-100 px-3 font-black text-amber-800 disabled:opacity-50"><Save size={17} /> Draft</button>{step < 2 ? <button onClick={() => setStep(step + 1)} disabled={busy || imageUploading} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 font-black text-white disabled:opacity-50">Next <ArrowRight size={17} /></button> : <button onClick={() => void complete()} disabled={busy || imageUploading} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-black text-white disabled:opacity-50"><Check size={17} /> Complete</button>}</div></div>
  </div>;
}
