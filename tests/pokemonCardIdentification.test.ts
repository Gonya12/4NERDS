import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  POKEMON_CARD_IDENTIFY_MODEL,
  assessPokemonIdentification,
  buildPokemonIdentificationSearchAttempts,
  identificationConfidenceLabel,
  isStrongVisualCatalogMatch,
  normalizeIdentificationCollectorNumber,
  normalizePokemonCardIdentification,
  rankScannerCandidates,
  scannerCandidateEvidence,
  scannerCardNameSimilarity,
  scannerFingerprintSimilarity,
  scoreScannerCandidate,
  selectScannerCandidates,
  stripPokemonCardImagePrefix,
} from "../supabase/functions/_shared/pokemonCardIdentificationCore.ts";
import { buildCardSearchRequest } from "../supabase/functions/_shared/cardSearchRequestContract.ts";

const edgeSource = readFileSync(new URL("../supabase/functions/pokemon-card-identify/index.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../src/services/sales/pokemonCardIdentificationService.ts", import.meta.url), "utf8");
const scannerSource = readFileSync(new URL("../src/components/sales/CardScanPanel.tsx", import.meta.url), "utf8");
const scanPipelineSource = readFileSync(new URL("../src/services/sales/cardScanService.ts", import.meta.url), "utf8");
const bulkWorkerSource = readFileSync(new URL("../supabase/functions/bulk-inventory-process/index.ts", import.meta.url), "utf8");
const cardSearchEdgeSource = readFileSync(new URL("../supabase/functions/pokemon-card-search/index.ts", import.meta.url), "utf8");

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

test("rejects BL Gene-style nonsense before any catalog request", () => {
  const identification = normalizePokemonCardIdentification({
    card_name: "BL Gene",
    pokemon_name: null,
    collector_number: "not-a-number",
    visible_text: ["BL Gene", "Ability"],
    confidence: 0.88,
    field_confidence: {
      card_name: "high",
      collector_number: "low",
      set: "low",
      hp: "low",
      language: "medium",
      artwork: "low",
    },
    language: "en",
  });
  const assessment = assessPokemonIdentification(identification);
  assert.equal(assessment.useful, false);
  assert.equal(assessment.recognizedName, null);
  assert.deepEqual(buildPokemonIdentificationSearchAttempts(identification), []);
  assert.ok(assessment.rejectedFields.some((field) => field.value === "BL Gene" && /OCR-like fragment/.test(field.reason)));
});

test("readable low-confidence names still trigger the existing name-first search", () => {
  for (const name of ["Dragonite ex", "Charizard ex", "Pikachu ex"]) {
    const identification = normalizePokemonCardIdentification({
      card_name: name,
      collector_number: "2",
      confidence: 0.3,
      field_confidence: {
        card_name: "low",
        collector_number: "low",
        set: "low",
        hp: "low",
        language: "medium",
        artwork: "low",
      },
      language: "en",
    });
    const attempts = buildPokemonIdentificationSearchAttempts(identification);
    assert.equal(attempts[0]?.name, name);
    assert.ok(attempts.every((attempt) => attempt.collectorNumber === ""));
  }
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
  assert.deepEqual(ranked.map((candidate) => candidate.providerCardId), ["charizard-56"]);
  assert.ok(scannerCardNameSimilarity("  Charizard—EX ", "charizard ex") < 0.62);
  assert.ok(scannerCardNameSimilarity("Charizard-ex", "CHARIZARD EX") < 0.62);
  assert.equal(scannerCardNameSimilarity("Charizard... ex", "charizard ex"), 1);
  assert.ok(scannerCardNameSimilarity("Charizard ex", "Weedle") < 0.58);
  const accepted = scoreScannerCandidate({ providerCardId: "charizard-56", name: "Charizard ex", collectorNumber: "56", language: "en", matchScore: 59 }, evidence);
  const rejected = scoreScannerCandidate({ providerCardId: "weedle-2", name: "Weedle", collectorNumber: "2", language: "en", matchScore: 99 }, evidence);
  assert.deepEqual({ name: accepted.normalizedNameSimilarity, number: accepted.numberScore, language: accepted.languageScore, total: accepted.totalScore }, {
    name: 1,
    number: 0,
    language: 2,
    total: 69,
  });
  assert.equal(rejected.accepted, false);
  assert.match(rejected.reason, /below the 62% sanity threshold/);
});

