import type { Cell, Sheet } from "write-excel-file/browser";
import type {
  ExportColumnKind, ExportValue, FinancialExportData, FinancialExportTable
} from "./financialExportService";

const requiredSheets = ["transactions", "items", "inventory", "expenses", "trades", "daily", "owners"] as const;
const headerStyle = {
  fontWeight: "bold" as const,
  textColor: "#FFFFFF",
  backgroundColor: "#F45D13",
  alignVertical: "center" as const,
  height: 30,
  wrap: true
};

function dateValue(value: ExportValue) {
  if (value instanceof Date) return value;
  if (!value) return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toCell(value: ExportValue, kind: ExportColumnKind): Cell {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "date") {
    const parsed = dateValue(value);
    return parsed
      ? { value: parsed, type: Date, format: String(value).includes("T") ? "mmm d, yyyy h:mm AM/PM" : "mmm d, yyyy" }
      : { value: String(value), type: String };
  }
  if (kind === "currency") {
    return { value: Number(value || 0), type: Number, format: "$#,##0.00;[Red]-$#,##0.00" };
  }
  if (kind === "percentage") {
    return { value: Number(value || 0) / 100, type: Number, format: "0.0%" };
  }
  if (kind === "number") return { value: Number(value || 0), type: Number, format: "#,##0.##" };
  if (typeof value === "boolean") return { value, type: Boolean };
  return { value: String(value), type: String, wrap: true };
}

function columnWidth(table: FinancialExportTable, index: number) {
  const header = table.headers[index] || "";
  const kind = table.kinds[index];
  if (kind === "date") return 19;
  if (kind === "currency" || kind === "percentage" || kind === "number") return 16;
  if (/ID|URL/.test(header)) return 32;
  if (/Notes|Description|Items|Ownership/.test(header)) return 38;
  const longest = Math.max(header.length, ...table.rows.slice(0, 200).map((row) => String(row[index] ?? "").length));
  return Math.min(34, Math.max(12, longest + 2));
}

function toSheet(table: FinancialExportTable): Sheet<Blob> {
  const header: Cell[] = table.headers.map((value) => ({ value, type: String, ...headerStyle }));
  const data: Cell[][] = [
    header,
    ...table.rows.map((row) => table.headers.map((_, index) => toCell(row[index], table.kinds[index])))
  ];
  const profitColumns = table.headers
    .map((value, index) => /Profit|Gain\/Loss|Result/.test(value) ? index + 1 : 0)
    .filter(Boolean);
  return {
    sheet: table.name,
    data,
    columns: table.headers.map((_, index) => ({ width: columnWidth(table, index) })),
    stickyRowsCount: 1,
    showGridLines: true,
    zoomScale: table.headers.length > 20 ? 75 : 90,
    conditionalFormatting: profitColumns.flatMap((column) => table.rows.length ? [{
      cellRange: { from: { row: 2, column }, to: { row: table.rows.length + 1, column } },
      condition: { operator: "<" as const, value: 0 },
      style: { textColor: "#B91C1C", backgroundColor: "#FEF2F2" }
    }] : [])
  };
}

function excelColumnName(index: number) {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

async function addSheetFilters(blob: Blob, tables: FinancialExportTable[]) {
  const { strFromU8, strToU8, unzipSync, zipSync } = await import("fflate");
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  tables.forEach((table, index) => {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    const source = files[path];
    if (!source) return;
    const xml = strFromU8(source);
    const reference = `A1:${excelColumnName(table.headers.length)}${Math.max(1, table.rows.length + 1)}`;
    files[path] = strToU8(xml.replace("</sheetData>", `</sheetData><autoFilter ref="${reference}"/>`));
  });
  return new Blob([zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

export async function downloadFinancialWorkbook(data: FinancialExportData) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const tables = requiredSheets.map((key) => data.tables[key]);
  const sheets: Sheet<Blob>[] = tables.map(toSheet);
  const workbook = await writeXlsxFile(sheets).toBlob();
  const filteredWorkbook = await addSheetFilters(workbook, tables);
  const url = URL.createObjectURL(filteredWorkbook);
  const link = document.createElement("a");
  link.href = url;
  link.download = `4Nerds_Financial_Workbook_${data.rangeLabel}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
