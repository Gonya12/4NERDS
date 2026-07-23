import {
  Camera, ClipboardPaste, Download, FileSpreadsheet, ImagePlus, PackagePlus, Receipt,
  RotateCcw, Save, SwitchCamera, Trash2, Upload, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ErrorState } from "../components/ErrorState";
import { LoadingScreen } from "../components/LoadingScreen";
import { FinancialSpreadsheet } from "../components/sales/FinancialSpreadsheet";
import { CardScanPanel } from "../components/sales/CardScanPanel";
import { BatchInventoryImporter } from "../components/sales/BatchInventoryImporter";
import { ImageLightbox } from "../components/sales/ImageLightbox";
import { RawCardCalculator } from "../components/sales/RawCardCalculator";
import { OwnershipEditor } from "../components/sales/OwnershipEditor";
import { SalesAnalyticsPanel } from "../components/sales/SalesAnalyticsPanel";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { deleteBusinessExpense, getCachedBusinessExpenses, listBusinessExpenses, saveBusinessExpense } from "../services/database/businessExpenseRepository";
import { deleteInventoryPurchase, getCachedInventoryPurchases, listInventoryPurchases, saveInventoryPurchase } from "../services/database/inventoryPurchaseRepository";
import { createSaleRecord, deleteSaleRecord, getCachedSalesRecords, listSalesRecordsPage, saveSaleRecord, syncPendingSales } from "../services/database/salesRepository";
import { listWorkers } from "../services/database/workerRepository";
import { listOwnershipShares, saveInventoryOwnership, saveSaleOwnership } from "../services/database/ownershipRepository";
import { compressSaleImage, imageFromClipboard } from "../services/images/saleImageService";
import { listPlannerEventOptions } from "../services/planner/plannerRepository";
import { downloadFinancialWorkbook, type ExcelExportScope } from "../services/sales/excelExportService";
import { loadDefaultRawBuyPercentage, saveDefaultRawBuyPercentage } from "../services/sales/salesPreferences";
import type {
  BusinessExpense, BusinessExpenseCategory, Event, InventoryPurchase, InventoryStatus, OwnershipShare,
  PokemonProductCategory, PurchaseSource, SalePaymentMethod, SalesRecord, Worker
} from "../types/models";
import { safeDateFromLocalInput } from "../utils/browserCompat";
import { eventDays, shortScheduleSummary } from "../utils/eventSchedule";
import { filterFinancialRecords, type FinancialDateRange } from "../utils/financialDateRange";
import { formatMoney, roundMoney } from "../utils/paymentMath";
import {
  expenseCategoryLabels, inventoryStatusForQuantity, inventoryStatusLabels, paymentMethodLabels,
  pokemonCategoryLabels, purchaseSourceLabels, selectedEventCost
} from "../utils/salesControl";
import { actionCooldownRemainingSeconds, canRunAction, markActionRun, recordPageLoad } from "../utils/supabase";

type Editor = "sale" | "purchase" | "expense" | null;

const categoryOptions = Object.entries(pokemonCategoryLabels) as [PokemonProductCategory, string][];
const sourceOptions = Object.entries(purchaseSourceLabels) as [PurchaseSource, string][];
const paymentOptions = Object.entries(paymentMethodLabels) as [SalePaymentMethod, string][];
const inventoryStatusOptions = Object.entries(inventoryStatusLabels) as [InventoryStatus, string][];
const expenseOptions = Object.entries(expenseCategoryLabels) as [BusinessExpenseCategory, string][];

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function isoDay(value: string) {
  return value.slice(0, 10);
}

function todayEventMatches(events: Event[]) {
  const today = new Date().toISOString().slice(0, 10);
  return events.filter((event) => eventDays(event).some((day) => day.date.slice(0, 10) === today));
}

function todayDayId(event?: Event) {
  const today = new Date().toISOString().slice(0, 10);
  return event ? eventDays(event).find((day) => day.date.slice(0, 10) === today)?.id || "" : "";
}

function compactInputClass() {
  return "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-ink outline-none transition focus:border-coral dark:border-slate-800 dark:bg-slate-950 dark:text-white";
}

function moneyInput(value: string, onChange: (value: string) => void, placeholder: string) {
  return <input type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={compactInputClass()} />;
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 8_000) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(`${label} timed out. Cached data is still available.`)), timeoutMs))
  ]);
}

