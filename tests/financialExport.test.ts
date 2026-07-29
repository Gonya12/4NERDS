import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCsv, financialExportFilename, type CsvTable } from "../src/services/sales/financialCsvService.ts";

const table: CsvTable = {
  headers: ["Name", "Notes", "Amount"],
  kinds: ["text", "text", "currency"],
  rows: [["Pikachu", "Line one\nLine two", 12.5], ["=2+2", "A \"quoted\" value", -4]]
};

test("CSV uses BOM, CRLF, quoting, and formula-injection protection", () => {
  const csv = createCsv(table);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("\r\n"));
  assert.ok(csv.includes("\"Line one\nLine two\""));
  assert.ok(csv.includes("\"A \"\"quoted\"\" value\""));
  assert.ok(csv.includes("\"'=2+2\""));
  assert.ok(csv.endsWith("\r\n"));
});

test("CSV filenames are descriptive and range-specific", () => {
  assert.equal(financialExportFilename("daily", "2026-07-01_to_2026-07-29"), "4Nerds_Daily_Summary_2026-07-01_to_2026-07-29.csv");
});

test("CSV and XLSX shared transaction export schema uses Item Mode", () => {
  const source = readFileSync(new URL("../src/services/sales/financialExportService.ts", import.meta.url), "utf8");
  assert.ok(source.includes('"Item Mode"'));
  assert.ok(source.includes('"Paid By"'));
  assert.ok(!source.includes('"Entry Mode"'));
});

test("CSV and XLSX shared item schemas include provider-neutral card metadata", () => {
  const source = readFileSync(new URL("../src/services/sales/financialExportService.ts", import.meta.url), "utf8");
  for (const header of [
    "Card Game",
    "Card Language",
    "Data Provider",
    "Provider Card ID",
    "Card Code",
    "Collector Number",
    "Set",
    "Market Price Source",
    "Market Price Currency",
  ]) {
    assert.ok(source.includes(`"${header}"`), `${header} column is required`);
  }
});
