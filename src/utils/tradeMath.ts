import type { TradeItem, TradeTransaction } from "../types/models";

const roundMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const total = (items: TradeItem[], key: "marketValue" | "agreedTradeValue" | "historicalCostBasis" | "costBasis") =>
  roundMoney(items.reduce((sum, item) => sum + Number(item[key] || 0), 0));

export function tradeTimeValue(item: Pick<TradeItem, "agreedTradeValue" | "marketValue">) {
  const agreed = Number(item.agreedTradeValue);
  return roundMoney(Number.isFinite(agreed) && agreed > 0 ? agreed : Number(item.marketValue || 0));
}

export function tradeSummary(trade: Pick<TradeTransaction, "items" | "cashPaid" | "cashReceived">) {
  const outgoing = trade.items.filter((item) => item.direction === "outgoing");
  const incoming = trade.items.filter((item) => item.direction === "incoming");
  const outgoingMarket = total(outgoing, "marketValue");
  const outgoingAgreed = total(outgoing, "agreedTradeValue");
  const outgoingCostBasis = total(outgoing, "historicalCostBasis");
  const incomingMarket = total(incoming, "marketValue");
  const incomingAgreed = total(incoming, "agreedTradeValue");
  const incomingTradeTimeValue = roundMoney(incoming.reduce((sum, item) => sum + tradeTimeValue(item), 0));
  const incomingCostBasis = total(incoming, "costBasis");
  const cashPaid = roundMoney(Number(trade.cashPaid || 0));
  const cashReceived = roundMoney(Number(trade.cashReceived || 0));
  const agreedDifference = roundMoney(incomingAgreed + cashReceived - outgoingAgreed - cashPaid);
  const marketDifference = roundMoney(incomingMarket + cashReceived - outgoingMarket - cashPaid);
  const cashDifference = roundMoney(cashReceived - cashPaid);
  const tradeGainLoss = roundMoney(incomingTradeTimeValue + cashReceived - outgoingCostBasis - cashPaid);
  const netInventoryValueChange = roundMoney(incomingMarket - outgoingMarket);
  return {
    outgoing, incoming, outgoingMarket, outgoingAgreed, outgoingCostBasis,
    incomingMarket, incomingAgreed, incomingTradeTimeValue, incomingCostBasis, cashPaid, cashReceived,
    agreedDifference, marketDifference, cashDifference, tradeGainLoss,
    estimatedGainLoss: tradeGainLoss, netInventoryValueChange
  };
}

export function allocateBasis(totalBasis: number, items: TradeItem[], method: "market" | "agreed" | "equal") {
  const weights = items.map((item) => method === "market" ? item.marketValue : method === "agreed" ? item.agreedTradeValue : 1);
  const weightTotal = weights.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  let allocated = 0;
  return items.map((item, index) => {
    const value = index === items.length - 1
      ? roundMoney(totalBasis - allocated)
      : roundMoney(totalBasis * (weightTotal ? Math.max(0, weights[index]) / weightTotal : 1 / Math.max(1, items.length)));
    allocated = roundMoney(allocated + value);
    return { ...item, costBasis: value };
  });
}

export function allocateIncomingTradeBasis(
  trade: Pick<TradeTransaction, "items">,
  method: "market" | "agreed" | "equal" = "agreed"
) {
  const incoming = trade.items.filter((item) => item.direction === "incoming");
  const totalBasis = roundMoney(incoming.reduce((sum, item) => sum + tradeTimeValue(item), 0));
  return allocateBasis(totalBasis, incoming, method);
}

function allocateAmounts(totalAmount: number, weights: number[]) {
  const normalized = weights.map((value) => Math.max(0, Number(value || 0)));
  const weightTotal = normalized.reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  return normalized.map((weight, index) => {
    const amount = index === normalized.length - 1
      ? roundMoney(totalAmount - allocated)
      : roundMoney(totalAmount * (weightTotal ? weight / weightTotal : 1 / Math.max(1, normalized.length)));
    allocated = roundMoney(allocated + amount);
    return amount;
  });
}

