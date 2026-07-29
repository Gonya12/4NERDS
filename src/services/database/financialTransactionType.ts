import type { FinancialTransactionType, TradeTransaction } from "../../types/models";

export const databaseFinancialTransactionTypes = [
  "sold",
  "purchased",
  "cost",
  "trade",
  "cash_trade",
] as const;

export type DatabaseFinancialTransactionType = typeof databaseFinancialTransactionTypes[number];

const databaseTypeSet = new Set<string>(databaseFinancialTransactionTypes);

const transactionTypeAliases: Record<string, DatabaseFinancialTransactionType> = {
  sale: "sold",
  sold: "sold",
  "multi sale": "sold",
  "multi item sale": "sold",
  "bundle sale": "sold",

  purchase: "purchased",
  purchased: "purchased",
  "inventory purchase": "purchased",
  "lot purchase": "purchased",
  "purchase lot": "purchased",

  expense: "cost",
  cost: "cost",
  "business expense": "cost",
  "table fee": "cost",
  "event cost": "cost",

  trade: "trade",
  "multi item trade": "trade",

  "cash trade": "cash_trade",
  "cash and trade": "cash_trade",
  "mixed trade": "cash_trade",
  "partial trade": "cash_trade",
  "multi item cash trade": "cash_trade",
};

function normalizeTransactionTypeLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " ")
    .replace(/[_‐‑‒–—―-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class InvalidFinancialTransactionTypeError extends Error {
  readonly invalidValue: unknown;
  readonly allowedValues = databaseFinancialTransactionTypes;

  constructor(invalidValue: unknown) {
    super("This transaction type is not supported and was not sent to Supabase.");
    this.name = "InvalidFinancialTransactionTypeError";
    this.invalidValue = invalidValue;
  }
}

export function mapTransactionTypeToDatabaseValue(uiType: unknown): DatabaseFinancialTransactionType {
  const raw = String(uiType ?? "").trim();
  if (databaseTypeSet.has(raw)) return raw as DatabaseFinancialTransactionType;
  const mapped = transactionTypeAliases[normalizeTransactionTypeLabel(uiType)];
  if (!mapped) throw new InvalidFinancialTransactionTypeError(uiType);
  return mapped;
}

export function mapTransactionTypeToApplicationValue(value: unknown): FinancialTransactionType {
  const databaseValue = mapTransactionTypeToDatabaseValue(value);
  if (databaseValue === "sold") return "sale";
  if (databaseValue === "purchased") return "purchase";
  if (databaseValue === "cost") return "expense";
  return databaseValue;
}

export function normalizeTransactionForApplication<T extends TradeTransaction>(transaction: T): T {
  return {
    ...transaction,
    transactionType: mapTransactionTypeToApplicationValue(transaction.transactionType),
  };
}

export function transactionTypeDeveloperDebug(error: unknown): string | undefined {
  let current: unknown = error;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof InvalidFinancialTransactionTypeError) {
      return `Rejected transaction_type input: ${JSON.stringify(current.invalidValue)}. Allowed database values: ${databaseFinancialTransactionTypes.join(", ")}.`;
    }
    current = typeof current === "object" && current && "cause" in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return undefined;
}
