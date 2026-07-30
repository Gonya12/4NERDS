import type { TradeItem, TradeTransaction } from "../../types/models";

export const LOCAL_TRANSACTION_DRAFT_VERSION = 3;

export type LocalTransactionDraft = {
  version: number;
  transaction: TradeTransaction;
  step: number;
  savedAt: string;
};

type LegacyTransactionItem = Partial<TradeItem> & {
  allocated_cost_basis?: unknown;
  allocatedCostBasis?: unknown;
  set_name?: unknown;
  card_set?: unknown;
  setName?: unknown;
};

function migrateItem(item: LegacyTransactionItem): TradeItem {
  const {
    allocated_cost_basis: legacySnakeCaseCost,
    allocatedCostBasis: legacyCamelCaseCost,
    set_name: canonicalSetName,
    card_set: legacyCardSet,
    setName: legacyCamelCaseSetName,
    ...current
  } = item;
  const hasCurrentCostBasis = current.costBasis !== undefined && current.costBasis !== null;
  const existingCostBasis = Number(current.costBasis);
  const migratedCostBasis = Number(
    legacySnakeCaseCost
    ?? legacyCamelCaseCost
    ?? current.boughtPrice
    ?? 0
  );
  const cardSet = String(
    canonicalSetName
    ?? current.cardSet
    ?? legacyCardSet
    ?? legacyCamelCaseSetName
    ?? ""
  ).trim();
  return {
    ...current,
    cardSet: cardSet || undefined,
    costBasis: hasCurrentCostBasis && Number.isFinite(existingCostBasis)
      ? existingCostBasis
      : Number.isFinite(migratedCostBasis) ? migratedCostBasis : 0
  } as TradeItem;
}

export function migrateLocalTransactionDraft(value: unknown): LocalTransactionDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const draft = value as Partial<LocalTransactionDraft> & {
    transaction?: Partial<TradeTransaction> & { items?: LegacyTransactionItem[] };
  };
  if (!draft.transaction?.id) return undefined;
  const transaction = {
    ...draft.transaction,
    items: (draft.transaction.items || []).map(migrateItem)
  } as TradeTransaction;
  return {
    version: LOCAL_TRANSACTION_DRAFT_VERSION,
    transaction,
    step: Math.max(0, Number(draft.step) || 0),
    savedAt: String(draft.savedAt || new Date().toISOString())
  };
}

export function createLocalTransactionDraft(
  transaction: TradeTransaction,
  step: number,
  savedAt = new Date().toISOString()
): LocalTransactionDraft {
  return {
    version: LOCAL_TRANSACTION_DRAFT_VERSION,
    transaction: {
      ...transaction,
      items: transaction.items.map(migrateItem)
    },
    step,
    savedAt
  };
}
