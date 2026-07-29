import type {
  BusinessExpense, Event, InventoryPurchase, SalesRecord, TradeItem, TradeTransaction, Worker
} from "../../types/models";
import type { FinancialDateRange } from "../../utils/financialDateRange";
import { financialDateBounds, isWithinFinancialRange } from "../../utils/financialDateRange";
import { roundMoney } from "../../utils/paymentMath";
import { expenseCategoryLabels, inventoryQuantitySummary, pokemonCategoryLabels } from "../../utils/salesControl";
import { dailyFinancialSummary, transactionReview } from "../../utils/transactionMath";
import { tradeSummary } from "../../utils/tradeMath";

export type FinancialExportKind = "transactions" | "items" | "inventory" | "expenses" | "trades" | "daily" | "all";
export type ExportValue = string | number | boolean | Date | null | undefined;
export type ExportColumnKind = "text" | "date" | "currency" | "percentage" | "number";
export type FinancialExportTable = {
  key: FinancialExportKind | "owners";
  name: string;
  headers: string[];
  rows: ExportValue[][];
  kinds: ExportColumnKind[];
};

export type FinancialExportFilters = {
  dateRange: FinancialDateRange;
  customStart: string;
  customEnd: string;
  eventId?: string;
  recordType?: "all" | TradeTransaction["transactionType"] | "inventory";
  ownerId?: string;
  status?: "all" | string;
  query?: string;
};

export type FinancialExportInput = {
  sales: SalesRecord[];
  purchases: InventoryPurchase[];
  expenses: BusinessExpense[];
  transactions: TradeTransaction[];
  events: Event[];
  workers: Worker[];
};

export type FinancialExportData = {
  tables: Record<FinancialExportKind | "owners", FinancialExportTable>;
  processedRecords: number;
  rangeLabel: string;
};

const transactionHeaders = [
  "Transaction ID", "Transaction Date", "Transaction Time", "Transaction Type", "Transaction Subtype", "Status",
  "Entry Mode", "Item Count", "Customer or Seller", "Event", "Event Day", "Payment Method", "Cash Received",
  "Cash Paid", "Bundle Total", "Allocation Method", "Market Value In", "Market Value Out", "Agreed Value In",
  "Agreed Value Out", "Total Cost Basis", "Gross Profit", "Estimated Trade Gain/Loss", "Operating Expense",
  "Entered By", "Notes", "Created At", "Updated At"
];
const transactionKinds: ExportColumnKind[] = [
  "text", "date", "text", "text", "text", "text", "text", "number", "text", "text", "text", "text",
  "currency", "currency", "currency", "text", "currency", "currency", "currency", "currency", "currency",
  "currency", "currency", "currency", "text", "text", "date", "date"
];
const itemHeaders = [
  "Transaction ID", "Transaction Item ID", "Date", "Transaction Type", "Direction", "Item Name", "Item Type",
  "Quantity", "Inventory Record ID", "Inventory Status", "Acquisition Method", "Disposition Method",
  "Pokémon TCG Card ID", "Collector Number", "Set", "Rarity", "Condition", "Grading Company", "Grade",
  "Certificate Number", "Owner Gonzalo %", "Owner Thiago %", "Other Ownership", "Ownership Breakdown",
  "Market Value", "Trade Percentage", "Agreed Trade Value", "Bought Price", "Cost Basis", "Sold Price",
  "Allocated Cash Amount", "Gross Profit", "TCGplayer Variant", "TCGplayer Market Price", "TCGplayer URL",
  "Event", "Image URL", "Notes"
];
const itemKinds: ExportColumnKind[] = itemHeaders.map((header) =>
  header.includes("%") || header === "Trade Percentage" ? "percentage"
    : /Value|Price|Basis|Cash|Profit/.test(header) ? "currency"
      : header === "Date" ? "date" : header === "Quantity" ? "number" : "text"
);

function workerName(workers: Worker[], workerId?: string) {
  return workers.find((worker) => worker.id === workerId)?.name || "";
}

function eventName(events: Event[], eventId?: string) {
  return events.find((event) => event.id === eventId)?.name || "";
}

function dateParts(value: string) {
  const parsed = new Date(value);
  return {
    date: Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10),
    time: Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  };
}

