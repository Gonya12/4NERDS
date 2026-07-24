import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNameEvidence,
  conditionFromVisibleText,
  parseCollectorNumber,
  rankPokemonCards,
  stickerPriceFromVisibleText,
} from "../src/services/sales/cardScanParsing.ts";

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
