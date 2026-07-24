import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManualPokemonQuery,
  buildNameEvidence,
  buildPokemonApiQueries,
  conditionFromVisibleText,
  manualCardSearchValidationError,
  normalizeManualCardSearchTerms,
  parseCollectorNumber,
  rankPokemonCards,
  stickerPriceFromVisibleText,
} from "../src/services/sales/cardScanParsing.ts";

test("builds safe manual API queries and removes trailing punctuation", () => {
  assert.equal(buildManualPokemonQuery({ name: "Charizard ex." }), 'name:"Charizard ex"');
  assert.equal(
    buildManualPokemonQuery({ name: 'Charizard ex\\"', collectorNumber: "125" }),
    'name:"Charizard ex" number:125',
  );
  assert.equal(buildManualPokemonQuery({ collectorNumber: "106" }), "number:106");
  assert.equal(
    buildManualPokemonQuery({ set: "Pokemon 151", collectorNumber: "025/165" }),
    'number:025 set.name:"Pokemon 151"',
  );
});

test("splits a collector number typed after a card name", () => {
  assert.deepEqual(normalizeManualCardSearchTerms({ name: "Pikachu 025/165" }), {
    name: "Pikachu",
    collectorNumber: "025/165",
    set: "",
    language: "",
  });
});

test("manual search validates useful input without requiring a name", () => {
  assert.match(manualCardSearchValidationError({ name: "x" }), /at least two/i);
  assert.match(manualCardSearchValidationError({}), /card name, collector number, or set/i);
  assert.equal(manualCardSearchValidationError({ collectorNumber: "106" }), "");
});

test("does not turn an unrecognized collector number into an API number filter", () => {
  assert.equal(buildManualPokemonQuery({ name: "Pikachu", collectorNumber: "AWA4/1EV01A" }), 'name:"Pikachu"');
  assert.equal(parseCollectorNumber("AWA4/1EV01A"), null);
});

test("cleans noisy Charizard OCR without using raw text as the final name", () => {
  const evidence = buildNameEvidence("re Charizalo iT");
  assert.equal(evidence.candidates[0], "Charizard ex");
  assert.equal(evidence.baseCandidate, "Charizard");
  assert.equal(evidence.suffix, "ex");
});

test("preserves printed suffix variants", () => {
  assert.equal(buildNameEvidence("Mewtwo EX").candidates[0], "Mewtwo EX");
  assert.equal(buildNameEvidence("Pikachu VMAX").candidates[0], "Pikachu VMAX");
  assert.equal(buildNameEvidence("Lugia BREAK").candidates[0], "Lugia BREAK");
});

test("preserves possessive printed names and rejects unrelated fuzzy OCR", () => {
  const lance = buildNameEvidence("Lance's Charizard V");
  assert.equal(lance.candidates[0], "Lance's Charizard V");
  assert.equal(lance.isReliable, true);
  const noise = buildNameEvidence("aerial damage resistance");
  assert.equal(noise.isReliable, false);
  assert.deepEqual(noise.candidates, []);
});

test("searches an exact collector number before any inferred card name", () => {
  const evidence = buildNameEvidence("Lance's Charizard V");
  assert.deepEqual(buildPokemonApiQueries(evidence, parseCollectorNumber("SWSH133")), [
    "number:SWSH133",
    'name:"Lance\'s Charizard V" number:SWSH133',
    'name:"Lance\'s Charizard V"',
  ]);
});

test("parses collector-number families and common OCR substitutions", () => {
  for (const value of ["106/094", "025/165", "SV107/SV122", "TG01/TG30", "GG44/GG70"]) {
    assert.equal(parseCollectorNumber(value)?.normalized, value);
  }
  assert.equal(parseCollectorNumber("O25 / 165")?.normalized, "025/165");
  assert.equal(parseCollectorNumber("TG0I | TG3O")?.normalized, "TG01/TG30");
});

test("reads only explicit sticker condition and price text", () => {
  assert.equal(conditionFromVisibleText("NM $27.00"), "Near Mint / NM");
  assert.equal(conditionFromVisibleText("LP 27$"), "Lightly Played / LP");
  assert.equal(conditionFromVisibleText("looks clean"), null);
  assert.equal(stickerPriceFromVisibleText("NM $27"), 27);
  assert.equal(stickerPriceFromVisibleText("asking 27$"), 27);
  assert.equal(stickerPriceFromVisibleText("no sticker"), null);
});

test("ranks the exact name, suffix, collector number, and set total first", () => {
  const evidence = buildNameEvidence("re Charizalo iT");
  const collector = parseCollectorNumber("025/165");
  const ranked = rankPokemonCards([
    { id: "wrong-number", name: "Charizard ex", number: "199", set: { name: "Other", printedTotal: 165 } },
    { id: "wrong-suffix", name: "Charizard V", number: "025", set: { name: "Example", printedTotal: 165 } },
    { id: "correct", name: "Charizard ex", number: "025", set: { name: "Example", printedTotal: 165 } },
  ], evidence, collector);
  assert.equal(ranked[0].id, "correct");
  assert.ok(ranked[0].matchScore >= 90);
  assert.ok(ranked[0].reasons.includes("collector number matches"));
  assert.ok(ranked[0].reasons.includes("set total matches"));
});
