import type { BusinessExpense, InventoryPurchase, SalesRecord, TradeItem, TradeItemOwnershipShare, TradeTransaction } from "../types/models";

const roundMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export type AllocationMethod = "market" | "equal" | "cost" | "custom";

export function itemCostBasis(item: TradeItem) {
  return roundMoney(item.direction === "outgoing" ? Number(item.historicalCostBasis || 0) : Number(item.costBasis || 0));
}

export function allocateOwnershipCostBasis(
  shares: TradeItemOwnershipShare[],
  costBasis: number
): TradeItemOwnershipShare[] {
  let allocated = 0;
  return shares.map((share, index) => {
    const amount = index === shares.length - 1
      ? roundMoney(costBasis - allocated)
      : roundMoney(costBasis * Number(share.ownershipPercentage || 0) / 100);
    allocated = roundMoney(allocated + amount);
    return { ...share, allocatedCostBasis: amount };
  });
}

export function withAllocatedOwnershipCostBasis(item: TradeItem): TradeItem {
  return {
    ...item,
    ownershipShares: allocateOwnershipCostBasis(item.ownershipShares, itemCostBasis(item))
  };
}

export function purchaseAccountingValidationError(transaction: TradeTransaction) {
  if (transaction.transactionType !== "purchase") return "";
  const items = transaction.items.filter((item) => item.direction === "incoming");
  if (!items.length) return "Add at least one purchased item.";
  if (!transaction.id?.trim()) return "Save the transaction draft before completing the purchase.";
  const itemWithoutId = items.find((item) => !item.id?.trim());
  if (itemWithoutId) return `${itemWithoutId.itemName || "A purchased item"} must be saved before ownership is assigned.`;
  const missingPurchasePrice = items.find((item) => !Number.isFinite(Number(item.boughtPrice)) || Number(item.boughtPrice) <= 0);
  if (missingPurchasePrice) return `Purchase price required for: ${missingPurchasePrice.itemName || "Unnamed item"}.`;
  const missingCostBasis = items.find((item) => !Number.isFinite(Number(item.costBasis)) || Number(item.costBasis) <= 0);
  if (missingCostBasis) return `Cost basis required for: ${missingCostBasis.itemName || "Unnamed item"}.`;
  const purchaseTotal = roundMoney(items.reduce((sum, item) => sum + Number(item.boughtPrice || 0), 0));
  const costBasisTotal = roundMoney(items.reduce((sum, item) => sum + Number(item.costBasis || 0), 0));
  const transactionAmount = transaction.pricingMode === "bundle_total"
    ? roundMoney(Number(transaction.bundleTotal || 0))
    : purchaseTotal;
  if (transactionAmount <= 0) return "Enter the actual purchase amount.";
  if (Math.abs(purchaseTotal - transactionAmount) > 0.009) {
    return `Item purchase prices must total ${transactionAmount.toFixed(2)}.`;
  }
  if (Math.abs(costBasisTotal - transactionAmount) > 0.009) {
    return `Item cost bases must total the transaction amount of ${transactionAmount.toFixed(2)}.`;
  }
  for (const item of items) {
    const shares = allocateOwnershipCostBasis(item.ownershipShares, item.costBasis);
    const ownerTotal = roundMoney(shares.reduce((sum, share) => sum + Number(share.allocatedCostBasis || 0), 0));
    if (Math.abs(ownerTotal - Number(item.costBasis)) > 0.009) {
      return `Owner allocated costs for ${item.itemName || "Unnamed item"} must total its item cost basis.`;
    }
  }
  return "";
}

export function hasKnownHistoricalCostBasis(item: TradeItem) {
  const basis = Number(item.historicalCostBasis);
  return Number.isFinite(basis) && (basis > 0 || (basis === 0 && item.zeroCostBasisConfirmed === true));
}

export function missingHistoricalCostBasisItems(transaction: Pick<TradeTransaction, "transactionType" | "items">) {
  if (transaction.transactionType !== "sale") return [];
  return transaction.items.filter((item) => item.direction === "outgoing" && !hasKnownHistoricalCostBasis(item));
}

