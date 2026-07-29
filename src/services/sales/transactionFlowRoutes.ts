export type TransactionFlowType = "sold" | "purchased" | "cost" | "trade" | "cash_trade";
export type TransactionEntryMode = "single" | "multiple";

export function transactionEditorBasePath(
  type: TransactionFlowType,
  subtype: { source?: string; category?: string } = {}
) {
  if (type === "sold") return "/sales/transactions/new?type=sale";
  if (type === "purchased") return `/sales/transactions/new?type=purchase&source=${encodeURIComponent(subtype.source || "other")}`;
  if (type === "cost") return `/sales/transactions/new?type=expense&category=${encodeURIComponent(subtype.category || "other")}`;
  if (type === "trade") return "/sales/trades?new=trade";
  return "/sales/trades?new=cash_trade";
}

export function transactionEditorDestination(editorPath: string, mode: TransactionEntryMode) {
  if (!editorPath) throw new Error("This transaction editor is not available yet.");
  return `${editorPath}${editorPath.includes("?") ? "&" : "?"}items=${mode}`;
}
