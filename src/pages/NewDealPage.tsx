import {
  ArrowLeft, ArrowRight, Banknote, Camera, Check, ChevronRight, CircleDollarSign, Copy,
  Eye, EyeOff, ImagePlus, Package, PackageCheck, Plus, RefreshCcw, Save, ScanLine,
  Search, SlidersHorizontal, Trash2, WalletCards, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CardScanPanel } from "../components/sales/CardScanPanel";
import { ImageAttachmentField } from "../components/sales/ImageAttachmentField";
import { ManualCardSearch } from "../components/sales/ManualCardSearch";
import { OwnershipEditor } from "../components/sales/OwnershipEditor";
import { AppButton, LoadingOverlay, ProgressSteps, ResponsiveModal, Toast, type ProgressStep } from "../components/sales/SalesDashboardPrimitives";
import { listInventoryPurchases } from "../services/database/inventoryPurchaseRepository";
import { listOwnershipShares } from "../services/database/ownershipRepository";
import {
  blankTrade, blankTradeItem, completeFinancialTransaction, isTransactionPaymentSaveError,
  saveFinancialTransactionDraft, saveTrade, saveTransactionPayments, type TransactionPaymentSaveError, type TransactionSaveStage,
} from "../services/database/tradeRepository";
import { migrateLocalTransactionDraft, createLocalTransactionDraft } from "../services/database/transactionDraft";
import { transactionTypeDeveloperDebug } from "../services/database/financialTransactionType";
import { listWorkers } from "../services/database/workerRepository";
import { listPlannerEventOptions } from "../services/planner/plannerRepository";
import { saveTransactionImage, type ImageUploadStage } from "../services/images/saleImageService";
import type {
  CardCondition, CardGame, CardLanguage, Event, InventoryPurchase, OwnershipShare, PokemonProductCategory,
  SalePaymentMethod, TradeItem, TradeTransaction, TransactionImageAttachment, TransactionImageType,
  TransactionPaymentEntry, Worker,
} from "../types/models";
import { applyCardSuggestionToItem, pricingFromInventory } from "../utils/cardPricing";
import {
  applyDealPercentage, classifyDeal, conditionAdjustedMarket, dealSummary, incomingDealPercentages,
  normalizeDealForSave, outgoingDealPercentages, type DealSide,
} from "../utils/dealBuilder";
import { deriveEventDisplayStatus } from "../utils/eventStage";
import { formatMoney, roundMoney } from "../utils/paymentMath";
import { paymentMethodLabels, pokemonCategoryLabels } from "../utils/salesControl";
import { hasKnownHistoricalCostBasis } from "../utils/transactionMath";
import { ownershipIsValid } from "../utils/tradeMath";
import { TRANSACTION_PHOTO_LIMIT } from "../utils/transactionImages";

const draftKey = "4nerds:new-deal-draft:v1";
const inputClass = "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-violet-900";
const saveSteps: ProgressStep[] = [
  { id: "transaction", label: "Saving deal" },
  { id: "items", label: "Saving items & photos" },
  { id: "inventory", label: "Updating inventory" },
  { id: "finalizing", label: "Finalizing accounting" },
];
const conditions: CardCondition[] = ["Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged"];
const paymentMethods = Object.keys(paymentMethodLabels) as SalePaymentMethod[];

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function createDeal(): TradeTransaction {
  return { ...blankTrade(), tradeDate: localDateTime(), transactionType: "trade", itemMode: "multiple", pricingMode: "individual", paymentMethod: "cash", payments: [] };
}

function readDealDraft() {
  try {
    const migrated = migrateLocalTransactionDraft(JSON.parse(localStorage.getItem(draftKey) || "null"));
    return migrated?.transaction;
  } catch {
    return undefined;
  }
}

function typeLabel(type: ReturnType<typeof classifyDeal>) {
  if (type === "purchase") return "PURCHASE";
  if (type === "sale") return "SALE";
  if (type === "trade") return "TRADE";
  if (type === "cash_trade") return "CASH + TRADE";
  return "BUILDING DEAL";
}

function typeClasses(type: ReturnType<typeof classifyDeal>) {
  if (type === "purchase") return "border-sky-400/40 bg-sky-400/15 text-sky-200";
  if (type === "sale") return "border-emerald-400/40 bg-emerald-400/15 text-emerald-200";
  if (type === "trade") return "border-violet-400/40 bg-violet-400/15 text-violet-200";
  if (type === "cash_trade") return "border-amber-400/40 bg-amber-400/15 text-amber-100";
  return "border-slate-600 bg-slate-800 text-slate-300";
}

