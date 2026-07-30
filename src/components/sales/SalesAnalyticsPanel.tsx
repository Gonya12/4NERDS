import {
  Activity, BadgeDollarSign, BarChart3, Boxes, CalendarDays, Camera, ChartArea, ChartBarStacked, ChartPie,
  Download, FileSpreadsheet, Handshake, LineChart, Maximize2, PackagePlus, Plus, Receipt, TrendingDown,
  TrendingUp, Users, WalletCards, X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { BusinessExpense, Event, InventoryPurchase, SalesRecord, TradeTransaction, Worker } from "../../types/models";
import { filterFinancialRecords, financialDateRangeLabels, isWithinFinancialRange, type FinancialDateRange } from "../../utils/financialDateRange";
import { formatMoney } from "../../utils/paymentMath";
import { effectiveSaleOwnership, expenseCategoryLabels, financialOverview, inventoryQuantitySummary, inventoryStatusLabels, ownerProfitRows, pokemonCategoryLabels, saleProfit } from "../../utils/salesControl";
import { ImageLightbox } from "./ImageLightbox";
import { tradeGainOwnership, tradeSummary } from "../../utils/tradeMath";
import { AppButton, DashboardEmptyState, DashboardPanel, MetricCard } from "./SalesDashboardPrimitives";

type FeedFilter = "all" | "in_stock" | "sold" | "sales" | "purchases" | "trades" | "expenses" | "missing";
type ChartMetric = "revenue" | "sale_profit" | "net_profit" | "expenses" | "inventory_cost_basis" | "inventory_market_value" | "unrealized_inventory_gain" | "items_sold" | "average_sale" | "owner_profit" | "trade_value" | "trade_value_in" | "trade_value_out" | "trade_gain" | "trade_cash_received" | "trade_cash_paid" | "trade_count" | "average_trade";
type ChartGrouping = "daily" | "weekly" | "monthly" | "event" | "category" | "owner" | "payment";
type ChartStyle = "line" | "bar" | "area" | "donut" | "stacked";

type Props = {
  sales: SalesRecord[];
  purchases: InventoryPurchase[];
  expenses: BusinessExpense[];
  events: Event[];
  workers: Worker[];
  trades: TradeTransaction[];
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
  onOpenDaily: () => void;
  onOpenTrades: () => void;
  onExport: () => void;
  onBatchInventory: () => void;
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
  const [chartExpanded, setChartExpanded] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string }>();
  const filtered = useMemo(() => filterFinancialRecords(props.sales, props.purchases, props.expenses, props.events, props.dateRange, props.customStart, props.customEnd), [props.sales, props.purchases, props.expenses, props.events, props.dateRange, props.customStart, props.customEnd]);
  const filteredTrades = useMemo(() => props.trades.filter((trade) => trade.status === "completed" && (trade.transactionType === "trade" || trade.transactionType === "cash_trade") && isWithinFinancialRange(trade.tradeDate, props.dateRange, props.customStart, props.customEnd)), [props.trades, props.dateRange, props.customStart, props.customEnd]);
  const overview = useMemo(() => financialOverview(filtered.sales, filtered.purchases, filtered.expenses, filtered.events, filteredTrades), [filtered, filteredTrades]);

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
    if (chartMetric.startsWith("trade_") || chartMetric === "average_trade") {
      filteredTrades.forEach((trade) => {
        const summary = tradeSummary(trade);
        const value = chartMetric === "trade_value" ? (summary.outgoingAgreed + summary.incomingAgreed) / 2
          : chartMetric === "trade_value_in" ? summary.incomingAgreed
          : chartMetric === "trade_value_out" ? summary.outgoingAgreed
          : chartMetric === "trade_gain" ? summary.tradeGainLoss
          : chartMetric === "trade_cash_received" ? trade.cashReceived
          : chartMetric === "trade_cash_paid" ? trade.cashPaid
          : chartMetric === "trade_count" ? 1 : summary.incomingAgreed;
        const g = group(trade.tradeDate, trade.eventId);
        add(g.key, g.label, value);
      });
    } else if (chartMetric === "owner_profit" && chartGrouping !== "owner") {
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
    } else if (chartMetric === "inventory_cost_basis" || chartMetric === "inventory_market_value" || chartMetric === "unrealized_inventory_gain") {
      filtered.purchases.filter((row) => row.status === "in_stock" || row.status === "partially_sold").forEach((row) => {
        const g = group(row.purchaseDate, row.eventId, row.category);
        const remainingRatio = Math.max(0, row.quantity - row.quantitySold) / Math.max(1, row.quantity);
        const basis = Number(row.totalCost || 0) * remainingRatio;
        const market = Number(row.marketValue || 0) * remainingRatio;
        add(g.key, g.label, chartMetric === "inventory_market_value" ? market : chartMetric === "unrealized_inventory_gain" ? market - basis : basis);
      });
    } else {
      filtered.sales.forEach((row) => {
        const g = group(row.soldAt, row.eventId, row.category, row.paymentMethod);
        const value = chartMetric === "revenue" || chartMetric === "average_sale" ? Number(row.soldPrice || 0)
          : chartMetric === "items_sold" ? Number(row.quantity || 1) : saleProfit(row);
        add(g.key, g.label, value);
      });
      if (chartMetric === "net_profit") {
        filtered.expenses.forEach((row) => { const g = group(row.expenseDate, row.eventId, row.category); add(g.key, g.label, -Number(row.amount || 0), 0); });
        filteredTrades.forEach((trade) => { const g = group(trade.tradeDate, trade.eventId); add(g.key, g.label, tradeSummary(trade).tradeGainLoss, 0); });
      }
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => ({
      key, label: row.label, value: (chartMetric === "average_sale" || chartMetric === "average_trade") && row.count ? row.total / row.count : row.total,
      segments: Array.from(row.segments.entries()).map(([label, value]) => ({ label, value }))
    }));
  }, [filtered, filteredTrades, chartMetric, chartGrouping, props.events, props.workers, props.purchases]);

  const maxChart = Math.max(1, ...chartRows.map((row) => Math.abs(row.value)));
  const linePoints = chartRows.map((row, index) => {
    const x = chartRows.length <= 1 ? 300 : 20 + index / (chartRows.length - 1) * 560;
    const y = 160 - Math.max(0, row.value) / maxChart * 130;
    return `${x},${y}`;
  }).join(" ");
  const ownerRows = useMemo(() => {
    const totals = ownerProfitRows(filtered.sales, props.purchases);
    filteredTrades.forEach((trade) => tradeGainOwnership(trade).forEach((gain, workerId) => {
      const current = totals.get(workerId) || { profit: 0, revenue: 0, itemsSold: 0 };
      totals.set(workerId, { ...current, profit: current.profit + gain });
    }));
    return totals;
  }, [filtered.sales, props.purchases, filteredTrades]);
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
  const metricLabels: Record<ChartMetric, string> = {
    revenue: "Sales Revenue", sale_profit: "Sale Profit", net_profit: "Net Profit", expenses: "Expenses",
    inventory_cost_basis: "Inventory Cost Basis", inventory_market_value: "Inventory Market Value",
    unrealized_inventory_gain: "Unrealized Inventory Gain", items_sold: "Items Sold",
    average_sale: "Average Sale", owner_profit: "Profit by Owner", trade_value: "Total Trade Value",
    trade_value_in: "Value Traded In", trade_value_out: "Value Traded Out", trade_gain: "Trade Gain/Loss",
    trade_cash_received: "Trade Cash Received", trade_cash_paid: "Trade Cash Paid", trade_count: "Number of Trades",
    average_trade: "Average Trade Value"
  };
  const isTradeMetric = chartMetric.startsWith("trade_") || chartMetric === "average_trade";
  const groupingOptions: [ChartGrouping, string][] = isTradeMetric
    ? [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["event", "By Event"]]
    : chartMetric === "expenses" || chartMetric === "inventory_cost_basis" || chartMetric === "inventory_market_value" || chartMetric === "unrealized_inventory_gain"
    ? [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["event", "By Event"], ["category", "By Category"]]
    : chartMetric === "owner_profit"
      ? [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["event", "By Event"], ["owner", "By Owner"]]
      : [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["event", "By Event"], ["category", "By Category"], ["owner", "By Owner"], ["payment", "By Payment Method"]];
  useEffect(() => {
    if (!groupingOptions.some(([value]) => value === chartGrouping)) setChartGrouping(groupingOptions[0][0]);
  }, [chartMetric, chartGrouping]);
  const chartRecordCount = isTradeMetric ? filteredTrades.length : chartMetric === "expenses" ? filtered.expenses.length : chartMetric === "inventory_cost_basis" || chartMetric === "inventory_market_value" || chartMetric === "unrealized_inventory_gain" ? filtered.purchases.length : filtered.sales.length;
  const chartTotal = chartMetric === "average_sale" || chartMetric === "average_trade"
    ? (chartRows.length ? chartRows.reduce((sum, row) => sum + row.value, 0) / chartRows.length : 0)
    : chartRows.reduce((sum, row) => sum + row.value, 0);
  const compactValue = (value: number) => chartMetric === "items_sold" || chartMetric === "trade_count" ? value.toFixed(1) : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: Math.abs(value) >= 1000 ? "compact" : "standard", maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2 }).format(value);

  const recentRecords = useMemo(() => {
    const rows = [
      ...props.sales.map((sale) => ({ id: `sale-${sale.id}`, type: "sale" as const, date: sale.soldAt, image: sale.imageUrl, missing: !sale.itemName || sale.soldPrice === undefined, sale })),
      ...props.purchases.map((purchase) => ({ id: `purchase-${purchase.id}`, type: "purchase" as const, date: purchase.purchaseDate, image: purchase.imageUrl, missing: !purchase.itemName || !purchase.totalCost, purchase })),
      ...props.trades.filter((trade) => trade.status === "completed" && (trade.transactionType === "trade" || trade.transactionType === "cash_trade")).map((trade) => ({ id: `trade-${trade.id}`, type: "trade" as const, date: trade.tradeDate, image: trade.generalImageUrl, missing: !trade.items.length, trade })),
      ...props.expenses.map((expense) => ({ id: `expense-${expense.id}`, type: "expense" as const, date: expense.expenseDate, image: expense.receiptImageUrl, missing: !expense.description || !expense.amount, expense }))
    ].filter((row) => {
      if (feedFilter === "sales") return row.type === "sale";
      if (feedFilter === "purchases") return row.type === "purchase";
      if (feedFilter === "trades") return row.type === "trade";
      if (feedFilter === "expenses") return row.type === "expense";
      if (feedFilter === "missing") return row.missing;
      if (feedFilter === "in_stock") return row.type === "purchase" && row.purchase.status === "in_stock";
      if (feedFilter === "sold") return row.type === "sale" || (row.type === "purchase" && row.purchase.status === "sold");
      return true;
    });
    return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  }, [props.sales, props.purchases, props.trades, props.expenses, feedFilter]);

  const summaryCards = [
    { label: "Sales revenue", value: overview.revenue, accent: "green" as const, icon: <WalletCards size={18} /> },
    { label: "Realized sale profit", value: overview.realizedSaleProfit, accent: "blue" as const, icon: <BadgeDollarSign size={18} /> },
    { label: "Realized trade gain", value: overview.realizedTradeGain, accent: overview.realizedTradeGain >= 0 ? "purple" as const : "red" as const, icon: <Handshake size={18} /> },
    { label: "Operating expenses", value: overview.operatingExpenses + overview.eventTableCosts, accent: "red" as const, icon: <TrendingDown size={18} /> },
    { label: "Current inventory market value", value: overview.currentInventoryMarketValue, accent: "orange" as const, icon: <Boxes size={18} /> },
    { label: "Current inventory cost basis", value: overview.currentInventoryCostBasis, accent: "cyan" as const, icon: <PackagePlus size={18} /> },
    { label: "Unrealized inventory gain", value: overview.unrealizedInventoryGain, accent: overview.unrealizedInventoryGain >= 0 ? "green" as const : "red" as const, icon: <TrendingUp size={18} /> },
    { label: "Net profit", value: overview.netProfit, accent: overview.netProfit >= 0 ? "purple" as const : "red" as const, icon: <TrendingUp size={18} /> }
  ];

  function renderChart(expanded = false) {
    const heightClass = expanded ? "h-[55vh] min-h-80" : "h-64 sm:h-72";
    if (!chartRows.length) {
      const action = chartMetric === "expenses" ? { label: "Add Expense", run: props.onAddExpense }
        : chartMetric === "inventory_cost_basis" || chartMetric === "inventory_market_value" || chartMetric === "unrealized_inventory_gain" ? { label: "Add Purchase", run: props.onAddPurchase }
          : { label: "Add Sale", run: props.onAddSale };
      return <div className={heightClass}><DashboardEmptyState icon={<BarChart3 size={24} />} title="No chart data yet" description="Add records in this date range to see a performance trend." action={<AppButton onClick={action.run}>{action.label}</AppButton>} /></div>;
    }
    if (chartRows.length === 1) {
      const row = chartRows[0];
      return <div className={`flex ${heightClass} items-center justify-center rounded-xl bg-slate-50 p-4 dark:bg-slate-950/70`}><div className="w-full max-w-sm text-center"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{row.label}</p><p className="mt-2 text-3xl font-black text-coral">{compactValue(row.value)}</p><div title={`${row.label}: ${compactValue(row.value)}`} className="mx-auto mt-4 h-24 w-16 rounded-t-xl bg-coral shadow-lg shadow-orange-950/10" /><p className="mt-3 text-xs text-slate-500">{chartRecordCount} recorded {chartRecordCount === 1 ? "record" : "records"} · Add more records to see a trend.</p></div></div>;
    }
    if (visibleChartStyle === "line" || visibleChartStyle === "area") return <div className="overflow-hidden rounded-xl bg-slate-50 p-2 dark:bg-slate-950/70"><svg viewBox="0 0 600 180" className={`${heightClass} w-full`} role="img" aria-label={`${chartMetric} chart`}>{[40, 80, 120, 160].map((y) => <line key={y} x1="20" y1={y} x2="580" y2={y} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="1" />)}{visibleChartStyle === "area" ? <polygon points={`20,160 ${linePoints} 580,160`} fill="#F45D1333" /> : null}<polyline points={linePoints} fill="none" stroke="#F45D13" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />{chartRows.map((row, index) => { const [x, y] = linePoints.split(" ")[index].split(","); return <circle key={row.key} cx={x} cy={y} r="6" fill="#F45D13"><title>{row.label}: {compactValue(row.value)}</title></circle>; })}</svg><div className="flex justify-between gap-2 overflow-hidden px-2 text-[10px] text-slate-500">{chartRows.slice(-6).map((row) => <span className="truncate" key={row.key}>{row.label}</span>)}</div></div>;
    if (visibleChartStyle === "donut") return <div className={`grid ${heightClass} items-center gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 dark:bg-slate-950/70`}><div className="mx-auto flex size-40 items-center justify-center rounded-full" style={{ background: `conic-gradient(${donutGradient})` }}><div className="flex size-24 items-center justify-center rounded-full bg-white text-center text-sm font-black dark:bg-slate-900">{compactValue(donutTotal)}<br />Total</div></div><div className="max-h-52 space-y-2 overflow-y-auto">{chartRows.map((row, index) => <div key={row.key} title={`${row.label}: ${compactValue(row.value)}`} className="flex items-center gap-2 text-xs"><span className="size-3 rounded-full" style={{ backgroundColor: donutColors[index % donutColors.length] }} /><span className="min-w-0 flex-1 truncate font-bold">{row.label}</span><span>{donutTotal ? `${(Math.max(0, row.value) / donutTotal * 100).toFixed(1)}%` : "0%"}</span><span>{compactValue(row.value)}</span></div>)}</div></div>;
    return <div className={`flex ${heightClass} items-end justify-center gap-3 overflow-x-auto rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70`}>{chartRows.map((row, index) => <div key={row.key} title={`${row.label}: ${compactValue(row.value)}`} className="flex min-w-14 max-w-24 flex-1 flex-col items-center justify-end gap-1"><span className="text-[10px] font-bold">{compactValue(row.value)}</span>{visibleChartStyle === "stacked" && row.segments.length ? <div className="flex w-12 flex-col-reverse overflow-hidden rounded-t-lg" style={{ height: `${Math.max(6, Math.abs(row.value) / maxChart * (expanded ? 260 : 170))}px` }}>{row.segments.map((segment, segmentIndex) => <div key={segment.label} title={`${segment.label}: ${compactValue(segment.value)}`} style={{ height: `${Math.abs(segment.value) / Math.max(0.01, Math.abs(row.value)) * 100}%`, backgroundColor: donutColors[segmentIndex % donutColors.length] }} />)}</div> : <div className="w-12 rounded-t-lg" style={{ height: `${Math.max(6, Math.abs(row.value) / maxChart * (expanded ? 260 : 170))}px`, backgroundColor: donutColors[index % donutColors.length] }} />}<span className="max-w-20 truncate text-[10px] text-slate-500">{row.label}</span></div>)}</div>;
  }

  return (
    <div className="contents">
      <DashboardPanel eyebrow="Financial overview" title="Performance snapshot" className="dashboard-reveal lg:col-span-5 lg:col-start-1 lg:row-start-1" action={<TrendingUp className="text-coral" size={22} />}>
        <select value={props.dateRange} onChange={(event) => props.onDateRange(event.target.value as FinancialDateRange)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white">{Object.entries(financialDateRangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {props.dateRange === "custom" ? <div className="grid grid-cols-2 gap-2"><input type="date" value={props.customStart} onChange={(event) => props.onCustomStart(event.target.value)} className="min-w-0 rounded-xl border border-slate-200 px-2 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white" /><input type="date" value={props.customEnd} onChange={(event) => props.onCustomEnd(event.target.value)} className="min-w-0 rounded-xl border border-slate-200 px-2 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white" /></div> : null}
        <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-3">{summaryCards.map((card) => <MetricCard key={card.label} label={card.label} value={formatMoney(card.value)} context={financialDateRangeLabels[props.dateRange]} icon={card.icon} accent={card.accent} negative={card.value < 0} />)}</div>
      </DashboardPanel>

      <DashboardPanel eyebrow="Performance charts" title="Explore your numbers" className="dashboard-reveal lg:col-span-8 lg:col-start-1 lg:row-start-2" action={<AppButton variant="ghost" onClick={() => setChartExpanded(true)} className="min-h-9 px-3 text-xs"><Maximize2 size={15} /> Expand</AppButton>}>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs font-black text-slate-500">Metric<select value={chartMetric} onChange={(event) => setChartMetric(event.target.value as ChartMetric)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-ink dark:border-slate-800 dark:bg-slate-950 dark:text-white">{([["inventory_market_value","Inventory Market Value"],["inventory_cost_basis","Inventory Cost Basis"],["unrealized_inventory_gain","Unrealized Inventory Gain"],["trade_gain","Trade Gain/Loss"],["revenue","Sales Revenue"],["sale_profit","Sale Profit"],["expenses","Expenses"],["net_profit","Net Profit"],["items_sold","Items Sold"],["average_sale","Average Sale"],["owner_profit","Owner Profit"],["trade_value","Total Trade Value"],["trade_value_in","Value Traded In"],["trade_value_out","Value Traded Out"],["trade_cash_received","Trade Cash Received"],["trade_cash_paid","Trade Cash Paid"],["trade_count","Number of Trades"],["average_trade","Average Trade Value"]] as [ChartMetric,string][]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">Group by<select value={chartGrouping} onChange={(event) => setChartGrouping(event.target.value as ChartGrouping)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-ink dark:border-slate-800 dark:bg-slate-950 dark:text-white">{groupingOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">Date range<select value={props.dateRange} onChange={(event) => props.onDateRange(event.target.value as FinancialDateRange)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-ink dark:border-slate-800 dark:bg-slate-950 dark:text-white">{Object.entries(financialDateRangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {props.dateRange === "custom" ? <div className="grid grid-cols-2 gap-2"><input type="date" aria-label="Custom start date" value={props.customStart} onChange={(event) => props.onCustomStart(event.target.value)} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2 text-sm dark:border-slate-800 dark:bg-slate-950" /><input type="date" aria-label="Custom end date" value={props.customEnd} onChange={(event) => props.onCustomEnd(event.target.value)} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2 text-sm dark:border-slate-800 dark:bg-slate-950" /></div> : null}
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
        <div className="flex items-end justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Total {metricLabels[chartMetric]}</p><p className="text-2xl font-black text-ink dark:text-white">{compactValue(chartTotal)}</p></div><p className="text-right text-xs text-slate-500">{chartRecordCount} recorded {chartRecordCount === 1 ? "record" : "records"}</p></div>
        <div key={`${chartMetric}-${visibleChartStyle}-${chartGrouping}`} className="sales-chart-stage">{renderChart()}</div>
      </DashboardPanel>

      <DashboardPanel eyebrow="Operations" title="Daily, trade & owner summary" className="dashboard-reveal lg:col-span-4 lg:col-start-9 lg:row-start-2" action={<Activity size={20} className="text-emerald-400" />}>
        <div className="grid grid-cols-2 gap-2">
          <AppButton variant="success" onClick={props.onOpenDaily} className="px-2"><CalendarDays size={17} /> Daily</AppButton>
          <AppButton variant="secondary" onClick={props.onOpenTrades} className="px-2 text-violet-600 dark:text-violet-300"><Handshake size={17} /> Trades</AppButton>
          <AppButton variant="secondary" onClick={props.onBatchInventory} className="px-2"><PackagePlus size={17} /> Batch</AppButton>
          <AppButton variant="secondary" onClick={props.onExport} className="px-2"><Download size={17} /> Export</AppButton>
        </div>
        <div className="mt-4 space-y-2">
          {props.workers.filter((worker) => ownerRows.has(worker.id) || ownerInventory.has(worker.id)).slice(0, 3).map((worker) => <div key={worker.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/55">
            <div className="flex items-center justify-between gap-2"><p className="inline-flex min-w-0 items-center gap-2 truncate text-sm font-black"><Users size={15} className="text-violet-500" />{worker.name}</p><span className="text-sm font-black text-emerald-500">{formatMoney(ownerRows.get(worker.id)?.profit || 0)}</span></div>
            <p className="mt-1 text-[11px] text-slate-500">{formatMoney(ownerRows.get(worker.id)?.revenue || 0)} revenue · {formatMoney(ownerInventory.get(worker.id)?.unsold || 0)} unsold</p>
          </div>)}
          {!ownerRows.size && !ownerInventory.size ? <DashboardEmptyState icon={<Users size={22} />} title="Owner summaries will appear here" description="Assign ownership to inventory and sales to track each owner." /> : null}
        </div>
        <AppButton variant="ghost" onClick={props.onOpenSpreadsheet} className="mt-3 w-full lg:hidden"><FileSpreadsheet size={17} /> Open full spreadsheet</AppButton>
      </DashboardPanel>

      <section onClickCapture={(event) => {
        const image = (event.target as HTMLElement).closest("img");
        if (!image) return;
        event.preventDefault();
        event.stopPropagation();
        const title = image.closest("button")?.querySelector("p")?.textContent || image.getAttribute("alt") || "Recent Activity image";
        setPreviewImage({ url: image.getAttribute("src") || "", title });
      }} className="dashboard-panel dashboard-reveal space-y-3 lg:col-span-12 lg:row-start-3 [&_img]:cursor-zoom-in [&_img]:border-2 [&_img]:border-transparent [&_img]:transition [&_img]:hover:scale-105 [&_img]:hover:border-coral">
        <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Recent activity</p><h2 className="font-black text-ink dark:text-white">Records & Photos</h2></div><Plus size={18} className="text-coral" /></div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{(["all", "in_stock", "sold", "sales", "purchases", "trades", "expenses", "missing"] as FeedFilter[]).map((filter) => <button key={filter} onClick={() => setFeedFilter(filter)} className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-black ${feedFilter === filter ? "bg-coral text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{filter === "in_stock" ? "In Stock" : filter === "missing" ? "Missing Info" : filter.charAt(0).toUpperCase() + filter.slice(1)}</button>)}</div>
        <div className="space-y-2 [&>button]:rounded-2xl [&>button]:border [&>button]:border-transparent [&>button]:p-3 [&>button]:transition [&>button]:duration-180 hover:[&>button]:border-slate-200 hover:[&>button]:shadow-md dark:hover:[&>button]:border-slate-700">{recentRecords.length ? recentRecords.map((row) => {
          if (row.type === "sale") return <button key={row.id} onClick={() => props.onEditSale(row.sale)} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-2 text-left dark:bg-slate-950/70">{row.image ? <img src={row.image} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg bg-slate-100 object-contain dark:bg-slate-900" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Camera size={20} /></div>}<div className="min-w-0 flex-1"><p className="truncate font-black text-ink dark:text-white">{row.sale.itemName || "Sale details pending"}</p><p className="text-xs text-slate-500">Bought {formatMoney(row.sale.boughtPrice || 0)} · Sold {formatMoney(row.sale.soldPrice || 0)}</p><p className={`text-xs font-black ${saleProfit(row.sale) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatMoney(saleProfit(row.sale))} profit</p></div><span className="text-[10px] text-slate-500">{new Date(row.date).toLocaleDateString()}</span></button>;
          if (row.type === "purchase") { const summary = inventoryQuantitySummary(row.purchase, props.sales); return <button key={row.id} onClick={() => props.onEditPurchase(row.purchase)} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-2 text-left dark:bg-slate-950/70">{row.image ? <img src={row.image} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg bg-slate-100 object-contain dark:bg-slate-900" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><PackagePlus size={20} /></div>}<div className="min-w-0 flex-1"><p className="truncate font-black text-ink dark:text-white">{row.purchase.itemName}</p><p className="text-xs text-slate-500">{formatMoney(row.purchase.totalCost)} · {summary.quantityRemaining}/{row.purchase.quantity} left</p><span className={`text-xs font-black ${row.purchase.status === "sold" ? "text-emerald-600" : row.purchase.status === "partially_sold" ? "text-amber-600" : row.purchase.status === "personal" ? "text-slate-500" : "text-sky-600"}`}>{inventoryStatusLabels[row.purchase.status]}</span></div><span className="text-[10px] text-slate-500">{new Date(row.date).toLocaleDateString()}</span></button>; }
          if (row.type === "trade") { const summary = tradeSummary(row.trade); return <button key={row.id} onClick={props.onOpenTrades} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-2 text-left dark:bg-slate-950/70">{row.image ? <img src={row.image} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg bg-slate-100 object-contain dark:bg-slate-900" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><Handshake size={20} /></div>}<div className="min-w-0 flex-1"><p className="truncate font-black text-ink dark:text-white">{row.trade.tradePartner || "Trade transaction"}</p><p className="text-xs text-slate-500">{formatMoney(summary.outgoingAgreed)} out · {formatMoney(summary.incomingTradeTimeValue)} in</p><p className={`text-xs font-black ${summary.tradeGainLoss >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatMoney(summary.tradeGainLoss)} trade gain/loss</p></div><span className="text-[10px] text-slate-500">{new Date(row.date).toLocaleDateString()}</span></button>; }
          return <button key={row.id} onClick={() => props.onEditExpense(row.expense)} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-2 text-left dark:bg-slate-950/70">{row.image ? <img src={row.image} alt={row.expense.description || "Expense receipt"} loading="lazy" className="size-16 shrink-0 rounded-lg bg-slate-100 object-contain dark:bg-slate-900" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700"><Receipt size={20} /></div>}<div className="min-w-0 flex-1"><p className="truncate font-black text-ink dark:text-white">{row.expense.description}</p><p className="text-xs text-slate-500">{expenseCategoryLabels[row.expense.category]}</p><p className="text-xs font-black text-rose-600">-{formatMoney(row.expense.amount)}</p></div><span className="text-[10px] text-slate-500">{new Date(row.date).toLocaleDateString()}</span></button>;
        }) : <DashboardEmptyState icon={<Activity size={22} />} title="No transactions yet" description="Your sales, purchases, trades, and expenses will appear here." />}</div>
      </section>
      {chartExpanded ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="expanded-chart-title" className="max-h-[95dvh] w-full max-w-5xl space-y-3 overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl dark:bg-slate-900"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Expanded chart</p><h2 id="expanded-chart-title" className="text-xl font-black text-ink dark:text-white">{metricLabels[chartMetric]}</h2><p className="text-xs text-slate-500">{financialDateRangeLabels[props.dateRange]} · {chartRecordCount} records</p></div><button onClick={() => setChartExpanded(false)} aria-label="Close expanded chart" className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button></div>{renderChart(true)}</section></div> : null}
      <ImageLightbox imageUrl={previewImage?.url} title={previewImage?.title || "Sales Control image"} onClose={() => setPreviewImage(undefined)} />
    </div>
  );
}