function shareValue(item: TradeItem, workers: Worker[], name: string) {
  return item.ownershipShares
    .filter((share) => workerName(workers, share.workerId).toLowerCase().includes(name))
    .reduce((sum, share) => sum + Number(share.ownershipPercentage || 0), 0);
}

function ownershipBreakdown(item: TradeItem, workers: Worker[]) {
  return item.ownershipShares.map((share) => `${workerName(workers, share.workerId) || share.workerId} ${share.ownershipPercentage}%`).join("; ");
}

function transactionMatches(transaction: TradeTransaction, filters: FinancialExportFilters, workers: Worker[]) {
  if (!isWithinFinancialRange(transaction.tradeDate, filters.dateRange, filters.customStart, filters.customEnd)) return false;
  if (filters.eventId && transaction.eventId !== filters.eventId) return false;
  if (filters.recordType && filters.recordType !== "all" && filters.recordType !== "inventory" && transaction.transactionType !== filters.recordType) return false;
  if (filters.status && filters.status !== "all" && transaction.status !== filters.status) return false;
  if (filters.ownerId && !transaction.items.some((item) => item.ownershipShares.some((share) => share.workerId === filters.ownerId))) return false;
  const query = filters.query?.trim().toLowerCase();
  return !query || `${transaction.id} ${transaction.tradePartner || ""} ${transaction.notes || ""} ${transaction.items.map((item) => `${item.itemName} ${item.collectorNumber || ""} ${item.cardSet || ""} ${ownershipBreakdown(item, workers)}`).join(" ")}`.toLowerCase().includes(query);
}

function legacyMatches(date: string, eventId: string | undefined, status: string, text: string, shares: { workerId: string }[] | undefined, filters: FinancialExportFilters) {
  if (!isWithinFinancialRange(date, filters.dateRange, filters.customStart, filters.customEnd)) return false;
  if (filters.eventId && eventId !== filters.eventId) return false;
  if (filters.status && filters.status !== "all" && status !== filters.status) return false;
  if (filters.ownerId && !shares?.some((share) => share.workerId === filters.ownerId)) return false;
  const query = filters.query?.trim().toLowerCase();
  return !query || text.toLowerCase().includes(query);
}

function table(key: FinancialExportTable["key"], name: string, headers: string[], rows: ExportValue[][], kinds?: ExportColumnKind[]): FinancialExportTable {
  return { key, name, headers, rows, kinds: kinds || headers.map(() => "text") };
}

