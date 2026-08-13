import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  POKEMON_CARD_IDENTIFY_MODEL,
  buildPokemonIdentificationSearchAttempts,
  identificationConfidenceLabel,
  isStrongVisualCatalogMatch,
  normalizePokemonCardIdentification,
  stripPokemonCardImagePrefix,
} from "../supabase/functions/_shared/pokemonCardIdentificationCore.ts";

const edgeSource = readFileSync(new URL("../supabase/functions/pokemon-card-identify/index.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../src/services/sales/pokemonCardIdentificationService.ts", import.meta.url), "utf8");
const scannerSource = readFileSync(new URL("../src/components/sales/CardScanPanel.tsx", import.meta.url), "utf8");

test("normalizes structured identification without losing leading zeros", () => {
  const result = normalizePokemonCardIdentification({
    card_name: " Charizard ex ",
    pokemon_name: "Charizard",
    collector_number: "056",
    printed_total_number: null,
    set_name_hint: "Scarlet & Violet Promos",
    language: "en",
    hp: 330,
    confidence: 1.4,
    notes: [" holo glare ", 12],
  });
  assert.equal(result.collector_number, "056");
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.notes, ["holo glare"]);
});

test("strips only supported image data URL prefixes", () => {
  assert.equal(stripPokemonCardImagePrefix("data:image/jpeg;base64,AAEC=="), "AAEC==");
  assert.equal(stripPokemonCardImagePrefix(" data:image/webp;base64,AA EC== "), "AAEC==");
});

test("builds the required collector-first catalog search order", () => {
  const identification = normalizePokemonCardIdentification({
    card_name: "Pikachu ex",
    pokemon_name: "Pikachu",
    collector_number: "057",
    set_name_hint: "Journey Together",
    confidence: 0.91,
    language: "en",
  });
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
  assert.deepEqual(attempts.map((attempt) => attempt.reason), [
    "collector number + card name",
    "collector number + Pokémon name",
    "card name + set",
    "Pokémon name + set",
    "card name fallback",
  ]);
  assert.equal(attempts[0].collectorNumber, "057");
});

test("keeps AI recognition confidence separate from exact catalog confidence", () => {
  const identification = normalizePokemonCardIdentification({ card_name: "Mew ex", confidence: 0.92, language: "en" });
  assert.equal(identificationConfidenceLabel(identification.confidence), "high");
  assert.equal(isStrongVisualCatalogMatch(identification, [
    { providerCardId: "a", matchScore: 94, matchConfidence: "high" },
    { providerCardId: "b", matchScore: 81, matchConfidence: "high" },
  ]), true);
  assert.equal(isStrongVisualCatalogMatch(identification, [
    { providerCardId: "a", matchScore: 90, matchConfidence: "high" },
    { providerCardId: "b", matchScore: 86, matchConfidence: "high" },
  ]), false);
});

test("Edge Function keeps Gemini secret server-side and requests structured visual output", () => {
  assert.equal(POKEMON_CARD_IDENTIFY_MODEL, "gemini-3.6-flash");
  assert.match(edgeSource, /Deno\.env\.get\("GEMINI_API_KEY"\)/);
  assert.doesNotMatch(edgeSource, /VITE_GEMINI_API_KEY/);
  assert.match(edgeSource, /inline_data/);
  assert.match(edgeSource, /responseFormat/);
  assert.match(edgeSource, /imageBase64/);
  assert.doesNotMatch(edgeSource, /market.?price|TCGplayer price/i);
});

test("scanner reuses catalog search, exposes stages, and always requires confirmation", () => {
  assert.match(serviceSource, /searchPokemonCardsManually/);
  assert.match(serviceSource, /language === "ja" \? "ja" : "en"/);
  assert.match(readFileSync(new URL("../src/services/sales/cardScanService.ts", import.meta.url), "utf8"), /Reading card/);
  assert.match(readFileSync(new URL("../src/services/sales/cardScanService.ts", import.meta.url), "utf8"), /Matching with TCG database/);
  assert.match(scannerSource, /Likely Match/);
  assert.match(scannerSource, /See Other Matches/);
  assert.match(scannerSource, /Try Again/);
  assert.match(scannerSource, /Search Card Manually/);
  assert.match(scannerSource, /disabled=\{isAiScan && \(!resolvedCard \|\| needsCondition\)\}/);
});
