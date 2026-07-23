import { BarChart3, Camera, ChartArea, ChartBarStacked, ChartPie, FileSpreadsheet, LineChart, PackagePlus, Plus, Receipt, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { BusinessExpense, Event, InventoryPurchase, SalesRecord, Worker } from "../../types/models";
import { filterFinancialRecords, financialDateRangeLabels, type FinancialDateRange } from "../../utils/financialDateRange";
import { formatMoney } from "../../utils/paymentMath";
import { effectiveSaleOwnership, expenseCategoryLabels, financialOverview, inventoryQuantitySummary, inventoryStatusLabels, ownerProfitRows, pokemonCategoryLabels, saleProfit } from "../../utils/salesControl";
import { ImageLightbox } from "./ImageLightbox";

type FeedFilter = "all" | "in_stock" | "sold" | "sales" | "purchases" | "expenses" | "missing";
type ChartMetric = "revenue" | "gross_profit" | "net_profit" | "expenses" | "inventory" | "unsold_inventory" | "items_sold" | "average_sale" | "owner_profit";
type ChartGrouping = "daily" | "weekly" | "monthly" | "event" | "category" | "owner" | "payment";
type ChartStyle = "line" | "bar" | "area" | "donut" | "stacked";

type Props = {
  sales: SalesRecord[];
  purchases: InventoryPurchase[];
  expenses: BusinessExpense[];
  events: Event[];
  workers: Worker[];
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

function dateGroup(value: string, grouping: ChartGrouping) {
  const date = new Date(value);
  if (grouping === "monthly") return { key: value.slice(0, 7), label: date.toLocaleDateString([], { month: "short", year: "2-digit" }) };
  if (grouping === "weekly") {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
    const key = start.toISOString().slice(0, 10);
    return { key, label: `Week of ${start.toLocaleDateString([], { month: "short", day: "numeric" })}` };
  }
  return { key: value.slice(0, 10), label: date.toLocaleDateString([], { month: "short", day: "numeric" }) };
}

export function SalesAnalyticsPanel(props: Props) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  const [chartGrouping, setChartGrouping] = useState<ChartGrouping>("daily");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string }>();
  const filtered = useMemo(() => filterFinancialRecords(props.sales, props.purchases, props.expenses, props.events, props.dateRange, props.customStart, props.customEnd), [props.sales, props.purchases, props.expenses, props.events, props.dateRange, props.customStart, props.customEnd]);
  const overview = useMemo(() => financialOverview(filtered.sales, filtered.purchases, filtered.expenses, filtered.events), [filtered]);

  const chartRows = useMemo(() => {
    const buckets = new Map<string, { label: string; total: number; count: number; segments: Map<string, number> }>();
    const eventNames = new Map(props.events.map((event) => [event.id, event.name]));
    const workerNames = new Map(props.workers.map((worker) => [worker.id, worker.name]));
    const add = (key: string, label: string, value: number, count = 1) => {
      const old = buckets.get(key) || { label, total: 0, count: 0, segments: new Map<string, number>() };
      buckets.set(key, { label, total: old.total + value, count: old.count + count, segments: old.segments });
    };
    const addSegment = (key: string, label: string, segment: string, value: number) => {
      const old = buckets.get(key) || { label, total: 0, count: 0, segments: new Map<string, number>() };
      old.total += value;
      old.count += 1;
      old.segments.set(segment, (old.segments.get(segment) || 0) + value);
      buckets.set(key, old);
    };
    const group = (date: string, eventId?: string, category?: string, payment?: string) => {
      if (chartGrouping === "event") return { key: eventId || "unassigned", label: eventNames.get(eventId || "") || "No event" };
      if (chartGrouping === "category") return { key: category || "other", label: pokemonCategoryLabels[category as keyof typeof pokemonCategoryLabels] || expenseCategoryLabels[category as keyof typeof expenseCategoryLabels] || "Other" };
      if (chartGrouping === "payment") return { key: payment || "unassigned", label: payment ? payment.replace(/_/g, " ") : "Not recorded" };
      return dateGroup(date, chartGrouping);
    };
    if (chartMetric === "owner_profit" && chartGrouping !== "owner") {
      filtered.sales.forEach((sale) => {
        const g = group(sale.soldAt, sale.eventId, sale.category, sale.paymentMethod);
        const shares = effectiveSaleOwnership(sale, props.purchases);
        if (!shares.length) addSegment(g.key, g.label, "Unassigned", saleProfit(sale));
        shares.forEach((share) => addSegment(g.key, g.label, workerNames.get(share.workerId) || "Other owner", saleProfit(sale) * share.ownershipPercentage / 100));
      });
    } else if (chartMetric === "owner_profit" || chartGrouping === "owner") {
      filtered.sales.forEach((sale) => {
        const shares = effectiveSaleOwnership(sale, props.purchases);
        if (!shares.length) add("unassigned", "Unassigned", chartMetric === "items_sold" ? Number(sale.quantity || 1) : chartMetric === "revenue" ? Number(sale.soldPrice || 0) : saleProfit(sale));
        shares.forEach((share) => {
          const ratio = share.ownershipPercentage / 100;
          const value = chartMetric === "items_sold" ? Number(sale.quantity || 1) * ratio : chartMetric === "revenue" ? Number(sale.soldPrice || 0) * ratio : saleProfit(sale) * ratio;
          add(share.workerId, workerNames.get(share.workerId) || "Other owner", value);
        });
      });
    } else if (chartMetric === "expenses") {
      filtered.expenses.forEach((row) => { const g = group(row.expenseDate, row.eventId, row.category); add(g.key, g.label, Number(row.amount || 0)); });
    } else if (chartMetric === "inventory" || chartMetric === "unsold_inventory") {
      filtered.purchases.filter((row) => chartMetric === "inventory" || row.status !== "sold").forEach((row) => {
        const g = group(row.purchaseDate, row.eventId, row.category);
        const remainingRatio = chartMetric === "unsold_inventory" ? Math.max(0, row.quantity - row.quantitySold) / Math.max(1, row.quantity) : 1;
        add(g.key, g.label, Number(row.totalCost || 0) * remainingRatio);
      });
    } else {
      filtered.sales.forEach((row) => {
        const g = group(row.soldAt, row.eventId, row.category, row.paymentMethod);
        const value = chartMetric === "revenue" || chartMetric === "average_sale" ? Number(row.soldPrice || 0)
          : chartMetric === "items_sold" ? Number(row.quantity || 1) : saleProfit(row);
        add(g.key, g.label, value);
      });
      if (chartMetric === "net_profit") filtered.expenses.forEach((row) => { const g = group(row.expenseDate, row.eventId, row.category); add(g.key, g.label, -Number(row.amount || 0), 0); });
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => ({
      key, label: row.label, value: chartMetric === "average_sale" && row.count ? row.total / row.count : row.total,
      segments: Array.from(row.segments.entries()).map(([label, value]) => ({ label, value }))
    }));
  }, [filtered, chartMetric, chartGrouping, props.events, props.workers, props.purchases]);

  const maxChart = Math.max(1, ...chartRows.map((row) => Math.abs(row.value)));
  const linePoints = chartRows.map((row, index) => {
    const x = chartRows.length <= 1 ? 300 : 20 + index / (chartRows.length - 1) * 560;
    const y = 160 - Math.max(0, row.value) / maxChart * 130;
    return `${x},${y}`;
  }).join(" ");
  const ownerRows = useMemo(() => ownerProfitRows(filtered.sales, props.purchases), [filtered.sales, props.purchases]);
  const ownerInventory = useMemo(() => {
    const totals = new Map<string, { cost: number; unsold: number; balance: number }>();
    filtered.purchases.forEach((purchase) => (purchase.ownershipShares || []).forEach((share) => {
      const current = totals.get(share.workerId) || { cost: 0, unsold: 0, balance: 0 };
      const ownedCost = Number(purchase.totalCost || 0) * share.ownershipPercentage / 100;
      const unsoldRatio = Math.max(0, purchase.quantity - purchase.quantitySold) / Math.max(1, purchase.quantity);
      current.cost += ownedCost;
      current.unsold += ownedCost * unsoldRatio;
      if (purchase.purchasedByWorkerId && purchase.purchasedByWorkerId !== share.workerId) current.balance += ownedCost;
      totals.set(share.workerId, current);
    }));
    return totals;
  }, [filtered.purchases]);
  const donutTotal = chartRows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  const donutColors = ["#F45D13", "#0284c7", "#16a34a", "#a855f7", "#eab308", "#e11d48", "#64748b"];
  let donutCursor = 0;
  const donutGradient = chartRows.map((row, index) => {
    const start = donutCursor;
    donutCursor += donutTotal ? Math.max(0, row.value) / donutTotal * 360 : 0;
    return `${donutColors[index % donutColors.length]} ${start}deg ${donutCursor}deg`;
  }).join(", ");
  const temporalGrouping = chartGrouping === "daily" || chartGrouping === "weekly" || chartGrouping === "monthly";
  const availableStyles: ChartStyle[] = temporalGrouping
    ? ["line", "bar", "area", ...(chartMetric === "owner_profit" ? ["stacked" as const] : [])]
    : ["bar", "donut", ...(["event", "category", "owner"].includes(chartGrouping) ? ["stacked" as const] : [])];
  const visibleChartStyle = availableStyles.includes(chartStyle) ? chartStyle : availableStyles[0];
  useEffect(() => {
    if (!availableStyles.includes(chartStyle)) setChartStyle(availableStyles[0]);
  }, [availableStyles, chartStyle]);

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
        {ownerRows.size || ownerInventory.size ? <div className="grid grid-cols-2 gap-2">{props.workers.filter((worker) => ownerRows.has(worker.id) || ownerInventory.has(worker.id)).map((worker) => <div key={worker.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><p className="text-xs font-black text-slate-500">{worker.name}</p><p className="text-lg font-black text-emerald-600">{formatMoney(ownerRows.get(worker.id)?.profit || 0)} profit</p><p className="text-[11px] text-slate-500">{formatMoney(ownerRows.get(worker.id)?.revenue || 0)} revenue · {(ownerRows.get(worker.id)?.itemsSold || 0).toFixed(1)} items</p><p className="text-[11px] text-slate-500">{formatMoney(ownerInventory.get(worker.id)?.cost || 0)} inventory · {formatMoney(ownerInventory.get(worker.id)?.unsold || 0)} unsold</p>{ownerInventory.get(worker.id)?.balance ? <p className="text-[11px] font-bold text-amber-600">{formatMoney(ownerInventory.get(worker.id)?.balance || 0)} advanced by another owner</p> : null}</div>)}</div> : null}
      </section>

      <section className="surface-card space-y-3 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2"><div><p className="eyebrow">Charts</p><h2 className="font-black text-ink dark:text-white">Explore performance</h2></div><BarChart3 className="text-coral" size={20} /></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-black text-slate-500">Metric<select value={chartMetric} onChange={(event) => setChartMetric(event.target.value as ChartMetric)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-ink dark:border-slate-800 dark:bg-slate-950 dark:text-white">{([["revenue","Revenue"],["gross_profit","Gross Profit"],["net_profit","Net Profit"],["expenses","Expenses"],["inventory","Inventory Purchases"],["unsold_inventory","Unsold Inventory"],["items_sold","Items Sold"],["average_sale","Average Sale"],["owner_profit","Owner Profit"]] as [ChartMetric,string][]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">Group by<select value={chartGrouping} onChange={(event) => setChartGrouping(event.target.value as ChartGrouping)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-ink dark:border-slate-800 dark:bg-slate-950 dark:text-white">{([["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"],["event","Event"],["category","Category"],["owner","Owner"],["payment","Payment Method"]] as [ChartGrouping,string][]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div>
          <p className="mb-1 text-xs font-black text-slate-500">Chart type</p>
          <div className="flex max-w-full flex-wrap gap-2" role="group" aria-label="Chart type">
            {([
              ["line", "Line", LineChart],
              ["bar", "Bar", BarChart3],
              ["area", "Area", ChartArea],
              ["donut", "Donut", ChartPie],
              ["stacked", "Stacked Bar", ChartBarStacked]
            ] as const).filter(([value]) => availableStyles.includes(value)).map(([value, label, Icon]) => {
              const selected = visibleChartStyle === value;
              return <button key={value} type="button" aria-pressed={selected} onClick={() => setChartStyle(value)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black transition duration-150 active:scale-[0.97] ${selected ? "border-coral bg-coral text-white shadow-sm shadow-orange-950/20" : "border-slate-700 bg-slate-900 text-slate-200 hover:border-coral/70 hover:bg-slate-800 hover:text-white"}`}><Icon size={17} aria-hidden="true" />{label}</button>;
            })}
          </div>
        </div>
        {chartRows.length ? visibleChartStyle === "line" || visibleChartStyle === "area" ? <div className="overflow-hidden rounded-xl bg-slate-50 p-2 dark:bg-slate-950/70"><svg viewBox="0 0 600 180" className="h-44 w-full" role="img" aria-label={`${chartMetric} chart`}>{visibleChartStyle === "area" ? <polygon points={`20,160 ${linePoints} 580,160`} fill="#F45D1333" /> : null}<line x1="20" y1="160" x2="580" y2="160" stroke="currentColor" className="text-slate-300 dark:text-slate-700" /><polyline points={linePoints} fill="none" stroke="#F45D13" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />{chartRows.map((row, index) => { const [x, y] = linePoints.split(" ")[index].split(","); return <circle key={row.key} cx={x} cy={y} r="6" fill="#F45D13"><title>{row.label}: {formatMoney(row.value)}</title></circle>; })}</svg><div className="flex justify-between gap-1 text-[10px] text-slate-500">{chartRows.slice(-6).map((row) => <span key={row.key}>{row.label}</span>)}</div></div>
          : visibleChartStyle === "donut" ? <div className="grid items-center gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 dark:bg-slate-950/70"><div className="mx-auto flex size-44 items-center justify-center rounded-full" style={{ background: `conic-gradient(${donutGradient})` }}><div className="flex size-24 items-center justify-center rounded-full bg-white text-center text-sm font-black dark:bg-slate-900">{formatMoney(donutTotal)}<br />Total</div></div><div className="space-y-2">{chartRows.map((row, index) => <div key={row.key} className="flex items-center gap-2 text-xs"><span className="size-3 rounded-full" style={{ backgroundColor: donutColors[index % donutColors.length] }} /><span className="min-w-0 flex-1 truncate font-bold">{row.label}</span><span>{formatMoney(row.value)}</span></div>)}</div></div>
          : <div className="flex h-56 items-end gap-2 overflow-x-auto rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70">{chartRows.map((row, index) => <div key={row.key} className="flex min-w-16 flex-1 flex-col items-center justify-end gap-1"><span className="text-[10px] font-bold">{chartMetric === "items_sold" ? row.value.toFixed(1) : formatMoney(row.value)}</span>{visibleChartStyle === "stacked" && row.segments.length ? <div className="flex w-full max-w-14 flex-col-reverse overflow-hidden rounded-t-lg" style={{ height: `${Math.max(4, Math.abs(row.value) / maxChart * 150)}px` }}>{row.segments.map((segment, segmentIndex) => <div key={segment.label} title={`${segment.label}: ${formatMoney(segment.value)}`} style={{ height: `${Math.abs(segment.value) / Math.max(0.01, Math.abs(row.value)) * 100}%`, backgroundColor: donutColors[segmentIndex % donutColors.length] }} />)}</div> : <div className="w-full max-w-14 rounded-t-lg bg-coral" style={{ height: `${Math.max(4, Math.abs(row.value) / maxChart * 150)}px`, backgroundColor: donutColors[index % donutColors.length] }} />}<span className="max-w-20 truncate text-[10px] text-slate-500">{row.label}</span></div>)}</div>
          : <div className="flex h-44 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500 dark:bg-slate-950/70">No records in this date range.</div>}
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
