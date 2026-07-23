import { BadgeDollarSign, ChevronDown, ChevronUp, Copy, Download, Eye, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { BusinessExpense, Event, InventoryPurchase, InventoryStatus, SalesRecord, Worker } from "../../types/models";
import { effectiveSaleOwnership, expenseCategoryLabels, inventoryQuantitySummary, inventoryStatusLabels, pokemonCategoryLabels, saleProfit } from "../../utils/salesControl";
import { formatMoney } from "../../utils/paymentMath";
import { ImageLightbox } from "./ImageLightbox";

type RecordType = "sale" | "purchase" | "expense";
type SortKey = "date" | "item" | "type" | "status" | "bought" | "sold" | "profit";
type ColumnKey = "photo" | "item" | "type" | "category" | "quantity" | "status" | "raw" | "market" | "buyPercent" | "target" | "bought" | "sold" | "profit" | "margin" | "date" | "source" | "worker" | "event" | "payment" | "notes" | "cardName" | "collectorNumber" | "cardSet" | "condition" | "stickerPrice" | "gradingCompany" | "grade" | "certificateNumber" | "scanConfidence" | "scanStatus" | "ownershipType" | "gonzaloPercent" | "thiagoPercent" | "otherOwnerPercent" | "paidBy" | "gonzaloCost" | "thiagoCost" | "gonzaloProfit" | "thiagoProfit" | "internalBalance" | "ownershipAssigned" | "actions";

type Props = {
  sales: SalesRecord[];
  purchases: InventoryPurchase[];
  expenses: BusinessExpense[];
  events: Event[];
  workers: Worker[];
  onSaveSale: (sale: SalesRecord) => Promise<void>;
  onSavePurchase: (purchase: InventoryPurchase) => Promise<void>;
  onSaveExpense: (expense: BusinessExpense) => Promise<void>;
  onOpenSale: (sale: SalesRecord) => void;
  onOpenPurchase: (purchase: InventoryPurchase) => void;
  onOpenExpense: (expense: BusinessExpense) => void;
  onDelete: (type: RecordType, id: string) => Promise<void>;
  onDuplicate: (type: RecordType, id: string) => Promise<void>;
  onAddRow: (type: RecordType) => void;
};

type UnifiedRow = {
  key: string;
  id: string;
  type: RecordType;
  image?: string;
  item: string;
  category: string;
  quantity: number;
  status: string;
  raw: boolean;
  market: number;
  buyPercent: number;
  target: number;
  bought: number;
  sold: number;
  profit: number;
  margin: number;
  date: string;
  source: string;
  worker: string;
  event: string;
  payment: string;
  notes: string;
  cardName?: string; collectorNumber?: string; cardSet?: string; condition?: string; stickerPrice?: number;
  gradingCompany?: string; grade?: string; certificateNumber?: string; scanConfidence?: string; scanStatus?: string;
  original: SalesRecord | InventoryPurchase | BusinessExpense;
};

const allColumns: { key: ColumnKey; label: string }[] = [
  { key: "photo", label: "Photo" }, { key: "item", label: "Item Name" }, { key: "type", label: "Record Type" },
  { key: "category", label: "Category" }, { key: "quantity", label: "Quantity" }, { key: "status", label: "Inventory Status" },
  { key: "raw", label: "Raw Card" }, { key: "market", label: "Market Value" }, { key: "buyPercent", label: "Buy %" },
  { key: "target", label: "Target Buy Price" }, { key: "bought", label: "Bought Price" }, { key: "sold", label: "Sold Price" },
  { key: "profit", label: "Gross Profit" }, { key: "margin", label: "Margin" }, { key: "date", label: "Date" },
  { key: "source", label: "Source" }, { key: "worker", label: "Worker" }, { key: "event", label: "Event" },
  { key: "payment", label: "Payment" }, { key: "notes", label: "Notes" },
  { key: "cardName", label: "Card Name" }, { key: "collectorNumber", label: "Collector #" }, { key: "cardSet", label: "Set" },
  { key: "condition", label: "Condition" }, { key: "stickerPrice", label: "Sticker Price" }, { key: "gradingCompany", label: "Grading Co." },
  { key: "grade", label: "Grade" }, { key: "certificateNumber", label: "Certificate #" }, { key: "scanConfidence", label: "Scan Confidence" },
  { key: "scanStatus", label: "Scan Status" }, { key: "ownershipType", label: "Ownership Type" },
  { key: "gonzaloPercent", label: "Gonzalo %" }, { key: "thiagoPercent", label: "Thiago %" }, { key: "otherOwnerPercent", label: "Other Owner %" },
  { key: "paidBy", label: "Paid By" }, { key: "gonzaloCost", label: "Gonzalo Cost Basis" }, { key: "thiagoCost", label: "Thiago Cost Basis" },
  { key: "gonzaloProfit", label: "Gonzalo Profit" }, { key: "thiagoProfit", label: "Thiago Profit" },
  { key: "internalBalance", label: "Internal Balance" }, { key: "ownershipAssigned", label: "Ownership Assigned" },
  { key: "actions", label: "Actions" }
];

const defaultVisible = new Set<ColumnKey>(["photo", "item", "type", "quantity", "status", "bought", "sold", "profit", "date", "actions"]);

function inputClass() {
  return "min-h-9 w-full min-w-20 rounded-lg border border-coral/40 bg-white px-2 text-sm outline-none dark:bg-slate-950";
}

export function FinancialSpreadsheet(props: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecordType | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [ascending, setAscending] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(defaultVisible);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState("");
  const [draft, setDraft] = useState({ item: "", category: "", quantity: "1", status: "", raw: false, market: "", buyPercent: "", target: "", bought: "", sold: "", date: "", source: "", workerId: "", eventId: "", payment: "", notes: "" });
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved" | "error">("idle");
  const [page, setPage] = useState(0);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState("");
  const [soldModalOpen, setSoldModalOpen] = useState(false);
  const [soldTargetKeys, setSoldTargetKeys] = useState<string[]>([]);
  const [soldDraft, setSoldDraft] = useState({ date: new Date().toISOString().slice(0, 10), eventId: "", workerId: "", payment: "", prices: {} as Record<string, string>, quantities: {} as Record<string, string> });
  const pageSize = 25;

  const eventMap = useMemo(() => new Map(props.events.map((event) => [event.id, event.name])), [props.events]);
  const workerMap = useMemo(() => new Map(props.workers.map((worker) => [worker.id, worker.name])), [props.workers]);
  const rows = useMemo<UnifiedRow[]>(() => [
    ...props.sales.map((sale) => ({ key: `sale-${sale.id}`, id: sale.id, type: "sale" as const, image: sale.imageUrl, item: sale.itemName || "Details pending", category: pokemonCategoryLabels[sale.category || "other_pokemon_product"], quantity: sale.quantity || 1, status: "Sold", raw: sale.isRawCard, market: Number(sale.marketValue || 0), buyPercent: Number(sale.buyPercentage || 0), target: Number(sale.targetBuyPrice || 0), bought: Number(sale.boughtPrice || 0), sold: Number(sale.soldPrice || 0), profit: saleProfit(sale), margin: Number(sale.soldPrice || 0) > 0 ? saleProfit(sale) / Number(sale.soldPrice) * 100 : 0, date: sale.soldAt, source: sale.purchaseSource || sale.boughtFrom || "", worker: workerMap.get(sale.soldByWorkerId || "") || "", event: eventMap.get(sale.eventId || "") || "", payment: sale.paymentMethod || "", notes: sale.notes || "", original: sale })),
    ...props.purchases.map((purchase) => { const summary = inventoryQuantitySummary(purchase, props.sales); return { key: `purchase-${purchase.id}`, id: purchase.id, type: "purchase" as const, image: purchase.imageUrl, item: purchase.itemName, category: pokemonCategoryLabels[purchase.category], quantity: purchase.quantity, status: inventoryStatusLabels[purchase.status], raw: purchase.isRawCard, market: Number(purchase.marketValue || 0), buyPercent: Number(purchase.buyPercentage || 0), target: Number(purchase.targetBuyPrice || 0), bought: purchase.totalCost, sold: summary.realizedRevenue, profit: summary.realizedProfit, margin: summary.margin, date: purchase.purchaseDate, source: purchase.purchaseSource || purchase.seller || "", worker: workerMap.get(purchase.purchasedByWorkerId || "") || "", event: eventMap.get(purchase.eventId || "") || "", payment: purchase.soldPaymentMethod || "", notes: purchase.notes || "", original: purchase }; }),
    ...props.expenses.map((expense) => ({ key: `expense-${expense.id}`, id: expense.id, type: "expense" as const, image: expense.receiptImageUrl, item: expense.description || "Expense", category: expenseCategoryLabels[expense.category], quantity: 1, status: "Expense", raw: false, market: 0, buyPercent: 0, target: 0, bought: expense.amount, sold: 0, profit: -expense.amount, margin: 0, date: expense.expenseDate, source: expense.vendor || "", worker: workerMap.get(expense.paidByWorkerId || "") || "", event: eventMap.get(expense.eventId || "") || "", payment: "", notes: expense.notes || "", original: expense }))
  ], [props.sales, props.purchases, props.expenses, eventMap, workerMap]);

  const filteredRows = useMemo(() => {
    const needle = query.toLowerCase();
    return rows.filter((row) => (typeFilter === "all" || row.type === typeFilter) && `${row.item} ${row.category} ${row.status} ${row.event} ${row.worker} ${row.notes}`.toLowerCase().includes(needle)).sort((a, b) => {
      const left = sortKey === "item" || sortKey === "type" || sortKey === "status" || sortKey === "date" ? String(a[sortKey]) : Number(a[sortKey]);
      const right = sortKey === "item" || sortKey === "type" || sortKey === "status" || sortKey === "date" ? String(b[sortKey]) : Number(b[sortKey]);
      const result = typeof left === "string" ? left.localeCompare(String(right)) : left - Number(right);
      return ascending ? result : -result;
    });
  }, [rows, query, typeFilter, sortKey, ascending]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice(page * pageSize, page * pageSize + pageSize);
  const imageRows = filteredRows.filter((row) => Boolean(row.image));
  const previewIndex = imageRows.findIndex((row) => row.key === previewKey);
  const previewRow = previewIndex >= 0 ? imageRows[previewIndex] : undefined;
  const selectedRows = rows.filter((row) => selected.has(row.key));
  const selectedTypes = new Set(selectedRows.map((row) => row.type));
  const onlyType = selectedTypes.size === 1 ? selectedRows[0]?.type : undefined;

  function toggleColumn(key: ColumnKey) {
    setVisibleColumns((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }

  function beginEdit(row: UnifiedRow) {
    const original = row.original;
    setEditingKey(row.key);
    setDraft({ item: row.item, category: row.type === "expense" ? (original as BusinessExpense).category : ((original as SalesRecord | InventoryPurchase).category || "other_pokemon_product"), quantity: String(row.quantity), status: row.type === "purchase" ? (original as InventoryPurchase).status : row.status, raw: row.raw, market: String(row.market || ""), buyPercent: String(row.buyPercent || ""), target: String(row.target || ""), bought: String(row.bought || ""), sold: String(row.sold || ""), date: row.date.slice(0, 10), source: row.type === "expense" ? ((original as BusinessExpense).vendor || "") : row.type === "purchase" ? ((original as InventoryPurchase).purchaseSource || "") : ((original as SalesRecord).purchaseSource || ""), workerId: row.type === "expense" ? ((original as BusinessExpense).paidByWorkerId || "") : row.type === "purchase" ? ((original as InventoryPurchase).purchasedByWorkerId || "") : ((original as SalesRecord).soldByWorkerId || ""), eventId: (original as SalesRecord | InventoryPurchase | BusinessExpense).eventId || "", payment: row.type === "purchase" ? ((original as InventoryPurchase).soldPaymentMethod || "") : row.type === "sale" ? ((original as SalesRecord).paymentMethod || "") : "", notes: row.notes });
    setSaveState("unsaved");
  }

  function openFullEditor(row: UnifiedRow) {
    if (row.type === "sale") props.onOpenSale(row.original as SalesRecord);
    else if (row.type === "purchase") props.onOpenPurchase(row.original as InventoryPurchase);
    else props.onOpenExpense(row.original as BusinessExpense);
  }

  async function saveDraft(row: UnifiedRow) {
    const quantity = Number(draft.quantity);
    const bought = draft.bought === "" ? 0 : Number(draft.bought);
    const sold = draft.sold === "" ? 0 : Number(draft.sold);
    if (!draft.date || !Number.isFinite(quantity) || quantity < 1 || !Number.isFinite(bought) || bought < 0 || !Number.isFinite(sold) || sold < 0) {
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    try {
      const date = new Date(`${draft.date}T12:00:00`).toISOString();
      if (row.type === "sale") await props.onSaveSale({ ...(row.original as SalesRecord), itemName: draft.item || undefined, category: draft.category as SalesRecord["category"], quantity: Math.max(1, Number(draft.quantity || 1)), isRawCard: draft.raw, marketValue: draft.market === "" ? undefined : Number(draft.market), buyPercentage: draft.buyPercent === "" ? undefined : Number(draft.buyPercent), targetBuyPrice: draft.target === "" ? undefined : Number(draft.target), boughtPrice: Number(draft.bought || 0), soldPrice: Number(draft.sold || 0), purchaseSource: draft.source as SalesRecord["purchaseSource"] || undefined, soldByWorkerId: draft.workerId || undefined, eventId: draft.eventId || undefined, paymentMethod: draft.payment as SalesRecord["paymentMethod"] || undefined, soldAt: date, notes: draft.notes, updatedAt: new Date().toISOString() });
      if (row.type === "purchase") await props.onSavePurchase({ ...(row.original as InventoryPurchase), itemName: draft.item || "Details pending", category: draft.category as InventoryPurchase["category"], quantity: Math.max(1, Number(draft.quantity || 1)), status: draft.status as InventoryStatus, isRawCard: draft.raw, marketValue: draft.market === "" ? undefined : Number(draft.market), buyPercentage: draft.buyPercent === "" ? undefined : Number(draft.buyPercent), targetBuyPrice: draft.target === "" ? undefined : Number(draft.target), totalCost: Number(draft.bought || 0), soldPrice: draft.sold === "" ? undefined : Number(draft.sold), purchaseSource: draft.source as InventoryPurchase["purchaseSource"] || undefined, purchasedByWorkerId: draft.workerId || undefined, eventId: draft.eventId || undefined, soldPaymentMethod: draft.payment as InventoryPurchase["soldPaymentMethod"] || undefined, purchaseDate: date, notes: draft.notes, updatedAt: new Date().toISOString() });
      if (row.type === "expense") await props.onSaveExpense({ ...(row.original as BusinessExpense), description: draft.item, category: draft.category as BusinessExpense["category"], amount: Number(draft.bought || 0), vendor: draft.source || undefined, paidByWorkerId: draft.workerId || undefined, eventId: draft.eventId || undefined, expenseDate: date, notes: draft.notes, updatedAt: new Date().toISOString() });
      setSaveState("saved"); setEditingKey("");
    } catch { setSaveState("error"); }
  }

  function editorKeyDown(event: React.KeyboardEvent<HTMLElement>, row: UnifiedRow) {
    if (event.key === "Escape") { event.preventDefault(); setEditingKey(""); setSaveState("idle"); }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void saveDraft(row); }
  }

  async function bulkStatus(status: InventoryStatus) {
    const purchases = rows.filter((row) => selected.has(row.key) && row.type === "purchase").map((row) => row.original as InventoryPurchase);
    setSaveState("saving");
    try { await Promise.all(purchases.map((purchase) => props.onSavePurchase({ ...purchase, status, updatedAt: new Date().toISOString() }))); setSelected(new Set()); setSaveState("saved"); } catch { setSaveState("error"); }
  }

  async function bulkAssign(field: "category" | "event" | "worker", value: string) {
    if (!value) return;
    setSaveState("saving");
    try {
      await Promise.all(selectedRows.map((row) => {
        if (row.type === "sale") {
          const sale = row.original as SalesRecord;
          return props.onSaveSale({ ...sale, ...(field === "category" ? { category: value as SalesRecord["category"] } : field === "event" ? { eventId: value === "none" ? undefined : value } : {}), updatedAt: new Date().toISOString() });
        }
        if (row.type === "purchase") {
          const purchase = row.original as InventoryPurchase;
          return props.onSavePurchase({ ...purchase, ...(field === "category" ? { category: value as InventoryPurchase["category"] } : field === "event" ? { eventId: value === "none" ? undefined : value } : {}), updatedAt: new Date().toISOString() });
        }
        const expense = row.original as BusinessExpense;
        return props.onSaveExpense({ ...expense, ...(field === "category" ? { category: value as BusinessExpense["category"] } : field === "event" ? { eventId: value === "none" ? undefined : value } : { paidByWorkerId: value === "none" ? undefined : value }), updatedAt: new Date().toISOString() });
      }));
      setSelected(new Set());
      setSaveState("saved");
    } catch { setSaveState("error"); }
  }

  function exportSelected() {
    const csvRows = [["Record Type", "Date", "Item", "Category", "Status", "Amount / Cost", "Sold Price", "Profit"], ...selectedRows.map((row) => [row.type, row.date, row.item, row.category, row.status, row.bought, row.type === "expense" ? "" : row.sold, row.type === "expense" ? "" : row.profit])];
    const csv = csvRows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url; link.download = "sales-control-selected.csv"; link.click(); URL.revokeObjectURL(url);
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected record${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setSaveState("saving");
    try {
      for (const row of selectedRows) await props.onDelete(row.type, row.id);
      setSelected(new Set());
      setSaveState("saved");
    } catch { setSaveState("error"); }
  }

  function openSoldModal(rowsToSell = selectedRows.filter((row) => row.type === "purchase" && (row.original as InventoryPurchase).status !== "sold")) {
    if (!rowsToSell.length) return;
    setSoldTargetKeys(rowsToSell.map((row) => row.key));
    setSoldDraft({
      date: new Date().toISOString().slice(0, 10), eventId: "", workerId: "", payment: "",
      prices: Object.fromEntries(rowsToSell.map((row) => [row.id, String((row.original as InventoryPurchase).soldPrice || "")])),
      quantities: Object.fromEntries(rowsToSell.map((row) => [row.id, String(Math.max(1, (row.original as InventoryPurchase).quantity - (row.original as InventoryPurchase).quantitySold))]))
    });
    setSoldModalOpen(true);
  }

  async function confirmSold() {
    const purchases = rows.filter((row) => soldTargetKeys.includes(row.key) && row.type === "purchase").map((row) => row.original as InventoryPurchase);
    if (!soldDraft.date || !purchases.length || purchases.some((purchase) => !Number.isFinite(Number(soldDraft.prices[purchase.id])) || Number(soldDraft.prices[purchase.id]) < 0 || !Number.isFinite(Number(soldDraft.quantities[purchase.id])) || Number(soldDraft.quantities[purchase.id]) < 1 || Number(soldDraft.quantities[purchase.id]) > purchase.quantity - purchase.quantitySold)) {
      setSaveState("error"); return;
    }
    setSaveState("saving");
    try {
      await Promise.all(purchases.map((purchase) => {
        const quantitySold = Math.min(purchase.quantity, purchase.quantitySold + Number(soldDraft.quantities[purchase.id]));
        return props.onSavePurchase({ ...purchase, status: quantitySold >= purchase.quantity ? "sold" : "partially_sold", quantitySold, soldPrice: Number(purchase.soldPrice || 0) + Number(soldDraft.prices[purchase.id]), soldDate: new Date(`${soldDraft.date}T12:00:00`).toISOString(), soldByWorkerId: soldDraft.workerId || undefined, soldEventId: soldDraft.eventId || undefined, soldPaymentMethod: soldDraft.payment as InventoryPurchase["soldPaymentMethod"] || undefined, updatedAt: new Date().toISOString() });
      }));
      setSoldModalOpen(false); setSelected(new Set()); setSaveState("saved");
    } catch { setSaveState("error"); }
  }

  function cell(key: ColumnKey, row: UnifiedRow) {
    const editing = editingKey === row.key;
    if (key === "photo") return row.image ? <button type="button" title={`Preview ${row.type === "expense" ? "receipt" : "image"}`} onClick={(event) => { event.stopPropagation(); setPreviewKey(row.key); }} className="group/image rounded-lg border-2 border-transparent transition hover:border-coral focus:border-coral focus:outline-none"><img src={row.image} alt={`${row.item} thumbnail`} loading="lazy" className="size-10 cursor-zoom-in rounded-md bg-slate-100 object-contain transition-transform group-hover/image:scale-105 dark:bg-slate-900" /></button> : <div aria-label="No image" className="size-10 rounded-lg bg-slate-100 dark:bg-slate-800" />;
    if (key === "item") return editing ? <input autoFocus value={draft.item} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, item: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : <span className="block max-w-44 truncate font-black text-ink dark:text-white">{row.item}</span>;
    if (key === "type") return <span className="capitalize" title="Record type cannot be converted in place. Use + Add Row to create another type.">{row.type}</span>;
    if (key === "category") return editing ? <select value={draft.category} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, category: event.target.value }); setSaveState("unsaved"); }} className={inputClass()}>{Object.entries(row.type === "expense" ? expenseCategoryLabels : pokemonCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : row.category;
    if (key === "quantity") return editing && row.type !== "expense" ? <input type="number" min="1" value={draft.quantity} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, quantity: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : row.quantity;
    if (key === "status") {
      if (editing && row.type === "purchase" && (row.original as InventoryPurchase).status !== "sold") return <select value={draft.status} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, status: event.target.value }); setSaveState("unsaved"); }} className={inputClass()}>{Object.entries(inventoryStatusLabels).filter(([value]) => value !== "sold").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
      if (row.type === "purchase") {
        const status = (row.original as InventoryPurchase).status;
        return <span className={`rounded-full px-2 py-1 font-black ${status === "sold" ? "bg-emerald-100 text-emerald-700" : status === "partially_sold" ? "bg-amber-100 text-amber-700" : status === "personal" ? "bg-slate-200 text-slate-600" : "bg-sky-100 text-sky-700"}`}>{row.status}</span>;
      }
      return row.type === "expense" ? <span className="text-slate-500">Expense</span> : <span className="text-emerald-600">Completed sale</span>;
    }
    if (key === "raw") return editing && row.type !== "expense" ? <input type="checkbox" checked={draft.raw} onChange={(event) => { setDraft({ ...draft, raw: event.target.checked }); setSaveState("unsaved"); }} className="size-5 accent-coral" /> : row.raw ? "Yes" : "No";
    if (key === "market") return editing && row.type !== "expense" ? <input type="number" min="0" step="0.01" value={draft.market} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, market: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : formatMoney(row.market);
    if (key === "buyPercent") return editing && row.type !== "expense" ? <input type="number" min="0" step="0.1" value={draft.buyPercent} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, buyPercent: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : `${row.buyPercent || 0}%`;
    if (key === "target") return editing && row.type !== "expense" ? <input type="number" min="0" step="0.01" value={draft.target} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, target: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : formatMoney(row.target);
    if (key === "bought") return editing ? <input type="number" min="0" step="0.01" value={draft.bought} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, bought: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : formatMoney(row.bought);
    if (key === "sold") return row.type === "expense" ? <span className="text-slate-400">—</span> : editing ? <input type="number" min="0" step="0.01" value={draft.sold} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, sold: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : formatMoney(row.sold);
    if (key === "profit") return row.type === "expense" ? <span className="font-bold text-rose-600">{formatMoney(row.bought)} operating expense</span> : <span className={row.profit >= 0 ? "font-black text-emerald-600" : "font-black text-rose-600"}>{formatMoney(row.profit)}</span>;
    if (key === "margin") return `${row.margin.toFixed(1)}%`;
    if (key === "date") return editing ? <input type="date" value={draft.date} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, date: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : new Date(row.date).toLocaleDateString();
    if (key === "source") return editing ? <input value={draft.source} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, source: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : row.source;
    if (key === "worker") return editing ? <select value={draft.workerId} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, workerId: event.target.value }); setSaveState("unsaved"); }} className={inputClass()}><option value="">Unassigned</option>{props.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select> : row.worker;
    if (key === "event") return editing ? <select value={draft.eventId} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, eventId: event.target.value }); setSaveState("unsaved"); }} className={inputClass()}><option value="">No event</option>{props.events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : row.event;
    if (key === "payment") return editing && row.type !== "expense" ? <select value={draft.payment} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, payment: event.target.value }); setSaveState("unsaved"); }} className={inputClass()}><option value="">Not set</option>{["cash", "zelle", "venmo", "cash_app", "paypal", "card", "trade", "other"].map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}</select> : row.payment;
    if (key === "notes") return editing ? <input value={draft.notes} onKeyDown={(event) => editorKeyDown(event, row)} onChange={(event) => { setDraft({ ...draft, notes: event.target.value }); setSaveState("unsaved"); }} className={inputClass()} /> : <span className="block max-w-44 truncate">{row.notes}</span>;
    if (["cardName", "collectorNumber", "cardSet", "condition", "stickerPrice", "gradingCompany", "grade", "certificateNumber", "scanConfidence", "scanStatus"].includes(key)) {
      if (row.type !== "purchase") return "—";
      const purchase = row.original as InventoryPurchase;
      const values: Record<string, string | number | undefined> = { cardName: purchase.cardName, collectorNumber: purchase.collectorNumber, cardSet: purchase.cardSet, condition: purchase.cardCondition, stickerPrice: purchase.stickerPrice, gradingCompany: purchase.gradingCompany, grade: purchase.grade, certificateNumber: purchase.certificateNumber, scanConfidence: purchase.scanConfidence, scanStatus: purchase.scanStatus?.replace(/_/g, " ") };
      return key === "stickerPrice" && values[key] !== undefined ? formatMoney(Number(values[key])) : values[key] || "—";
    }
    if (["ownershipType", "gonzaloPercent", "thiagoPercent", "otherOwnerPercent", "paidBy", "gonzaloCost", "thiagoCost", "gonzaloProfit", "thiagoProfit", "internalBalance", "ownershipAssigned"].includes(key)) {
      if (row.type === "expense") return "—";
      const shares = row.type === "purchase" ? (row.original as InventoryPurchase).ownershipShares || [] : effectiveSaleOwnership(row.original as SalesRecord, props.purchases);
      const gonzalo = props.workers.find((item) => item.name.toLowerCase() === "gonzalo");
      const thiago = props.workers.find((item) => item.name.toLowerCase() === "thiago");
      const percent = (workerId?: string) => shares.find((share) => share.workerId === workerId)?.ownershipPercentage || 0;
      const gonzaloPercent = percent(gonzalo?.id);
      const thiagoPercent = percent(thiago?.id);
      const base = row.type === "purchase" ? Number((row.original as InventoryPurchase).totalCost || 0) : Number((row.original as SalesRecord).boughtPrice || 0);
      const paidById = row.type === "purchase" ? (row.original as InventoryPurchase).purchasedByWorkerId : undefined;
      const paidByName = props.workers.find((item) => item.id === paidById)?.name;
      const ownershipLabel = !shares.length ? "Not assigned" : shares.length === 1 ? (props.workers.find((item) => item.id === shares[0].workerId)?.name || "Single owner") : shares.length === 2 && Math.abs(shares[0].ownershipPercentage - 50) < 0.01 && Math.abs(shares[1].ownershipPercentage - 50) < 0.01 ? "Shared 50/50" : "Custom split";
      const values: Record<string, string | number> = {
        ownershipType: ownershipLabel, gonzaloPercent, thiagoPercent,
        otherOwnerPercent: Math.max(0, shares.reduce((sum, share) => sum + share.ownershipPercentage, 0) - gonzaloPercent - thiagoPercent),
        paidBy: paidByName || "—", gonzaloCost: base * gonzaloPercent / 100, thiagoCost: base * thiagoPercent / 100,
        gonzaloProfit: row.profit * gonzaloPercent / 100, thiagoProfit: row.profit * thiagoPercent / 100,
        internalBalance: paidById && shares.length ? `${shares.filter((share) => share.workerId !== paidById).map((share) => `${props.workers.find((item) => item.id === share.workerId)?.name || "Owner"} owes ${paidByName} ${formatMoney(base * share.ownershipPercentage / 100)}`).join(" · ") || "No balance"}` : "—",
        ownershipAssigned: shares.length ? "Yes" : "No"
      };
      return ["gonzaloCost", "thiagoCost", "gonzaloProfit", "thiagoProfit"].includes(key) ? formatMoney(Number(values[key])) : key.endsWith("Percent") ? `${values[key]}%` : values[key];
    }
    return <div className="flex items-center gap-1">{editing ? <button onClick={() => void saveDraft(row)} title="Save row" aria-label="Save row" className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Save size={15} /></button> : <button onClick={() => beginEdit(row)} title="Edit inline" aria-label="Edit inline" className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-200"><Pencil size={15} /></button>}{row.type === "purchase" && (row.original as InventoryPurchase).status !== "sold" ? <button onClick={() => openSoldModal([row])} title="Mark sold" aria-label="Mark sold" className="rounded-lg bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950/40"><BadgeDollarSign size={15} /></button> : null}<button onClick={() => openFullEditor(row)} title="View or edit full record" aria-label="View or edit full record" className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-200"><Eye size={15} /></button><button onClick={() => void props.onDuplicate(row.type, row.id)} title="Duplicate" aria-label="Duplicate" className="rounded-lg bg-sky-50 p-2 text-sky-600 dark:bg-sky-950/40"><Copy size={15} /></button><button onClick={() => { if (confirm("Delete this record?")) void props.onDelete(row.type, row.id); }} title="Delete" aria-label="Delete" className="rounded-lg bg-rose-50 p-2 text-rose-600 dark:bg-rose-950/40"><Trash2 size={15} /></button></div>;
  }

  return (
    <section className="surface-card min-w-0 overflow-hidden">
      <div className="space-y-3 border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="eyebrow">Spreadsheet</p><h2 className="font-black text-ink dark:text-white">Records Grid</h2></div><div className="flex items-center gap-2"><button onClick={() => setAddRowOpen(true)} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-coral px-3 text-sm font-black text-white"><Plus size={17} /> Add Row</button><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-black ${saveState === "unsaved" ? "bg-amber-100 text-amber-700" : saveState === "saving" ? "bg-sky-100 text-sky-700" : saveState === "error" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{saveState === "unsaved" ? "Unsaved" : saveState === "saving" ? "Saving..." : saveState === "error" ? "Save failed" : saveState === "saved" ? "Saved" : "Up to date"}</span></div></div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><label className="relative"><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search spreadsheet" className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white" /></label><select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value as typeof typeFilter); setPage(0); }} className="rounded-xl border border-slate-200 px-3 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white"><option value="all">All records</option><option value="sale">Sales</option><option value="purchase">Inventory</option><option value="expense">Expenses</option></select><details className="relative"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-xl bg-slate-100 px-3 text-sm font-black dark:bg-slate-800">Columns</summary><div className="absolute right-0 z-30 mt-2 grid w-64 grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900">{allColumns.map((column) => <label key={column.key} className="flex items-center gap-2 rounded-lg p-2 text-xs"><input type="checkbox" checked={visibleColumns.has(column.key)} onChange={() => toggleColumn(column.key)} /> {column.label}</label>)}</div></details></div>
        {selected.size ? <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-2 text-xs dark:border-sky-900 dark:bg-sky-950/30">
          <strong>{selected.size} selected</strong>
          {onlyType === "purchase" ? <>{selectedRows.some((row) => (row.original as InventoryPurchase).status !== "sold") ? <button onClick={() => openSoldModal()} className="rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white">Mark Sold</button> : null}<button onClick={() => void bulkStatus("in_stock")} className="rounded-lg bg-white px-3 py-2 font-bold dark:bg-slate-900">Mark In Stock</button><button onClick={() => void bulkStatus("personal")} className="rounded-lg bg-white px-3 py-2 font-bold dark:bg-slate-900">Mark Personal</button><select aria-label="Assign category" defaultValue="" onChange={(event) => void bulkAssign("category", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 font-bold dark:border-slate-700 dark:bg-slate-900"><option value="">Assign Category</option>{Object.entries(pokemonCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></> : null}
          {onlyType === "expense" ? <><select aria-label="Assign expense category" defaultValue="" onChange={(event) => void bulkAssign("category", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 font-bold dark:border-slate-700 dark:bg-slate-900"><option value="">Assign Category</option>{Object.entries(expenseCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Assign paid by" defaultValue="" onChange={(event) => void bulkAssign("worker", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 font-bold dark:border-slate-700 dark:bg-slate-900"><option value="">Assign Paid By</option><option value="none">Unassigned</option>{props.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></> : null}
          {onlyType === "sale" ? <button onClick={() => selectedRows.length === 1 ? openFullEditor(selectedRows[0]) : alert("Open sales individually to assign a custom profit split safely.")} className="rounded-lg bg-white px-3 py-2 font-bold dark:bg-slate-900">Assign Owner / Profit Split</button> : null}
          {onlyType ? <select aria-label="Assign event" defaultValue="" onChange={(event) => void bulkAssign("event", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 font-bold dark:border-slate-700 dark:bg-slate-900"><option value="">Assign Event</option><option value="none">No event</option>{props.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select> : null}
          <button onClick={exportSelected} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 font-bold dark:bg-slate-900"><Download size={14} /> Export Selected</button>
          <button onClick={() => void deleteSelected()} className="inline-flex items-center gap-1 rounded-lg bg-rose-100 px-3 py-2 font-bold text-rose-700 dark:bg-rose-950/50"><Trash2 size={14} /> Delete Selected</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto font-bold text-slate-500">Clear</button>
        </div> : null}
      </div>
      <div className="max-w-full overflow-x-auto overscroll-x-contain">
        <table className="min-w-[1080px] border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-950"><tr><th className="sticky left-0 z-30 w-10 border-b border-r border-slate-200 bg-slate-100 p-2 dark:border-slate-800 dark:bg-slate-950"><input type="checkbox" checked={visibleRows.length > 0 && visibleRows.every((row) => selected.has(row.key))} onChange={(event) => setSelected((current) => { const next = new Set(current); visibleRows.forEach((row) => event.target.checked ? next.add(row.key) : next.delete(row.key)); return next; })} /></th>{allColumns.filter((column) => visibleColumns.has(column.key)).map((column) => <th key={column.key} className={`resize-x overflow-hidden whitespace-nowrap border-b border-r border-slate-200 p-3 font-black dark:border-slate-800 ${column.key === "item" ? "sticky left-10 z-20 bg-slate-100 dark:bg-slate-950" : ""}`}><button onClick={() => { if (["item", "type", "status", "bought", "sold", "profit", "date"].includes(column.key)) { if (sortKey === column.key) setAscending(!ascending); else { setSortKey(column.key as SortKey); setAscending(true); } } }} className="inline-flex items-center gap-1">{column.label}{sortKey === column.key ? ascending ? <ChevronUp size={12} /> : <ChevronDown size={12} /> : null}</button></th>)}</tr></thead>
          <tbody>{visibleRows.map((row) => {
            const soldInventory = row.type === "purchase" && (row.original as InventoryPurchase).status === "sold";
            const isSelected = selected.has(row.key);
            return <tr key={row.key} onClick={(event) => { if (window.matchMedia("(max-width: 1023px)").matches && !(event.target as HTMLElement).closest("button,input,select,a")) openFullEditor(row); }} className={`group cursor-pointer transition-colors ${isSelected ? "bg-sky-50 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/40 dark:ring-sky-800" : soldInventory ? "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-slate-800" : "bg-white hover:bg-orange-50/40 dark:bg-slate-900 dark:hover:bg-slate-800"}`}><td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-inherit p-2 dark:border-slate-800"><input aria-label={`Select ${row.item}`} type="checkbox" checked={isSelected} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.key); else next.delete(row.key); return next; })} /></td>{allColumns.filter((column) => visibleColumns.has(column.key)).map((column) => <td key={column.key} onClick={() => { if (!window.matchMedia("(min-width: 1024px)").matches) return; if (column.key === "photo") openFullEditor(row); else if (!["type", "profit", "margin", "actions"].includes(column.key)) beginEdit(row); }} className={`whitespace-nowrap border-b border-r border-slate-100 p-2 align-middle dark:border-slate-800 ${column.key === "item" ? "sticky left-10 z-10 bg-inherit" : ""} ${soldInventory && !["photo", "status", "actions"].includes(column.key) ? "opacity-65" : ""}`}>{cell(column.key, row)}</td>)}</tr>;
          })}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-3 text-xs dark:border-slate-800"><span>{filteredRows.length} records · Page {page + 1} of {pageCount}</span><div className="flex gap-2"><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded-lg bg-slate-100 px-3 py-2 font-bold disabled:opacity-40 dark:bg-slate-800">Previous</button><button disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="rounded-lg bg-slate-100 px-3 py-2 font-bold disabled:opacity-40 dark:bg-slate-800">Next</button></div></div>
      {soldModalOpen ? <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-slate-950/70 p-0 sm:items-center sm:p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="mark-sold-title" className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Inventory sale</p><h3 id="mark-sold-title" className="text-xl font-black text-ink dark:text-white">Confirm sold details</h3></div><button onClick={() => setSoldModalOpen(false)} title="Close" aria-label="Close sold dialog" className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></div>
          <p className="text-sm text-slate-500">Enter the sold price and quantity for every inventory item. Nothing is marked sold until you save.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-black text-slate-500">Sold date<input type="date" required value={soldDraft.date} onChange={(event) => setSoldDraft({ ...soldDraft, date: event.target.value })} className={`${inputClass()} mt-1`} /></label>
            <label className="text-xs font-black text-slate-500">Sold by<select value={soldDraft.workerId} onChange={(event) => setSoldDraft({ ...soldDraft, workerId: event.target.value })} className={`${inputClass()} mt-1`}><option value="">Not recorded</option>{props.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
            <label className="text-xs font-black text-slate-500">Event sold at<select value={soldDraft.eventId} onChange={(event) => setSoldDraft({ ...soldDraft, eventId: event.target.value })} className={`${inputClass()} mt-1`}><option value="">No event</option>{props.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
            <label className="text-xs font-black text-slate-500">Payment method<select value={soldDraft.payment} onChange={(event) => setSoldDraft({ ...soldDraft, payment: event.target.value })} className={`${inputClass()} mt-1`}><option value="">Not recorded</option>{["cash", "zelle", "venmo", "cash_app", "paypal", "card", "trade", "other"].map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</select></label>
          </div>
          <div className="space-y-2">{rows.filter((row) => soldTargetKeys.includes(row.key)).map((row) => { const purchase = row.original as InventoryPurchase; return <div key={row.key} className="grid items-end gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem] dark:bg-slate-950"><div><p className="truncate font-black text-ink dark:text-white">{row.item}</p><p className="text-xs text-slate-500">{Math.max(0, purchase.quantity - purchase.quantitySold)} remaining</p></div><label className="text-xs font-black text-slate-500">Quantity<input type="number" min="1" max={Math.max(1, purchase.quantity - purchase.quantitySold)} value={soldDraft.quantities[row.id] || ""} onChange={(event) => setSoldDraft({ ...soldDraft, quantities: { ...soldDraft.quantities, [row.id]: event.target.value } })} className={`${inputClass()} mt-1`} /></label><label className="text-xs font-black text-slate-500">Sold price<input type="number" min="0" step="0.01" required value={soldDraft.prices[row.id] || ""} onChange={(event) => setSoldDraft({ ...soldDraft, prices: { ...soldDraft.prices, [row.id]: event.target.value } })} className={`${inputClass()} mt-1`} /></label></div>; })}</div>
          <div className="flex justify-end gap-2"><button onClick={() => setSoldModalOpen(false)} className="rounded-xl bg-slate-100 px-4 py-3 font-black dark:bg-slate-800">Cancel</button><button onClick={() => void confirmSold()} className="rounded-xl bg-emerald-600 px-4 py-3 font-black text-white">Save sale details</button></div>
        </section>
      </div> : null}
      {addRowOpen ? <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4"><section className="w-full max-w-sm space-y-3 rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl dark:bg-slate-900"><div className="flex items-center justify-between"><div><p className="eyebrow">Manual record</p><h3 className="text-xl font-black text-ink dark:text-white">Choose record type</h3></div><button onClick={() => setAddRowOpen(false)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></div>{([['sale','Sale'],['purchase','Inventory Purchase'],['expense','Business Expense']] as const).map(([type, label]) => <button key={type} onClick={() => { setAddRowOpen(false); props.onAddRow(type); }} className="min-h-12 w-full rounded-xl bg-slate-100 px-4 text-left font-black hover:bg-orange-100 dark:bg-slate-800 dark:hover:bg-slate-700"><Plus className="mr-2 inline" size={17} />{label}</button>)}<p className="text-xs text-slate-500">Photos are optional. The record will save to its matching Supabase table.</p></section></div> : null}
      <ImageLightbox imageUrl={previewRow?.image} title={previewRow?.item || "Sales Control image"} onClose={() => setPreviewKey("")} onPrevious={imageRows.length > 1 ? () => setPreviewKey(imageRows[(previewIndex - 1 + imageRows.length) % imageRows.length].key) : undefined} onNext={imageRows.length > 1 ? () => setPreviewKey(imageRows[(previewIndex + 1) % imageRows.length].key) : undefined} />
    </section>
  );
}