export function normalizeTradeAccounting(transaction: TradeTransaction) {
  if (transaction.transactionType !== "trade" && transaction.transactionType !== "cash_trade") return transaction;
  const incoming = transaction.items.filter((item) => item.direction === "incoming");
  const outgoing = transaction.items.filter((item) => item.direction === "outgoing");
  const assignedIncomingValue = roundMoney(incoming.reduce((sum, item) => sum + tradeTimeValue(item), 0));
  const currentBasisTotal = roundMoney(incoming.reduce((sum, item) => sum + Number(item.costBasis || 0), 0));
  const customBasisIsBalanced = incoming.length > 0
    && incoming.every((item) => Number.isFinite(Number(item.costBasis)) && Number(item.costBasis) >= 0)
    && Math.abs(currentBasisTotal - assignedIncomingValue) < 0.01;
  const incomingBasis = customBasisIsBalanced ? incoming : allocateIncomingTradeBasis(transaction, "agreed");
  const incomingBasisById = new Map(incomingBasis.map((item) => [item.id, item.costBasis]));
  const cashPaidAllocations = allocateAmounts(
    roundMoney(transaction.cashPaid),
    incoming.map((item) => tradeTimeValue(item))
  );
  const cashPaidById = new Map(incoming.map((item, index) => [item.id, cashPaidAllocations[index] || 0]));
  const gain = tradeSummary(transaction).tradeGainLoss;
  const outgoingBasisTotal = outgoing.reduce((sum, item) => sum + Math.max(0, Number(item.historicalCostBasis || 0)), 0);
  const gainShares = outgoing.flatMap((item) => item.ownershipShares.map((share) => ({
    itemId: item.id,
    workerId: share.workerId,
    weight: (outgoingBasisTotal > 0 ? Number(item.historicalCostBasis || 0) : 1) * Number(share.ownershipPercentage || 0) / 100
  })));
  const gainAllocations = allocateAmounts(gain, gainShares.map((share) => share.weight));
  const gainByShare = new Map(gainShares.map((share, index) => [`${share.itemId}:${share.workerId}`, gainAllocations[index] || 0]));
  return {
    ...transaction,
    items: transaction.items.map((item) => item.direction === "incoming"
      ? {
          ...item,
          costBasis: incomingBasisById.get(item.id) ?? item.costBasis,
          boughtPrice: cashPaidById.get(item.id) ?? 0,
          cashAllocation: cashPaidById.get(item.id) ?? 0
        }
      : item.direction === "outgoing"
        ? {
            ...item,
            ownershipShares: item.ownershipShares.map((share) => ({
              ...share,
              allocatedTradeValue: gainByShare.get(`${item.id}:${share.workerId}`) ?? 0
            }))
          }
        : item)
  };
}

export function tradeGainOwnership(transaction: Pick<TradeTransaction, "transactionType" | "items" | "cashPaid" | "cashReceived">) {
  const normalized = normalizeTradeAccounting(transaction as TradeTransaction);
  const totals = new Map<string, number>();
  normalized.items.filter((item) => item.direction === "outgoing").forEach((item) => {
    item.ownershipShares.forEach((share) => {
      totals.set(share.workerId, roundMoney((totals.get(share.workerId) || 0) + Number(share.allocatedTradeValue || 0)));
    });
  });
  return totals;
}

export function tradeGainByIncomingItem(transaction: Pick<TradeTransaction, "items" | "cashPaid" | "cashReceived">) {
  const incoming = transaction.items.filter((item) => item.direction === "incoming");
  const allocations = allocateAmounts(
    tradeSummary(transaction).tradeGainLoss,
    incoming.map((item) => tradeTimeValue(item))
  );
  return new Map(incoming.map((item, index) => [item.id, allocations[index] || 0]));
}

export function ownershipIsValid(item: TradeItem) {
  return ownershipValidationError(item) === "";
}

export function ownershipValidationError(item: Pick<TradeItem, "ownershipShares">) {
  if (!item.ownershipShares.length) return "At least one owner is required.";
  const workers = new Set<string>();
  let total = 0;
  for (const share of item.ownershipShares) {
    const percentage = Number(share.ownershipPercentage);
    if (!share.workerId) return "Every ownership share requires a worker.";
    if (workers.has(share.workerId)) return "The same worker cannot appear more than once.";
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return "Ownership percentages must be greater than 0 and no more than 100.";
    workers.add(share.workerId);
    total += percentage;
  }
  return Math.abs(total - 100) < 0.001 ? "" : "Ownership must total exactly 100%.";
}