test("region fingerprints identify the correct Charizard ex printing without trusting a bad number", () => {
  const identification = normalizePokemonCardIdentification({
    card_name: "Charizard ex",
    pokemon_name: "Charizard",
    collector_number: "2",
    hp: 330,
    stage_or_subtype: "Stage 2",
    ability_names: ["InfernaI Reign"],
    attack_names: ["Burnlng Darkness"],
    attack_damage: ["180+"],
    confidence: 0.88,
    language: "en",
    field_confidence: {
      card_name: "high",
      collector_number: "low",
      set: "low",
      hp: "high",
      stage: "medium",
      ability: "high",
      attack: "high",
      attack_damage: "high",
      language: "high",
      artwork: "medium",
    },
  });
  const ranked = rankScannerCandidates([
    {
      providerCardId: "obf-125",
      name: "Charizard ex",
      collectorNumber: "125",
      hp: "330",
      subtypes: ["Stage 2", "ex"],
      abilities: [{ name: "Infernal Reign", text: "When you play this Pokémon..." }],
      attacks: [{ name: "Burning Darkness", damage: "180+", text: "This attack does more damage..." }],
      language: "en",
      matchScore: 62,
      matchConfidence: "medium",
      searchConfidence: "possible",
      reasons: [],
    },
    {
      providerCardId: "other-charizard",
      name: "Charizard ex",
      collectorNumber: "6",
      hp: "330",
      abilities: [{ name: "Different Ability" }],
      attacks: [{ name: "Wing Attack", damage: "160" }],
      language: "en",
      matchScore: 62,
      matchConfidence: "medium",
      searchConfidence: "possible",
      reasons: [],
    },
    {
      providerCardId: "weedle-2",
      name: "Weedle",
      collectorNumber: "2",
      hp: "40",
      language: "en",
      matchScore: 99,
      matchConfidence: "high",
      searchConfidence: "exact",
      reasons: [],
    },
  ], scannerCandidateEvidence(identification));
  assert.deepEqual(ranked.map((candidate) => candidate.providerCardId), ["obf-125", "other-charizard"]);
  assert.ok(ranked[0].matchScore - ranked[1].matchScore >= 6);
  assert.equal(scannerFingerprintSimilarity("InfernaI Reign", "Infernal Reign"), 1);
  assert.ok(scannerFingerprintSimilarity("Burnlng Darkness", "Burning Darkness") > 0.9);
});

test("a reliable attack can become a provider hint when the top name is unreadable", () => {
  const identification = normalizePokemonCardIdentification({
    card_name: null,
    attack_names: ["Burning Darkness"],
    confidence: 0.52,
    language: "en",
    field_confidence: {
      card_name: "low",
      collector_number: "low",
      set: "low",
      hp: "low",
      stage: "low",
      ability: "low",
      attack: "medium",
      attack_damage: "low",
      language: "medium",
      artwork: "low",
    },
  });
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].attackName, "Burning Darkness");
  assert.equal(attempts[0].reason, "content fingerprint fallback");
  const request = buildCardSearchRequest({
    game: "pokemon",
    language: "en",
    attackName: attempts[0].attackName,
  });
  assert.equal(request.name, null);
  assert.equal(request.attackName, "Burning Darkness");
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
  assert.equal(normalizeIdentificationCollectorNumber("SVP056"), "056");
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
  assert.match(edgeSource, /recognitionStrategy/);
  assert.match(edgeSource, /alternatePrompt/);
  assert.match(edgeSource, /ability_names/);
  assert.match(edgeSource, /attack_names/);
  assert.match(edgeSource, /LOWER-MIDDLE/);
  assert.doesNotMatch(edgeSource, /market.?price|TCGplayer price/i);
});

