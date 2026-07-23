import { BarChart3, Camera, FileSpreadsheet, LineChart, PackagePlus, Plus, Receipt, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import type { BusinessExpense, Event, InventoryPurchase, SalesRecord } from "../../types/models";
import { filterFinancialRecords, financialDateRangeLabels, type FinancialDateRange } from "../../utils/financialDateRange";
import { formatMoney } from "../../utils/paymentMath";
import { expenseCategoryLabels, financialOverview, inventoryQuantitySummary, inventoryStatusLabels, pokemonCategoryLabels, saleProfit } from "../../utils/salesControl";
import { ImageLightbox } from "./ImageLightbox";

type FeedFilter = "all" | "in_stock" | "sold" | "sales" | "purchases" | "expenses" | "missing";
type ChartMetric = "revenue" | "profit" | "expenses" | "inventory";
type ChartStyle = "line" | "bar";

type Props = {
  sales: SalesRecord[];
  purchases: InventoryPurchase[];
  expenses: BusinessExpense[];
  events: Event[];
  dateRange: FinancialDateRange;
  customStart: string;
  customEnd: string;
  onDateRange: (range: FinancialDateRange) => void;
  onCustomStart: (value: string) => void;
  onCustomEnd: (value: string) => void;
  onAddSale: () => void;
  onAddPurchase: () => void;
  onAddExpense: () => void;
  onOpenSpreadsheet: () => void;
  onEditSale: (sale: SalesRecord) => void;
  onEditPurchase: (purchase: InventoryPurchase) => void;
  onEditExpense: (expense: BusinessExpense) => void;
};

function dateKey(value: string, monthly: boolean) {
  return monthly ? value.slice(0, 7) : value.slice(0, 10);
}

export function SalesAnalyticsPanel(props: Props) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string }>();
  const filtered = useMemo(() => filterFinancialRecords(props.sales, props.purchases, props.expenses, props.events, props.dateRange, props.customStart, props.customEnd), [props.sales, props.purchases, props.expenses, props.events, props.dateRange, props.customStart, props.customEnd]);
  const overview = useMemo(() => financialOverview(filtered.sales, filtered.purchases, filtered.expenses, filtered.events), [filtered]);

  const chartRows = useMemo(() => {
    const monthly = props.dateRange === "this_year";
    const buckets = new Map<string, number>();
    const add = (key: string, value: number) => buckets.set(key, (buckets.get(key) || 0) + value);
    if (chartMetric === "revenue" || chartMetric === "profit") {
      filtered.sales.forEach((sale) => add(dateKey(sale.soldAt, monthly), chartMetric === "revenue" ? Number(sale.soldPrice || 0) : saleProfit(sale)));
    } else if (chartMetric === "expenses") {
      filtered.expenses.forEach((expense) => add(dateKey(expense.expenseDate, monthly), Number(expense.amount || 0)));
    } else {
      filtered.purchases.forEach((purchase) => add(dateKey(purchase.purchaseDate, monthly), Number(purchase.totalCost || 0)));
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({
      key,
      label: monthly ? new Date(`${key}-01T12:00:00`).toLocaleDateString([], { month: "short" }) : new Date(`${key}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" }),
      value
    }));
  }, [filtered, chartMetric, props.dateRange]);

  const maxChart = Math.max(1, ...chartRows.map((row) => Math.abs(row.value)));
  const linePoints = chartRows.map((row, index) => {
    const x = chartRows.length <= 1 ? 300 : 20 + index / (chartRows.length - 1) * 560;
    const y = 160 - Math.max(0, row.value) / maxChart * 130;
    return `${x},${y}`;
  }).join(" ");

  const recentRecords = useMemo(() => {
    const rows = [
      ...props.sales.map((sale) => ({ id: `sale-${sale.id}`, type: "sale" as const, date: sale.soldAt, image: sale.imageUrl, missing: !sale.itemName || sale.soldPrice === undefined, sale })),
      ...props.purchases.map((purchase) => ({ id: `purchase-${purchase.id}`, type: "purchase" as const, date: purchase.purchaseDate, image: purchase.imageUrl, missing: !purchase.itemName || !purchase.totalCost, purchase })),
      ...props.expenses.map((expense) => ({ id: `expense-${expense.id}`, type: "expense" as const, date: expense.expenseDate, image: expense.receiptImageUrl, missing: !expense.description || !expense.amount, expense }))
    ].filter((row) => {
      if (feedFilter === "sales") return row.type === "sale";
      if (feedFilter === "purchases") return row.type === "purchase";
      if (feedFilter === "expenses") return row.type === "expense";
      if (feedFilter === "missing") return row.missing;
      if (feedFilter === "in_stock") return row.type === "purchase" && row.purchase.status === "in_stock";
      if (feedFilter === "sold") return row.type === "sale" || (row.type === "purchase" && row.purchase.status === "sold");
      return true;
    });
    return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  }, [props.sales, props.purchases, props.expenses, feedFilter]);

  const summaryCards = [
    ["Revenue", overview.revenue, "text-emerald-600"], ["Gross profit", overview.grossProfit, "text-sky-600"],
    ["Operating expenses", overview.operatingExpenses + overview.eventTableCosts, "text-rose-600"], ["Inventory purchased", overview.inventoryInvestment, "text-amber-600"],
    ["Unsold inventory cost", overview.unsoldInventoryCost, "text-cyan-600"], ["Net profit", overview.netProfit, overview.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"]
  ] as const;

  return (
    <div className="space-y-4">
      <section className="surface-card space-y-3 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Financial overview</p><h2 className="font-black text-ink dark:text-white">Performance</h2></div><TrendingUp className="text-coral" size={22} /></div>
        <select value={props.dateRange} onChange={(event) => props.onDateRange(event.target.value as FinancialDateRange)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white">{Object.entries(financialDateRangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {props.dateRange === "custom" ? <div className="grid grid-cols-2 gap-2"><input type="date" value={props.customStart} onChange={(event) => props.onCustomStart(event.target.value)} className="min-w-0 rounded-xl border border-slate-200 px-2 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white" /><input type="date" value={props.customEnd} onChange={(event) => props.onCustomEnd(event.target.value)} className="min-w-0 rounded-xl border border-slate-200 px-2 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white" /></div> : null}
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">{summaryCards.map(([label, value, color]) => <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70"><p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{label}</p><p className={`mt-1 truncate text-lg font-black ${color}`}>{formatMoney(value)}</p></div>)}</div>
      </section>

      <section className="surface-card space-y-3 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2"><div><p className="eyebrow">Charts</p><h2 className="font-black text-ink dark:text-white">Trend</h2></div><div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-950"><button onClick={() => setChartStyle("line")} aria-label="Line graph" className={`rounded-lg p-2 ${chartStyle === "line" ? "bg-white text-coral shadow-sm dark:bg-slate-800" : "text-slate-400"}`}><LineChart size={17} /></button><button onClick={() => setChartStyle("bar")} aria-label="Bar chart" className={`rounded-lg p-2 ${chartStyle === "bar" ? "bg-white text-coral shadow-sm dark:bg-slate-800" : "text-slate-400"}`}><BarChart3 size={17} /></button></div></div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-950 xl:grid-cols-4">{(["revenue", "profit", "expenses", "inventory"] as ChartMetric[]).map((metric) => <button key={metric} onClick={() => setChartMetric(metric)} className={`min-h-9 rounded-lg px-2 text-xs font-black capitalize ${chartMetric === metric ? "bg-white text-ink shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500"}`}>{metric === "inventory" ? "Purchases" : metric}</button>)}</div>
        {chartRows.length ? chartStyle === "line" ? <div className="overflow-hidden rounded-xl bg-slate-50 p-2 dark:bg-slate-950/70"><svg viewBox="0 0 600 180" className="h-44 w-full" role="img" aria-label={`${chartMetric} line graph`}><line x1="20" y1="160" x2="580" y2="160" stroke="currentColor" className="text-slate-300 dark:text-slate-700" /><polyline points={linePoints} fill="none" stroke="#F45D13" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />{chartRows.map((row, index) => { const [x, y] = linePoints.split(" ")[index].split(","); return <circle key={row.key} cx={x} cy={y} r="7" fill="#F45D13" />; })}</svg><div className="flex justify-between gap-1 text-[10px] text-slate-500">{chartRows.slice(-6).map((row) => <span key={row.key}>{row.label}</span>)}</div></div> : <div className="flex h-52 items-end gap-2 overflow-x-auto rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">{chartRows.map((row) => <div key={row.key} className="flex min-w-12 flex-1 flex-col items-center justify-end gap-1"><span className="text-[10px] font-bold">{formatMoney(row.value)}</span><div className="w-full max-w-12 rounded-t-lg bg-coral" style={{ height: `${Math.max(4, Math.abs(row.value) / maxChart * 150)}px` }} /><span className="text-[10px] text-slate-500">{row.label}</span></div>)}</div> : <div className="flex h-44 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500 dark:bg-slate-950/70">No records in this date range.</div>}
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button onClick={props.onAddSale} className="btn-primary min-h-14"><Camera size={18} /> Add Sale</button>
        <button onClick={props.onAddPurchase} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-sky-600 text-sm font-black text-white"><PackagePlus size={18} /> Add Purchase</button>
        <button onClick={props.onAddExpense} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-black text-white"><Receipt size={18} /> Add Expense</button>
        <button onClick={props.onOpenSpreadsheet} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-black text-white dark:bg-slate-100 dark:text-ink"><FileSpreadsheet size={18} /> Spreadsheet</button>
      </section>

      <section onClickCapture={(event) => {
        const image = (event.target as HTMLElement).closest("img");
        if (!image) return;
        event.preventDefault();
        event.stopPropagation();
        const title = image.closest("button")?.querySelector("p")?.textContent || image.getAttribute("alt") || "Recent Activity image";
        setPreviewImage({ url: image.getAttribute("src") || "", title });
      }} className="surface-card space-y-3 p-3 sm:p-4 [&_img]:cursor-zoom-in [&_img]:border-2 [&_img]:border-transparent [&_img]:transition [&_img]:hover:scale-105 [&_img]:hover:border-coral">
        <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Recent activity</p><h2 className="font-black text-ink dark:text-white">Records & Photos</h2></div><Plus size={18} className="text-coral" /></div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{(["all", "in_stock", "sold", "sales", "purchases", "expenses", "missing"] as FeedFilter[]).map((filter) => <button key={filter} onClick={() => setFeedFilter(filter)} className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-black ${feedFilter === filter ? "bg-coral text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{filter === "in_stock" ? "In Stock" : filter === "missing" ? "Missing Info" : filter.charAt(0).toUpperCase() + filter.slice(1)}</button>)}</div>
        <div className="space-y-2">{recentRecords.length ? recentRecords.map((row) => {
          if (row.type === "sale") return <button key={row.id} onClick={() => props.onEditSale(row.sale)} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-2 text-left dark:bg-slate-950/70">{row.image ? <img src={row.image} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg bg-slate-100 object-contain dark:bg-slate-900" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Camera size={20} /></div>}<div className="min-w-0 flex-1"><p className="truncate font-black text-ink dark:text-white">{row.sale.itemName || "Sale details pending"}</p><p className="text-xs text-slate-500">Bought {formatMoney(row.sale.boughtPrice || 0)} · Sold {formatMoney(row.sale.soldPrice || 0)}</p><p className={`text-xs font-black ${saleProfit(row.sale) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatMoney(saleProfit(row.sale))} profit</p></div><span className="text-[10px] text-slate-500">{new Date(row.date).toLocaleDateString()}</span></button>;
          if (row.type === "purchase") { const summary = inventoryQuantitySummary(row.purchase, props.sales); return <button key={row.id} onClick={() => props.onEditPurchase(row.purchase)} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-2 text-left dark:bg-slate-950/70">{row.image ? <img src={row.image} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg bg-slate-100 object-contain dark:bg-slate-900" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><PackagePlus size={20} /></div>}<div className="min-w-0 flex-1"><p className="truncate font-black text-ink dark:text-white">{row.purchase.itemName}</p><p className="text-xs text-slate-500">{formatMoney(row.purchase.totalCost)} · {summary.quantityRemaining}/{row.purchase.quantity} left</p><span className={`text-xs font-black ${row.purchase.status === "sold" ? "text-emerald-600" : row.purchase.status === "partially_sold" ? "text-amber-600" : row.purchase.status === "personal" ? "text-slate-500" : "text-sky-600"}`}>{inventoryStatusLabels[row.purchase.status]}</span></div><span className="text-[10px] text-slate-500">{new Date(row.date).toLocaleDateString()}</span></button>; }
          return <button key={row.id} onClick={() => props.onEditExpense(row.expense)} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-2 text-left dark:bg-slate-950/70">{row.image ? <img src={row.image} alt={row.expense.description || "Expense receipt"} loading="lazy" className="size-16 shrink-0 rounded-lg bg-slate-100 object-contain dark:bg-slate-900" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700"><Receipt size={20} /></div>}<div className="min-w-0 flex-1"><p className="truncate font-black text-ink dark:text-white">{row.expense.description}</p><p className="text-xs text-slate-500">{expenseCategoryLabels[row.expense.category]}</p><p className="text-xs font-black text-rose-600">-{formatMoney(row.expense.amount)}</p></div><span className="text-[10px] text-slate-500">{new Date(row.date).toLocaleDateString()}</span></button>;
        }) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950/70">No matching records yet.</p>}</div>
      </section>
      <ImageLightbox imageUrl={previewImage?.url} title={previewImage?.title || "Sales Control image"} onClose={() => setPreviewImage(undefined)} />
    </div>
  );
}
