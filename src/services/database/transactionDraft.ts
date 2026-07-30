import type { TradeItem, TradeTransaction } from "../../types/models";

export const LOCAL_TRANSACTION_DRAFT_VERSION = 4;

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
  sticker_price?: unknown;
  asking_price?: unknown;
  visible_sticker_price?: unknown;
  askingPrice?: unknown;
  visibleStickerPrice?: unknown;
  sticker_condition?: unknown;
  visible_sticker_condition?: unknown;
  visibleStickerCondition?: unknown;
};

function migrateItem(item: LegacyTransactionItem): TradeItem {
  const {
    allocated_cost_basis: legacySnakeCaseCost,
    allocatedCostBasis: legacyCamelCaseCost,
    set_name: canonicalSetName,
    card_set: legacyCardSet,
    setName: legacyCamelCaseSetName,
    sticker_price: canonicalStickerPrice,
    asking_price: legacyAskingPrice,
    visible_sticker_price: legacyVisibleStickerPrice,
    askingPrice: legacyCamelCaseAskingPrice,
    visibleStickerPrice: legacyCamelCaseVisibleStickerPrice,
    sticker_condition: canonicalStickerCondition,
    visible_sticker_condition: legacyVisibleStickerCondition,
    visibleStickerCondition: legacyCamelCaseVisibleStickerCondition,
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
  const stickerPriceValue = Number(
    current.stickerPrice
    ?? canonicalStickerPrice
    ?? legacyAskingPrice
    ?? legacyVisibleStickerPrice
    ?? legacyCamelCaseAskingPrice
    ?? legacyCamelCaseVisibleStickerPrice
  );
  const stickerCondition = String(
    current.stickerCondition
    ?? canonicalStickerCondition
    ?? legacyVisibleStickerCondition
    ?? legacyCamelCaseVisibleStickerCondition
    ?? ""
  ).trim();
  return {
    ...current,
    cardSet: cardSet || undefined,
    stickerPrice: Number.isFinite(stickerPriceValue) && stickerPriceValue >= 0 ? stickerPriceValue : undefined,
    stickerCondition: stickerCondition || undefined,
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

export function sanitizeTransactionInventoryLinks(
  transaction: TradeTransaction,
  existingInventoryIds: Iterable<string>
): TradeTransaction {
  const existing = new Set(existingInventoryIds);
  return {
    ...transaction,
    items: transaction.items.map((item) => ({
      ...item,
      inventoryPurchaseId: item.direction === "outgoing" && item.inventoryPurchaseId && existing.has(item.inventoryPurchaseId)
        ? item.inventoryPurchaseId
        : undefined,
      createdInventoryPurchaseId: item.direction === "incoming"
        && item.createdInventoryPurchaseId
        && existing.has(item.createdInventoryPurchaseId)
        ? item.createdInventoryPurchaseId
        : undefined
    }))
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