function directionTotal(payments: TransactionPaymentEntry[], direction: TransactionPaymentEntry["direction"]) {
  return roundMoney(payments.filter((payment) => payment.direction === direction).reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
}

function itemImage(item: TradeItem) {
  return item.officialCardImageUrl || item.imageUrl;
}

export function NewDealPage() {
  const navigate = useNavigate();
  const recovered = useMemo(readDealDraft, []);
  const [transaction, setTransaction] = useState<TradeTransaction>(() => recovered || createDeal());
  const [recoveredNotice, setRecoveredNotice] = useState(Boolean(recovered));
  const [inventory, setInventory] = useState<InventoryPurchase[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"build" | "review">("build");
  const [editing, setEditing] = useState<TradeItem>();
  const [manualSearch, setManualSearch] = useState(false);
  const [scanFile, setScanFile] = useState<File>();
  const [inventoryPicker, setInventoryPicker] = useState(false);
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventorySort, setInventorySort] = useState<"name" | "cost" | "market" | "age">("name");
  const [selectedInventory, setSelectedInventory] = useState<Set<string>>(() => new Set());
  const [offerMode, setOfferMode] = useState(false);
  const [message, setMessage] = useState("");
  const [debug, setDebug] = useState("");
  const [draftError, setDraftError] = useState("");
  const [paymentRetry, setPaymentRetry] = useState<{ error: TransactionPaymentSaveError; operation: "pending" | "complete" }>();
  const [imageError, setImageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyImageFields, setBusyImageFields] = useState<Set<string>>(() => new Set());
  const [saveStage, setSaveStage] = useState<TransactionSaveStage>();
  const [saveComplete, setSaveComplete] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "warning" | "info" }>();
  const completionInFlight = useRef(false);
  const quickScanInput = useRef<HTMLInputElement>(null);
  const summary = dealSummary(transaction);
  const classification = summary.classification;
  const payments = transaction.payments || [];
  const images = transaction.images || [];
  const imageUploading = busyImageFields.size > 0;
  const saveStageIndex = saveStage === "transaction" ? 0 : saveStage === "items" ? 1 : saveStage === "inventory" || saveStage === "ownership" ? 2 : 3;

  const updateTransaction = useCallback((next: TradeTransaction) => {
    const normalized = normalizeDealForSave(next);
    setTransaction(normalized);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listInventoryPurchases(2000), listPlannerEventOptions(1000), listWorkers()]).then(async ([inventoryResult, eventResult, workerResult]) => {
      if (inventoryResult.status === "fulfilled") {
        try {
          const ownership = await listOwnershipShares(inventoryResult.value.map((row) => row.id), []);
          if (!cancelled) setInventory(inventoryResult.value.map((row) => ({ ...row, ownershipShares: ownership.inventory.get(row.id) || [] })));
        } catch {
          if (!cancelled) setInventory(inventoryResult.value);
        }
      } else if (!cancelled) setMessage("Available inventory could not be loaded. You can still build the incoming side.");
      if (eventResult.status === "fulfilled" && !cancelled) setEvents(eventResult.value);
      if (workerResult.status === "fulfilled" && !cancelled) setWorkers(workerResult.value.filter((worker) => worker.active));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (recovered?.eventId || transaction.eventId || !events.length || !workers.length) return;
    const paid = events
      .filter((event) => deriveEventDisplayStatus(event, workers) === "paid")
      .filter((event) => event.startDate.slice(0, 10) >= new Date().toLocaleDateString("en-CA"))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (paid[0]) setTransaction((current) => ({ ...current, eventId: paid[0].id }));
  }, [events, recovered?.eventId, transaction.eventId, workers]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify(createLocalTransactionDraft(transaction, step === "build" ? 0 : 1))); }
      catch { setToast({ message: "Local recovery is full. Save this deal as Pending to protect it.", tone: "warning" }); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [step, transaction]);

  const onImageBusyChange = useCallback((fieldId: string, active: boolean) => {
    setBusyImageFields((current) => {
      const next = new Set(current);
      if (active) next.add(fieldId); else next.delete(fieldId);
      return next;
    });
  }, []);

  function updateItem(item: TradeItem) {
    updateTransaction({ ...transaction, items: transaction.items.map((current) => current.id === item.id ? item : current) });
    setEditing(item);
  }

  function addBlankItem(side: DealSide, itemType: PokemonProductCategory = "raw_card", openSearch = false) {
    const defaultOwner = workers[0] ? [{ workerId: workers[0].id, ownershipPercentage: 100 }] : [];
    const base = blankTradeItem(transaction.id, side);
    const item: TradeItem = {
      ...base,
      itemType,
      cardGame: itemType === "raw_card" || itemType === "graded_card" ? "pokemon" : "other",
      cardLanguage: itemType === "raw_card" || itemType === "graded_card" ? "en" : "unknown",
      dataProvider: "manual",
      cardCondition: "Near Mint / NM",
      targetBuyPercentage: side === "incoming" ? 70 : 100,
      ownershipShares: defaultOwner,
    };
    updateTransaction({ ...transaction, items: [...transaction.items, item] });
    setEditing(item);
    setManualSearch(openSearch);
    return item;
  }

  function beginScan(side: DealSide, file?: File) {
    addBlankItem(side);
    setScanFile(file);
  }

  function inventoryItem(purchase: InventoryPurchase): TradeItem {
    return {
      ...blankTradeItem(transaction.id, "outgoing"),
      inventoryPurchaseId: purchase.id,
      itemName: purchase.itemName,
      itemType: purchase.category,
      quantity: Math.max(1, purchase.quantity - purchase.quantitySold),
      marketValue: Number(purchase.marketValue || 0),
      agreedTradeValue: Number(purchase.marketValue || 0),
      soldPrice: Number(purchase.marketValue || 0),
      historicalCostBasis: Number(purchase.totalCost ?? 0),
      imageUrl: purchase.frontImageUrl || purchase.imageUrl,
      imagePath: purchase.frontImagePath || purchase.imagePath,
      collectorNumber: purchase.collectorNumber,
      cardSet: purchase.cardSet,
      cardSetId: purchase.cardSetId,
      cardSetCode: purchase.cardSetCode,
      cardRarity: purchase.cardRarity,
      cardGame: purchase.cardGame,
      cardLanguage: purchase.cardLanguage,
      dataProvider: purchase.dataProvider,
      providerCardId: purchase.providerCardId,
      cardCode: purchase.cardCode,
      pokemonTcgCardId: purchase.pokemonTcgCardId,
      officialCardImageUrl: purchase.officialCardImageUrl,
      tcgplayerUrl: purchase.tcgplayerUrl,
      marketPriceSource: purchase.marketPriceSource,
      marketPriceVariant: purchase.marketPriceVariant,
      marketPriceUpdatedAt: purchase.marketPriceUpdatedAt,
      marketPriceCheckedAt: purchase.marketPriceCheckedAt,
      marketPriceCurrency: purchase.marketPriceCurrency,
      tcgplayerPricing: pricingFromInventory(purchase),
      cardSelectionSource: "inventory",
      cardCondition: purchase.cardCondition,
      stickerPrice: purchase.stickerPrice,
      stickerCondition: purchase.cardCondition,
      gradingCompany: purchase.gradingCompany,
      grade: purchase.grade,
      certificateNumber: purchase.certificateNumber,
      ownershipShares: purchase.ownershipShares || [],
      zeroCostBasisConfirmed: Number(purchase.totalCost ?? 0) === 0 ? false : undefined,
    };
  }

  function commitInventorySelection() {
    const existing = new Set(transaction.items.map((item) => item.inventoryPurchaseId));
    const additions = inventory.filter((purchase) => selectedInventory.has(purchase.id) && !existing.has(purchase.id)).map(inventoryItem);
    updateTransaction({ ...transaction, items: [...transaction.items, ...additions] });
    setSelectedInventory(new Set());
    setInventoryPicker(false);
  }

  function addPayment(direction: TransactionPaymentEntry["direction"]) {
    const entry: TransactionPaymentEntry = {
      id: crypto.randomUUID(), direction, paymentMethod: "cash", amount: 0,
      paidByWorkerId: direction === "paid" ? transaction.paidByWorkerId : undefined,
      paidAt: transaction.tradeDate,
    };
    setTransaction({ ...transaction, payments: [...payments, entry] });
  }

  function changePayments(next: TransactionPaymentEntry[]) {
    updateTransaction({
      ...transaction,
      payments: next,
      cashReceived: directionTotal(next, "received"),
      cashPaid: directionTotal(next, "paid"),
      paymentMethod: next[0]?.paymentMethod || transaction.paymentMethod,
      paidByWorkerId: next.find((payment) => payment.direction === "paid")?.paidByWorkerId,
    });
  }

  async function uploadImage(
    file: File | undefined,
    imageType: TransactionImageType,
    onProgress: (stage: ImageUploadStage) => void,
    itemId?: string,
    stableImageId?: string,
    resumeAttachment?: TransactionImageAttachment,
  ) {
    setImageError("");
    let persisted: TradeTransaction;
    try {
      const normalized = normalizeDealForSave(transaction);
      persisted = normalized.items.length
        ? await saveTrade(normalized, { syncImages: false, syncPayments: false, syncOwnership: false })
        : await saveFinancialTransactionDraft(normalized);
      setTransaction(persisted);
      setDraftError("");
      setDebug("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The deal draft could not be saved.";
      setDraftError(detail);
      setDebug(transactionTypeDeveloperDebug(error) || "");
      throw new Error("Image upload is waiting for the deal draft to save. Your selected photo is preserved for Retry.");
    }
    try {
      return await saveTransactionImage(file, persisted.id, itemId, imageType, onProgress, stableImageId, resumeAttachment);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "The image could not be saved.");
      throw error;
    }
  }

  async function changeTransactionImages(next: TransactionImageAttachment[]) {
    const general = next[0];
    const updated = { ...transaction, images: next, generalImageUrl: general?.imageUrl, generalImagePath: general?.imagePath };
    setTransaction(updated);
    try {
      if (next.some((image) => image.metadataStatus === "pending")) await saveFinancialTransactionDraft(updated);
      else await saveTrade(updated, { syncImages: false, syncPayments: false });
      setDraftError("");
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "The deal draft could not be updated.");
      setDebug(transactionTypeDeveloperDebug(error) || "");
    }
  }

  async function changeItemImages(item: TradeItem, next: TransactionImageAttachment[]) {
    const front = next.find((image) => image.imageType !== "back");
    const updatedItem = { ...item, images: next, imageUrl: front?.imageUrl, imagePath: front?.imagePath };
    const updated = { ...transaction, items: transaction.items.map((current) => current.id === item.id ? updatedItem : current) };
    setEditing(updatedItem);
    setTransaction(updated);
    try {
      await saveTrade(updated, { syncImages: false, syncPayments: false, syncOwnership: !next.some((image) => image.metadataStatus === "pending") });
      setDraftError("");
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "The item photo could not be linked to the draft.");
    }
  }

  function validationError(next: TradeTransaction) {
    const kind = classifyDeal(next);
    if (kind === "unclassified") return "Add at least one item to Coming In or Going Out.";
    const unnamed = next.items.find((item) => !item.itemName.trim());
    if (unnamed) return "Every item needs a name or confirmed card match.";
    const invalidOwnership = next.items.find((item) => !ownershipIsValid(item));
    if (invalidOwnership) return `Ownership for ${invalidOwnership.itemName} must total 100%.`;
    const missingBasis = next.items.find((item) => item.direction === "outgoing" && !hasKnownHistoricalCostBasis(item));
    if (missingBasis) return `Cost basis required for ${missingBasis.itemName}. Enter the historical cost or explicitly confirm a true $0 basis.`;
    if (kind === "purchase" && next.items.some((item) => item.direction === "incoming" && Number(item.agreedTradeValue || 0) <= 0)) return "Every incoming item needs an agreed purchase value.";
    if (kind === "sale" && next.items.some((item) => item.direction === "outgoing" && Number(item.agreedTradeValue || 0) <= 0)) return "Every outgoing item needs an agreed sale value.";
    if ((kind === "trade" || kind === "cash_trade") && (!next.items.some((item) => item.direction === "incoming") || !next.items.some((item) => item.direction === "outgoing"))) return "A trade needs items on both sides.";
    return "";
  }

  async function savePending() {
    setBusy(true);
    setMessage("");
    setPaymentRetry(undefined);
    setSaveStage("transaction");
    try {
      const saved = await saveTrade({ ...normalizeDealForSave(transaction), status: "draft" });
      setTransaction(saved);
      localStorage.setItem(draftKey, JSON.stringify(createLocalTransactionDraft(saved, step === "build" ? 0 : 1)));
      setDraftError("");
      setToast({ message: "Deal saved as Pending. Inventory and profit totals were not changed.", tone: "success" });
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "The pending deal could not be saved.");
      setDebug(transactionTypeDeveloperDebug(error) || "");
      if (isTransactionPaymentSaveError(error)) {
        setTransaction(error.transaction);
        setPaymentRetry({ error, operation: "pending" });
        setDraftError("");
      }
    } finally {
      setBusy(false);
      setSaveStage(undefined);
    }
  }

  async function completeDeal() {
    if (completionInFlight.current) return;
    const normalized = normalizeDealForSave(transaction);
    const error = validationError(normalized);
    if (error) { setMessage(error); setStep("review"); return; }
    completionInFlight.current = true;
    setBusy(true);
    setMessage("");
    setPaymentRetry(undefined);
    setSaveComplete(false);
    setSaveStage("transaction");
    try {
      await completeFinancialTransaction(normalized, inventory, setSaveStage);
      localStorage.removeItem(draftKey);
      setSaveComplete(true);
      setToast({ message: `${typeLabel(classifyDeal(normalized))} completed.`, tone: "success" });
      window.setTimeout(() => navigate("/sales", { replace: true }), 450);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The deal could not be completed.";
      setMessage(isTransactionPaymentSaveError(error) ? `${detail} The deal draft is preserved; Retry will only save the missing payment stage.` : detail);
      setDebug(transactionTypeDeveloperDebug(error) || "");
      if (isTransactionPaymentSaveError(error)) {
        setTransaction(error.transaction);
        setPaymentRetry({ error, operation: "complete" });
      }
    } finally {
      completionInFlight.current = false;
      setBusy(false);
      setSaveStage(undefined);
      setSaveComplete(false);
    }
  }

  async function retryPaymentOnly() {
    if (!paymentRetry) return;
    setBusy(true);
    setMessage("");
    try {
      await saveTransactionPayments(paymentRetry.error.transactionId, paymentRetry.error.transaction);
      const operation = paymentRetry.operation;
      setPaymentRetry(undefined);
      if (operation === "complete") {
        localStorage.removeItem(draftKey);
        setToast({ message: "Payment saved. The completed deal was not duplicated.", tone: "success" });
        window.setTimeout(() => navigate("/sales", { replace: true }), 450);
      } else {
        setToast({ message: "Payment saved to the existing pending deal.", tone: "success" });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The payment could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const availableInventory = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();
    return inventory
      .filter((item) => item.status === "in_stock" && item.quantity > item.quantitySold)
      .filter((item) => !transaction.items.some((dealItem) => dealItem.inventoryPurchaseId === item.id))
      .filter((item) => !query || `${item.itemName} ${item.collectorNumber || ""} ${item.cardSet || ""} ${item.cardCondition || ""}`.toLowerCase().includes(query))
      .sort((a, b) => inventorySort === "cost" ? b.totalCost - a.totalCost
        : inventorySort === "market" ? Number(b.marketValue || 0) - Number(a.marketValue || 0)
          : inventorySort === "age" ? a.purchaseDate.localeCompare(b.purchaseDate)
            : a.itemName.localeCompare(b.itemName));
  }, [inventory, inventorySearch, inventorySort, transaction.items]);

  if (loading) return <LoadingOverlay label="Preparing New Deal" />;

  const incoming = transaction.items.filter((item) => item.direction === "incoming");
  const outgoing = transaction.items.filter((item) => item.direction === "outgoing");
  const selectedEvent = events.find((event) => event.id === transaction.eventId);

  function renderItems(side: DealSide) {
    const rows = transaction.items.filter((item) => item.direction === side);
    if (!rows.length) return <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700"><Package className="mx-auto text-slate-400" size={28} /><p className="mt-2 text-sm font-black text-slate-600 dark:text-slate-300">No items {side === "incoming" ? "coming in" : "going out"} yet</p><p className="mt-1 text-xs text-slate-500">Scan a card or choose another add method above.</p></div>;
    return <div className="space-y-2">{rows.map((item) => {
      const agreed = Number(item.agreedTradeValue || (side === "incoming" ? item.boughtPrice : item.soldPrice) || 0);
      return <article key={item.id} className="group grid grid-cols-[3.5rem_minmax(0,1fr)_auto] gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-violet-300 dark:border-slate-800 dark:bg-night-850">
        {itemImage(item) ? <img src={itemImage(item)} alt="" className="h-[4.8rem] w-14 rounded-xl bg-slate-100 object-contain" /> : <div className="grid h-[4.8rem] w-14 place-items-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-900"><Package size={20} /></div>}
        <button type="button" onClick={() => setEditing(item)} className="min-w-0 text-left">
          <span className="block truncate font-black text-slate-950 dark:text-white">{item.itemName || "Details pending"}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{[item.cardSet, item.cardCode || item.collectorNumber, item.cardCondition].filter(Boolean).join(" · ") || pokemonCategoryLabels[item.itemType]}</span>
          <span className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-500"><span>Market<b className="block text-sm text-slate-800 dark:text-slate-200">{formatMoney(item.marketValue)}</b></span><span>Agreed<b className="block text-sm text-violet-700 dark:text-violet-300">{formatMoney(agreed)}</b></span><span>{side === "outgoing" ? "Basis" : "Own"}<b className="block truncate text-sm text-slate-800 dark:text-slate-200">{side === "outgoing" ? (hasKnownHistoricalCostBasis(item) ? formatMoney(item.historicalCostBasis) : "Required") : item.ownershipShares.map((share) => `${share.ownershipPercentage}%`).join("/") || "Required"}</b></span></span>
        </button>
        <div className="flex flex-col items-end justify-between"><button type="button" onClick={() => updateTransaction({ ...transaction, items: transaction.items.filter((row) => row.id !== item.id) })} aria-label={`Remove ${item.itemName || "item"}`} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button><button type="button" onClick={() => setEditing(item)} className="rounded-lg bg-violet-50 px-2 py-1 text-[11px] font-black text-violet-700 dark:bg-violet-950/40 dark:text-violet-200">Edit</button></div>
      </article>;
    })}</div>;
  }

  function sidePanel(side: DealSide) {
    const incomingSide = side === "incoming";
    const cashDirection = incomingSide ? "received" : "paid";
    const cashTotal = directionTotal(payments, cashDirection);
    return <section className={`rounded-[1.75rem] border p-4 shadow-sm sm:p-5 ${incomingSide ? "border-sky-200 bg-gradient-to-b from-sky-50 to-white dark:border-sky-900/70 dark:from-sky-950/20 dark:to-night-900" : "border-orange-200 bg-gradient-to-b from-orange-50 to-white dark:border-orange-900/70 dark:from-orange-950/20 dark:to-night-900"}`}>
      <div className="flex items-start justify-between gap-3"><div><p className={`text-xs font-black uppercase tracking-[0.18em] ${incomingSide ? "text-sky-700 dark:text-sky-300" : "text-orange-700 dark:text-orange-300"}`}>{incomingSide ? "Coming In" : "Going Out"}</p><h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{incomingSide ? "What 4 Nerds receives" : "What 4 Nerds gives"}</h2></div><span className={`rounded-full px-2.5 py-1 text-xs font-black ${incomingSide ? "bg-sky-100 text-sky-700 dark:bg-sky-950" : "bg-orange-100 text-orange-700 dark:bg-orange-950"}`}>{transaction.items.filter((item) => item.direction === side).length} items</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <label className="deal-add-button"><ScanLine size={17} /><span>Scan</span><input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) beginScan(side, file); event.currentTarget.value = ""; }} /></label>
        <button type="button" className="deal-add-button" onClick={() => addBlankItem(side, "raw_card", true)}><Search size={17} />Search</button>
        {!incomingSide ? <button type="button" className="deal-add-button" onClick={() => setInventoryPicker(true)}><PackageCheck size={17} />Inventory</button> : <button type="button" className="deal-add-button" onClick={() => addBlankItem(side)}><Plus size={17} />Manual</button>}
        {incomingSide ? <button type="button" className="deal-add-button" onClick={() => addBlankItem(side, "sealed_product")}><Package size={17} />Sealed</button> : <button type="button" className="deal-add-button" onClick={() => addBlankItem(side)}><Plus size={17} />Manual</button>}
        <button type="button" className="deal-add-button" onClick={() => addBlankItem(side, "graded_card")}><ImagePlus size={17} />Slab</button>
        <button type="button" className="deal-add-button" onClick={() => addPayment(cashDirection)}><Banknote size={17} />Cash</button>
      </div>
      <div className="mt-4">{renderItems(side)}</div>
      {cashTotal > 0 ? <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"><span className="font-bold">Cash {incomingSide ? "received" : "paid"}</span><b>{formatMoney(cashTotal)}</b></div> : null}
    </section>;
  }

  function summaryCard(customerSafe = false) {
    const metricLabel = classification === "purchase" ? "Unrealized inventory gain" : classification === "sale" ? "Sale profit" : "Trade gain / loss";
    const metric = classification === "purchase" ? summary.purchaseUnrealizedGain : classification === "sale" ? summary.saleProfit : summary.tradeGainLoss;
    return <section className="rounded-[1.5rem] border border-slate-700 bg-slate-950 p-4 text-white shadow-xl">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Live deal summary</p><p className="mt-1 text-lg font-black">{typeLabel(classification)}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide ${typeClasses(classification)}`}>{typeLabel(classification)}</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-xl bg-white/5 p-2"><small className="text-slate-400">Coming In</small><b className="mt-1 block">{formatMoney(summary.incomingAgreed + Number(transaction.cashReceived || 0))}</b></div><div className="rounded-xl bg-white/5 p-2"><small className="text-slate-400">Going Out</small><b className="mt-1 block">{formatMoney(summary.outgoingAgreed + Number(transaction.cashPaid || 0))}</b></div><div className="rounded-xl bg-white/5 p-2"><small className="text-slate-400">Cash Diff.</small><b className={`mt-1 block ${summary.cashDifference < 0 ? "text-orange-300" : "text-emerald-300"}`}>{formatMoney(summary.cashDifference)}</b></div></div>
      {!customerSafe && classification !== "unclassified" ? <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"><span className="text-xs font-bold text-slate-300">{metricLabel}</span><b className={metric == null ? "text-amber-300" : metric >= 0 ? "text-emerald-300" : "text-rose-300"}>{metric == null ? "Pending cost basis" : formatMoney(metric)}</b></div> : null}
      {!customerSafe && classification === "purchase" ? <p className="mt-2 text-[11px] leading-4 text-slate-400">Market value minus acquisition cost is unrealized. It is not sale profit.</p> : null}
    </section>;
  }

  return <div className="mx-auto min-w-0 max-w-7xl space-y-4 pb-28">
    <input ref={quickScanInput} type="file" accept="image/*" capture="environment" className="sr-only" />
    <header className="overflow-hidden rounded-[1.75rem] border border-slate-800 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,.28),transparent_38%),linear-gradient(135deg,#0f172a,#020617)] p-5 text-white shadow-2xl sm:p-6">
      <div className="flex items-center justify-between gap-3"><button type="button" onClick={() => navigate("/sales")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-black hover:bg-white/15"><ArrowLeft size={17} /> Sales Control</button><div className="flex gap-2"><button type="button" onClick={() => setOfferMode(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-black"><Eye size={17} /> Offer</button><span className={`inline-flex items-center rounded-xl border px-3 text-xs font-black ${typeClasses(classification)}`}>{typeLabel(classification)}</span></div></div>
      <div className="mt-6 max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">Unified transaction workspace</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">New Deal</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Build what comes in and what goes out. The system classifies the deal automatically and keeps purchase, sale, trade, and cash + trade accounting separate.</p></div>
      <div className="mt-5 grid gap-2 sm:grid-cols-3"><label><span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Date & time</span><input type="datetime-local" value={transaction.tradeDate.slice(0, 16)} onChange={(event) => updateTransaction({ ...transaction, tradeDate: event.target.value })} className={`${inputClass} mt-1 border-white/10 bg-white/10 text-white`} /></label><label><span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Customer / seller</span><input value={transaction.tradePartner || ""} onChange={(event) => updateTransaction({ ...transaction, tradePartner: event.target.value })} placeholder="Optional name" className={`${inputClass} mt-1 border-white/10 bg-white/10 text-white placeholder:text-slate-500`} /></label><label><span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Event</span><select value={transaction.eventId || ""} onChange={(event) => updateTransaction({ ...transaction, eventId: event.target.value || undefined })} className={`${inputClass} mt-1 border-white/10 bg-slate-900 text-white`}><option value="">No event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label></div>
      {recoveredNotice ? <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs"><span><b>Pending deal resumed.</b> Your items, pricing, ownership, payments, photos, and notes were restored.</span><button type="button" onClick={() => { localStorage.removeItem(draftKey); setTransaction(createDeal()); setRecoveredNotice(false); }} className="shrink-0 rounded-lg bg-white/10 px-2 py-1 font-black">Start fresh</button></div> : null}
    </header>

    {message ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{message}</div> : null}
    {paymentRetry ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><span><b>The deal already exists.</b> Only its payment record still needs to be saved.</span><button type="button" onClick={() => void retryPaymentOnly()} disabled={busy} className="min-h-10 rounded-xl bg-amber-600 px-3 font-black text-white disabled:opacity-50">Retry payment only</button></div> : null}
    {draftError ? <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><b>Deal draft:</b> {draftError}{debug ? <details className="mt-2"><summary className="cursor-pointer font-black">Developer Debug</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{debug}</pre></details> : null}</div> : null}
    {imageError ? <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"><b>Transaction photos:</b> {imageError}</div> : null}

    {step === "build" ? <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <main className="space-y-4">
        {sidePanel("incoming")}
        {sidePanel("outgoing")}
        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-night-900 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Payment split</p><h2 className="text-lg font-black">Cash and payment methods</h2></div><WalletCards className="text-violet-500" /></div><p className="mt-1 text-xs text-slate-500">Add only payments that were actually entered. Each method saves as its own canonical transaction payment.</p><div className="mt-3 space-y-2">{payments.map((payment) => <div key={payment.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(5.5rem,.7fr)_auto] gap-2"><select value={payment.direction} onChange={(event) => changePayments(payments.map((row) => row.id === payment.id ? { ...row, direction: event.target.value as TransactionPaymentEntry["direction"] } : row))} className={inputClass}><option value="received">Received</option><option value="paid">Paid</option></select><select value={payment.paymentMethod} onChange={(event) => changePayments(payments.map((row) => row.id === payment.id ? { ...row, paymentMethod: event.target.value as SalePaymentMethod } : row))} className={inputClass}>{paymentMethods.map((method) => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}</select><input type="number" min="0" step=".01" value={payment.amount || ""} placeholder="$0" onChange={(event) => changePayments(payments.map((row) => row.id === payment.id ? { ...row, amount: Number(event.target.value || 0) } : row))} className={inputClass} /><button type="button" onClick={() => changePayments(payments.filter((row) => row.id !== payment.id))} className="grid size-12 place-items-center rounded-xl bg-rose-50 text-rose-600"><Trash2 size={16} /></button>{payment.direction === "paid" ? <select value={payment.paidByWorkerId || ""} onChange={(event) => changePayments(payments.map((row) => row.id === payment.id ? { ...row, paidByWorkerId: event.target.value || undefined } : row))} className={`${inputClass} col-span-3`}><option value="">Who paid: Unassigned</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select> : null}</div>)}</div><div className="mt-3 flex flex-wrap gap-2"><AppButton variant="secondary" onClick={() => addPayment("received")}><Plus size={16} /> Add received payment</AppButton><AppButton variant="secondary" onClick={() => addPayment("paid")}><Plus size={16} /> Add paid payment</AppButton></div></section>
        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-night-900 sm:p-5"><ImageAttachmentField label="Transaction Photos" description="Up to 20 transaction photos. These group photos remain separate from item-specific photos." attachments={images.filter((image) => image.imageType === "general")} imageType="general" transactionId={transaction.id} multiple maxImages={TRANSACTION_PHOTO_LIMIT} onUpload={(file, imageType, onProgress, stableId, resume) => uploadImage(file, imageType, onProgress, undefined, stableId, resume)} onChange={changeTransactionImages} onBusyChange={onImageBusyChange} retryDisabled={Boolean(draftError)} /><label className="mt-4 block"><span className="text-xs font-black">Deal notes</span><textarea value={transaction.notes || ""} onChange={(event) => updateTransaction({ ...transaction, notes: event.target.value })} rows={3} placeholder="Condition notes, bundle terms, customer details…" className={`${inputClass} mt-1`} /></label></section>
      </main>
      <aside className="sticky top-4 hidden space-y-3 lg:block">{summaryCard()}<button type="button" onClick={() => setOfferMode(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white font-black shadow-sm dark:border-slate-800 dark:bg-night-900"><Eye size={17} /> Customer-safe Offer Mode</button><div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-night-900"><b className="block text-slate-800 dark:text-white">{selectedEvent ? `Linked: ${selectedEvent.name}` : "No event linked"}</b>Pending saves do not move inventory or change realized profit.</div></aside>
    </div> : <main className="mx-auto max-w-5xl space-y-4">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-night-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Review & confirm</p><h2 className="mt-1 text-2xl font-black">{typeLabel(classification)}</h2><p className="mt-1 text-sm text-slate-500">Verify values, ownership, payment splits, and inventory links before completing.</p></div><span className={`rounded-full border px-3 py-1 text-xs font-black ${typeClasses(classification)} !text-slate-900 dark:!text-white`}>{transaction.items.length} card{transaction.items.length === 1 ? "" : "s"} moved</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ReviewMetric label="Coming In" value={formatMoney(summary.incomingAgreed)} /><ReviewMetric label="Going Out" value={formatMoney(summary.outgoingAgreed)} /><ReviewMetric label="Cash Difference" value={formatMoney(summary.cashDifference)} tone={summary.cashDifference < 0 ? "warning" : "positive"} /><ReviewMetric label={classification === "purchase" ? "Unrealized Gain" : classification === "sale" ? "Gross Profit" : "Trade Gain / Loss"} value={(classification === "purchase" ? summary.purchaseUnrealizedGain : classification === "sale" ? summary.saleProfit : summary.tradeGainLoss) == null ? "Pending basis" : formatMoney((classification === "purchase" ? summary.purchaseUnrealizedGain : classification === "sale" ? summary.saleProfit : summary.tradeGainLoss) || 0)} /></div>{classification === "purchase" ? <p className="mt-3 rounded-xl bg-sky-50 p-3 text-xs font-bold text-sky-800">Inventory market value is {formatMoney(summary.incomingMarket)}. The {formatMoney(summary.purchaseUnrealizedGain || 0)} difference is unrealized and is not recorded as sale profit.</p> : null}</section>
      <ReviewSide title="Coming In" items={incoming} workers={workers} onEdit={setEditing} />
      <ReviewSide title="Going Out" items={outgoing} workers={workers} onEdit={setEditing} />
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-night-900"><h3 className="font-black">Final checks</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><CheckRow checked={transaction.items.every((item) => item.itemName.trim())} label="All item details complete" /><CheckRow checked={transaction.items.every(ownershipIsValid)} label="Ownership totals 100%" /><CheckRow checked={outgoing.every(hasKnownHistoricalCostBasis)} label="Outgoing cost basis complete" /><CheckRow checked={classification !== "unclassified"} label="Canonical type classified" /></div></section>
    </main>}

    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(15,23,42,.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:left-64"><div className="mx-auto flex max-w-5xl items-center gap-2"><button type="button" onClick={() => step === "review" ? setStep("build") : navigate("/sales")} disabled={busy || imageUploading} className="grid size-12 shrink-0 place-items-center rounded-xl bg-slate-100 disabled:opacity-50 dark:bg-slate-800"><ArrowLeft size={18} /></button><button type="button" onClick={() => void savePending()} disabled={busy || imageUploading || classification === "unclassified"} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-100 px-3 font-black text-amber-900 disabled:opacity-40"><Save size={17} /><span className="hidden sm:inline">Save as</span> Pending</button>{step === "build" ? <button type="button" onClick={() => { setMessage(""); setStep("review"); window.scrollTo({ top: 0, behavior: "smooth" }); }} disabled={classification === "unclassified" || busy || imageUploading} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 font-black text-white disabled:opacity-40">Review Deal <ArrowRight size={18} /></button> : <button type="button" onClick={() => void completeDeal()} disabled={busy || imageUploading} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-40"><Check size={18} /> Confirm {typeLabel(classification)}</button>}</div></div>

    <ResponsiveModal open={Boolean(editing)} title={editing?.itemName || "Deal Item"} description="Market, condition, percentage, agreed value, cost basis, ownership, and item photos remain separate." onClose={() => { setEditing(undefined); setManualSearch(false); setScanFile(undefined); }} size="lg" dismissible={!imageUploading}>
      {editing ? <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[7rem_1fr]"><div className="grid aspect-[2.5/3.5] place-items-center overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-900">{itemImage(editing) ? <img src={itemImage(editing)} alt="" className="size-full object-contain" /> : <Camera className="text-slate-400" />}</div><div className="space-y-3"><label><span className="text-xs font-black">Item name</span><input value={editing.itemName} onChange={(event) => updateItem({ ...editing, itemName: event.target.value })} className={`${inputClass} mt-1`} /></label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setManualSearch(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-100 text-sm font-black text-violet-800"><Search size={16} /> Search Cards</button><label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-black"><ScanLine size={16} /> Scan<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { setScanFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div></div></div>
        {scanFile ? <div className="rounded-2xl border border-violet-200 p-3"><CardScanPanel imageFile={scanFile} category={editing.itemType} inventory={inventory} initialGame={editing.cardGame || "pokemon"} initialLanguage={editing.cardLanguage === "ja" ? "ja" : editing.cardGame === "other" ? "unknown" : "en"} onRetakePhoto={() => setScanFile(undefined)} onApply={(suggestion) => { const item = applyCardSuggestionToItem(editing, suggestion, "scanner"); const priced = applyDealPercentage(item, editing.direction as DealSide, editing.direction === "incoming" ? 70 : 100); updateItem(priced); setScanFile(undefined); }} /></div> : null}
        <div className="grid gap-3 sm:grid-cols-2"><label><span className="text-xs font-black">Item type</span><select value={editing.itemType} onChange={(event) => updateItem({ ...editing, itemType: event.target.value as PokemonProductCategory })} className={`${inputClass} mt-1`}>{Object.entries(pokemonCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="text-xs font-black">Quantity</span><input type="number" min="1" value={editing.quantity} onChange={(event) => updateItem({ ...editing, quantity: Math.max(1, Number(event.target.value || 1)) })} className={`${inputClass} mt-1`} /></label><label><span className="text-xs font-black">Set name</span><input value={editing.cardSet || ""} onChange={(event) => updateItem({ ...editing, cardSet: event.target.value })} className={`${inputClass} mt-1`} /></label><label><span className="text-xs font-black">Collector number</span><input value={editing.cardCode || editing.collectorNumber || ""} onChange={(event) => updateItem({ ...editing, collectorNumber: event.target.value, cardCode: event.target.value })} className={`${inputClass} mt-1`} /></label></div>
        <section className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800"><div className="grid gap-3 sm:grid-cols-3"><label><span className="text-xs font-black">Raw NM market</span><input type="number" min="0" step=".01" value={editing.marketValue || ""} onChange={(event) => updateItem({ ...editing, marketValue: Number(event.target.value || 0) })} className={`${inputClass} mt-1`} /></label><label><span className="text-xs font-black">Condition</span><select value={editing.cardCondition || "Near Mint / NM"} onChange={(event) => updateItem({ ...editing, cardCondition: event.target.value as CardCondition })} className={`${inputClass} mt-1`}>{conditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}</select></label><div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900"><small className="text-slate-500">Condition-adjusted market</small><b className="mt-1 block text-lg">{formatMoney(conditionAdjustedMarket(editing.marketValue, editing.cardCondition))}</b></div></div><p className="mt-2 text-xs text-slate-500">Condition adjusts the internal reference before the percentage. LP and other condition values are internal guidance, not provider-issued official prices.</p><div className="mt-3 flex flex-wrap gap-2">{(editing.direction === "incoming" ? incomingDealPercentages : outgoingDealPercentages).map((percentage) => <button type="button" key={percentage} onClick={() => updateItem(applyDealPercentage(editing, editing.direction as DealSide, percentage))} className={`min-h-10 rounded-xl px-3 text-sm font-black ${editing.targetBuyPercentage === percentage ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>{percentage}%</button>)}<span className="inline-flex min-h-10 items-center rounded-xl border border-dashed border-slate-300 px-3 text-xs font-bold text-slate-500">Custom via agreed value</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label><span className="text-xs font-black">Percentage</span><input type="number" min="0" max="200" step=".1" value={editing.targetBuyPercentage ?? ""} onChange={(event) => updateItem(applyDealPercentage(editing, editing.direction as DealSide, Number(event.target.value || 0)))} className={`${inputClass} mt-1`} /></label><label><span className="text-xs font-black">Final agreed value</span><input type="number" min="0" step=".01" value={editing.agreedTradeValue || ""} onChange={(event) => { const agreed = Number(event.target.value || 0); updateItem(editing.direction === "incoming" ? { ...editing, agreedTradeValue: agreed, boughtPrice: agreed, costBasis: agreed } : { ...editing, agreedTradeValue: agreed, soldPrice: agreed }); }} className={`${inputClass} mt-1`} /></label></div></section>
        {editing.direction === "outgoing" ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20"><label><span className="text-xs font-black">Historical cost basis</span><input type="number" min="0" step=".01" value={editing.historicalCostBasis > 0 || editing.zeroCostBasisConfirmed ? editing.historicalCostBasis : ""} readOnly={Boolean(editing.inventoryPurchaseId && editing.historicalCostBasis > 0)} placeholder="Required" onChange={(event) => updateItem({ ...editing, historicalCostBasis: Number(event.target.value || 0), zeroCostBasisConfirmed: false })} className={`${inputClass} mt-1`} /></label>{editing.inventoryPurchaseId ? <p className="mt-1 text-xs font-bold text-amber-800 dark:text-amber-200">Loaded from canonical inventory history. Current market never replaces this value.</p> : null}{!hasKnownHistoricalCostBasis(editing) ? <button type="button" onClick={() => updateItem({ ...editing, historicalCostBasis: 0, zeroCostBasisConfirmed: true })} className="mt-2 min-h-10 w-full rounded-xl border border-amber-400 bg-white px-3 text-xs font-black text-amber-900">Confirm this item had a $0 cost basis</button> : null}</section> : null}
        <OwnershipEditor workers={workers} shares={editing.ownershipShares} totalCost={editing.direction === "outgoing" ? editing.historicalCostBasis : editing.costBasis} paidByWorkerId={transaction.paidByWorkerId} onChange={(ownershipShares: OwnershipShare[]) => updateItem({ ...editing, ownershipShares })} />
        <ImageAttachmentField label="Item Photos" description="Individual item photos are separate from the 20-photo transaction limit." attachments={(editing.images || []).filter((image) => ["item", "front", "crop"].includes(image.imageType))} imageType="front" transactionId={transaction.id} transactionItemId={editing.id} multiple maxImages={3} reusableAttachment={images[0]} onUpload={(file, imageType, onProgress, stableId, resume) => uploadImage(file, imageType, onProgress, editing.id, stableId, resume)} onChange={(next) => changeItemImages(editing, next)} onBusyChange={onImageBusyChange} retryDisabled={Boolean(draftError)} />
        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setEditing(undefined)} className="min-h-12 rounded-xl bg-slate-100 font-black dark:bg-slate-800"><Check className="mr-1 inline" size={17} /> Done</button><label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-violet-600 font-black text-white"><ScanLine size={17} /> Save & Scan Next<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) beginScan(editing.direction as DealSide, file); event.currentTarget.value = ""; }} /></label></div>
      </div> : null}
    </ResponsiveModal>

    {manualSearch && editing ? <ManualCardSearch open category={editing.itemType} initialName={editing.itemName} initialCollectorNumber={editing.cardCode || editing.collectorNumber} initialSet={editing.cardSet} initialGame={editing.cardGame} initialLanguage={editing.cardLanguage} onClose={() => setManualSearch(false)} onApply={(suggestion) => { const matched = applyCardSuggestionToItem(editing, suggestion, "manual"); updateItem(applyDealPercentage(matched, editing.direction as DealSide, editing.direction === "incoming" ? 70 : 100)); setManualSearch(false); }} /> : null}

    <ResponsiveModal open={inventoryPicker} title="Choose from Inventory" description="Only available stock appears. Selection preserves source inventory ID, historical cost basis, and ownership." onClose={() => setInventoryPicker(false)} size="lg">
      <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-[1fr_12rem]"><label className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search item, set, number, condition…" className={`${inputClass} pl-10`} /></label><select value={inventorySort} onChange={(event) => setInventorySort(event.target.value as typeof inventorySort)} className={inputClass}><option value="name">Sort: Item</option><option value="cost">Highest cost</option><option value="market">Highest market</option><option value="age">Oldest inventory</option></select></div><div className="max-h-[60dvh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800"><div className="sticky top-0 z-10 hidden grid-cols-[2rem_minmax(12rem,1fr)_6rem_6rem_5rem_7rem] gap-2 bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 sm:grid"><span /><span>Item</span><span>Cost</span><span>Market</span><span>Age</span><span>Condition</span></div>{availableInventory.map((item) => { const checked = selectedInventory.has(item.id); const days = Math.max(0, Math.floor((Date.now() - new Date(item.purchaseDate).getTime()) / 86_400_000)); return <label key={item.id} className={`grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 border-t border-slate-100 px-3 py-3 first:border-t-0 dark:border-slate-800 sm:grid-cols-[2rem_minmax(12rem,1fr)_6rem_6rem_5rem_7rem] ${checked ? "bg-violet-50 dark:bg-violet-950/20" : "bg-white dark:bg-night-900"}`}><input type="checkbox" checked={checked} onChange={() => setSelectedInventory((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className="size-5 accent-violet-600" /><span className="flex min-w-0 items-center gap-2">{item.imageUrl ? <img src={item.imageUrl} alt="" className="size-10 rounded-lg object-contain" /> : null}<span className="min-w-0"><b className="block truncate text-sm">{item.itemName}</b><small className="block truncate text-slate-500">{[item.cardSet, item.cardCode || item.collectorNumber].filter(Boolean).join(" · ")}</small></span></span><span className="text-sm font-bold">{formatMoney(item.totalCost)}</span><span className="text-sm font-bold">{formatMoney(item.marketValue || 0)}</span><span className="text-xs text-slate-500">{days}d</span><span className="text-xs font-bold">{item.cardCondition || "—"}</span></label>; })}{!availableInventory.length ? <p className="p-8 text-center text-sm font-bold text-slate-500">No available inventory matches this search.</p> : null}</div><AppButton onClick={commitInventorySelection} disabled={!selectedInventory.size} className="w-full"><PackageCheck size={17} /> Add {selectedInventory.size} selected item{selectedInventory.size === 1 ? "" : "s"}</AppButton></div>
    </ResponsiveModal>

    <ResponsiveModal open={offerMode} title="Offer Mode" description="Customer-safe view. Cost basis, ownership, profit, and acquisition details are hidden." onClose={() => setOfferMode(false)} size="lg"><div className="space-y-4"><div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800"><EyeOff size={18} /> Internal accounting is hidden in this view.</div>{summaryCard(true)}<OfferSide title="You receive" items={incoming} /><OfferSide title="You give" items={outgoing} />{transaction.cashReceived || transaction.cashPaid ? <div className="grid grid-cols-2 gap-2"><ReviewMetric label="Cash received" value={formatMoney(transaction.cashReceived)} /><ReviewMetric label="Cash paid" value={formatMoney(transaction.cashPaid)} /></div> : null}<button type="button" onClick={() => { const text = `${typeLabel(classification)} offer\nComing in: ${formatMoney(summary.incomingAgreed + transaction.cashReceived)}\nGoing out: ${formatMoney(summary.outgoingAgreed + transaction.cashPaid)}`; void navigator.clipboard?.writeText(text); setToast({ message: "Offer summary copied.", tone: "success" }); }} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-black text-white"><Copy size={17} /> Copy Offer Summary</button></div></ResponsiveModal>

    {saveStage ? <div className="fixed inset-x-3 bottom-24 z-[70] mx-auto max-w-2xl"><ProgressSteps steps={saveSteps} activeStep={saveStageIndex} complete={saveComplete} /></div> : null}
    <Toast open={Boolean(toast)} message={toast?.message || ""} tone={toast?.tone} onDismiss={() => setToast(undefined)} />
    {busy ? <LoadingOverlay label={saveStage ? saveSteps[saveStageIndex]?.label || "Saving deal" : "Saving deal"} /> : null}
  </div>;
}

function ReviewMetric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "warning" }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950"><small className="text-slate-500">{label}</small><b className={`mt-1 block text-lg ${tone === "positive" ? "text-emerald-600" : tone === "warning" ? "text-orange-600" : "text-slate-950 dark:text-white"}`}>{value}</b></div>;
}

