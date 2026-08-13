import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  POKEMON_CARD_IDENTIFY_MODEL,
  buildPokemonIdentificationSearchAttempts,
  identificationConfidenceLabel,
  isStrongVisualCatalogMatch,
  normalizeIdentificationCollectorNumber,
  normalizePokemonCardIdentification,
  rankScannerCandidates,
  scannerCardNameSimilarity,
  selectScannerCandidates,
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

test("builds a confidence-aware catalog search order", () => {
  const identification = normalizePokemonCardIdentification({
    card_name: "Pikachu ex",
    pokemon_name: "Pikachu",
    collector_number: "057",
    set_name_hint: "Journey Together",
    confidence: 0.91,
    field_confidence: {
      card_name: "high",
      collector_number: "low",
      set: "medium",
      hp: "high",
      language: "high",
      artwork: "medium",
    },
    language: "en",
  });
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
  assert.deepEqual(attempts.map((attempt) => attempt.reason), [
    "card name first",
    "Pokémon name first",
    "card name fallback",
  ]);
  assert.equal(attempts[0].collectorNumber, "");
});

test("low-confidence collector numbers cannot outrank a strong recognized name", () => {
  const evidence = {
    name: "Charizard ex",
    collectorNumber: "2",
    set: "",
    language: "en" as const,
    nameConfidence: "high" as const,
    collectorNumberConfidence: "low" as const,
    setConfidence: "low" as const,
  };
  const ranked = rankScannerCandidates([
    { providerCardId: "weedle-2", name: "Weedle", collectorNumber: "2", language: "en", matchScore: 99, matchConfidence: "high", searchConfidence: "exact", reasons: [] },
    { providerCardId: "oddish-2", name: "Oddish", collectorNumber: "2", language: "en", matchScore: 98, matchConfidence: "high", searchConfidence: "exact", reasons: [] },
    { providerCardId: "ludicolo-2", name: "Ludicolo", collectorNumber: "2", language: "en", matchScore: 97, matchConfidence: "high", searchConfidence: "exact", reasons: [] },
    { providerCardId: "charizard-56", name: "Charizard ex", collectorNumber: "56", language: "en", matchScore: 61, matchConfidence: "medium", searchConfidence: "possible", reasons: [] },
    { providerCardId: "charizard-199", name: "Charizard EX", collectorNumber: "199", language: "en", matchScore: 58, matchConfidence: "medium", searchConfidence: "possible", reasons: [] },
  ], evidence);
  assert.deepEqual(ranked.map((candidate) => candidate.providerCardId), ["charizard-56", "charizard-199"]);
  assert.equal(scannerCardNameSimilarity("  Charizard—EX ", "charizard ex"), 1);
  assert.ok(scannerCardNameSimilarity("Charizard ex", "Weedle") < 0.58);
});

test("manual collector correction becomes strong evidence among same-name printings", () => {
  const ranked = rankScannerCandidates([
    { providerCardId: "charizard-2", name: "Charizard ex", collectorNumber: "2", language: "en", matchScore: 80, matchConfidence: "high", searchConfidence: "likely", reasons: [] },
    { providerCardId: "charizard-56", name: "Charizard ex", collectorNumber: "056", language: "en", matchScore: 60, matchConfidence: "medium", searchConfidence: "possible", reasons: [] },
  ], {
    name: "Charizard ex",
    collectorNumber: "56",
    set: "",
    language: "en",
    nameConfidence: "high",
    collectorNumberConfidence: "high",
    setConfidence: "low",
  });
  assert.equal(ranked[0].providerCardId, "charizard-56");
});

test("normalizes common collector-number formats before catalog search", () => {
  assert.equal(normalizeIdentificationCollectorNumber("#56"), "56");
  assert.equal(normalizeIdentificationCollectorNumber("056"), "056");
  assert.equal(normalizeIdentificationCollectorNumber("SVP 056"), "056");
  assert.equal(normalizeIdentificationCollectorNumber("056 / 198"), "056/198");
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

test("name-only possible matches survive scanner candidate selection", () => {
  const candidates = selectScannerCandidates([
    { providerCardId: "charizard-a", matchScore: 63, searchConfidence: "possible" },
    { providerCardId: "charizard-b", matchScore: 59, searchConfidence: "possible" },
    { providerCardId: "noise", matchScore: 20, searchConfidence: "unreliable" },
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.providerCardId), ["charizard-a", "charizard-b"]);
  assert.doesNotMatch(serviceSource, /match\.searchConfidence === "exact" \|\| match\.searchConfidence === "likely"/);
  assert.match(serviceSource, /searchRecognizedCardText/);
});

test("Edge Function keeps Gemini secret server-side and requests structured visual output", () => {
  assert.equal(POKEMON_CARD_IDENTIFY_MODEL, "gemini-3.6-flash");
  assert.match(edgeSource, /Deno\.env\.get\("GEMINI_API_KEY"\)/);
  assert.doesNotMatch(edgeSource, /VITE_GEMINI_API_KEY/);
  assert.match(edgeSource, /inline_data/);
  assert.match(edgeSource, /responseFormat/);
  assert.match(edgeSource, /type: \["string", "null"\]/);
  assert.doesNotMatch(edgeSource, /const nullableString = \{ anyOf/);
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
  assert.match(scannerSource, /We found a few possible matches/);
  assert.match(scannerSource, /Card recognition could not complete/);
  assert.match(scannerSource, /Partial identification/);
  assert.match(scannerSource, />Card Name/);
  assert.match(scannerSource, />Collector Number/);
  assert.match(scannerSource, /Search Matches/);
  assert.match(scannerSource, /initialName=\{recognizedName \|\| suggestion\?\.cardName \|\| suggestion\?\.correctedNameCandidate/);
  assert.match(scannerSource, /disabled=\{isAiScan && \(!resolvedCard \|\| needsCondition\)\}/);
});

test("a vision transport failure falls back to local OCR before becoming a processing error", () => {
  const scanService = readFileSync(new URL("../src/services/sales/cardScanService.ts", import.meta.url), "utf8");
  assert.match(scanService, /vision failed; starting local text fallback/);
  assert.match(scanService, /Reading visible text fallback/);
  assert.match(scanService, /!analysis\.suggestion\.possibleMatches\?\.length/);
  assert.match(scanService, /throw visualFailure/);
});

test("recognition preprocessing preserves crop detail and avoids double JPEG loss", () => {
  const imageService = readFileSync(new URL("../src/services/images/saleImageService.ts", import.meta.url), "utf8");
  const processor = readFileSync(new URL("../src/services/sales/cardImageProcessor.ts", import.meta.url), "utf8");
  assert.match(imageService, /prepareCardRecognitionImage/);
  assert.match(imageService, /file\.name\.startsWith\("cropped-"\)/);
  assert.match(imageService, /maxLongEdge: 2000, quality: 0\.92/);
  assert.match(imageService, /imageOrientation: "from-image"/);
  assert.match(processor, /maxLongEdge: 1800/);
});