export function allocateTransactionTotal(items: TradeItem[], total: number, method: AllocationMethod, field: "soldPrice" | "boughtPrice") {
  if (method === "custom") return items;
  const weights = items.map((item) => method === "market" ? item.marketValue : method === "cost" ? item.historicalCostBasis : 1);
  const weightTotal = weights.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  let used = 0;
  return items.map((item, index) => {
    const allocated = index === items.length - 1
      ? roundMoney(total - used)
      : roundMoney(total * (weightTotal ? Math.max(0, weights[index]) / weightTotal : 1 / Math.max(1, items.length)));
    used = roundMoney(used + allocated);
    return { ...item, [field]: allocated, ...(field === "boughtPrice" ? { costBasis: allocated } : {}) };
  });
}

export function transactionReview(transaction: TradeTransaction) {
  const outgoing = transaction.items.filter((item) => item.direction === "outgoing");
  const incoming = transaction.items.filter((item) => item.direction === "incoming");
  const sold = roundMoney(outgoing.reduce((sum, item) => sum + Number(item.soldPrice || 0), 0));
  const bought = roundMoney(incoming.reduce((sum, item) => sum + Number(item.boughtPrice || 0), 0));
  const purchaseCostBasis = roundMoney(incoming.reduce((sum, item) => sum + Number(item.costBasis || 0), 0));
  const marketValue = roundMoney(incoming.reduce((sum, item) => sum + Number(item.marketValue || 0), 0));
  const potentialMargin = roundMoney(marketValue - purchaseCostBasis);
  const missingCostBasisItems = missingHistoricalCostBasisItems(transaction);
  const basisComplete = missingCostBasisItems.length === 0;
  const basis = roundMoney(outgoing.reduce((sum, item) => sum + (hasKnownHistoricalCostBasis(item) ? Number(item.historicalCostBasis) : 0), 0));
  const grossProfit = basisComplete ? roundMoney(sold - basis) : undefined;
  const ownerProfit = new Map<string, number>();
  if (basisComplete) outgoing.forEach((item) => item.ownershipShares.forEach((share) => {
    const profit = Number(item.soldPrice || 0) - Number(item.historicalCostBasis || 0);
    ownerProfit.set(share.workerId, roundMoney((ownerProfit.get(share.workerId) || 0) + profit * share.ownershipPercentage / 100));
  }));
  const allocated = transaction.transactionType === "sale" ? sold : bought;
  const bundleDifference = transaction.pricingMode === "bundle_total" ? roundMoney(Number(transaction.bundleTotal || 0) - allocated) : 0;
  const internalBalances = new Map<string, { owedByWorkerId: string; owedToWorkerId: string; amount: number }>();
  if (transaction.transactionType === "purchase" && transaction.paidByWorkerId) {
    incoming.forEach((item) => item.ownershipShares.forEach((share) => {
      if (share.workerId === transaction.paidByWorkerId) return;
      const key = `${share.workerId}:${transaction.paidByWorkerId}`;
      const current = internalBalances.get(key) || { owedByWorkerId: share.workerId, owedToWorkerId: transaction.paidByWorkerId!, amount: 0 };
      current.amount = roundMoney(current.amount + Number(item.costBasis || 0) * share.ownershipPercentage / 100);
      internalBalances.set(key, current);
    }));
  }
  return {
    outgoing,
    incoming,
    sold,
    bought,
    basis,
    purchaseCostBasis,
    marketValue,
    potentialMargin,
    basisComplete,
    missingCostBasisItems,
    grossProfit,
    ownerProfit,
    bundleDifference,
    internalBalances: Array.from(internalBalances.values())
  };
}

