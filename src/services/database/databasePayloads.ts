import type {
  InventoryTradeLineage,
  TradeItem,
  TradeItemOwnershipShare,
  TransactionImageAttachment
} from "../../types/models";
import type { FinancialTransactionItemRow, Json } from "../../types/database.types";

function removeUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

export type FinancialTransactionItemPayload = FinancialTransactionItemRow;

export function buildTransactionItemPayload(item: TradeItem): FinancialTransactionItemPayload {
  const cardGame = item.cardGame || (item.pokemonTcgCardId ? "pokemon" : "other");
  const dataProvider = item.dataProvider || (item.pokemonTcgCardId ? "pokemontcg" : "manual");
  const cardLanguage = item.cardLanguage === "ja" || /japanese/i.test(item.cardLanguage || "")
    ? "ja"
    : item.cardLanguage === "unknown" || cardGame === "other" ? "unknown" : "en";
  return {
    id: item.id,
    transaction_id: item.tradeTransactionId,
    direction: item.direction,
    inventory_purchase_id: item.inventoryPurchaseId || null,
    created_inventory_purchase_id: item.createdInventoryPurchaseId || null,
    created_sales_record_id: item.createdSalesRecordId || null,
    created_business_expense_id: item.createdBusinessExpenseId || null,
    prior_inventory_purchase_id: item.priorInventoryPurchaseId || null,
    item_name: item.itemName,
    item_type: item.itemType,
    quantity: Number(item.quantity || 1),
    market_value: Number(item.marketValue || 0),
    agreed_trade_value: Number(item.agreedTradeValue || 0),
    trade_percentage: item.tradePercentage ?? null,
    historical_cost_basis: Number(item.historicalCostBasis || 0),
    zero_cost_basis_confirmed: item.zeroCostBasisConfirmed === true,
    allocated_cost_basis: Number(item.allocatedCostBasis || 0),
    sold_price: item.soldPrice ?? null,
    bought_price: item.boughtPrice ?? null,
    cash_allocation: item.cashAllocation ?? null,
    image_url: item.imageUrl || null,
    image_path: item.imagePath || null,
    back_image_url: item.backImageUrl || null,
    back_image_path: item.backImagePath || null,
    collector_number: item.collectorNumber || null,
    card_set: item.cardSet || null,
    card_set_id: item.cardSetId || null,
    card_set_code: item.cardSetCode || null,
    card_rarity: item.cardRarity || null,
    card_game: cardGame,
    card_language: cardLanguage,
    data_provider: dataProvider,
    provider_card_id: dataProvider === "manual" ? null : item.providerCardId || (dataProvider === "pokemontcg" ? item.pokemonTcgCardId : undefined) || null,
    card_code: item.cardCode || null,
    pokemon_tcg_card_id: dataProvider === "pokemontcg" ? item.pokemonTcgCardId || item.providerCardId || null : null,
    official_card_image_url: item.officialCardImageUrl || null,
    tcgplayer_url: item.tcgplayerUrl || null,
    market_price_source: item.marketPriceSource || null,
    market_price_variant: item.marketPriceVariant || null,
    market_price_updated_at: item.marketPriceUpdatedAt || null,
    market_price_checked_at: item.marketPriceCheckedAt || null,
    market_price_currency: item.marketPriceCurrency || null,
    tcgplayer_pricing: (item.tcgplayerPricing as Json | undefined) ?? null,
    target_buy_percentage: item.targetBuyPercentage ?? null,
    target_buy_price: item.targetBuyPrice ?? null,
    card_selection_source: item.cardSelectionSource || null,
    cost_basis_is_estimate: item.costBasisIsEstimate === true,
    card_condition: item.cardCondition || null,
    sticker_price: item.stickerPrice ?? null,
    grading_company: item.gradingCompany || null,
    grade: item.grade || null,
    certificate_number: item.certificateNumber || null,
    notes: item.notes?.trim() || null,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

export function buildTransactionOwnershipPayload(
  transactionItemId: string,
  share: TradeItemOwnershipShare,
  updatedAt: string
) {
  return removeUndefinedFields({
    id: share.id,
    transaction_item_id: transactionItemId,
    worker_id: share.workerId,
    ownership_percentage: Number(share.ownershipPercentage),
    allocated_cost_basis: share.allocatedCostBasis ?? null,
    allocated_trade_value: share.allocatedTradeValue ?? null,
    updated_at: updatedAt
  });
}

export function buildTransactionPaymentPayload(input: {
  id: string;
  transactionId: string;
  direction: "received" | "paid";
  paymentMethod: string;
  amount: number;
  workerId?: string;
  updatedAt: string;
}) {
  return {
    id: input.id,
    transaction_id: input.transactionId,
    direction: input.direction,
    payment_method: input.paymentMethod,
    amount: Number(input.amount || 0),
    worker_id: input.workerId || null,
    updated_at: input.updatedAt
  };
}

export function buildTransactionImagePayload(
  image: TransactionImageAttachment,
  fallbackId: string,
  transactionId: string
) {
  if (!transactionId) throw new Error("A transaction image requires a transaction_id.");
  if (!image.imagePath) throw new Error("A transaction image requires an image_path.");
  if (["item", "front", "back", "crop"].includes(image.imageType) && !image.transactionItemId) {
    throw new Error("An item-specific transaction image requires a transaction_item_id.");
  }
  return {
    id: image.id || fallbackId,
    transaction_id: transactionId,
    transaction_item_id: image.transactionItemId || null,
    image_type: image.imageType,
    image_url: image.imageUrl,
    image_path: image.imagePath,
    sort_order: Number(image.sortOrder || 0)
  };
}

export function buildTransactionBalancePayload(input: {
  transactionId: string;
  owedByWorkerId: string;
  owedToWorkerId: string;
  amount: number;
  updatedAt: string;
}) {
  return {
    transaction_id: input.transactionId,
    owed_by_worker_id: input.owedByWorkerId,
    owed_to_worker_id: input.owedToWorkerId,
    amount: Number(input.amount || 0),
    settled: false,
    updated_at: input.updatedAt
  };
}

export function buildInventoryLineagePayload(row: InventoryTradeLineage) {
  return {
    id: row.id,
    source_inventory_purchase_id: row.sourceInventoryPurchaseId,
    resulting_inventory_purchase_id: row.resultingInventoryPurchaseId,
    transaction_id: row.tradeTransactionId,
    relationship_type: row.relationshipType,
    created_at: row.createdAt
  };
}