export function SalesControlPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const requestedEventId = params.get("eventId") || "";
  const cachedSales = getCachedSalesRecords();
  const cachedPurchases = getCachedInventoryPurchases();
  const cachedExpenses = getCachedBusinessExpenses();
  const [editor, setEditor] = useState<Editor>(null);
  const [sales, setSales] = useState<SalesRecord[]>(cachedSales);
  const [purchases, setPurchases] = useState<InventoryPurchase[]>(cachedPurchases);
  const [expenses, setExpenses] = useState<BusinessExpense[]>(cachedExpenses);
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [editingSale, setEditingSale] = useState<SalesRecord>();
  const [editingPurchase, setEditingPurchase] = useState<InventoryPurchase>();
  const [editingExpense, setEditingExpense] = useState<BusinessExpense>();
  const [loading, setLoading] = useState(!cachedSales.length && !cachedPurchases.length && !cachedExpenses.length);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [imageFile, setImageFile] = useState<File>();
  const [backImageFile, setBackImageFile] = useState<File>();
  const [backPreviewUrl, setBackPreviewUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMode, setCameraMode] = useState(false);
  const [cameraSwitching, setCameraSwitching] = useState(false);
  const [imageStatus, setImageStatus] = useState("");
  const [imageRemoved, setImageRemoved] = useState(false);
  const [largePreviewOpen, setLargePreviewOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMoreSales, setHasMoreSales] = useState(false);
  const [salesPage, setSalesPage] = useState(0);
  const [dateRange, setDateRange] = useState<FinancialDateRange>("this_month");
  const [customStart, setCustomStart] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));
  const [mobileSpreadsheetOpen, setMobileSpreadsheetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExcelExportScope>("all");
  const [exportEventId, setExportEventId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const defaultBuyPercentage = loadDefaultRawBuyPercentage();

  const blankSale = () => ({
    eventId: "", eventDayId: "", itemName: "", category: "raw_card" as PokemonProductCategory,
    quantity: "1", soldPrice: "", boughtPrice: "", marketValue: "", boughtFrom: "",
    purchaseSource: "" as PurchaseSource | "", paymentMethod: "cash" as SalePaymentMethod,
    soldByWorkerId: "", isRawCard: true, buyPercentage: String(defaultBuyPercentage),
    inventoryPurchaseId: "", notes: "", soldAt: localDateTime(), ownershipShares: [] as OwnershipShare[]
  });
  const blankPurchase = () => ({
    itemName: "", category: "raw_card" as PokemonProductCategory, quantity: "1", purchaseDate: localDateTime(),
    totalCost: "", marketValue: "", isRawCard: true, buyPercentage: String(defaultBuyPercentage),
    purchaseSource: "" as PurchaseSource | "", seller: "", eventId: "", purchasedByWorkerId: "",
    notes: "", status: "in_stock" as InventoryStatus, quantitySold: "0", soldPrice: "", soldDate: "",
    soldByWorkerId: "", soldEventId: "", soldPaymentMethod: "cash" as SalePaymentMethod, buyerNote: "",
    cardName: "", collectorNumber: "", cardSet: "", cardLanguage: "", cardCondition: "", stickerPrice: "",
    gradingCompany: "", grade: "", certificateNumber: "", scanConfidence: "", scanStatus: "not_scanned", imageHash: "", scanResult: undefined as Record<string, unknown> | undefined,
    ownershipShares: [] as OwnershipShare[]
  });
  const blankExpense = () => ({
    expenseDate: localDateTime(), amount: "", category: "other" as BusinessExpenseCategory,
    description: "", eventId: "", paidByWorkerId: "", vendor: "", notes: ""
  });
  const [saleForm, setSaleForm] = useState(blankSale);
  const [purchaseForm, setPurchaseForm] = useState(blankPurchase);
  const [expenseForm, setExpenseForm] = useState(blankExpense);

  async function loadData() {
    recordPageLoad("Sales Control");
    setSyncing(true);
    setLoadError("");
    const results = await Promise.allSettled([
      withTimeout(listSalesRecordsPage(0, 50), "Sales"),
      withTimeout(listInventoryPurchases(100), "Inventory purchases"),
      withTimeout(listBusinessExpenses(100), "Expenses"),
      withTimeout(listPlannerEventOptions(500), "Events"),
      withTimeout(listWorkers(), "Workers"),
      withTimeout(listOwnershipShares(), "Ownership")
    ]);
    const errors: string[] = [];
    const ownership = results[5].status === "fulfilled" ? results[5].value : { inventory: new Map<string, OwnershipShare[]>(), sales: new Map<string, OwnershipShare[]>() };
    if (results[0].status === "fulfilled") { setSales(results[0].value.records.map((sale) => ({ ...sale, ownershipShares: ownership.sales.get(sale.id) || [] }))); setHasMoreSales(results[0].value.hasMore); setSalesPage(0); } else errors.push(`Sales: ${String(results[0].reason?.message || results[0].reason)}`);
    if (results[1].status === "fulfilled") setPurchases(results[1].value.map((purchase) => ({ ...purchase, ownershipShares: ownership.inventory.get(purchase.id) || [] }))); else errors.push(`Inventory purchases: ${String(results[1].reason?.message || results[1].reason)}`);
    if (results[2].status === "fulfilled") setExpenses(results[2].value); else errors.push(`Expenses: ${String(results[2].reason?.message || results[2].reason)}`);
    const eventRows = results[3].status === "fulfilled" ? results[3].value : [];
    if (results[3].status === "fulfilled") setEvents(eventRows); else errors.push(`Events: ${String(results[3].reason?.message || results[3].reason)}`);
    if (results[4].status === "fulfilled") setWorkers(results[4].value); else errors.push(`Workers: ${String(results[4].reason?.message || results[4].reason)}`);
    if (results[5].status === "rejected") errors.push(`Ownership: ${String(results[5].reason?.message || results[5].reason)}`);
    if (errors.length) setLoadError(errors.join("\n"));
    setLoading(false);
    setSyncing(false);
    if (new URLSearchParams(location.search).get("mode") === "sale" && !editor) openSale(undefined, eventRows);
  }

  useEffect(() => { void loadData(); }, [location.search]);
  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (!cameraMode) return;
    const frame = window.requestAnimationFrame(() => void startCamera(facingMode));
    return () => { window.cancelAnimationFrame(frame); stopCamera(); };
  }, [cameraMode]);

  function cleanPreview() {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setImageFile(undefined);
    if (backPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(backPreviewUrl);
    setBackImageFile(undefined);
    setBackPreviewUrl("");
    setCameraError("");
    setImageStatus("");
    setImageRemoved(false);
    setLargePreviewOpen(false);
  }

  function closeEditor() {
    stopCamera();
    setCameraMode(false);
    cleanPreview();
    setEditor(null);
    setEditingSale(undefined);
    setEditingPurchase(undefined);
    setEditingExpense(undefined);
  }

  function openSale(sale?: SalesRecord, availableEvents = events) {
    cleanPreview();
    setEditingSale(sale);
    const requested = requestedEventId ? availableEvents.find((event) => event.id === requestedEventId) : undefined;
    const todayMatches = todayEventMatches(availableEvents);
    const automaticEvent = requested || (todayMatches.length === 1 ? todayMatches[0] : undefined);
    setSaleForm(sale ? {
      eventId: sale.eventId || "", eventDayId: sale.eventDayId || "", itemName: sale.itemName || "",
      category: sale.category || "raw_card", quantity: String(sale.quantity || 1), soldPrice: sale.soldPrice === undefined ? "" : String(sale.soldPrice),
      boughtPrice: sale.boughtPrice === undefined ? "" : String(sale.boughtPrice), marketValue: sale.marketValue === undefined ? "" : String(sale.marketValue),
      boughtFrom: sale.boughtFrom || "", purchaseSource: sale.purchaseSource || "", paymentMethod: sale.paymentMethod || "cash",
      soldByWorkerId: sale.soldByWorkerId || "", isRawCard: sale.isRawCard, buyPercentage: String(sale.buyPercentage || defaultBuyPercentage),
      inventoryPurchaseId: sale.inventoryPurchaseId || "", notes: sale.notes || "", soldAt: sale.soldAt.slice(0, 16), ownershipShares: sale.ownershipShares || []
    } : { ...blankSale(), eventId: automaticEvent?.id || "", eventDayId: todayDayId(automaticEvent) });
    setPreviewUrl(sale?.imageUrl || "");
    setEditor("sale");
  }

  function openPurchase(purchase?: InventoryPurchase) {
    cleanPreview();
    setEditingPurchase(purchase);
    setPurchaseForm(purchase ? {
      itemName: purchase.itemName, category: purchase.category, quantity: String(purchase.quantity), purchaseDate: purchase.purchaseDate.slice(0, 16),
      totalCost: String(purchase.totalCost), marketValue: purchase.marketValue === undefined ? "" : String(purchase.marketValue), isRawCard: purchase.isRawCard,
      buyPercentage: String(purchase.buyPercentage || defaultBuyPercentage), purchaseSource: purchase.purchaseSource || "", seller: purchase.seller || "",
      eventId: purchase.eventId || "", purchasedByWorkerId: purchase.purchasedByWorkerId || "", notes: purchase.notes || "", status: purchase.status,
      quantitySold: String(purchase.quantitySold || 0), soldPrice: purchase.soldPrice === undefined ? "" : String(purchase.soldPrice),
      soldDate: purchase.soldDate?.slice(0, 16) || "", soldByWorkerId: purchase.soldByWorkerId || "", soldEventId: purchase.soldEventId || "",
      soldPaymentMethod: purchase.soldPaymentMethod || "cash", buyerNote: purchase.buyerNote || ""
      , cardName: purchase.cardName || "", collectorNumber: purchase.collectorNumber || "", cardSet: purchase.cardSet || "",
      cardLanguage: purchase.cardLanguage || "", cardCondition: purchase.cardCondition || "", stickerPrice: purchase.stickerPrice === undefined ? "" : String(purchase.stickerPrice),
      gradingCompany: purchase.gradingCompany || "", grade: purchase.grade || "", certificateNumber: purchase.certificateNumber || "",
      scanConfidence: purchase.scanConfidence || "", scanStatus: purchase.scanStatus || "not_scanned", imageHash: purchase.imageHash || "", scanResult: purchase.scanResult,
      ownershipShares: purchase.ownershipShares || []
    } : blankPurchase());
    setPreviewUrl(purchase?.imageUrl || "");
    setBackPreviewUrl(purchase?.backImageUrl || "");
    setEditor("purchase");
  }

  function openExpense(expense?: BusinessExpense) {
    cleanPreview();
    setEditingExpense(expense);
    setExpenseForm(expense ? {
      expenseDate: expense.expenseDate.slice(0, 16), amount: String(expense.amount), category: expense.category,
      description: expense.description, eventId: expense.eventId || "", paidByWorkerId: expense.paidByWorkerId || "",
      vendor: expense.vendor || "", notes: expense.notes || ""
    } : blankExpense());
    setPreviewUrl(expense?.receiptImageUrl || "");
    setEditor("expense");
  }

  async function pickFile(file?: File) {
    if (!file) return;
    stopCamera();
    setCameraMode(false);
    setImageStatus("Compressing image...");
    try {
      const compressed = await compressSaleImage(file);
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setImageFile(compressed);
      setImageRemoved(false);
      setPreviewUrl(URL.createObjectURL(compressed));
      setImageStatus(`Ready to upload on Save · ${(compressed.size / 1024).toFixed(0)} KB`);
    } catch (error) {
      setImageStatus(error instanceof Error ? error.message : "Could not prepare image.");
    }
  }

  function removeImage() {
    stopCamera();
    setCameraMode(false);
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setImageFile(undefined);
    setImageRemoved(true);
    setImageStatus("Image will be removed when you save.");
  }

  function handleEditorPaste(event: React.ClipboardEvent) {
    if (event.defaultPrevented) return;
    const file = imageFromClipboard(event);
    if (!file) {
      if (!(event.target as HTMLElement).closest("input,textarea,[contenteditable='true']")) setImageStatus("No image found in the clipboard.");
      return;
    }
    event.preventDefault();
    void pickFile(file);
  }

  async function pasteImageFromClipboard() {
    if (!window.isSecureContext || !navigator.clipboard?.read) {
      setImageStatus("Clipboard images are unavailable here. Use Take Photo or Upload Image instead.");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => ["image/png", "image/jpeg", "image/webp"].includes(value));
        if (type) {
          const blob = await item.getType(type);
          await pickFile(new File([blob], `pasted-${Date.now()}.${type.split("/")[1]}`, { type }));
          return;
        }
      }
      setImageStatus("No image found in the clipboard.");
    } catch {
      setImageStatus("Clipboard access was blocked. Press Ctrl+V in this form, or use Take Photo or Upload Image.");
    }
  }

  async function startCamera(mode: "environment" | "user" = facingMode) {
    stopCamera();
    setCameraReady(false);
    setCameraError("");
    if (!window.isSecureContext) { setCameraError("Camera requires a secure HTTPS connection. Use Upload instead."); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("Camera is not available. Use Upload instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode } }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("Camera preview is unavailable.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraReady(true);
    } catch (error) {
      stopCamera();
      const name = error instanceof DOMException ? error.name : "";
      setCameraError(name === "NotAllowedError"
        ? "Camera permission was denied. Enable camera access or upload an image."
        : name === "NotReadableError"
          ? "The camera may be in use by another app. Close it there or use Upload."
          : "Camera is not available. Use Upload instead.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setCameraError("Camera is still starting. Try Capture again in a moment.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) { setCameraError("Could not capture the photo."); return; }
    await pickFile(new File([blob], `sale-${Date.now()}.jpg`, { type: "image/jpeg" }));
  }

  function enterCameraMode() {
    setCameraMode(true);
    setCameraError("");
  }

  async function switchCamera() {
    if (cameraSwitching) return;
    setCameraSwitching(true);
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    try { await startCamera(next); } finally { setCameraSwitching(false); }
  }

  async function saveSale() {
    if (saleForm.soldPrice === "" || !saleForm.soldAt) { setMessage("Sold price and date sold are required."); return; }
    if ([saleForm.soldPrice, saleForm.boughtPrice, saleForm.marketValue].some((value) => value !== "" && Number(value) < 0)) { setMessage("Prices cannot be negative."); return; }
    const saleOwnershipTotal = saleForm.ownershipShares.reduce((sum, share) => sum + share.ownershipPercentage, 0);
    if (!saleForm.inventoryPurchaseId && saleForm.ownershipShares.length && Math.abs(saleOwnershipTotal - 100) > 0.001) { setMessage("Profit ownership percentages must total 100%."); return; }
    setBusy(true); setMessage("");
    try {
      const market = saleForm.marketValue === "" ? undefined : Number(saleForm.marketValue);
      const percentage = saleForm.buyPercentage === "" ? undefined : Number(saleForm.buyPercentage);
      if (percentage) saveDefaultRawBuyPercentage(percentage);
      const input: Partial<SalesRecord> = {
        id: editingSale?.id, eventId: saleForm.eventId || undefined, eventDayId: saleForm.eventDayId || undefined,
        imageUrl: imageRemoved ? undefined : editingSale?.imageUrl, imagePath: imageRemoved ? undefined : editingSale?.imagePath, itemName: saleForm.itemName.trim() || undefined,
        category: saleForm.category, quantity: Math.max(1, Number(saleForm.quantity || 1)), soldPrice: Number(saleForm.soldPrice),
        boughtPrice: saleForm.boughtPrice === "" ? undefined : Number(saleForm.boughtPrice), marketValue: market,
        boughtFrom: saleForm.boughtFrom.trim() || undefined, purchaseSource: saleForm.purchaseSource || undefined,
        paymentMethod: saleForm.paymentMethod, soldByWorkerId: saleForm.soldByWorkerId || undefined, isRawCard: saleForm.isRawCard,
        buyPercentage: saleForm.isRawCard ? percentage : undefined, targetBuyPrice: saleForm.isRawCard && market && percentage ? roundMoney(market * percentage / 100) : undefined,
        inventoryPurchaseId: saleForm.inventoryPurchaseId || undefined, notes: saleForm.notes.trim() || undefined,
        soldAt: safeDateFromLocalInput(saleForm.soldAt).toISOString(), createdAt: editingSale?.createdAt,
        ownershipShares: saleForm.inventoryPurchaseId ? [] : saleForm.ownershipShares
      };
      const saved = editingSale && !imageFile
        ? await saveSaleRecord({ ...editingSale, ...input, quantity: input.quantity || 1, isRawCard: Boolean(input.isRawCard), pendingUpload: editingSale.pendingUpload } as SalesRecord)
        : (await createSaleRecord(input, imageFile)).sale;
      if (!saved.inventoryPurchaseId) await saveSaleOwnership(saved.id, saleForm.ownershipShares);
      const savedWithOwnership = { ...saved, ownershipShares: saved.inventoryPurchaseId ? [] : saleForm.ownershipShares };
      setSales((current) => [savedWithOwnership, ...current.filter((row) => row.id !== saved.id)]);
      if (saved.inventoryPurchaseId) {
        const linked = purchases.find((purchase) => purchase.id === saved.inventoryPurchaseId);
        if (linked && linked.status !== "personal") {
          const linkedSales = [...sales.filter((row) => row.id !== saved.id), saved].filter((row) => row.inventoryPurchaseId === linked.id);
          const soldQuantity = Math.min(linked.quantity, linkedSales.reduce((sum, row) => sum + Number(row.quantity || 1), 0));
          const soldTotal = roundMoney(linkedSales.reduce((sum, row) => sum + Number(row.soldPrice || 0), 0));
          const latestSale = [...linkedSales].sort((a, b) => b.soldAt.localeCompare(a.soldAt))[0];
          const updated = await saveInventoryPurchase({
            ...linked,
            status: inventoryStatusForQuantity(linked.quantity, soldQuantity),
            quantitySold: soldQuantity,
            soldPrice: soldTotal,
            soldDate: latestSale?.soldAt,
            soldByWorkerId: latestSale?.soldByWorkerId,
            soldEventId: latestSale?.eventId,
            soldPaymentMethod: latestSale?.paymentMethod
          });
          setPurchases((current) => current.map((row) => row.id === updated.id ? { ...updated, ownershipShares: linked.ownershipShares } : row));
        }
      }
      setMessage("Sale saved."); closeEditor();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save sale."); } finally { setBusy(false); }
  }

  async function savePurchase() {
    if (!purchaseForm.itemName.trim() || purchaseForm.totalCost === "") { setMessage("Item name and total cost are required."); return; }
    const duplicateCertificate = purchaseForm.certificateNumber.trim() && purchases.some((purchase) => purchase.id !== editingPurchase?.id && purchase.certificateNumber?.trim().toLowerCase() === purchaseForm.certificateNumber.trim().toLowerCase());
    if (duplicateCertificate && !window.confirm("Possible duplicate slab certificate. Save anyway?")) return;
    if ([purchaseForm.totalCost, purchaseForm.marketValue, purchaseForm.soldPrice].some((value) => value !== "" && Number(value) < 0)) { setMessage("Prices cannot be negative."); return; }
    const quantity = Math.max(1, Number(purchaseForm.quantity || 1));
    const requestedSoldQuantity = Math.max(0, Number(purchaseForm.quantitySold || 0));
    if (requestedSoldQuantity > quantity) { setMessage("Quantity sold cannot be greater than the quantity purchased."); return; }
    if (requestedSoldQuantity > 0 && (purchaseForm.soldPrice === "" || !purchaseForm.soldDate)) { setMessage("Sold price and sold date are required when inventory is marked sold."); return; }
    const ownershipTotal = purchaseForm.ownershipShares.reduce((sum, share) => sum + share.ownershipPercentage, 0);
    if (purchaseForm.ownershipShares.some((share) => share.ownershipPercentage < 0) || (purchaseForm.ownershipShares.length && Math.abs(ownershipTotal - 100) > 0.001)) { setMessage("Ownership percentages cannot be negative and must total 100%."); return; }
    setBusy(true); setMessage("");
    try {
      const market = purchaseForm.marketValue === "" ? undefined : Number(purchaseForm.marketValue);
      const percentage = purchaseForm.buyPercentage === "" ? undefined : Number(purchaseForm.buyPercentage);
      if (percentage) saveDefaultRawBuyPercentage(percentage);
      const linkedSales = editingPurchase ? sales.filter((sale) => sale.inventoryPurchaseId === editingPurchase.id) : [];
      const linkedQuantity = linkedSales.reduce((sum, sale) => sum + Number(sale.quantity || 1), 0);
      const quantitySold = Math.min(quantity, Math.max(requestedSoldQuantity, linkedQuantity));
      const saved = await saveInventoryPurchase({
        ...editingPurchase, imageUrl: imageRemoved ? undefined : editingPurchase?.imageUrl, imagePath: imageRemoved ? undefined : editingPurchase?.imagePath, itemName: purchaseForm.itemName, category: purchaseForm.category, quantity,
        purchaseDate: safeDateFromLocalInput(purchaseForm.purchaseDate).toISOString(), totalCost: Number(purchaseForm.totalCost), marketValue: market,
        isRawCard: purchaseForm.isRawCard, buyPercentage: purchaseForm.isRawCard ? percentage : undefined,
        targetBuyPrice: purchaseForm.isRawCard && market && percentage ? roundMoney(market * percentage / 100) : undefined,
        purchaseSource: purchaseForm.purchaseSource || undefined, seller: purchaseForm.seller, eventId: purchaseForm.eventId || undefined,
        purchasedByWorkerId: purchaseForm.purchasedByWorkerId || undefined, notes: purchaseForm.notes,
        status: purchaseForm.status === "personal" ? "personal" : inventoryStatusForQuantity(quantity, quantitySold), quantitySold,
        soldPrice: quantitySold ? Number(purchaseForm.soldPrice || linkedSales.reduce((sum, sale) => sum + Number(sale.soldPrice || 0), 0)) : undefined,
        soldDate: quantitySold && purchaseForm.soldDate ? safeDateFromLocalInput(purchaseForm.soldDate).toISOString() : linkedSales[0]?.soldAt,
        soldByWorkerId: purchaseForm.soldByWorkerId || undefined, soldEventId: purchaseForm.soldEventId || undefined,
        soldPaymentMethod: quantitySold ? purchaseForm.soldPaymentMethod : undefined, buyerNote: purchaseForm.buyerNote || undefined
        , cardName: purchaseForm.cardName || undefined, collectorNumber: purchaseForm.collectorNumber || undefined,
        cardSet: purchaseForm.cardSet || undefined, cardLanguage: purchaseForm.cardLanguage || undefined,
        cardCondition: purchaseForm.cardCondition as InventoryPurchase["cardCondition"] || undefined,
        stickerPrice: purchaseForm.stickerPrice === "" ? undefined : Number(purchaseForm.stickerPrice),
        gradingCompany: purchaseForm.gradingCompany || undefined, grade: purchaseForm.grade || undefined,
        certificateNumber: purchaseForm.certificateNumber || undefined, scanConfidence: purchaseForm.scanConfidence as InventoryPurchase["scanConfidence"] || undefined,
        scanStatus: (purchaseForm.scanStatus === "needs_review" ? "imported" : purchaseForm.scanStatus) as InventoryPurchase["scanStatus"], imageHash: purchaseForm.imageHash || undefined, scanResult: purchaseForm.scanResult,
        ownershipShares: purchaseForm.ownershipShares
      }, imageFile, backImageFile);
      await saveInventoryOwnership(saved.id, purchaseForm.ownershipShares);
      const savedWithOwnership = { ...saved, ownershipShares: purchaseForm.ownershipShares };
      setPurchases((current) => [savedWithOwnership, ...current.filter((row) => row.id !== saved.id)]);
      if (quantitySold > 0 && linkedSales.length === 0) {
        const sale = (await createSaleRecord({
          itemName: saved.itemName,
          category: saved.category,
          quantity: quantitySold,
          soldPrice: Number(purchaseForm.soldPrice),
          boughtPrice: roundMoney(saved.totalCost / saved.quantity * quantitySold),
          marketValue: saved.marketValue,
          paymentMethod: purchaseForm.soldPaymentMethod,
          soldByWorkerId: purchaseForm.soldByWorkerId || undefined,
          eventId: purchaseForm.soldEventId || undefined,
          inventoryPurchaseId: saved.id,
          isRawCard: saved.isRawCard,
          notes: purchaseForm.buyerNote || undefined,
          soldAt: safeDateFromLocalInput(purchaseForm.soldDate).toISOString()
        })).sale;
        setSales((current) => [sale, ...current]);
      } else if (quantitySold > 0 && linkedSales.length === 1) {
        const currentSale = linkedSales[0];
        const sale = await saveSaleRecord({
          ...currentSale,
          itemName: saved.itemName,
          category: saved.category,
          quantity: quantitySold,
          soldPrice: Number(purchaseForm.soldPrice || currentSale.soldPrice || 0),
          boughtPrice: roundMoney(saved.totalCost / saved.quantity * quantitySold),
          paymentMethod: purchaseForm.soldPaymentMethod,
          soldByWorkerId: purchaseForm.soldByWorkerId || undefined,
          eventId: purchaseForm.soldEventId || undefined,
          notes: purchaseForm.buyerNote || currentSale.notes,
          soldAt: purchaseForm.soldDate ? safeDateFromLocalInput(purchaseForm.soldDate).toISOString() : currentSale.soldAt,
          updatedAt: new Date().toISOString()
        });
        setSales((current) => [sale, ...current.filter((row) => row.id !== sale.id)]);
      }
      setMessage(linkedSales.length > 1 ? "Inventory saved. Existing linked sales were preserved as the detailed sale history." : "Inventory purchase saved."); closeEditor();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save purchase."); } finally { setBusy(false); }
  }

  async function saveExpense() {
    if (expenseForm.amount === "" || !expenseForm.expenseDate) { setMessage("Amount and date are required."); return; }
    if (Number(expenseForm.amount) < 0) { setMessage("Expense amount cannot be negative."); return; }
    setBusy(true); setMessage("");
    try {
      const duplicate = expenseForm.category === "event_table_fee" && expenseForm.eventId && selectedEventCost(events.find((event) => event.id === expenseForm.eventId) as Event) > 0;
      const saved = await saveBusinessExpense({
        ...editingExpense, receiptImageUrl: imageRemoved ? undefined : editingExpense?.receiptImageUrl, receiptImagePath: imageRemoved ? undefined : editingExpense?.receiptImagePath, expenseDate: safeDateFromLocalInput(expenseForm.expenseDate).toISOString(), amount: Number(expenseForm.amount),
        category: expenseForm.category, description: expenseForm.description, eventId: expenseForm.eventId || undefined,
        paidByWorkerId: expenseForm.paidByWorkerId || undefined, vendor: expenseForm.vendor, notes: expenseForm.notes
      }, imageFile);
      setExpenses((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setMessage(duplicate ? "Expense saved. Warning: this event already has a table cost, so reports will count the event cost only once." : "Expense saved.");
      closeEditor();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save expense."); } finally { setBusy(false); }
  }

  async function syncPending() {
    if (!canRunAction("sales-sync-pending", 45_000)) { setMessage(`Please wait ${actionCooldownRemainingSeconds("sales-sync-pending", 45_000)}s before syncing again.`); return; }
    markActionRun("sales-sync-pending");
    const result = await syncPendingSales();
    setMessage(`Synced ${result.synced}. Pending ${result.failed}.`);
    await loadData();
  }

  async function loadMoreSales() {
    const nextPage = salesPage + 1;
    const [result, ownership] = await Promise.all([listSalesRecordsPage(nextPage, 50), listOwnershipShares()]);
    setSales((current) => [...current, ...result.records.map((sale) => ({ ...sale, ownershipShares: ownership.sales.get(sale.id) || [] }))]);
    setSalesPage(nextPage);
    setHasMoreSales(result.hasMore);
  }

  const eventMap = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const workerMap = useMemo(() => new Map(workers.map((worker) => [worker.id, worker])), [workers]);
  const selectedSaleEvent = events.find((event) => event.id === saleForm.eventId);
  const selectedLinkedPurchase = purchases.find((purchase) => purchase.id === saleForm.inventoryPurchaseId);
  const selectedExpenseEvent = events.find((event) => event.id === expenseForm.eventId);
  const duplicateExpenseWarning = expenseForm.category === "event_table_fee" && selectedExpenseEvent && selectedEventCost(selectedExpenseEvent) > 0;

  function imageActions(label: string) {
    const pasteSupported = window.isSecureContext && Boolean(navigator.clipboard?.read);
    return <div tabIndex={0} onPaste={(event) => { const file = imageFromClipboard(event); if (file) { event.preventDefault(); void pickFile(file); } }} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
      <div><p className="font-black text-ink dark:text-white">{label}</p><p className="text-xs text-slate-500">Take, upload, or paste a photo. You can also continue without one.</p></div>
      {cameraMode ? <>
        <div className="relative mx-auto flex aspect-[3/4] max-h-[50dvh] min-h-56 w-full max-w-sm items-center justify-center overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} playsInline muted className={`size-full object-contain ${cameraReady ? "block" : "invisible"}`} />
          {!cameraReady ? <div className="absolute inset-0 flex items-center justify-center p-5 text-center text-sm font-bold text-white">{cameraError || "Starting camera…"}</div> : null}
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button type="button" onClick={() => void capturePhoto()} disabled={!cameraReady || cameraSwitching} className="min-h-11 rounded-xl bg-coral px-3 text-sm font-black text-white disabled:opacity-50"><Camera className="mr-1 inline" size={16} /> Capture</button>
          <button type="button" onClick={() => void switchCamera()} disabled={!cameraReady || cameraSwitching} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black disabled:opacity-50 dark:bg-slate-800"><SwitchCamera className="mr-1 inline" size={16} /> {cameraSwitching ? "Switching…" : "Switch Camera"}</button>
          <button type="button" onClick={() => { stopCamera(); setCameraMode(false); setCameraError(""); }} className="col-span-2 min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black sm:col-span-1 dark:bg-slate-800"><X className="mr-1 inline" size={16} /> Cancel Camera</button>
        </div>
      </> : previewUrl ? <>
        <button type="button" onClick={() => setLargePreviewOpen(true)} className="block w-full overflow-hidden rounded-xl bg-white dark:bg-slate-900"><img src={previewUrl} alt={`${label} preview`} loading="lazy" className="mx-auto max-h-[360px] w-full object-contain" /></button>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button type="button" onClick={enterCameraMode} className="min-h-11 rounded-xl bg-slate-200 px-2 text-sm font-black dark:bg-slate-800"><RotateCcw className="mr-1 inline" size={15} /> Retake</button>
          <button type="button" onClick={() => inputRef.current?.click()} className="min-h-11 rounded-xl bg-slate-200 px-2 text-sm font-black dark:bg-slate-800"><ImagePlus className="mr-1 inline" size={15} /> Replace</button>
          <button type="button" onClick={removeImage} className="min-h-11 rounded-xl bg-rose-100 px-2 text-sm font-black text-rose-700 dark:bg-rose-950/40"><Trash2 className="mr-1 inline" size={15} /> Remove</button>
          <button type="button" onClick={removeImage} className="min-h-11 rounded-xl bg-slate-200 px-2 text-sm font-black dark:bg-slate-800">Continue Without Photo</button>
        </div>
      </> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button type="button" onClick={enterCameraMode} className="min-h-11 rounded-xl bg-coral px-2 text-sm font-black text-white"><Camera className="mr-1 inline" size={15} /> Take Photo</button>
        <button type="button" onClick={() => inputRef.current?.click()} className="min-h-11 rounded-xl bg-slate-200 px-2 text-sm font-black dark:bg-slate-800"><Upload className="mr-1 inline" size={15} /> Upload</button>
        {pasteSupported ? <button type="button" onClick={() => void pasteImageFromClipboard()} className="min-h-11 rounded-xl bg-slate-200 px-2 text-sm font-black dark:bg-slate-800"><ClipboardPaste className="mr-1 inline" size={15} /> Paste Image</button> : <button type="button" onClick={() => inputRef.current?.click()} className="min-h-11 rounded-xl bg-slate-200 px-2 text-sm font-black dark:bg-slate-800">Upload Fallback</button>}
        <button type="button" onClick={() => { stopCamera(); setImageStatus("Continuing without a photo."); }} className="min-h-11 rounded-xl bg-slate-200 px-2 text-sm font-black dark:bg-slate-800">Continue Without Photo</button>
      </div>}
      {cameraError && !cameraMode ? <p role="alert" className="text-xs font-bold text-rose-600">{cameraError}</p> : null}
      {imageStatus ? <p role="status" className="text-xs font-bold text-slate-600 dark:text-slate-300">{imageStatus}</p> : null}
    </div>;
  }

  function exportData() {
    const rows = [
      ["Type", "Date", "Item / Description", "Category", "Revenue", "Cost", "Event", "Worker"],
      ...sales.map((sale) => ["Sale", sale.soldAt, sale.itemName || "", pokemonCategoryLabels[sale.category || "other_pokemon_product"], sale.soldPrice || 0, sale.boughtPrice || 0, eventMap.get(sale.eventId || "")?.name || "", workerMap.get(sale.soldByWorkerId || "")?.name || ""]),
      ...purchases.map((purchase) => ["Inventory Purchase", purchase.purchaseDate, purchase.itemName, pokemonCategoryLabels[purchase.category], "", purchase.totalCost, eventMap.get(purchase.eventId || "")?.name || "", workerMap.get(purchase.purchasedByWorkerId || "")?.name || ""]),
      ...expenses.map((expense) => ["Expense", expense.expenseDate, expense.description, expenseCategoryLabels[expense.category], "", expense.amount, eventMap.get(expense.eventId || "")?.name || "", workerMap.get(expense.paidByWorkerId || "")?.name || ""])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `4-nerds-finances-${isoDay(new Date().toISOString())}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  async function exportExcel() {
    setExporting(true);
    setMessage("");
    try {
      const dateFiltered = filterFinancialRecords(sales, purchases, expenses, events, dateRange, customStart, customEnd);
      const data = exportScope === "filtered" || exportScope === "date_range" ? dateFiltered : { sales, purchases, expenses, events };
      const scoped = exportScope === "sales" ? { ...data, purchases: [], expenses: [] }
        : exportScope === "inventory" ? { ...data, sales: [], expenses: [] }
        : exportScope === "expenses" ? { ...data, sales: [], purchases: [] }
        : exportScope === "event" ? {
          sales: sales.filter((row) => row.eventId === exportEventId),
          purchases: purchases.filter((row) => row.eventId === exportEventId || row.soldEventId === exportEventId),
          expenses: expenses.filter((row) => row.eventId === exportEventId),
          events: events.filter((row) => row.id === exportEventId)
        } : data;
      await downloadFinancialWorkbook({ ...scoped, workers, scopeLabel: exportScope === "event" ? eventMap.get(exportEventId)?.name || "Selected event" : exportScope.replace(/_/g, " ") });
      setExportOpen(false);
      setMessage("Excel workbook downloaded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the Excel workbook."); }
    finally { setExporting(false); }
  }

  async function saveSpreadsheetSale(sale: SalesRecord) {
    const saved = await saveSaleRecord(sale);
    const savedWithOwnership = { ...saved, ownershipShares: sale.ownershipShares || [] };
    const nextSales = [savedWithOwnership, ...sales.filter((row) => row.id !== saved.id)];
    setSales(nextSales);
    if (saved.inventoryPurchaseId) {
      const purchase = purchases.find((row) => row.id === saved.inventoryPurchaseId);
      if (purchase && purchase.status !== "personal") {
        const linked = nextSales.filter((row) => row.inventoryPurchaseId === purchase.id);
        const quantitySold = Math.min(purchase.quantity, linked.reduce((sum, row) => sum + Number(row.quantity || 1), 0));
        const latest = [...linked].sort((a, b) => b.soldAt.localeCompare(a.soldAt))[0];
        const updated = await saveInventoryPurchase({ ...purchase, quantitySold, status: inventoryStatusForQuantity(purchase.quantity, quantitySold), soldPrice: roundMoney(linked.reduce((sum, row) => sum + Number(row.soldPrice || 0), 0)), soldDate: latest?.soldAt, soldByWorkerId: latest?.soldByWorkerId, soldEventId: latest?.eventId, soldPaymentMethod: latest?.paymentMethod });
        setPurchases((current) => current.map((row) => row.id === updated.id ? { ...updated, ownershipShares: row.ownershipShares } : row));
      }
    }
  }

  async function saveSpreadsheetPurchase(purchase: InventoryPurchase) {
    const saved = await saveInventoryPurchase(purchase);
    setPurchases((current) => [{ ...saved, ownershipShares: purchase.ownershipShares || [] }, ...current.filter((row) => row.id !== saved.id)]);
  }

  async function saveSpreadsheetExpense(expense: BusinessExpense) {
    const saved = await saveBusinessExpense(expense);
    setExpenses((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
  }

  async function deleteSpreadsheetRecord(type: "sale" | "purchase" | "expense", id: string) {
    if (type === "sale") {
      const deleted = sales.find((row) => row.id === id);
      await deleteSaleRecord(id);
      const remainingSales = sales.filter((row) => row.id !== id);
      setSales(remainingSales);
      if (deleted?.inventoryPurchaseId) {
        const purchase = purchases.find((row) => row.id === deleted.inventoryPurchaseId);
        if (purchase && purchase.status !== "personal") {
          const linked = remainingSales.filter((row) => row.inventoryPurchaseId === purchase.id);
          const quantitySold = Math.min(purchase.quantity, linked.reduce((sum, row) => sum + Number(row.quantity || 1), 0));
          const latest = [...linked].sort((a, b) => b.soldAt.localeCompare(a.soldAt))[0];
          const updated = await saveInventoryPurchase({ ...purchase, quantitySold, status: inventoryStatusForQuantity(purchase.quantity, quantitySold), soldPrice: linked.length ? roundMoney(linked.reduce((sum, row) => sum + Number(row.soldPrice || 0), 0)) : undefined, soldDate: latest?.soldAt, soldByWorkerId: latest?.soldByWorkerId, soldEventId: latest?.eventId, soldPaymentMethod: latest?.paymentMethod });
          setPurchases((current) => current.map((row) => row.id === updated.id ? updated : row));
        }
      }
    }
    if (type === "purchase") { await deleteInventoryPurchase(id); setPurchases((current) => current.filter((row) => row.id !== id)); }
    if (type === "expense") { await deleteBusinessExpense(id); setExpenses((current) => current.filter((row) => row.id !== id)); }
  }

  async function duplicateSpreadsheetRecord(type: "sale" | "purchase" | "expense", id: string) {
    const now = new Date().toISOString();
    if (type === "sale") {
      const source = sales.find((row) => row.id === id); if (!source) return;
      const saved = (await createSaleRecord({ ...source, id: undefined, imagePath: undefined, pendingUpload: false, soldAt: now, createdAt: undefined, updatedAt: undefined })).sale;
      if (!saved.inventoryPurchaseId && source.ownershipShares?.length) await saveSaleOwnership(saved.id, source.ownershipShares);
      setSales((current) => [{ ...saved, ownershipShares: source.ownershipShares || [] }, ...current]);
    }
    if (type === "purchase") {
      const source = purchases.find((row) => row.id === id); if (!source) return;
      const saved = await saveInventoryPurchase({ ...source, id: undefined, imagePath: undefined, status: "in_stock", quantitySold: 0, soldPrice: undefined, soldDate: undefined, soldByWorkerId: undefined, soldEventId: undefined, soldPaymentMethod: undefined, buyerNote: undefined, purchaseDate: now, createdAt: undefined, updatedAt: undefined });
      if (source.ownershipShares?.length) await saveInventoryOwnership(saved.id, source.ownershipShares);
      setPurchases((current) => [{ ...saved, ownershipShares: source.ownershipShares || [] }, ...current]);
    }
    if (type === "expense") {
      const source = expenses.find((row) => row.id === id); if (!source) return;
      const saved = await saveBusinessExpense({ ...source, id: undefined, receiptImagePath: undefined, expenseDate: now, createdAt: undefined, updatedAt: undefined });
      setExpenses((current) => [saved, ...current]);
    }
  }

  if (loading) return <LoadingScreen label="Loading Sales Control" />;

  return (
    <div className="page-shell w-full min-w-0 max-w-full overflow-x-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="eyebrow">Financial control</p><h1 className="text-3xl font-black text-ink dark:text-white">Sales Control</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pokémon sales, inventory, and business costs in one place.</p></div>
        <button onClick={() => openSale()} className="btn-primary"><Camera size={18} /> Add Sale</button>
      </header>
      <SyncStatusBadge syncing={syncing} />
      {loadError ? <ErrorState message="Some financial data could not be refreshed." details={`${loadError}\nRun the latest supabase-schema.sql if the new tables are missing.`} onRetry={() => void loadData()} onSync={() => void loadData()} /> : null}
      {message ? <p className="rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{message}</p> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(20rem,0.38fr)_minmax(0,0.62fr)] lg:items-start">
        <div className="min-w-0">
          <SalesAnalyticsPanel
            sales={sales}
            purchases={purchases}
            expenses={expenses}
            events={events}
            workers={workers}
            dateRange={dateRange}
            customStart={customStart}
            customEnd={customEnd}
            onDateRange={setDateRange}
            onCustomStart={setCustomStart}
            onCustomEnd={setCustomEnd}
            onAddSale={() => openSale()}
            onAddPurchase={() => openPurchase()}
            onAddExpense={() => openExpense()}
            onOpenSpreadsheet={() => setMobileSpreadsheetOpen(true)}
            onEditSale={openSale}
            onEditPurchase={openPurchase}
            onEditExpense={openExpense}
          />
          <section className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={() => setBatchOpen(true)} className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-black text-white"><PackagePlus size={17} /> Batch Add Inventory</button>
            <button onClick={() => setExportOpen(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-black text-white"><Download size={17} /> Download Excel</button>
            <button onClick={exportData} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 text-sm font-black text-ink dark:bg-slate-800 dark:text-white"><FileSpreadsheet size={17} /> Download CSV</button>
            <button onClick={() => void syncPending()} className="col-span-2 min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-black text-ink dark:bg-slate-800 dark:text-white">Sync Pending Sales</button>
            {hasMoreSales ? <button onClick={() => void loadMoreSales()} className="col-span-2 min-h-11 rounded-xl bg-slate-100 text-sm font-black text-ink dark:bg-slate-800 dark:text-white">Load more sale records</button> : null}
          </section>
        </div>

        <div className={`${mobileSpreadsheetOpen ? "fixed inset-0 z-40 block overflow-y-auto bg-canvas p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] dark:bg-slate-950" : "hidden"} min-w-0 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:bg-transparent lg:p-0`}>
          <div className="mb-3 flex items-center justify-between lg:hidden"><h2 className="text-xl font-black text-ink dark:text-white">Financial Spreadsheet</h2><button onClick={() => setMobileSpreadsheetOpen(false)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></div>
          <FinancialSpreadsheet
            sales={sales}
            purchases={purchases}
            expenses={expenses}
            events={events}
            workers={workers}
            onSaveSale={saveSpreadsheetSale}
            onSavePurchase={saveSpreadsheetPurchase}
            onSaveExpense={saveSpreadsheetExpense}
            onOpenSale={openSale}
            onOpenPurchase={openPurchase}
            onOpenExpense={openExpense}
            onDelete={deleteSpreadsheetRecord}
            onDuplicate={duplicateSpreadsheetRecord}
            onAddRow={(type) => type === "sale" ? openSale() : type === "purchase" ? openPurchase() : openExpense()}
          />
        </div>
      </div>

      {exportOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <section className="w-full max-w-md space-y-4 rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl dark:bg-slate-900">
            <div className="flex items-center justify-between"><div><p className="eyebrow">Excel workbook</p><h2 className="text-xl font-black text-ink dark:text-white">Choose export scope</h2></div><button onClick={() => setExportOpen(false)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></div>
            <select value={exportScope} onChange={(event) => setExportScope(event.target.value as ExcelExportScope)} className={compactInputClass()}>
              <option value="all">All data</option><option value="sales">Sales only</option><option value="inventory">Inventory only</option><option value="expenses">Expenses only</option><option value="filtered">Current date filter</option><option value="date_range">Selected date range</option><option value="event">One event</option>
            </select>
            {exportScope === "event" ? <select value={exportEventId} onChange={(event) => setExportEventId(event.target.value)} className={compactInputClass()}><option value="">Choose event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select> : null}
            <p className="text-sm text-slate-500">Workbook sheets: Overview, Sales, Inventory, Expenses, Event Summary, and Monthly Summary.</p>
            <button onClick={() => void exportExcel()} disabled={exporting || (exportScope === "event" && !exportEventId)} className="btn-primary min-h-12 w-full"><Download size={18} /> {exporting ? "Preparing workbook..." : "Download Excel"}</button>
          </section>
        </div>
      ) : null}

      {batchOpen ? <BatchInventoryImporter onClose={() => setBatchOpen(false)} onImport={async (input, file) => {
        const saved = await saveInventoryPurchase(input, file);
        setPurchases((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      }} /> : null}

      {editor ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:p-4">
          <section onPaste={handleEditorPaste} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { if (event.defaultPrevented) return; event.preventDefault(); void pickFile(event.dataTransfer.files[0]); }} className="max-h-[95dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-5 dark:bg-slate-900">
            <div className="sticky top-0 z-10 -mx-1 mb-4 flex items-start justify-between bg-white/95 px-1 py-1 backdrop-blur dark:bg-slate-900/95"><div><p className="eyebrow">Sales Control</p><h2 className="text-2xl font-black text-ink dark:text-white">{editor === "sale" ? editingSale ? "Edit Sale" : "Add Sale" : editor === "purchase" ? editingPurchase ? "Edit Purchase" : "Add Inventory Purchase" : editingExpense ? "Edit Expense" : "Add Expense"}</h2></div><button onClick={closeEditor} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></div>

            {editor === "sale" ? imageActions("Sale Image — Optional") : null}
            {editor === "sale" ? <div className="space-y-3">
              {selectedSaleEvent ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-black text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">Linked to: {selectedSaleEvent.name}</p> : null}
              <div className="grid gap-3 sm:grid-cols-2"><input value={saleForm.itemName} onChange={(event) => setSaleForm({ ...saleForm, itemName: event.target.value })} placeholder="Item name or description" className={compactInputClass()} /><select value={saleForm.category} onChange={(event) => setSaleForm({ ...saleForm, category: event.target.value as PokemonProductCategory, isRawCard: event.target.value === "raw_card" ? true : saleForm.isRawCard })} className={compactInputClass()}>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input type="number" min="1" value={saleForm.quantity} onChange={(event) => setSaleForm({ ...saleForm, quantity: event.target.value })} placeholder="Quantity" className={compactInputClass()} /><input type="datetime-local" value={saleForm.soldAt} onChange={(event) => setSaleForm({ ...saleForm, soldAt: event.target.value })} className={compactInputClass()} />{moneyInput(saleForm.soldPrice, (value) => setSaleForm({ ...saleForm, soldPrice: value }), "Sold price *")}{moneyInput(saleForm.boughtPrice, (value) => setSaleForm({ ...saleForm, boughtPrice: value }), "Actual bought price / cost basis")}</div>
              <label className="flex min-h-12 items-center justify-between rounded-xl bg-slate-100 px-3 text-sm font-black dark:bg-slate-800">Raw Pokémon Card<input type="checkbox" checked={saleForm.isRawCard} onChange={(event) => setSaleForm({ ...saleForm, isRawCard: event.target.checked })} className="size-5 accent-coral" /></label>
              {saleForm.isRawCard ? <RawCardCalculator marketValue={saleForm.marketValue} buyPercentage={saleForm.buyPercentage} actualCost={saleForm.boughtPrice} onMarketValue={(value) => setSaleForm({ ...saleForm, marketValue: value })} onPercentage={(value) => setSaleForm({ ...saleForm, buyPercentage: value })} onActualCost={(value) => setSaleForm({ ...saleForm, boughtPrice: value })} /> : <>{moneyInput(saleForm.marketValue, (value) => setSaleForm({ ...saleForm, marketValue: value }), "Market value, optional")}</>}
              <div className="grid gap-3 sm:grid-cols-2"><select value={saleForm.eventId} onChange={(event) => setSaleForm({ ...saleForm, eventId: event.target.value, eventDayId: "" })} className={compactInputClass()}><option value="">No event selected</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name} · {shortScheduleSummary(event)}</option>)}</select><select value={saleForm.eventDayId} disabled={!selectedSaleEvent} onChange={(event) => setSaleForm({ ...saleForm, eventDayId: event.target.value })} className={compactInputClass()}><option value="">No event day selected</option>{selectedSaleEvent ? eventDays(selectedSaleEvent).map((day) => <option key={day.id} value={day.id}>{day.date.slice(0, 10)}</option>) : null}</select><select value={saleForm.inventoryPurchaseId} onChange={(event) => { const linked = purchases.find((row) => row.id === event.target.value); const suggested = linked ? roundMoney(linked.totalCost / Math.max(1, linked.quantity) * Math.max(1, Number(saleForm.quantity || 1))) : undefined; setSaleForm({ ...saleForm, inventoryPurchaseId: event.target.value, boughtPrice: linked && saleForm.boughtPrice === "" ? String(suggested) : saleForm.boughtPrice }); }} className={compactInputClass()}><option value="">No linked inventory purchase</option>{purchases.map((purchase) => <option key={purchase.id} value={purchase.id}>{purchase.itemName} · {formatMoney(purchase.totalCost)}</option>)}</select><select value={saleForm.soldByWorkerId} onChange={(event) => setSaleForm({ ...saleForm, soldByWorkerId: event.target.value })} className={compactInputClass()}><option value="">Sold by, optional</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select><select value={saleForm.purchaseSource} onChange={(event) => setSaleForm({ ...saleForm, purchaseSource: event.target.value as PurchaseSource | "" })} className={compactInputClass()}><option value="">Purchase source, optional</option>{sourceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={saleForm.paymentMethod} onChange={(event) => setSaleForm({ ...saleForm, paymentMethod: event.target.value as SalePaymentMethod })} className={compactInputClass()}>{paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={saleForm.boughtFrom} onChange={(event) => setSaleForm({ ...saleForm, boughtFrom: event.target.value })} placeholder="Bought from / seller" className={compactInputClass()} /></div>
              {selectedLinkedPurchase ? <p className="rounded-xl bg-sky-50 p-3 text-xs font-bold text-sky-700 dark:bg-sky-950/30 dark:text-sky-200">Linked to {selectedLinkedPurchase.itemName}. Its purchase is not counted as an operating expense.</p> : null}<textarea value={saleForm.notes} onChange={(event) => setSaleForm({ ...saleForm, notes: event.target.value })} placeholder="Notes" className={`${compactInputClass()} min-h-24`} />
              {!saleForm.inventoryPurchaseId ? <OwnershipEditor workers={workers} shares={saleForm.ownershipShares} totalCost={Number(saleForm.boughtPrice || 0)} label="Profit Ownership" onChange={(ownershipShares) => setSaleForm({ ...saleForm, ownershipShares })} /> : null}
              <button onClick={() => void saveSale()} disabled={busy} className="btn-primary min-h-12 w-full"><Save size={18} /> {busy ? "Saving..." : "Save Sale"}</button>
            </div> : null}

            {editor === "purchase" ? <CardScanPanel imageFile={imageFile} backImageFile={backImageFile} category={purchaseForm.category} inventory={purchases} onApply={(scan, hash) => setPurchaseForm((current) => ({
              ...current, category: scan.suggestedType || current.category, isRawCard: (scan.suggestedType || current.category) === "raw_card",
              itemName: scan.cardName || current.itemName, cardName: scan.cardName || current.cardName,
              collectorNumber: scan.collectorNumber || current.collectorNumber, cardSet: scan.cardSet || current.cardSet,
              cardLanguage: scan.language || current.cardLanguage, cardCondition: scan.condition || current.cardCondition,
              stickerPrice: scan.stickerPrice == null ? current.stickerPrice : String(scan.stickerPrice),
              gradingCompany: scan.gradingCompany || current.gradingCompany, grade: scan.grade || current.grade,
              certificateNumber: scan.certificateNumber || current.certificateNumber, scanConfidence: scan.overallConfidence,
              scanStatus: "needs_review", imageHash: hash, scanResult: scan as unknown as Record<string, unknown>
            }))} /> : null}
            {editor === "purchase" ? <section className="grid gap-2 rounded-2xl border border-slate-200 p-3 sm:grid-cols-3 dark:border-slate-700">
              <input value={purchaseForm.cardName} onChange={(event) => setPurchaseForm({ ...purchaseForm, cardName: event.target.value })} placeholder="Pokémon / card name" className={compactInputClass()} />
              <input value={purchaseForm.collectorNumber} onChange={(event) => setPurchaseForm({ ...purchaseForm, collectorNumber: event.target.value })} placeholder="Collector number" className={compactInputClass()} />
              <input value={purchaseForm.cardSet} onChange={(event) => setPurchaseForm({ ...purchaseForm, cardSet: event.target.value })} placeholder="Set / code" className={compactInputClass()} />
              <input value={purchaseForm.cardLanguage} onChange={(event) => setPurchaseForm({ ...purchaseForm, cardLanguage: event.target.value })} placeholder="Language" className={compactInputClass()} />
              <select value={purchaseForm.cardCondition} onChange={(event) => setPurchaseForm({ ...purchaseForm, cardCondition: event.target.value })} className={compactInputClass()}><option value="">Condition unknown</option>{["Mint", "Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged"].map((condition) => <option key={condition}>{condition}</option>)}</select>
              {moneyInput(purchaseForm.stickerPrice, (value) => setPurchaseForm({ ...purchaseForm, stickerPrice: value }), "Sticker / asking price")}
              {purchaseForm.category === "graded_card" ? <><input value={purchaseForm.gradingCompany} onChange={(event) => setPurchaseForm({ ...purchaseForm, gradingCompany: event.target.value })} placeholder="Grading company" className={compactInputClass()} /><input value={purchaseForm.grade} onChange={(event) => setPurchaseForm({ ...purchaseForm, grade: event.target.value })} placeholder="Grade" className={compactInputClass()} /><input value={purchaseForm.certificateNumber} onChange={(event) => setPurchaseForm({ ...purchaseForm, certificateNumber: event.target.value })} placeholder="Certificate number" className={compactInputClass()} /><label className="sm:col-span-3 rounded-xl border-2 border-dashed border-slate-300 p-3 text-sm font-black dark:border-slate-700">{backPreviewUrl ? <img src={backPreviewUrl} alt="Slab back preview" className="mb-2 h-40 w-full object-contain" /> : null}Back image for slab <span className="font-normal text-slate-500">(recommended)</span><input type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block w-full text-xs" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (backPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(backPreviewUrl); setBackImageFile(file); setBackPreviewUrl(URL.createObjectURL(file)); }} /></label></> : null}
              <p className="sm:col-span-3 text-xs text-slate-500">Actual bought price remains the separate “Actual total cost” field below. Scan status: {purchaseForm.scanStatus.replace(/_/g, " ")}{purchaseForm.scanConfidence ? ` · ${purchaseForm.scanConfidence} confidence` : ""}</p>
            </section> : null}
            {editor === "purchase" ? <OwnershipEditor workers={workers} shares={purchaseForm.ownershipShares} totalCost={Number(purchaseForm.totalCost || 0)} paidByWorkerId={purchaseForm.purchasedByWorkerId} onChange={(ownershipShares) => setPurchaseForm({ ...purchaseForm, ownershipShares })} /> : null}


            {editor === "purchase" ? <div className="space-y-3"><div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center dark:border-slate-700 dark:bg-slate-950">{previewUrl ? <img src={previewUrl} alt="Purchase preview" className="mx-auto max-h-64 object-contain" /> : <PackagePlus className="mx-auto text-sky-500" size={38} />}<button onClick={() => inputRef.current?.click()} className="mt-3 min-h-10 rounded-xl bg-ink px-4 text-sm font-bold text-white dark:bg-coral"><Upload className="inline" size={16} /> Choose optional photo</button></div><div className="grid gap-3 sm:grid-cols-2"><input value={purchaseForm.itemName} onChange={(event) => setPurchaseForm({ ...purchaseForm, itemName: event.target.value })} placeholder="Item name *" className={compactInputClass()} /><select value={purchaseForm.category} onChange={(event) => setPurchaseForm({ ...purchaseForm, category: event.target.value as PokemonProductCategory, isRawCard: event.target.value === "raw_card" ? true : purchaseForm.isRawCard })} className={compactInputClass()}>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input type="number" min="1" value={purchaseForm.quantity} onChange={(event) => setPurchaseForm({ ...purchaseForm, quantity: event.target.value })} placeholder="Quantity" className={compactInputClass()} /><input type="datetime-local" value={purchaseForm.purchaseDate} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchaseDate: event.target.value })} className={compactInputClass()} />{moneyInput(purchaseForm.totalCost, (value) => setPurchaseForm({ ...purchaseForm, totalCost: value }), "Actual total cost *")}</div><label className="flex min-h-12 items-center justify-between rounded-xl bg-slate-100 px-3 text-sm font-black dark:bg-slate-800">Raw Pokémon Card<input type="checkbox" checked={purchaseForm.isRawCard} onChange={(event) => setPurchaseForm({ ...purchaseForm, isRawCard: event.target.checked })} className="size-5 accent-coral" /></label>{purchaseForm.isRawCard ? <RawCardCalculator marketValue={purchaseForm.marketValue} buyPercentage={purchaseForm.buyPercentage} actualCost={purchaseForm.totalCost} onMarketValue={(value) => setPurchaseForm({ ...purchaseForm, marketValue: value })} onPercentage={(value) => setPurchaseForm({ ...purchaseForm, buyPercentage: value })} onActualCost={(value) => setPurchaseForm({ ...purchaseForm, totalCost: value })} /> : moneyInput(purchaseForm.marketValue, (value) => setPurchaseForm({ ...purchaseForm, marketValue: value }), "Market value, optional")}<div className="grid gap-3 sm:grid-cols-2"><select value={purchaseForm.purchaseSource} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchaseSource: event.target.value as PurchaseSource | "" })} className={compactInputClass()}><option value="">Purchase source</option>{sourceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={purchaseForm.seller} onChange={(event) => setPurchaseForm({ ...purchaseForm, seller: event.target.value })} placeholder="Website / store / seller" className={compactInputClass()} /><select value={purchaseForm.eventId} onChange={(event) => setPurchaseForm({ ...purchaseForm, eventId: event.target.value })} className={compactInputClass()}><option value="">No event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select><select value={purchaseForm.purchasedByWorkerId} onChange={(event) => setPurchaseForm({ ...purchaseForm, purchasedByWorkerId: event.target.value })} className={compactInputClass()}><option value="">Purchased by, optional</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select><select value={purchaseForm.status} onChange={(event) => setPurchaseForm({ ...purchaseForm, status: event.target.value as InventoryStatus })} className={compactInputClass()}>{inventoryStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><textarea value={purchaseForm.notes} onChange={(event) => setPurchaseForm({ ...purchaseForm, notes: event.target.value })} placeholder="Notes" className={`${compactInputClass()} min-h-24`} /></div> : null}

            {editor === "expense" ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><input type="datetime-local" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm({ ...expenseForm, expenseDate: event.target.value })} className={compactInputClass()} />{moneyInput(expenseForm.amount, (value) => setExpenseForm({ ...expenseForm, amount: value }), "Amount *")}<select value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value as BusinessExpenseCategory })} className={compactInputClass()}>{expenseOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={expenseForm.description} onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })} placeholder="Description" className={compactInputClass()} /><select value={expenseForm.eventId} onChange={(event) => setExpenseForm({ ...expenseForm, eventId: event.target.value })} className={compactInputClass()}><option value="">No event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select><select value={expenseForm.paidByWorkerId} onChange={(event) => setExpenseForm({ ...expenseForm, paidByWorkerId: event.target.value })} className={compactInputClass()}><option value="">Paid by, optional</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select><input value={expenseForm.vendor} onChange={(event) => setExpenseForm({ ...expenseForm, vendor: event.target.value })} placeholder="Vendor / store" className={compactInputClass()} /></div>{duplicateExpenseWarning ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">This event already has a {formatMoney(selectedEventCost(selectedExpenseEvent))} table cost. Reports will use that event cost and exclude this manual table-fee row to prevent double-counting.</p> : null}<div className="rounded-2xl border-2 border-dashed border-slate-300 p-3 text-center dark:border-slate-700">{previewUrl ? <img src={previewUrl} alt="Receipt preview" className="mx-auto max-h-48 object-contain" /> : <Receipt className="mx-auto text-slate-400" size={30} />}<button onClick={() => inputRef.current?.click()} className="mt-2 min-h-10 rounded-xl bg-slate-100 px-4 text-sm font-bold dark:bg-slate-800"><Upload className="inline" size={16} /> Optional receipt</button></div><textarea value={expenseForm.notes} onChange={(event) => setExpenseForm({ ...expenseForm, notes: event.target.value })} placeholder="Notes" className={`${compactInputClass()} min-h-24`} /><button onClick={() => void saveExpense()} disabled={busy} className="btn-primary min-h-12 w-full"><Save size={18} /> {busy ? "Saving..." : "Save Expense"}</button></div> : null}
            {editor === "purchase" ? <section className="mt-3 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20"><div><p className="font-black text-emerald-800 dark:text-emerald-200">Sold inventory details</p><p className="text-xs text-emerald-700/80 dark:text-emerald-300/70">Set quantity sold to zero for in stock. A linked sale is created automatically when needed.</p></div><div className="grid gap-3 sm:grid-cols-2"><input type="number" min="0" max={purchaseForm.quantity} value={purchaseForm.quantitySold} onChange={(event) => setPurchaseForm({ ...purchaseForm, quantitySold: event.target.value, status: inventoryStatusForQuantity(Number(purchaseForm.quantity || 1), Number(event.target.value || 0)) })} placeholder="Quantity sold" className={compactInputClass()} />{moneyInput(purchaseForm.soldPrice, (value) => setPurchaseForm({ ...purchaseForm, soldPrice: value }), "Total sold price")}<input type="datetime-local" value={purchaseForm.soldDate} onChange={(event) => setPurchaseForm({ ...purchaseForm, soldDate: event.target.value })} className={compactInputClass()} /><select value={purchaseForm.soldByWorkerId} onChange={(event) => setPurchaseForm({ ...purchaseForm, soldByWorkerId: event.target.value })} className={compactInputClass()}><option value="">Sold by, optional</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select><select value={purchaseForm.soldEventId} onChange={(event) => setPurchaseForm({ ...purchaseForm, soldEventId: event.target.value })} className={compactInputClass()}><option value="">No sale event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select><select value={purchaseForm.soldPaymentMethod} onChange={(event) => setPurchaseForm({ ...purchaseForm, soldPaymentMethod: event.target.value as SalePaymentMethod })} className={compactInputClass()}>{paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><textarea value={purchaseForm.buyerNote} onChange={(event) => setPurchaseForm({ ...purchaseForm, buyerNote: event.target.value })} placeholder="Buyer / sale note" className={`${compactInputClass()} min-h-20`} /></section> : null}
            {editor === "purchase" ? <button onClick={() => void savePurchase()} disabled={busy} className="btn-primary mt-3 min-h-12 w-full"><Save size={18} /> {busy ? "Saving..." : "Save Inventory & Sold Status"}</button> : null}
            <ImageLightbox imageUrl={largePreviewOpen ? previewUrl : undefined} title={editor === "sale" ? saleForm.itemName || "Sale image" : editor === "purchase" ? purchaseForm.itemName || "Inventory image" : expenseForm.description || "Expense receipt"} onClose={() => setLargePreviewOpen(false)} />
            <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { void pickFile(event.target.files?.[0]); event.target.value = ""; }} />
          </section>
        </div>
      ) : null}
    </div>
  );
}