export function buildFinancialExportData(input: FinancialExportInput, filters: FinancialExportFilters): FinancialExportData {
  const allTransactionIds = new Set(input.transactions.map((row) => row.id));
  const transactions = input.transactions.filter((row) => transactionMatches(row, filters, input.workers));
  const legacySales = input.sales.filter((row) => !row.financialTransactionId || !allTransactionIds.has(row.financialTransactionId)).filter((row) =>
    (!filters.recordType || filters.recordType === "all" || filters.recordType === "sale")
    && legacyMatches(row.soldAt, row.eventId, "completed", `${row.id} ${row.itemName || ""} ${row.cardName || ""} ${row.collectorNumber || ""} ${row.cardSet || ""} ${row.notes || ""}`, row.ownershipShares, filters)
  );
  const legacyPurchases = input.purchases.filter((row) => !row.financialTransactionId || !allTransactionIds.has(row.financialTransactionId)).filter((row) =>
    (!filters.recordType || filters.recordType === "all" || filters.recordType === "purchase" || filters.recordType === "inventory")
    && legacyMatches(row.purchaseDate, row.eventId, row.status, `${row.id} ${row.itemName} ${row.collectorNumber || ""} ${row.cardSet || ""} ${row.seller || ""} ${row.notes || ""}`, row.ownershipShares, filters)
  );
  const legacyExpenses = input.expenses.filter((row) => !row.financialTransactionId || !allTransactionIds.has(row.financialTransactionId)).filter((row) =>
    (!filters.recordType || filters.recordType === "all" || filters.recordType === "expense")
    && legacyMatches(row.expenseDate, row.eventId, "completed", `${row.id} ${row.description} ${row.vendor || ""} ${row.notes || ""}`, undefined, filters)
  );
  const filteredInventory = input.purchases.filter((row) =>
    (!filters.recordType || filters.recordType === "all" || filters.recordType === "purchase" || filters.recordType === "inventory")
    && legacyMatches(row.purchaseDate, row.eventId, row.status, `${row.id} ${row.itemName} ${row.collectorNumber || ""} ${row.cardSet || ""} ${row.seller || ""} ${row.notes || ""}`, row.ownershipShares, filters)
  );

  const transactionRows: ExportValue[][] = transactions.map((transaction) => {
    const review = transactionReview(transaction);
    const summary = tradeSummary(transaction);
    const parts = dateParts(transaction.tradeDate);
    const operatingExpense = transaction.transactionType === "expense" ? Number(transaction.bundleTotal || transaction.items.reduce((sum, item) => sum + Number(item.boughtPrice || item.allocatedCostBasis || 0), 0)) : 0;
    return [
      transaction.id, parts.date, parts.time, transaction.transactionType,
      transaction.purchaseSource || transaction.expenseCategory || "", transaction.status, transaction.itemMode, transaction.items.length,
      transaction.tradePartner || "", eventName(input.events, transaction.eventId), transaction.eventDayId || "", transaction.paymentMethod || "",
      transaction.cashReceived, transaction.cashPaid, transaction.bundleTotal ?? "", transaction.pricingMode,
      summary.incomingMarket, summary.outgoingMarket, summary.incomingAgreed, summary.outgoingAgreed, review.basis,
      transaction.transactionType === "sale" ? review.grossProfit : "", ["trade", "cash_trade"].includes(transaction.transactionType) ? summary.estimatedGainLoss : "",
      operatingExpense || "", workerName(input.workers, transaction.enteredByWorkerId || transaction.paidByWorkerId), transaction.notes || "",
      transaction.createdAt, transaction.updatedAt
    ];
  });
  legacySales.forEach((sale) => {
    const parts = dateParts(sale.soldAt);
    transactionRows.push([sale.id, parts.date, parts.time, "sale", "legacy-compatible", "completed", "single", 1, "", eventName(input.events, sale.eventId), sale.eventDayId || "", sale.paymentMethod || "", sale.soldPrice ?? "", "", "", "individual", "", sale.marketValue ?? "", "", sale.soldPrice ?? "", sale.boughtPrice ?? "", roundMoney(Number(sale.soldPrice || 0) - Number(sale.boughtPrice || 0)), "", "", workerName(input.workers, sale.soldByWorkerId), sale.notes || "", sale.createdAt, sale.updatedAt]);
  });
  legacyPurchases.filter((purchase) => filters.recordType !== "inventory").forEach((purchase) => {
    const parts = dateParts(purchase.purchaseDate);
    transactionRows.push([purchase.id, parts.date, parts.time, "purchase", purchase.purchaseSource || "legacy-compatible", purchase.status, "single", 1, purchase.seller || "", eventName(input.events, purchase.eventId), "", "", "", purchase.totalCost, "", "individual", purchase.marketValue ?? "", "", purchase.agreedTradeValue ?? "", "", "", "", "", "", workerName(input.workers, purchase.purchasedByWorkerId), purchase.notes || "", purchase.createdAt, purchase.updatedAt]);
  });
  legacyExpenses.forEach((expense) => {
    const parts = dateParts(expense.expenseDate);
    transactionRows.push([expense.id, parts.date, parts.time, "expense", expense.category, "completed", "single", 1, expense.vendor || "", eventName(input.events, expense.eventId), "", "", "", expense.amount, "", "individual", "", "", "", "", "", "", "", expense.amount, workerName(input.workers, expense.paidByWorkerId), expense.notes || "", expense.createdAt, expense.updatedAt]);
  });
  transactionRows.sort((a, b) => String(b[1]).localeCompare(String(a[1])));

  const inventoryById = new Map(input.purchases.map((row) => [row.id, row]));
  const itemRows: ExportValue[][] = transactions.flatMap((transaction) => transaction.items.map((item) => {
    const inventory = inventoryById.get(item.inventoryPurchaseId || item.createdInventoryPurchaseId || "");
    const basis = item.direction === "outgoing" ? item.historicalCostBasis : item.allocatedCostBasis;
    return [
      transaction.id, item.id, transaction.tradeDate, transaction.transactionType, item.direction, item.itemName, pokemonCategoryLabels[item.itemType],
      item.quantity, item.inventoryPurchaseId || item.createdInventoryPurchaseId || "", inventory?.status || "", inventory?.acquisitionMethod || (item.direction === "incoming" ? transaction.transactionType : ""),
      inventory?.status === "sold" ? "sold" : inventory?.disposedFinancialTransactionId ? "traded_out" : "",
      item.pokemonTcgCardId || inventory?.pokemonTcgCardId || "", item.collectorNumber || inventory?.collectorNumber || "", item.cardSet || inventory?.cardSet || "",
      inventory?.cardRarity || "", item.cardCondition || inventory?.cardCondition || "", item.gradingCompany || inventory?.gradingCompany || "",
      item.grade || inventory?.grade || "", item.certificateNumber || inventory?.certificateNumber || "", shareValue(item, input.workers, "gonzalo"),
      shareValue(item, input.workers, "thiago"), item.ownershipShares.filter((share) => !["gonzalo", "thiago"].some((name) => workerName(input.workers, share.workerId).toLowerCase().includes(name))).reduce((sum, share) => sum + share.ownershipPercentage, 0),
      ownershipBreakdown(item, input.workers), item.marketValue, item.tradePercentage ?? "", item.agreedTradeValue, item.boughtPrice ?? "",
      basis, item.soldPrice ?? "", item.cashAllocation ?? "", item.soldPrice == null ? "" : roundMoney(item.soldPrice - basis),
      inventory?.marketPriceVariant || "", inventory?.marketValue ?? "", inventory?.tcgplayerUrl || "", eventName(input.events, transaction.eventId),
      item.imageUrl || transaction.generalImageUrl || "", item.notes || ""
    ];
  }));
  legacySales.forEach((sale) => itemRows.push([
    sale.id, sale.id, sale.soldAt, "sale", "outgoing", sale.itemName || "Details pending", pokemonCategoryLabels[sale.category || "other_pokemon_product"],
    sale.quantity, sale.inventoryPurchaseId || "", inventoryById.get(sale.inventoryPurchaseId || "")?.status || "sold", "purchased", "sold",
    sale.pokemonTcgCardId || "", sale.collectorNumber || "", sale.cardSet || "", sale.cardRarity || "", sale.cardCondition || "", "", "", "",
    (sale.ownershipShares || []).filter((share) => workerName(input.workers, share.workerId).toLowerCase().includes("gonzalo")).reduce((sum, share) => sum + share.ownershipPercentage, 0),
    (sale.ownershipShares || []).filter((share) => workerName(input.workers, share.workerId).toLowerCase().includes("thiago")).reduce((sum, share) => sum + share.ownershipPercentage, 0),
    (sale.ownershipShares || []).filter((share) => !["gonzalo", "thiago"].some((name) => workerName(input.workers, share.workerId).toLowerCase().includes(name))).reduce((sum, share) => sum + share.ownershipPercentage, 0),
    (sale.ownershipShares || []).map((share) => `${workerName(input.workers, share.workerId) || share.workerId} ${share.ownershipPercentage}%`).join("; "),
    sale.marketValue ?? "", "", "", "", sale.boughtPrice ?? "", sale.soldPrice ?? "", "", roundMoney(Number(sale.soldPrice || 0) - Number(sale.boughtPrice || 0)),
    sale.marketPriceVariant || "", sale.marketValue ?? "", sale.tcgplayerUrl || "", eventName(input.events, sale.eventId), sale.imageUrl || "", sale.notes || ""
  ]));

  const inventoryRows = filteredInventory.map((purchase) => {
    const summary = inventoryQuantitySummary(purchase, input.sales);
    return [
      purchase.id, purchase.purchaseDate, purchase.itemName, pokemonCategoryLabels[purchase.category], purchase.status, purchase.quantity,
      summary.quantitySold, summary.quantityRemaining, purchase.totalCost, summary.costPerUnit, purchase.marketValue ?? "", summary.realizedRevenue,
      summary.realizedCost, summary.realizedProfit, purchase.purchaseSource || "", purchase.acquisitionMethod || "", purchase.seller || "",
      workerName(input.workers, purchase.purchasedByWorkerId), eventName(input.events, purchase.eventId), purchase.collectorNumber || "",
      purchase.cardSet || "", purchase.cardRarity || "", purchase.cardCondition || "", purchase.gradingCompany || "", purchase.grade || "",
      purchase.certificateNumber || "", purchase.imageUrl || purchase.frontImageUrl || "", purchase.notes || ""
    ];
  });
  const inventoryHeaders = ["Inventory ID", "Purchase Date", "Item", "Category", "Status", "Quantity", "Quantity Sold", "Quantity Remaining", "Total Cost", "Cost Per Unit", "Market Value", "Realized Revenue", "Realized Cost", "Realized Profit", "Purchase Source", "Acquisition Method", "Seller", "Purchased By", "Event", "Collector Number", "Set", "Rarity", "Condition", "Grading Company", "Grade", "Certificate Number", "Image URL", "Notes"];

  const linkedExpenseIds = new Set(legacyExpenses.map((row) => row.financialTransactionId).filter(Boolean));
  const canonicalExpenses = transactions.filter((row) => row.transactionType === "expense" && !linkedExpenseIds.has(row.id)).map((transaction): BusinessExpense => ({
    id: transaction.id, expenseDate: transaction.tradeDate,
    amount: Number(transaction.bundleTotal || transaction.items.reduce((sum, item) => sum + Number(item.boughtPrice || item.allocatedCostBasis || 0), 0)),
    category: transaction.expenseCategory || "other", description: transaction.items.map((item) => item.itemName).filter(Boolean).join("; ") || "Business expense",
    eventId: transaction.eventId, paidByWorkerId: transaction.paidByWorkerId, vendor: transaction.tradePartner,
    receiptImageUrl: transaction.proofImageUrl || transaction.generalImageUrl, notes: transaction.notes,
    createdAt: transaction.createdAt, updatedAt: transaction.updatedAt
  }));
  const expenseRows = [...legacyExpenses, ...canonicalExpenses].map((expense) => [
    expense.id, expense.expenseDate, expenseCategoryLabels[expense.category], expense.category, expense.description, expense.vendor || "",
    expense.amount, workerName(input.workers, expense.paidByWorkerId), eventName(input.events, expense.eventId), expense.receiptImageUrl || "",
    expense.notes || "", expense.createdAt, expense.updatedAt
  ]);
  const expenseHeaders = ["Expense ID", "Date", "Category", "Expense Subtype", "Description", "Vendor", "Amount", "Paid By", "Event", "Receipt URL", "Notes", "Created At", "Updated At"];

  const tradeRows = transactions.filter((row) => row.transactionType === "trade" || row.transactionType === "cash_trade").map((transaction) => {
    const summary = tradeSummary(transaction);
    return [
      transaction.id, transaction.tradeDate, transaction.tradePartner || "", eventName(input.events, transaction.eventId),
      summary.outgoing.map((item) => item.itemName).join("; "), summary.incoming.map((item) => item.itemName).join("; "),
      summary.outgoing.length, summary.incoming.length, summary.outgoingMarket, summary.incomingMarket, summary.outgoingAgreed,
      summary.incomingAgreed, transaction.cashPaid, transaction.cashReceived, summary.estimatedGainLoss,
      transaction.items.map((item) => `${item.itemName}: ${ownershipBreakdown(item, input.workers)}`).join(" | "), transaction.status, transaction.notes || ""
    ];
  });
  const tradeHeaders = ["Transaction ID", "Date", "Trade Partner", "Event", "Items Given", "Items Received", "Outgoing Item Count", "Incoming Item Count", "Market Value Out", "Market Value In", "Agreed Value Out", "Agreed Value In", "Cash Paid", "Cash Received", "Estimated Trade Gain/Loss", "Ownership Summary", "Status", "Notes"];

  const unifiedSaleRecords: SalesRecord[] = transactions.filter((row) => row.transactionType === "sale").flatMap((transaction) => transaction.items.filter((item) => item.direction === "outgoing").map((item) => ({
    id: item.createdSalesRecordId || item.id, financialTransactionId: transaction.id, financialTransactionItemId: item.id,
    eventId: transaction.eventId, eventDayId: transaction.eventDayId, imageUrl: item.imageUrl || transaction.generalImageUrl,
    itemName: item.itemName, category: item.itemType, quantity: item.quantity, soldPrice: item.soldPrice,
    boughtPrice: item.historicalCostBasis, marketValue: item.marketValue, paymentMethod: transaction.paymentMethod,
    soldByWorkerId: transaction.enteredByWorkerId, isRawCard: item.itemType === "raw_card", inventoryPurchaseId: item.inventoryPurchaseId,
    notes: item.notes, soldAt: transaction.tradeDate, pendingUpload: false, createdAt: item.createdAt, updatedAt: item.updatedAt,
    ownershipShares: item.ownershipShares
  })));
  const unifiedPurchaseRecords: InventoryPurchase[] = transactions.filter((row) => row.transactionType === "purchase").flatMap((transaction) => transaction.items.filter((item) => item.direction === "incoming").map((item) => ({
    id: item.createdInventoryPurchaseId || item.id, financialTransactionId: transaction.id, financialTransactionItemId: item.id,
    itemName: item.itemName, category: item.itemType, quantity: item.quantity, quantitySold: 0, purchaseDate: transaction.tradeDate,
    totalCost: Number(item.boughtPrice || item.allocatedCostBasis || 0), marketValue: item.marketValue, isRawCard: item.itemType === "raw_card",
    purchaseSource: transaction.purchaseSource, seller: transaction.tradePartner, eventId: transaction.eventId,
    purchasedByWorkerId: transaction.paidByWorkerId, status: "in_stock", acquisitionMethod: "purchased",
    createdAt: item.createdAt, updatedAt: item.updatedAt, ownershipShares: item.ownershipShares
  })));
  const dates = new Set<string>([
    ...legacySales.map((row) => row.soldAt.slice(0, 10)), ...unifiedSaleRecords.map((row) => row.soldAt.slice(0, 10)),
    ...legacyPurchases.map((row) => row.purchaseDate.slice(0, 10)), ...unifiedPurchaseRecords.map((row) => row.purchaseDate.slice(0, 10)),
    ...[...legacyExpenses, ...canonicalExpenses].map((row) => row.expenseDate.slice(0, 10)), ...transactions.filter((row) => ["trade", "cash_trade"].includes(row.transactionType)).map((row) => row.tradeDate.slice(0, 10))
  ]);
  const normalizedSales = [...legacySales, ...unifiedSaleRecords];
  const normalizedPurchases = [...legacyPurchases, ...unifiedPurchaseRecords];
  const normalizedExpenses = [...legacyExpenses, ...canonicalExpenses];
  const gonzalo = input.workers.find((row) => row.name.toLowerCase().includes("gonzalo"));
  const thiago = input.workers.find((row) => row.name.toLowerCase().includes("thiago"));
  const dailyRows = Array.from(dates).sort().map((date) => {
    const summary = dailyFinancialSummary(date, normalizedSales, normalizedPurchases, normalizedExpenses, transactions);
    const daySales = normalizedSales.filter((row) => row.soldAt.slice(0, 10) === date);
    const dayTrades = transactions.filter((row) => ["trade", "cash_trade"].includes(row.transactionType) && row.tradeDate.slice(0, 10) === date);
    const valueIn = dayTrades.reduce((sum, row) => sum + tradeSummary(row).incomingAgreed, 0);
    const valueOut = dayTrades.reduce((sum, row) => sum + tradeSummary(row).outgoingAgreed, 0);
    const grossSales = summary.cashSales + summary.digitalSales;
    const costBasis = daySales.reduce((sum, row) => sum + Number(row.boughtPrice || 0), 0);
    const gonzaloProfit = gonzalo ? summary.ownerProfit.get(gonzalo.id) || 0 : 0;
    const thiagoProfit = thiago ? summary.ownerProfit.get(thiago.id) || 0 : 0;
    const sharedProfit = roundMoney(summary.realizedGrossProfit - gonzaloProfit - thiagoProfit);
    return [
      date, daySales.length, daySales.reduce((sum, row) => sum + Number(row.quantity || 1), 0), summary.cashSales, summary.digitalSales,
      grossSales, costBasis, summary.realizedGrossProfit, summary.inventorySpent, summary.operatingExpenses, summary.tableFees, dayTrades.length,
      valueIn, valueOut, summary.tradeCashReceived, summary.tradeCashPaid, summary.estimatedTradeGainLoss, summary.netCashFlow,
      gonzaloProfit, thiagoProfit, sharedProfit, summary.overallEstimatedResult
    ];
  });
  const dailyHeaders = ["Date", "Number of Sales", "Items Sold", "Cash Sales", "Digital Sales", "Gross Sales Revenue", "Cost Basis of Sold Items", "Realized Gross Profit", "Inventory Purchased", "Business Expenses", "Table Fees", "Trade Count", "Trade Value In", "Trade Value Out", "Cash Received from Trades", "Cash Paid in Trades", "Estimated Trade Gain/Loss", "Net Cash Flow", "Gonzalo Profit", "Thiago Profit", "Shared Profit", "Overall Daily Result"];

  const ownerRows = input.workers.map((worker) => {
    const ownedItems = transactions.flatMap((row) => row.items).filter((item) => item.ownershipShares.some((share) => share.workerId === worker.id));
    const ownershipValue = ownedItems.reduce((sum, item) => {
      const share = item.ownershipShares.find((row) => row.workerId === worker.id);
      return sum + item.marketValue * Number(share?.ownershipPercentage || 0) / 100;
    }, 0);
    const realizedProfit = normalizedSales.reduce((sum, sale) => {
      const share = sale.ownershipShares?.find((row) => row.workerId === worker.id);
      return sum + (Number(sale.soldPrice || 0) - Number(sale.boughtPrice || 0)) * Number(share?.ownershipPercentage || 0) / 100;
    }, 0);
    return [worker.name, ownedItems.length, roundMoney(ownershipValue), roundMoney(realizedProfit)];
  });

  const tables = {
    transactions: table("transactions", "Transactions", transactionHeaders, transactionRows, transactionKinds),
    items: table("items", "Items", itemHeaders, itemRows, itemKinds),
    inventory: table("inventory", "Inventory", inventoryHeaders, inventoryRows, inventoryHeaders.map((header) => /Date/.test(header) ? "date" : /Cost|Value|Revenue|Profit/.test(header) ? "currency" : /Quantity/.test(header) ? "number" : "text")),
    expenses: table("expenses", "Expenses", expenseHeaders, expenseRows, expenseHeaders.map((header) => /Date|Created|Updated/.test(header) ? "date" : header === "Amount" ? "currency" : "text")),
    trades: table("trades", "Trades", tradeHeaders, tradeRows, tradeHeaders.map((header) => header === "Date" ? "date" : /Value|Cash|Gain/.test(header) ? "currency" : /Count/.test(header) ? "number" : "text")),
    daily: table("daily", "Daily Summary", dailyHeaders, dailyRows, dailyHeaders.map((header) => header === "Date" ? "date" : /Sales|Basis|Profit|Purchased|Expenses|Fees|Value|Cash|Flow|Result/.test(header) && !/Number|Items/.test(header) ? "currency" : "number")),
    all: table("all", "All Financial Records", transactionHeaders, transactionRows, transactionKinds),
    owners: table("owners", "Owner Summary", ["Owner", "Owned Items", "Current Market Share", "Realized Profit"], ownerRows, ["text", "number", "currency", "currency"])
  } satisfies Record<FinancialExportKind | "owners", FinancialExportTable>;
  const { start, end } = financialDateBounds(filters.dateRange, filters.customStart, filters.customEnd);
  const rangeLabel = filters.dateRange === "all_time" ? new Date().toISOString().slice(0, 10)
    : filters.dateRange === "custom" ? `${filters.customStart}_to_${filters.customEnd}`
      : `${start.toISOString().slice(0, 10)}_to_${end.toISOString().slice(0, 10)}`;
  return {
    tables,
    processedRecords: transactions.length + legacySales.length + legacyPurchases.length + legacyExpenses.length,
    rangeLabel
  };
}

function safeCsvText(value: ExportValue) {
  if (value === null || value === undefined) return "";
  const string = value instanceof Date ? value.toISOString() : String(value);
  const protectedValue = /^[=+\-@]/.test(string.trimStart()) ? `'${string}` : string;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function createCsv(table: FinancialExportTable) {
  return `\uFEFF${[table.headers, ...table.rows].map((row) => row.map(safeCsvText).join(",")).join("\r\n")}\r\n`;
}

export function financialExportFilename(kind: FinancialExportKind, rangeLabel: string) {
  const labels: Record<FinancialExportKind, string> = {
    transactions: "Transactions", items: "Items", inventory: "Inventory", expenses: "Expenses",
    trades: "Trades", daily: "Daily_Summary", all: "All_Financial_Records"
  };
  return `4Nerds_${labels[kind]}_${rangeLabel}.csv`;
}

export function downloadCsv(table: FinancialExportTable, filename: string) {
  const url = URL.createObjectURL(new Blob([createCsv(table)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
