import assert from "node:assert/strict";
import test from "node:test";
import type { TradeItem, TradeTransaction } from "../src/types/models.ts";
import { allocateBasis, ownershipIsValid, tradeSummary } from "../src/utils/tradeMath.ts";

const item = (direction: "outgoing" | "incoming", name: string, agreed: number, market: number, basis: number): TradeItem => ({
  id: crypto.randomUUID(), tradeTransactionId: "00000000-0000-0000-0000-000000000001", direction,
  itemName: name, itemType: "raw_card", quantity: 1, marketValue: market, agreedTradeValue: agreed,
  historicalCostBasis: direction === "outgoing" ? basis : 0, allocatedCostBasis: direction === "incoming" ? basis : 0,
  ownershipShares: [{ workerId: "00000000-0000-0000-0000-000000000002", ownershipPercentage: 100 }],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
});
const trade = (items: TradeItem[], cashPaid = 0, cashReceived = 0): TradeTransaction => ({
  id: crypto.randomUUID(), tradeDate: new Date().toISOString(), cashPaid, cashReceived, status: "draft",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items
});

test("basic trade keeps value differences separate from cash", () => {
  const summary = tradeSummary(trade([item("outgoing", "Pikachu", 30, 30, 20), item("incoming", "Charizard", 40, 40, 20)]));
  assert.equal(summary.agreedDifference, 10);
  assert.equal(summary.marketDifference, 10);
  assert.equal(summary.cashDifference, 0);
  assert.equal(summary.cashReceived, 0);
});

test("cash adjustment is counted once as trade cash", () => {
  const summary = tradeSummary(trade([item("outgoing", "Card A", 80, 80, 50), item("incoming", "Card B", 100, 100, 70)], 20, 0));
  assert.equal(summary.agreedDifference, 0);
  assert.equal(summary.cashDifference, -20);
  assert.equal(summary.cashPaid, 20);
});

test("multi-item basis allocation totals exactly with rounding", () => {
  const incoming = [item("incoming", "A", 20, 20, 0), item("incoming", "B", 30, 30, 0), item("incoming", "C", 50, 50, 0)];
  const allocated = allocateBasis(73.37, incoming, "market");
  assert.equal(allocated.reduce((sum, row) => sum + row.allocatedCostBasis, 0), 73.37);
});

test("ownership requires exactly one hundred percent", () => {
  const valid = item("incoming", "A", 10, 10, 5);
  assert.equal(ownershipIsValid(valid), true);
  assert.equal(ownershipIsValid({ ...valid, ownershipShares: [{ ...valid.ownershipShares[0], ownershipPercentage: 99.9 }] }), false);
});
