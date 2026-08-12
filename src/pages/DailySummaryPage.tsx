import { ArrowLeft, CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listBusinessExpenses } from "../services/database/businessExpenseRepository";
import { listInventoryPurchases } from "../services/database/inventoryPurchaseRepository";
import { listOwnershipShares } from "../services/database/ownershipRepository";
import { listSalesRecordsPage } from "../services/database/salesRepository";
import { listFinancialTransactions } from "../services/database/tradeRepository";
import { listWorkers } from "../services/database/workerRepository";
import type { BusinessExpense, InventoryPurchase, SalesRecord, TradeTransaction, Worker } from "../types/models";
import { formatMoney } from "../utils/paymentMath";
import { dailyFinancialSummary } from "../utils/transactionMath";

export function DailySummaryPage() {
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [sales, setSales] = useState<SalesRecord[]>([]);
  const [purchases, setPurchases] = useState<InventoryPurchase[]>([]);
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [transactions, setTransactions] = useState<TradeTransaction[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([listSalesRecordsPage(0, 1000), listInventoryPurchases(1000), listBusinessExpenses(1000), listFinancialTransactions(), listWorkers()]).then(async ([salePage, inventoryRows, expenseRows, transactionRows, workerRows]) => {
      const ownership = await listOwnershipShares(inventoryRows.map((row) => row.id), salePage.records.map((row) => row.id));
      setSales(salePage.records.map((row) => ({ ...row, ownershipShares: ownership.sales.get(row.id) || inventoryRows.find((item) => item.id === row.inventoryPurchaseId)?.ownershipShares || [] })));
      setPurchases(inventoryRows); setExpenses(expenseRows); setTransactions(transactionRows); setWorkers(workerRows);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the daily summary."));
  }, []);
  const summary = useMemo(() => dailyFinancialSummary(date, sales, purchases, expenses, transactions), [date, sales, purchases, expenses, transactions]);
  const card = (label: string, value: number | string, tone = "text-ink dark:text-white") => <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><p className="text-xs font-bold text-slate-500">{label}</p><p className={`mt-1 text-lg font-black ${tone}`}>{typeof value === "number" ? formatMoney(value) : value}</p></div>;
  return <div className="page-shell min-w-0 overflow-x-hidden"><header><Link to="/sales" className="inline-flex items-center gap-1 text-sm font-black text-violet-600"><ArrowLeft size={16} /> Sales Control</Link><div className="mt-2 flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Financial closeout</p><h1 className="text-3xl font-black">Daily Summary</h1><p className="text-sm text-slate-500">Cash, inventory movement, profit, and ownership without duplicated totals.</p></div><label className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-3 font-black shadow-sm dark:bg-slate-900"><CalendarDays size={18} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="bg-transparent outline-none" /></label></div></header>{error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}
    <section className="overflow-hidden rounded-[1.5rem] border border-slate-800 bg-gradient-to-br from-slate-950 to-indigo-950 p-4 text-white shadow-xl"><p className="text-xs font-black uppercase tracking-[.18em] text-violet-300">Today at a glance</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{card("Net cash",summary.netCashFlow,summary.netCashFlow >= 0 ? "text-emerald-600" : "text-rose-600")}{card("Revenue",summary.salesRevenue)}{card("Spent",summary.inventorySpent,"text-rose-600")}{card("Cash margin",summary.cashMargin,summary.cashMargin >= 0 ? "text-emerald-600" : "text-rose-600")}{card("Transactions",String(summary.transactionCount))}{card("Cards moved",String(summary.cardsMoved))}{card("Sales",String(summary.saleCount))}{card("Buys",String(summary.purchaseCount))}{card("Trades",String(summary.tradeCount))}{card("Sale profit",summary.realizedGrossProfit)}{card("Trade gain",summary.estimatedTradeGainLoss)}{card("Inventory market",summary.currentInventoryMarketValue)}</div><p className="mt-3 text-xs text-slate-400">Inventory market value is a current asset snapshot. It is not included in revenue or cash margin.</p></section>
    <section className="surface-card p-4"><p className="eyebrow">Cash</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{card("Cash sales",summary.cashSales)}{card("Digital sales",summary.digitalSales)}{card("Inventory purchases",summary.inventorySpent,"text-rose-600")}{card("Operating expenses",summary.operatingExpenses,"text-rose-600")}{card("Table fees",summary.tableFees,"text-rose-600")}{card("Trade cash received",summary.tradeCashReceived,"text-emerald-600")}{card("Trade cash paid",summary.tradeCashPaid,"text-rose-600")}{card("Net cash flow",summary.netCashFlow,summary.netCashFlow >= 0 ? "text-emerald-600" : "text-rose-600")}</div></section>
    <section className="surface-card p-4"><p className="eyebrow">Inventory</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{card("Items bought",String(summary.inventoryBought))}{card("Items sold",String(summary.inventorySold))}{card("Items traded out",String(summary.inventoryTradedOut))}{card("Items received in trades",String(summary.inventoryReceived))}</div></section>
    <section className="surface-card p-4"><p className="eyebrow">Profit</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{card("Realized gross profit",summary.realizedGrossProfit)}{card("Estimated trade gain/loss",summary.estimatedTradeGainLoss)}{card("Overall estimated result",summary.overallEstimatedResult,summary.overallEstimatedResult >= 0 ? "text-emerald-600" : "text-rose-600")}{workers.map((worker) => card(`${worker.name} profit`,summary.ownerProfit.get(worker.id) || 0))}</div><p className="mt-3 text-xs text-slate-500">Trade market value is excluded from cash revenue. Table fees are expenses, not inventory. Linked transaction headers are not summed in addition to their legacy records.</p></section>
  </div>;
}
