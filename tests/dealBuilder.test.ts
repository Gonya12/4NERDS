import assert from "node:assert/strict";
import test from "node:test";
import type { TradeItem, TradeTransaction } from "../src/types/models.ts";
import { applyDealPercentage, classifyDeal, dealSummary, normalizeDealForSave } from "../src/utils/dealBuilder.ts";

const item = (direction: TradeItem["direction"], values: Partial<TradeItem> = {}): TradeItem => ({
  id: crypto.randomUUID(), tradeTransactionId: "tx", direction, itemName: "Card", itemType: "raw_card",
  quantity: 1, marketValue: 0, agreedTradeValue: 0, historicalCostBasis: 0, costBasis: 0,
  ownershipShares: [{ workerId: "owner", ownershipPercentage: 100 }], createdAt: "2026-08-12", updatedAt: "2026-08-12", ...values,
});
const deal = (items: TradeItem[], cashPaid = 0, cashReceived = 0): TradeTransaction => ({
  id: "tx", tradeDate: "2026-08-12", transactionType: "trade", itemMode: "multiple", pricingMode: "individual",
  cashPaid, cashReceived, status: "draft", createdAt: "2026-08-12", updatedAt: "2026-08-12", items,
});

test("classifies canonical deal shapes", () => {
  assert.equal(classifyDeal(deal([item("incoming")], 11)), "purchase");
  assert.equal(classifyDeal(deal([item("outgoing")], 0, 16)), "sale");
  assert.equal(classifyDeal(deal([item("incoming"), item("outgoing")])), "trade");
  assert.equal(classifyDeal(deal([item("incoming"), item("outgoing")], 5)), "cash_trade");
});

test("purchase percentage keeps market and agreed value separate", () => {
  const result = applyDealPercentage(item("incoming", { marketValue: 16, cardCondition: "NM" }), "incoming", 70);
  assert.equal(result.marketValue, 16);
  assert.equal(result.agreedTradeValue, 11.2);
  assert.equal(result.boughtPrice, 11.2);
});

test("purchase summary labels market less cost as unrealized", () => {
  const transaction = normalizeDealForSave(deal([item("incoming", { marketValue: 16, agreedTradeValue: 11, boughtPrice: 11, costBasis: 11 })], 11));
  const summary = dealSummary(transaction);
  assert.equal(summary.classification, "purchase");
  assert.equal(summary.purchaseUnrealizedGain, 5);
  assert.equal(summary.saleProfit, undefined);
});

test("sale profit uses historical cost", () => {
  const transaction = normalizeDealForSave(deal([item("outgoing", { marketValue: 16, agreedTradeValue: 16, soldPrice: 16, historicalCostBasis: 11 })], 0, 16));
  assert.equal(transaction.transactionType, "sale");
  assert.equal(dealSummary(transaction).saleProfit, 5);
});
