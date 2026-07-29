import { ArrowLeft, ArrowRight, Camera, Check, Copy, PackagePlus, Save, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { OwnershipEditor } from "../components/sales/OwnershipEditor";
import { listInventoryPurchases } from "../services/database/inventoryPurchaseRepository";
import { listOwnershipShares } from "../services/database/ownershipRepository";
import { completeFinancialTransaction, blankTrade, blankTradeItem, saveTrade } from "../services/database/tradeRepository";
import { listWorkers } from "../services/database/workerRepository";
import { listPlannerEventOptions } from "../services/planner/plannerRepository";
import { saveTransactionImage } from "../services/images/saleImageService";
import type { BusinessExpenseCategory, Event, FinancialTransactionType, InventoryPurchase, OwnershipShare, PokemonProductCategory, PurchaseSource, SalePaymentMethod, TradeItem, TradeTransaction, Worker } from "../types/models";
import { formatMoney } from "../utils/paymentMath";
import { expenseCategoryLabels, pokemonCategoryLabels, purchaseSourceLabels } from "../utils/salesControl";
import { allocateTransactionTotal, transactionReview, type AllocationMethod } from "../utils/transactionMath";
import { ownershipIsValid } from "../utils/tradeMath";

const input = "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-base outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950";
const moneyInput = (value: number | undefined, onChange: (value: number) => void) => <input type="number" min="0" step=".01" value={value || ""} onChange={(event) => onChange(Number(event.target.value || 0))} className={input} />;

export function UnifiedTransactionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requestedType = (params.get("type") || "sale") as FinancialTransactionType;
  const requestedMode = params.get("items") === "multiple" ? "multiple" : "single";
  const initial = useMemo(() => ({ ...blankTrade(), transactionType: requestedType, itemMode: requestedMode as TradeTransaction["itemMode"], pricingMode: "individual" as const, paymentMethod: "cash" as SalePaymentMethod, purchaseSource: (params.get("source") || undefined) as PurchaseSource | undefined, expenseCategory: (params.get("category") || undefined) as BusinessExpenseCategory | undefined }), [requestedType, requestedMode]);
  const [transaction, setTransaction] = useState<TradeTransaction>(initial);
  const [inventory, setInventory] = useState<InventoryPurchase[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TradeItem>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [allocation, setAllocation] = useState<AllocationMethod>("market");
  const fileRef = useRef<HTMLInputElement>(null);
  const review = transactionReview(transaction);
  const typeLabel = transaction.transactionType === "sale" ? "Sold" : transaction.transactionType === "purchase" ? "Inventory Purchase" : "Business Cost";
  const fileToDataUrl = async (file: File) => {
    await saveTrade(transaction);
    return (await saveTransactionImage(file, transaction.id, editing?.id, editing ? "item" : "transaction")).imageUrl;
  };

  useEffect(() => {
    void Promise.all([listInventoryPurchases(1000), listPlannerEventOptions(), listWorkers()]).then(async ([rows, eventRows, workerRows]) => {
      const ownership = await listOwnershipShares(rows.map((row) => row.id), []);
      setInventory(rows.map((row) => ({ ...row, ownershipShares: ownership.inventory.get(row.id) || [] })));
      setEvents(eventRows); setWorkers(workerRows);
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Could not load transaction data."));
  }, []);

  const available = inventory.filter((row) => row.status === "in_stock").filter((row) => !search || `${row.itemName} ${row.collectorNumber || ""} ${row.cardSet || ""} ${row.id}`.toLowerCase().includes(search.toLowerCase()));
  const updateItem = (item: TradeItem) => setTransaction((row) => ({ ...row, items: row.items.map((value) => value.id === item.id ? item : value) }));
  const addSaleItem = (purchase: InventoryPurchase) => {
    if (transaction.items.some((item) => item.inventoryPurchaseId === purchase.id)) { setMessage("That inventory item is already selected."); return; }
    const item: TradeItem = { ...blankTradeItem(transaction.id, "outgoing"), inventoryPurchaseId: purchase.id, itemName: purchase.itemName, itemType: purchase.category, quantity: Math.max(1, purchase.quantity - purchase.quantitySold), marketValue: Number(purchase.marketValue || 0), historicalCostBasis: purchase.totalCost, soldPrice: Number(purchase.marketValue || 0), imageUrl: purchase.imageUrl, collectorNumber: purchase.collectorNumber, cardSet: purchase.cardSet, ownershipShares: purchase.ownershipShares || [] };
    setTransaction((row) => ({ ...row, items: row.itemMode === "single" ? [item] : [...row.items, item] }));
  };
  const addIncoming = () => {
    const item = { ...blankTradeItem(transaction.id, transaction.transactionType === "expense" ? "expense" : "incoming"), ownershipShares: [] };
    setTransaction((row) => ({ ...row, items: row.itemMode === "single" ? [item] : [...row.items, item] })); setEditing(item);
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
    try {
      await completeFinancialTransaction(transaction, inventory);
      navigate("/sales", { replace: true });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Transaction could not be completed."); }
    finally { setBusy(false); }
  }
  async function saveDraft() {
    setBusy(true); try { await saveTrade(transaction); setMessage("Draft saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Draft could not be saved."); } finally { setBusy(false); }
  }
  async function transactionPhoto(file?: File) { if (file) { const generalImageUrl = await fileToDataUrl(file); setTransaction((row) => ({ ...row, generalImageUrl })); } }

  return <div className="page-shell min-w-0 overflow-x-hidden pb-28">
    <header className="flex items-start justify-between gap-3"><div><Link to="/sales" className="inline-flex items-center gap-1 text-sm font-black text-violet-600"><ArrowLeft size={16} /> Sales Control</Link><p className="eyebrow mt-2">Unified transaction · {transaction.itemMode === "multiple" ? "Multiple Items / Lot" : "Single Item"}</p><h1 className="text-2xl font-black">{typeLabel}</h1></div><button onClick={() => navigate("/sales")} className="rounded-full bg-slate-100 p-2"><X size={18} /></button></header>
    <div className="grid grid-cols-3 gap-1">{["Shared Info", "Items", "Review"].map((label, index) => <button key={label} onClick={() => setStep(index)} className={`min-h-11 rounded-xl text-xs font-black ${step === index ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{index + 1}. {label}</button>)}</div>
    {message ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">{message}</p> : null}

    {step === 0 ? <section className="surface-card grid gap-3 p-4 sm:grid-cols-2">
      <label><span className="text-xs font-black">Date and time</span><input type="datetime-local" value={new Date(new Date(transaction.tradeDate).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(event) => setTransaction({ ...transaction, tradeDate: new Date(event.target.value).toISOString() })} className={input} /></label>
      <label><span className="text-xs font-black">Event</span><select value={transaction.eventId || ""} onChange={(event) => setTransaction({ ...transaction, eventId: event.target.value || undefined })} className={input}><option value="">No event</option>{events.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label><span className="text-xs font-black">Customer / seller / vendor</span><input value={transaction.tradePartner || ""} onChange={(event) => setTransaction({ ...transaction, tradePartner: event.target.value })} className={input} /></label>
      {transaction.transactionType === "sale" ? <label><span className="text-xs font-black">Payment method</span><select value={transaction.paymentMethod || "cash"} onChange={(event) => setTransaction({ ...transaction, paymentMethod: event.target.value as SalePaymentMethod })} className={input}>{["cash","zelle","venmo","cash_app","paypal","card","other"].map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</select></label> : null}
      {transaction.transactionType === "purchase" ? <label><span className="text-xs font-black">Purchase source</span><select value={transaction.purchaseSource || "other"} onChange={(event) => setTransaction({ ...transaction, purchaseSource: event.target.value as PurchaseSource })} className={input}>{Object.entries(purchaseSourceLabels).filter(([value]) => value !== "trade").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
      {transaction.transactionType === "expense" ? <label><span className="text-xs font-black">Expense category</span><select value={transaction.expenseCategory || "other"} onChange={(event) => setTransaction({ ...transaction, expenseCategory: event.target.value as BusinessExpenseCategory })} className={input}>{Object.entries(expenseCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
      <label><span className="text-xs font-black">{transaction.transactionType === "sale" ? "Entered by" : "Who paid"}</span><select value={(transaction.transactionType === "sale" ? transaction.enteredByWorkerId : transaction.paidByWorkerId) || ""} onChange={(event) => setTransaction({ ...transaction, ...(transaction.transactionType === "sale" ? { enteredByWorkerId: event.target.value || undefined } : { paidByWorkerId: event.target.value || undefined }) })} className={input}><option value="">Unassigned</option>{workers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="sm:col-span-2"><span className="text-xs font-black">Transaction photo / receipt</span><input type="file" accept="image/*" capture="environment" onChange={(event) => void transactionPhoto(event.target.files?.[0])} className={input} />{transaction.generalImageUrl ? <img src={transaction.generalImageUrl} className="mt-2 max-h-52 w-full rounded-xl object-contain" /> : null}</label>
      <label className="sm:col-span-2"><span className="text-xs font-black">Notes</span><textarea value={transaction.notes || ""} onChange={(event) => setTransaction({ ...transaction, notes: event.target.value })} rows={3} className={input} /></label>
    </section> : null}

    {step === 1 ? <section className="space-y-3">
      {transaction.transactionType === "sale" ? <div className="surface-card p-4"><h2 className="font-black">Search Existing Inventory</h2><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, collector number, set, inventory ID…" className={`${input} mt-2`} /><div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{available.map((row) => <button key={row.id} onClick={() => addSaleItem(row)} className="flex w-full items-center gap-2 rounded-xl border p-2 text-left">{row.imageUrl ? <img src={row.imageUrl} className="size-12 rounded-lg object-contain" /> : <div className="size-12 rounded-lg bg-slate-100" />}<span className="min-w-0 flex-1"><b className="block truncate">{row.itemName}</b><small>{formatMoney(row.totalCost)} basis · {formatMoney(row.marketValue || 0)} market</small></span><PackagePlus size={17} /></button>)}</div></div> : <button onClick={addIncoming} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 font-black text-white"><PackagePlus size={18} /> {transaction.transactionType === "expense" ? "Add Expense Details" : "Add Purchased Item"}</button>}
      {transaction.transactionType !== "expense" && transaction.itemMode === "multiple" ? <div className="surface-card grid gap-2 p-4 sm:grid-cols-[1fr_1fr_auto]"><select value={transaction.pricingMode} onChange={(event) => setTransaction({ ...transaction, pricingMode: event.target.value as TradeTransaction["pricingMode"] })} className={input}><option value="individual">Individual Prices</option><option value="bundle_total">Bundle Total</option></select>{transaction.pricingMode === "bundle_total" ? <>{moneyInput(transaction.bundleTotal, (bundleTotal) => setTransaction({ ...transaction, bundleTotal }))}<select value={allocation} onChange={(event) => setAllocation(event.target.value as AllocationMethod)} className={input}><option value="market">Market Value</option><option value="equal">Equal Split</option><option value="cost">Cost Basis</option><option value="custom">Custom</option></select><button onClick={allocate} className="rounded-xl bg-violet-600 px-3 font-black text-white sm:col-span-3 min-h-11">Allocate {formatMoney(transaction.bundleTotal || 0)}</button></> : null}</div> : null}
      <div className="space-y-2">{transaction.items.map((item) => <article key={item.id} className="surface-card flex items-center gap-3 p-3">{item.imageUrl || transaction.generalImageUrl ? <img src={item.imageUrl || transaction.generalImageUrl} className="size-14 rounded-lg object-contain" /> : <div className="size-14 rounded-lg bg-slate-100" />}<div className="min-w-0 flex-1"><b className="block truncate">{item.itemName || "Details pending"}</b><p className="text-xs text-slate-500">{transaction.transactionType === "sale" ? `${formatMoney(item.soldPrice || 0)} sold · ${formatMoney(item.historicalCostBasis)} basis` : `${formatMoney(item.boughtPrice || 0)} cost · ${formatMoney(item.marketValue)} market`} · {item.ownershipShares.map((share) => `${workers.find((row) => row.id === share.workerId)?.name} ${share.ownershipPercentage}%`).join(", ") || "Unassigned"}</p></div><button onClick={() => setEditing(item)} className="rounded-lg bg-violet-100 px-2 py-2 text-xs font-black text-violet-700">Edit</button><button onClick={() => { const duplicate = { ...item, id: crypto.randomUUID(), inventoryPurchaseId: undefined }; setTransaction({ ...transaction, items: [...transaction.items, duplicate] }); }} className="rounded-lg bg-slate-100 p-2"><Copy size={15} /></button><button onClick={() => setTransaction({ ...transaction, items: transaction.items.filter((row) => row.id !== item.id) })} className="rounded-lg bg-rose-50 p-2 text-rose-600"><Trash2 size={15} /></button></article>)}</div>
    </section> : null}

    {step === 2 ? <section className="space-y-3"><div className="surface-card p-4"><p className="eyebrow">Transaction Review</p><h2 className="text-xl font-black">{typeLabel} · {transaction.items.length} item{transaction.items.length === 1 ? "" : "s"}</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Cash received", transaction.transactionType === "sale" ? review.sold : 0],["Cash paid", transaction.transactionType === "purchase" ? review.bought : transaction.transactionType === "expense" ? Number(transaction.bundleTotal || 0) : 0],["Cost basis", review.basis],["Gross profit", review.grossProfit]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-3"><small className="block text-slate-500">{label}</small><b>{formatMoney(Number(value))}</b></div>)}</div>{transaction.pricingMode === "bundle_total" && Math.abs(review.bundleDifference) > .009 ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">Bundle allocation is off by {formatMoney(review.bundleDifference)}.</p> : null}{transaction.items.some((item) => transaction.transactionType !== "expense" && !ownershipIsValid(item)) ? <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">One or more item ownership splits do not total 100%.</p> : null}{transaction.items.some((item) => !item.historicalCostBasis && transaction.transactionType === "sale") ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">One or more sold items has a missing cost basis.</p> : null}</div><div className="surface-card p-4"><h3 className="font-black">Owner profit shares</h3>{Array.from(review.ownerProfit.entries()).map(([workerId, amount]) => <p key={workerId} className="mt-1 text-sm">{workers.find((row) => row.id === workerId)?.name || "Owner"}: <b>{formatMoney(amount)}</b></p>)}{!review.ownerProfit.size ? <p className="text-sm text-slate-500">Calculated from each item’s ownership after items are assigned.</p> : null}</div></section> : null}

    {editing ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 sm:items-center sm:p-4"><section className="max-h-[94dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 dark:bg-slate-900 sm:rounded-3xl"><div className="flex justify-between"><h2 className="text-xl font-black">Transaction Item</h2><button onClick={() => setEditing(undefined)}><X /></button></div><label><span className="text-xs font-black">Item / description</span><input value={editing.itemName} onChange={(event) => { const item = { ...editing, itemName: event.target.value }; setEditing(item); updateItem(item); }} className={input} /></label>{transaction.transactionType !== "expense" ? <><div className="grid grid-cols-2 gap-2"><label><span className="text-xs font-black">Item type</span><select value={editing.itemType} onChange={(event) => { const item = { ...editing, itemType: event.target.value as PokemonProductCategory }; setEditing(item); updateItem(item); }} className={input}>{Object.entries(pokemonCategoryLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="text-xs font-black">Market value</span>{moneyInput(editing.marketValue, (marketValue) => { const item = { ...editing, marketValue }; setEditing(item); updateItem(item); })}</label><label><span className="text-xs font-black">{transaction.transactionType === "sale" ? "Sold price" : "Bought price"}</span>{moneyInput(transaction.transactionType === "sale" ? editing.soldPrice : editing.boughtPrice, (value) => { const item = transaction.transactionType === "sale" ? { ...editing, soldPrice: value } : { ...editing, boughtPrice: value, allocatedCostBasis: value }; setEditing(item); updateItem(item); })}</label><label><span className="text-xs font-black">Collector number</span><input value={editing.collectorNumber || ""} onChange={(event) => { const item = { ...editing, collectorNumber: event.target.value }; setEditing(item); updateItem(item); }} className={input} /></label></div><OwnershipEditor workers={workers} shares={editing.ownershipShares} totalCost={transaction.transactionType === "sale" ? editing.historicalCostBasis : Number(editing.boughtPrice || 0)} onChange={(ownershipShares: OwnershipShare[]) => { const item = { ...editing, ownershipShares }; setEditing(item); updateItem(item); }} /></> : <label><span className="text-xs font-black">Amount</span>{moneyInput(transaction.bundleTotal, (bundleTotal) => setTransaction({ ...transaction, bundleTotal }))}</label>}<input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const item = { ...editing, imageUrl: await fileToDataUrl(file) }; setEditing(item); updateItem(item); }} /><button onClick={() => fileRef.current?.click()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 font-black"><Camera size={17} /> Take / Upload Item Photo</button><button onClick={() => setEditing(undefined)} className="btn-primary w-full"><Check size={17} /> Done</button></section></div> : null}

    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:bg-slate-950/95 lg:left-64"><div className="mx-auto flex max-w-4xl gap-2"><button onClick={() => setStep(Math.max(0, step - 1))} disabled={!step} className="min-h-12 rounded-xl bg-slate-100 px-3 font-black disabled:opacity-40"><ArrowLeft size={17} /></button><button onClick={() => void saveDraft()} disabled={busy} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-100 px-3 font-black text-amber-800"><Save size={17} /> Draft</button>{step < 2 ? <button onClick={() => setStep(step + 1)} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 font-black text-white">Next <ArrowRight size={17} /></button> : <button onClick={() => void complete()} disabled={busy} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-black text-white"><Check size={17} /> Complete</button>}</div></div>
  </div>;
}
