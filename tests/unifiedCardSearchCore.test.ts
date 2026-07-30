import test from "node:test";
import assert from "node:assert/strict";
import {
  extractOnePieceCardCode,
  normalizeCardGame,
  normalizeCardLanguage,
  normalizeOnePieceCardCode,
  rankOnePieceCards,
} from "../supabase/functions/_shared/unifiedCardSearchCore.ts";
import { buildTransactionItemPayload } from "../src/services/database/databasePayloads.ts";
import type { TradeItem } from "../src/types/models.ts";

test("normalizes game and language selectors to canonical database values", () => {
  assert.equal(normalizeCardGame("One Piece"), "one_piece");
  assert.equal(normalizeCardGame("manual"), "other");
  assert.equal(normalizeCardLanguage("Japanese"), "ja");
  assert.equal(normalizeCardLanguage("jp"), "en");
  assert.equal(normalizeCardLanguage("English", "one_piece"), "en");
});

test("normalizes common One Piece card-code spacing and punctuation", () => {
  assert.equal(normalizeOnePieceCardCode("op01 001"), "OP01-001");
  assert.equal(normalizeOnePieceCardCode("ST-1-001"), "ST01-001");
  assert.equal(normalizeOnePieceCardCode("prb01–001"), "PRB01-001");
  assert.equal(normalizeOnePieceCardCode("p 1"), "P-001");
  assert.equal(extractOnePieceCardCode("Zoro # OP01 001"), "OP01-001");
});

const cards = [
  {
    providerCardId: "OP01-001_p1",
    name: "Roronoa Zoro (001) (Parallel)",
    cardCode: "OP01-001",
    setId: "OP-01",
    setName: "Romance Dawn",
    rarity: "L",
    character: "Straw Hat Crew Supernovas",
    cardType: "Leader",
  },
  {
    providerCardId: "OP01-025",
    name: "Roronoa Zoro (025)",
    cardCode: "OP01-025",
    setId: "OP-01",
    setName: "Romance Dawn",
    rarity: "SR",
    character: "Straw Hat Crew Supernovas",
    cardType: "Character",
  },
];

test("ranks exact One Piece codes before name-only candidates", () => {
  const ranked = rankOnePieceCards(cards, "Roronoa Zoro OP01-001");
  assert.equal(ranked[0].providerCardId, "OP01-001_p1");
  assert.equal(ranked[0].confidence, "exact");
});

test("recovers a conservative One Piece name typo", () => {
  const ranked = rankOnePieceCards(cards, "Zorro");
  assert.equal(ranked[0].providerCardId, "OP01-001_p1");
  assert.notEqual(ranked[0].confidence, "unreliable");
  assert.match(ranked[0].reasons.join(" "), /typo/i);
});

test("ranks One Piece name and bare collector suffix agreement above name-only candidates", () => {
  const ranked = rankOnePieceCards([
    { providerCardId: "nami-006", name: "Nami", cardCode: "OP01-006" },
    { providerCardId: "nami-016", name: "Nami", cardCode: "OP02-016" },
  ], "Nami 016");
  assert.equal(ranked[0].providerCardId, "nami-016");
  assert.ok(ranked[0].reasons.includes("Exact card-number suffix"));
});

test("searches One Piece set, character, type, and rarity fields", () => {
  assert.equal(rankOnePieceCards(cards, { query: "SR" })[0].providerCardId, "OP01-025");
  assert.notEqual(rankOnePieceCards(cards, { query: "Straw Hat Crew" })[0].confidence, "unreliable");
  assert.notEqual(rankOnePieceCards(cards, { set: "Romance Dawn" })[0].confidence, "unreliable");
});

function item(overrides: Partial<TradeItem>): TradeItem {
  const now = new Date().toISOString();
  return {
    id: "item-1",
    tradeTransactionId: "transaction-1",
    direction: "incoming",
    itemName: "Card",
    itemType: "raw_card",
    quantity: 1,
    marketValue: 10,
    agreedTradeValue: 10,
    historicalCostBasis: 0,
    costBasis: 0,
    ownershipShares: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("canonical item payload stores Japanese TCGdex metadata without a Pokémon TCG API ID", () => {
  const payload = buildTransactionItemPayload(item({
    cardGame: "pokemon",
    cardLanguage: "ja",
    dataProvider: "tcgdex",
    providerCardId: "SM11b-016",
    pokemonTcgCardId: "must-not-leak",
    marketPriceCurrency: "EUR",
  }));
  assert.equal(payload.card_game, "pokemon");
  assert.equal(payload.card_language, "ja");
  assert.equal(payload.data_provider, "tcgdex");
  assert.equal(payload.provider_card_id, "SM11b-016");
  assert.equal(payload.pokemon_tcg_card_id, null);
  assert.equal(payload.market_price_currency, "EUR");
});

test("canonical item payload keeps One Piece card codes out of pokemon_tcg_card_id", () => {
  const payload = buildTransactionItemPayload(item({
    cardGame: "one_piece",
    cardLanguage: "en",
    dataProvider: "optcgapi",
    providerCardId: "OP01-001_p1",
    cardCode: "OP01-001",
  }));
  assert.equal(payload.card_game, "one_piece");
  assert.equal(payload.card_code, "OP01-001");
  assert.equal(payload.provider_card_id, "OP01-001_p1");
  assert.equal(payload.pokemon_tcg_card_id, null);
});

test("existing English Pokémon IDs remain legacy compatible and provider neutral", () => {
  const payload = buildTransactionItemPayload(item({ pokemonTcgCardId: "base1-4" }));
  assert.equal(payload.card_game, "pokemon");
  assert.equal(payload.card_language, "en");
  assert.equal(payload.data_provider, "pokemontcg");
  assert.equal(payload.provider_card_id, "base1-4");
  assert.equal(payload.pokemon_tcg_card_id, "base1-4");
});

test("manual metadata cannot retain a stale provider or Pokémon API ID", () => {
  const payload = buildTransactionItemPayload(item({
    cardGame: "one_piece",
    cardLanguage: "en",
    dataProvider: "manual",
    providerCardId: "stale-provider-id",
    pokemonTcgCardId: "stale-pokemon-id",
    cardCode: "OP01-001",
  }));
  assert.equal(payload.provider_card_id, null);
  assert.equal(payload.pokemon_tcg_card_id, null);
  assert.equal(payload.card_code, "OP01-001");
});