function CheckRow({ checked, label }: { checked: boolean; label: string }) {
  return <div className={`flex items-center gap-2 rounded-xl p-3 text-sm font-bold ${checked ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"}`}>{checked ? <Check size={17} /> : <RefreshCcw size={17} />}{label}</div>;
}

function ReviewSide({ title, items, workers, onEdit }: { title: string; items: TradeItem[]; workers: Worker[]; onEdit: (item: TradeItem) => void }) {
  if (!items.length) return null;
  return <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-night-900"><h3 className="font-black">{title}</h3><div className="mt-3 space-y-2">{items.map((item) => <button type="button" key={item.id} onClick={() => onEdit(item)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl bg-slate-50 p-3 text-left dark:bg-slate-950"><span className="min-w-0"><b className="block truncate">{item.itemName}</b><small className="text-slate-500">{[item.cardSet, item.cardCondition, `Qty ${item.quantity}`].filter(Boolean).join(" · ")}</small><small className="mt-1 block text-slate-500">Ownership: {item.ownershipShares.map((share) => `${workers.find((worker) => worker.id === share.workerId)?.name || "Owner"} ${share.ownershipPercentage}%`).join(", ") || "Required"}</small></span><span className="text-right"><b className="block text-violet-700 dark:text-violet-300">{formatMoney(item.agreedTradeValue || item.soldPrice || item.boughtPrice || 0)}</b><small className="text-slate-500">Market {formatMoney(item.marketValue)}</small>{item.direction === "outgoing" ? <small className="block text-slate-500">Basis {hasKnownHistoricalCostBasis(item) ? formatMoney(item.historicalCostBasis) : "Required"}</small> : null}</span></button>)}</div></section>;
}

function OfferSide({ title, items }: { title: string; items: TradeItem[] }) {
  if (!items.length) return null;
  return <section><h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">{title}</h3><div className="space-y-2">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"><span><b className="block">{item.itemName}</b><small className="text-slate-500">{[item.cardSet, item.cardCondition].filter(Boolean).join(" · ")}</small></span><b>{formatMoney(item.agreedTradeValue || item.soldPrice || item.boughtPrice || 0)}</b></div>)}</div></section>;
}