test("single and bulk scanners share validation and one alternate visual strategy", () => {
  assert.match(scanPipelineSource, /assessPokemonIdentification\(rawIdentification\)/);
  assert.equal((scanPipelineSource.match(/"alternate"\)/g) || []).length, 1);
  assert.match(bulkWorkerSource, /assessPokemonIdentification\(rawIdentification\)/);
  assert.equal((bulkWorkerSource.match(/recognitionStrategy: "alternate"/g) || []).length, 1);
  assert.match(bulkWorkerSource, /NO_USEFUL_DETAILS/);
});

test("provider candidates include the content fields used for fingerprint ranking", () => {
  assert.match(cardSearchEdgeSource, /hp,types,abilities,attacks/);
  assert.match(cardSearchEdgeSource, /abilities: card\.abilities/);
  assert.match(cardSearchEdgeSource, /attacks: card\.attacks/);
  assert.match(cardSearchEdgeSource, /abilities\.name/);
  assert.match(cardSearchEdgeSource, /attacks\.name/);
});

test("scanner reuses catalog search, exposes stages, and always requires confirmation", () => {
  assert.match(serviceSource, /searchPokemonCardsManually/);
  assert.match(serviceSource, /language === "ja" \? "ja" : "en"/);
  assert.match(scanPipelineSource, /Reading card/);
  assert.match(scanPipelineSource, /Matching with TCG database/);
  assert.match(scannerSource, /Likely Match/);
  assert.match(scannerSource, /See Other Matches/);
  assert.match(scannerSource, /Try Again/);
  assert.match(scannerSource, /Search Card Manually/);
  assert.match(scannerSource, /We found a few possible matches/);
  assert.match(scannerSource, /Card recognition could not complete/);
  assert.match(scannerSource, /Partial identification/);
  assert.match(scannerSource, /void scan\(false, detection\.confidence < 0\.48/);
  assert.match(scannerSource, />Card Name/);
  assert.match(scannerSource, />Collector Number/);
  assert.match(scannerSource, /Search Matches/);
  assert.match(scannerSource, /initialName=\{recognizedName \|\| suggestion\?\.cardName \|\| suggestion\?\.correctedNameCandidate/);
  assert.match(scannerSource, /disabled=\{isAiScan && \(!resolvedCard \|\| needsCondition\)\}/);
  assert.match(scannerSource, /import\.meta\.env\.DEV && reviewSuggestion\.technicalDetails\?\.scannerDebug/);
  assert.match(scannerSource, /Scanner Debug/);
  assert.match(serviceSource, /firstTwentyReturned/);
  assert.match(serviceSource, /responseBodyKeys/);
});

test("transient empty searches are retried but never cached", () => {
  const searchService = readFileSync(new URL("../src/services/sales/pokemonCardSearchService.ts", import.meta.url), "utf8");
  const scanService = readFileSync(new URL("../src/services/sales/cardScanService.ts", import.meta.url), "utf8");
  assert.match(searchService, /empty result retry/);
  assert.match(searchService, /if \(matches\.length > 0 \|\| request\.providerCardId\) writeCache/);
  assert.match(scanService, /4nerds_card_scan_v8_/);
  assert.match(scanService, /Trying alternate recognition/);
  assert.match(scanService, /assessPokemonIdentification/);
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
  assert.match(imageService, /normalized\.name\.startsWith\("cropped-"\)/);
  assert.match(imageService, /maxLongEdge: 2000, quality: 0\.92/);
  assert.match(imageService, /normalizeImageOrientation/);
  assert.match(imageService, /imageOrientation: "none"/);
  assert.match(processor, /maxLongEdge: 1800/);
});
