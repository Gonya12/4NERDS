import assert from "node:assert/strict";
import test from "node:test";
import {
  transactionEditorBasePath, transactionEditorDestination,
  type TransactionEntryMode, type TransactionFlowType
} from "../src/services/sales/transactionFlowRoutes.ts";

const cases: Array<[string, TransactionFlowType, TransactionEntryMode, string]> = [
  ["sold single", "sold", "single", "/sales/transactions/new?type=sale&items=single"],
  ["sold multiple", "sold", "multiple", "/sales/transactions/new?type=sale&items=multiple"],
  ["purchased single", "purchased", "single", "/sales/transactions/new?type=purchase&source=other&items=single"],
  ["purchased multiple", "purchased", "multiple", "/sales/transactions/new?type=purchase&source=other&items=multiple"],
  ["trade single", "trade", "single", "/sales/trades?new=trade&items=single"],
  ["trade multiple", "trade", "multiple", "/sales/trades?new=trade&items=multiple"],
  ["cash + trade single", "cash_trade", "single", "/sales/trades?new=cash_trade&items=single"],
  ["cash + trade multiple", "cash_trade", "multiple", "/sales/trades?new=cash_trade&items=multiple"]
];

for (const [name, type, mode, expected] of cases) {
  test(`routes ${name} to its editor`, () => {
    assert.equal(transactionEditorDestination(transactionEditorBasePath(type), mode), expected);
  });
}

test("purchase and cost subtypes survive route construction", () => {
  assert.equal(transactionEditorBasePath("purchased", { source: "card_show" }), "/sales/transactions/new?type=purchase&source=card_show");
  assert.equal(transactionEditorBasePath("cost", { category: "event_table_fee" }), "/sales/transactions/new?type=expense&category=event_table_fee");
});

test("missing editor mappings fail visibly", () => {
  assert.throws(() => transactionEditorDestination("", "multiple"), /not available/i);
});
