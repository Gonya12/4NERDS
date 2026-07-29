import assert from "node:assert/strict";
import test from "node:test";
import type { TradeTransaction } from "../src/types/models.ts";
import { buildFinancialTransactionPayload } from "../src/services/database/financialTransactionPayload.ts";

const now = "2026-07-29T12:00:00.000Z";
function transaction(
  transactionType: TradeTransaction["transactionType"],
  patch: Partial<TradeTransaction> = {}
): TradeTransaction {
  return {
    id: "5a88d735-8e67-4d9d-a251-1ba266fa5e34",
    transactionType,
    tradeDate: now,
    itemMode: "multiple",
    pricingMode: "individual",
    cashReceived: 0,
    cashPaid: 0,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    items: [],
    ...patch
  };
}

const allowedKeys = new Set([
  "id", "transaction_type", "transaction_subtype", "transaction_date", "event_id", "event_day_id",
  "customer_or_seller", "payment_method", "cash_received", "cash_paid", "bundle_total",
  "allocation_method", "entered_by_worker_id", "notes", "status", "item_mode",
  "general_image_url", "general_image_path", "expense_category"
]);

function assertCleanPayload(payload: ReturnType<typeof buildFinancialTransactionPayload>) {
  assert.ok(Object.keys(payload).every((key) => allowedKeys.has(key)), `Unexpected key: ${Object.keys(payload).find((key) => !allowedKeys.has(key))}`);
  assert.ok(Object.values(payload).every((value) => value !== undefined && value !== null));
}

for (const source of ["pasted", "gallery", "camera"]) {
  test(`multi-item sale with ${source} image omits expense fields and preserves its UUID`, () => {
    const input = transaction("sale", {
      expenseCategory: "event_table_fee",
      generalImageUrl: `https://example.test/${source}.jpg`,
      generalImagePath: `shared/${source}.jpg`
    });
    const payload = buildFinancialTransactionPayload(input);
    assert.equal(payload.id, input.id);
    assert.equal(payload.transaction_type, "sale");
    assert.equal(payload.item_mode, "multiple");
    assert.equal(payload.general_image_path, `shared/${source}.jpg`);
    assert.ok(!("expense_category" in payload));
    assertCleanPayload(payload);
  });
}

test("single-item transaction uses canonical item_mode without entry_mode", () => {
  const payload = buildFinancialTransactionPayload(transaction("sale", { itemMode: "single" }));
  assert.equal(payload.item_mode, "single");
  assert.ok(!("entry_mode" in payload));
  assertCleanPayload(payload);
});

test("inventory lot purchase includes its subtype but not expense_category", () => {
  const payload = buildFinancialTransactionPayload(transaction("purchase", {
    purchaseSource: "card_show",
    expenseCategory: "other",
    bundleTotal: 500
  }));
  assert.equal(payload.transaction_subtype, "card_show");
  assert.ok(!("expense_category" in payload));
  assertCleanPayload(payload);
});

test("general expense includes expense_category", () => {
  const payload = buildFinancialTransactionPayload(transaction("expense", { expenseCategory: "other", cashPaid: 75 }));
  assert.equal(payload.expense_category, "other");
  assertCleanPayload(payload);
});

test("event table fee includes its expense category", () => {
  const payload = buildFinancialTransactionPayload(transaction("expense", { expenseCategory: "event_table_fee", cashPaid: 250 }));
  assert.equal(payload.expense_category, "event_table_fee");
  assertCleanPayload(payload);
});

test("trade omits expense_category", () => {
  const payload = buildFinancialTransactionPayload(transaction("trade", { expenseCategory: "supplies" }));
  assert.ok(!("expense_category" in payload));
  assertCleanPayload(payload);
});

test("cash + trade omits expense_category", () => {
  const payload = buildFinancialTransactionPayload(transaction("cash_trade", { expenseCategory: "food", cashPaid: 25, cashReceived: 10 }));
  assert.ok(!("expense_category" in payload));
  assertCleanPayload(payload);
});
