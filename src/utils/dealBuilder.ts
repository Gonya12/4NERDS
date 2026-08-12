import type { FinancialTransactionType, TradeItem, TradeTransaction } from "../types/models";
import { calculateTargetPrice } from "./cardPricing";
import { roundMoney } from "./paymentMath";
import { hasKnownHistoricalCostBasis } from "./transactionMath";
import { tradeSummary } from "./tradeMath";

export type DealClassification = Exclude<FinancialTransactionType, "expense"> | "unclassified";
export type DealSide = "incoming" | "outgoing";

export const incomingDealPercentages = [90, 85, 80, 75, 70] as const;
export const outgoingDealPercentages = [100, 95, 90, 85, 80] as const;

export const conditionMarketFactors = {
  NM: 1,
  LP: 0.9,
  MP: 0.75,
  HP: 0.6,
  DMG: 0.4,
} as const;

export function classifyDeal(input: Pick<TradeTransaction, "items" | "cashPaid" | "cashReceived">): DealClassification {
  const incoming = input.items.some((item) => item.direction === "incoming");
  const outgoing = input.items.some((item) => item.direction === "outgoing");
  const hasCash = Number(input.cashPaid || 0) > 0 || Number(input.cashReceived || 0) > 0;
  if (incoming && outgoing) return hasCash ? "cash_trade" : "trade";
  if (incoming) return "purchase";
  if (outgoing) return "sale";
  return "unclassified";
}

export function conditionAdjustedMarket(marketValue: number, condition?: string) {
  const normalized = (condition || "NM").toUpperCase();
  const key = normalized.includes("DMG") || normalized.includes("DAMAGED") ? "DMG"
    : normalized.includes("HP") || normalized.includes("HEAVILY") ? "HP"
      : normalized.includes("MP") || normalized.includes("MODERATELY") ? "MP"
        : normalized.includes("LP") || normalized.includes("LIGHTLY") ? "LP"
          : "NM";
  const factor = conditionMarketFactors[key];
  return roundMoney(Math.max(0, Number(marketValue || 0)) * factor);
}

export function applyDealPercentage(item: TradeItem, side: DealSide, percentage: number): TradeItem {
  const adjustedMarket = conditionAdjustedMarket(item.marketValue, item.cardCondition);
  const agreed = calculateTargetPrice(adjustedMarket, percentage);
  if (side === "incoming") {
    return {
      ...item,
      direction: "incoming",
      targetBuyPercentage: percentage,
      targetBuyPrice: agreed,
      tradePercentage: percentage,
      agreedTradeValue: agreed,
      boughtPrice: agreed,
      costBasis: agreed,
    };
  }
  return {
    ...item,
    direction: "outgoing",
    targetBuyPercentage: percentage,
    targetBuyPrice: agreed,
    tradePercentage: percentage,
    agreedTradeValue: agreed,
    soldPrice: agreed,
  };
}

export function normalizeDealForSave(transaction: TradeTransaction): TradeTransaction {
  const transactionType = classifyDeal(transaction);
  if (transactionType === "unclassified") return transaction;
  const itemMode = transaction.items.length > 1 ? "multiple" : "single";
  return {
    ...transaction,
    transactionType,
    itemMode,
    items: transaction.items.map((item) => item.direction === "incoming"
      ? {
          ...item,
          agreedTradeValue: Number(item.agreedTradeValue || item.boughtPrice || item.marketValue || 0),
          boughtPrice: transactionType === "purchase" ? Number(item.agreedTradeValue || item.boughtPrice || 0) : item.boughtPrice,
          costBasis: transactionType === "purchase" ? Number(item.agreedTradeValue || item.boughtPrice || 0) : item.costBasis,
        }
      : {
          ...item,
          agreedTradeValue: Number(item.agreedTradeValue || item.soldPrice || item.marketValue || 0),
          soldPrice: transactionType === "sale" ? Number(item.agreedTradeValue || item.soldPrice || 0) : item.soldPrice,
        }),
  };
}

export function dealSummary(transaction: TradeTransaction) {
  const incoming = transaction.items.filter((item) => item.direction === "incoming");
  const outgoing = transaction.items.filter((item) => item.direction === "outgoing");
  const incomingAgreed = roundMoney(incoming.reduce((sum, item) => sum + Number(item.agreedTradeValue || item.boughtPrice || 0), 0));
  const outgoingAgreed = roundMoney(outgoing.reduce((sum, item) => sum + Number(item.agreedTradeValue || item.soldPrice || 0), 0));
  const incomingMarket = roundMoney(incoming.reduce((sum, item) => sum + Number(item.marketValue || 0), 0));
  const outgoingBasisComplete = outgoing.every(hasKnownHistoricalCostBasis);
  const outgoingBasis = roundMoney(outgoing.reduce((sum, item) => sum + (hasKnownHistoricalCostBasis(item) ? Number(item.historicalCostBasis || 0) : 0), 0));
  const classification = classifyDeal(transaction);
  const saleProfit = classification === "sale" && outgoingBasisComplete
    ? roundMoney(outgoingAgreed - outgoingBasis)
    : undefined;
  const purchaseUnrealizedGain = classification === "purchase"
    ? roundMoney(incomingMarket - incomingAgreed)
    : undefined;
  const tradeGainLoss = (classification === "trade" || classification === "cash_trade") && outgoingBasisComplete
    ? tradeSummary(transaction).tradeGainLoss
    : undefined;
  return {
    classification,
    incomingAgreed,
    outgoingAgreed,
    incomingMarket,
    outgoingBasis,
    outgoingBasisComplete,
    cashDifference: roundMoney(Number(transaction.cashReceived || 0) - Number(transaction.cashPaid || 0)),
    saleProfit,
    purchaseUnrealizedGain,
    tradeGainLoss,
  };
}
