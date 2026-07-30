import assert from "node:assert/strict";
import test from "node:test";
import { applyCardSuggestionToItem, applyIncomingPercentage, calculateTargetPrice, selectedTcgplayerPrice } from "../src/utils/cardPricing.ts";
import type { CardScanSuggestion } from "../src/services/sales/cardScanService.ts";
import type { TradeItem } from "../src/types/models.ts";

const item: TradeItem = {
  id: "item-1", tradeTransactionId: "transaction-1", direction: "incoming", itemName: "Manual name",
  itemType: "raw_card", quantity: 1, marketValue: 42, agreedTradeValue: 0, historicalCostBasis: 19,
  costBasis: 0, ownershipShares: [{ id: "share-1", workerId: "worker-1", ownershipPercentage: 100 }],
  createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z",
};

const suggestion: CardScanSuggestion = {
  suggestedType: "raw_card", cardName: "Tapu Bulu-GX", collectorNumber: "130", cardSet: "Burning Shadows",
  cardSetId: "sm3", cardSetCode: "BUS", cardRarity: "Secret Rare", pokemonTcgCardId: "sm3-130",
  officialImageUrl: "https://example.test/card.png", tcgplayerUrl: "https://example.test/tcgplayer",
  language: "English", condition: null, stickerPrice: null, gradingCompany: null, grade: null,
  certificateNumber: null, labelInformation: null, barcodeText: null, overallConfidence: "high",
  fieldConfidence: {}, warnings: [], tcgplayerPricing: {
    url: "https://example.test/tcgplayer", updatedAt: "2026/07/28", checkedAt: "2026-07-29T00:00:00.000Z",
    selectedVariant: "holofoil", variants: [{ variant: "normal", market: 20 }, { variant: "holofoil", market: 100, low: 90, mid: 105, high: 120, directLow: 95 }],
  },
};

test("target price uses canonical two-decimal rounding", () => {
  assert.equal(calculateTargetPrice(99.99, 75), 74.99);
  assert.equal(calculateTargetPrice(99.99, 80), 79.99);
});

test("selected finish determines market while preserving accounting and ownership", () => {
  const next = applyCardSuggestionToItem(item, suggestion, "manual");
  assert.equal(selectedTcgplayerPrice(next.tcgplayerPricing)?.variant, "holofoil");
  assert.equal(next.marketValue, 100);
  assert.equal(next.historicalCostBasis, 19);
  assert.deepEqual(next.ownershipShares, item.ownershipShares);
  assert.equal(next.pokemonTcgCardId, "sm3-130");
  assert.equal(next.marketPriceVariant, "holofoil");
  assert.equal(next.targetBuyPrice, 75);
});

test("visible sticker metadata never becomes an accounting amount automatically", () => {
  const next = applyCardSuggestionToItem({
    ...item,
    soldPrice: 35,
    boughtPrice: 11,
    costBasis: 9,
  }, {
    ...suggestion,
    condition: "Near Mint / NM",
    stickerPrice: 125,
    tcgplayerPricing: undefined,
  }, "scanner");
  assert.equal(next.stickerPrice, 125);
  assert.equal(next.stickerCondition, "Near Mint / NM");
  assert.equal(next.soldPrice, 35);
  assert.equal(next.boughtPrice, 11);
  assert.equal(next.costBasis, 9);
  assert.equal(next.historicalCostBasis, 19);
});

test("unpriced card preserves editable market value instead of inserting zero", () => {
  const next = applyCardSuggestionToItem(item, {
    ...suggestion,
    tcgplayerPricing: { checkedAt: "2026-07-29T00:00:00.000Z", variants: [] },
  }, "manual");
  assert.equal(next.marketValue, 42);
});

test("stale scanner result cannot overwrite a manual card selection", () => {
  const manual = applyCardSuggestionToItem(item, suggestion, "manual");
  const stale = applyCardSuggestionToItem(manual, { ...suggestion, cardName: "Wrong OCR card" }, "scanner");
  assert.equal(stale.itemName, "Tapu Bulu-GX");
});

test("batch trade percentage changes incoming accepted values but never outgoing inventory", () => {
  const outgoing = { ...item, id: "outgoing", direction: "outgoing" as const, agreedTradeValue: 88, historicalCostBasis: 12 };
  const incoming = { ...item, id: "incoming", marketValue: 100 };
  const next = applyIncomingPercentage([outgoing, incoming], 80, "trade");
  assert.equal(next[0], outgoing);
  assert.equal(next[0].historicalCostBasis, 12);
  assert.equal(next[1].tradePercentage, 80);
  assert.equal(next[1].agreedTradeValue, 80);
});

test("batch purchase percentage sets a target without silently changing bought price", () => {
  const incoming = { ...item, boughtPrice: 51, marketValue: 100 };
  const [next] = applyIncomingPercentage([incoming], 75, "purchase");
  assert.equal(next.targetBuyPrice, 75);
  assert.equal(next.boughtPrice, 51);
});