export function dailyFinancialSummary(date: string, sales: SalesRecord[], purchases: InventoryPurchase[], expenses: BusinessExpense[], transactions: TradeTransaction[]) {
  const daySales = sales.filter((row) => row.soldAt.slice(0, 10) === date);
  const dayPurchases = purchases.filter((row) => row.purchaseDate.slice(0, 10) === date && row.purchaseSource !== "trade");
  const dayExpenses = expenses.filter((row) => row.expenseDate.slice(0, 10) === date);
  const trades = transactions.filter((row) => row.status === "completed" && ["trade", "cash_trade"].includes(row.transactionType) && row.tradeDate.slice(0, 10) === date);
  const cashSales = daySales.filter((row) => (row.paymentMethod || "cash") === "cash").reduce((sum, row) => sum + Number(row.soldPrice || 0), 0);
  const digitalSales = daySales.filter((row) => (row.paymentMethod || "cash") !== "cash").reduce((sum, row) => sum + Number(row.soldPrice || 0), 0);
  const inventorySpent = dayPurchases.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);
  const tableFees = dayExpenses.filter((row) => row.category === "event_table_fee").reduce((sum, row) => sum + row.amount, 0);
  const operatingExpenses = dayExpenses.filter((row) => row.category !== "event_table_fee").reduce((sum, row) => sum + row.amount, 0);
  const tradeCashReceived = trades.reduce((sum, row) => sum + row.cashReceived, 0);
  const tradeCashPaid = trades.reduce((sum, row) => sum + row.cashPaid, 0);
  const realizedGrossProfit = daySales.reduce((sum, row) => sum + Number(row.soldPrice || 0) - Number(row.boughtPrice || 0), 0);
  const estimatedTradeGainLoss = trades.reduce((sum, row) => {
    const incomingMarket = row.items.filter((item) => item.direction === "incoming").reduce((value, item) => value + Number(item.marketValue || 0), 0);
    const outgoingBasis = row.items.filter((item) => item.direction === "outgoing").reduce((value, item) => value + Number(item.historicalCostBasis || 0), 0);
    return sum + incomingMarket + row.cashReceived - outgoingBasis - row.cashPaid;
  }, 0);
  const netCashFlow = cashSales + digitalSales + tradeCashReceived - inventorySpent - operatingExpenses - tableFees - tradeCashPaid;
  const salesRevenue = roundMoney(cashSales + digitalSales);
  const cashMargin = roundMoney(salesRevenue + tradeCashReceived - inventorySpent - tradeCashPaid);
  const completedTransactions = transactions.filter((row) => row.status === "completed" && row.tradeDate.slice(0, 10) === date);
  const saleTransactions = completedTransactions.filter((row) => row.transactionType === "sale");
  const purchaseTransactions = completedTransactions.filter((row) => row.transactionType === "purchase");
  const tradeTransactions = completedTransactions.filter((row) => row.transactionType === "trade" || row.transactionType === "cash_trade");
  const cardsMoved = completedTransactions.reduce((sum, row) => sum + row.items.reduce((itemSum, item) => itemSum + Number(item.quantity || 1), 0), 0);
  const currentInventoryMarketValue = roundMoney(purchases
    .filter((purchase) => purchase.status === "in_stock" || purchase.status === "partially_sold")
    .reduce((sum, purchase) => {
      const remaining = Math.max(0, Number(purchase.quantity || 0) - Number(purchase.quantitySold || 0));
      return sum + Number(purchase.marketValue || 0) * (remaining / Math.max(1, Number(purchase.quantity || 1)));
    }, 0));
  const ownerProfit = new Map<string, number>();
  daySales.forEach((sale) => (sale.ownershipShares || []).forEach((share) => ownerProfit.set(share.workerId, roundMoney((ownerProfit.get(share.workerId) || 0) + (Number(sale.soldPrice || 0) - Number(sale.boughtPrice || 0)) * share.ownershipPercentage / 100))));
  return {
    cashSales: roundMoney(cashSales), digitalSales: roundMoney(digitalSales), salesRevenue, inventorySpent: roundMoney(inventorySpent),
    operatingExpenses: roundMoney(operatingExpenses), tableFees: roundMoney(tableFees), tradeCashReceived: roundMoney(tradeCashReceived),
    tradeCashPaid: roundMoney(tradeCashPaid), netCashFlow: roundMoney(netCashFlow), cashMargin,
    transactionCount: completedTransactions.length, saleCount: saleTransactions.length, purchaseCount: purchaseTransactions.length,
    tradeCount: tradeTransactions.length, cardsMoved, currentInventoryMarketValue, inventoryBought: dayPurchases.length,
    inventorySold: daySales.length, inventoryTradedOut: trades.flatMap((row) => row.items).filter((item) => item.direction === "outgoing").length,
    inventoryReceived: trades.flatMap((row) => row.items).filter((item) => item.direction === "incoming").length,
    realizedGrossProfit: roundMoney(realizedGrossProfit), estimatedTradeGainLoss: roundMoney(estimatedTradeGainLoss),
    overallEstimatedResult: roundMoney(realizedGrossProfit - operatingExpenses - tableFees + estimatedTradeGainLoss), ownerProfit
  };
}
