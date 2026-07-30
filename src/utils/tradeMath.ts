import type { TradeItem, TradeTransaction } from "../types/models";

const roundMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const total = (items: TradeItem[], key: "marketValue" | "agreedTradeValue" | "historicalCostBasis" | "costBasis") =>
  roundMoney(items.reduce((sum, item) => sum + Number(item[key] || 0), 0));

export function tradeSummary(trade: Pick<TradeTransaction, "items" | "cashPaid" | "cashReceived">) {
  const outgoing = trade.items.filter((item) => item.direction === "outgoing");
  const incoming = trade.items.filter((item) => item.direction === "incoming");
  const outgoingMarket = total(outgoing, "marketValue");
  const outgoingAgreed = total(outgoing, "agreedTradeValue");
  const outgoingCostBasis = total(outgoing, "historicalCostBasis");
  const incomingMarket = total(incoming, "marketValue");
  const incomingAgreed = total(incoming, "agreedTradeValue");
  const incomingCostBasis = total(incoming, "costBasis");
  const cashPaid = roundMoney(Number(trade.cashPaid || 0));
  const cashReceived = roundMoney(Number(trade.cashReceived || 0));
  const agreedDifference = roundMoney(incomingAgreed + cashReceived - outgoingAgreed - cashPaid);
  const marketDifference = roundMoney(incomingMarket + cashReceived - outgoingMarket - cashPaid);
  const cashDifference = roundMoney(cashReceived - cashPaid);
  const estimatedGainLoss = roundMoney(incomingMarket + cashReceived - outgoingCostBasis - cashPaid);
  const netInventoryValueChange = roundMoney(incomingMarket - outgoingMarket);
  return {
    outgoing, incoming, outgoingMarket, outgoingAgreed, outgoingCostBasis,
    incomingMarket, incomingAgreed, incomingCostBasis, cashPaid, cashReceived,
    agreedDifference, marketDifference, cashDifference, estimatedGainLoss, netInventoryValueChange
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
