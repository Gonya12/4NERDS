import type { BusinessExpense, InventoryPurchase, SalesRecord, TradeItem, TradeTransaction } from "../types/models";

const roundMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export type AllocationMethod = "market" | "equal" | "cost" | "custom";

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
    return { ...item, [field]: allocated, ...(field === "boughtPrice" ? { allocatedCostBasis: allocated } : {}) };
  });
}

export function transactionReview(transaction: TradeTransaction) {
  const outgoing = transaction.items.filter((item) => item.direction === "outgoing");
  const incoming = transaction.items.filter((item) => item.direction === "incoming");
  const sold = roundMoney(outgoing.reduce((sum, item) => sum + Number(item.soldPrice || 0), 0));
  const bought = roundMoney(incoming.reduce((sum, item) => sum + Number(item.boughtPrice || 0), 0));
  const basis = roundMoney(outgoing.reduce((sum, item) => sum + Number(item.historicalCostBasis || 0), 0));
  const grossProfit = roundMoney(sold - basis);
  const ownerProfit = new Map<string, number>();
  outgoing.forEach((item) => item.ownershipShares.forEach((share) => {
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
      current.amount = roundMoney(current.amount + Number(item.boughtPrice || item.allocatedCostBasis || 0) * share.ownershipPercentage / 100);
      internalBalances.set(key, current);
    }));
  }
  return { outgoing, incoming, sold, bought, basis, grossProfit, ownerProfit, bundleDifference, internalBalances: Array.from(internalBalances.values()) };
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
  const ownerProfit = new Map<string, number>();
  daySales.forEach((sale) => (sale.ownershipShares || []).forEach((share) => ownerProfit.set(share.workerId, roundMoney((ownerProfit.get(share.workerId) || 0) + (Number(sale.soldPrice || 0) - Number(sale.boughtPrice || 0)) * share.ownershipPercentage / 100))));
  return {
    cashSales: roundMoney(cashSales), digitalSales: roundMoney(digitalSales), inventorySpent: roundMoney(inventorySpent),
    operatingExpenses: roundMoney(operatingExpenses), tableFees: roundMoney(tableFees), tradeCashReceived: roundMoney(tradeCashReceived),
    tradeCashPaid: roundMoney(tradeCashPaid), netCashFlow: roundMoney(netCashFlow), inventoryBought: dayPurchases.length,
    inventorySold: daySales.length, inventoryTradedOut: trades.flatMap((row) => row.items).filter((item) => item.direction === "outgoing").length,
    inventoryReceived: trades.flatMap((row) => row.items).filter((item) => item.direction === "incoming").length,
    realizedGrossProfit: roundMoney(realizedGrossProfit), estimatedTradeGainLoss: roundMoney(estimatedTradeGainLoss),
    overallEstimatedResult: roundMoney(realizedGrossProfit - operatingExpenses - tableFees + estimatedTradeGainLoss), ownerProfit
  };
}
