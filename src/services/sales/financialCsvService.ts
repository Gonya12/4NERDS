export type CsvValue = string | number | boolean | Date | null | undefined;
export type CsvTable = { headers: string[]; rows: CsvValue[][] };
export type CsvExportKind = "transactions" | "items" | "inventory" | "expenses" | "trades" | "daily" | "all";

function safeCsvText(value: CsvValue) {
  if (value === null || value === undefined) return "";
  const string = value instanceof Date ? value.toISOString() : String(value);
  const protectedValue = /^[=+\-@]/.test(string.trimStart()) ? `'${string}` : string;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function createCsv(table: CsvTable) {
  return `\uFEFF${[table.headers, ...table.rows].map((row) => row.map(safeCsvText).join(",")).join("\r\n")}\r\n`;
}

export function financialExportFilename(kind: CsvExportKind, rangeLabel: string) {
  const labels: Record<CsvExportKind, string> = {
    transactions: "Transactions", items: "Items", inventory: "Inventory", expenses: "Expenses",
    trades: "Trades", daily: "Daily_Summary", all: "All_Financial_Records"
  };
  return `4Nerds_${labels[kind]}_${rangeLabel}.csv`;
}

export function downloadCsv(table: CsvTable, filename: string) {
  const url = URL.createObjectURL(new Blob([createCsv(table)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
