import type { InventoryPurchase, InventoryTradeLineage, TradeItem, TradeItemOwnershipShare, TradeTransaction, TransactionImageAttachment, TransactionImageType } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, recordSupabaseRequest, supabase } from "../../utils/supabase";
import { saveInventoryPurchase } from "./inventoryPurchaseRepository";
import { saveInventoryOwnership, saveSaleOwnership } from "./ownershipRepository";
import { createSaleRecord } from "./salesRepository";
import { saveBusinessExpense } from "./businessExpenseRepository";
import { missingHistoricalCostBasisItems, transactionReview } from "../../utils/transactionMath";
import { roundMoney } from "../../utils/paymentMath";
import { buildFinancialTransactionPayload } from "./financialTransactionPayload";
import {
  buildTransactionItemPayload,
  buildInventoryLineagePayload,
  buildTransactionBalancePayload,
  buildTransactionImagePayload,
  buildTransactionOwnershipPayload,
  buildTransactionPaymentPayload
} from "./databasePayloads";
import { ownershipValidationError } from "../../utils/tradeMath";
import { prepareTransactionForCompletion } from "./transactionReliability";
import {
  mapTransactionTypeToApplicationValue,
  mapTransactionTypeToDatabaseValue,
  normalizeTransactionForApplication,
  type DatabaseFinancialTransactionType
} from "./financialTransactionType";
export { prepareTransactionForCompletion } from "./transactionReliability";

const localKey = "4nerds_financial_transactions_local_v1";
const cacheKey = "4nerds_financial_transactions_cache_v1";
const lineageKey = "4nerds_inventory_lineage_local_v1";

const read = <T>(key: string): T[] => { try { return JSON.parse(localStorage.getItem(key) || "[]") as T[]; } catch { return []; } };
const write = (key: string, values: unknown[]) => { try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* optional cache */ } };

type TransactionRow = {
  id: string; transaction_date: string; transaction_subtype?: string | null;
  event_id?: string | null; event_day_id?: string | null; customer_or_seller?: string | null;
  cash_received?: number | null; cash_paid?: number | null;
  bundle_total?: number | null; allocation_method?: TradeTransaction["pricingMode"] | null;
  notes?: string | null; status: TradeTransaction["status"]; item_mode?: TradeTransaction["itemMode"] | null; entered_by_worker_id?: string | null;
  general_image_url?: string | null; general_image_path?: string | null; expense_category?: TradeTransaction["expenseCategory"] | null;
  payment_method?: TradeTransaction["paymentMethod"] | null; transaction_type?: DatabaseFinancialTransactionType | string | null;
  created_at?: string | null; updated_at?: string | null;
  // Read-only compatibility for rows created before the canonical payload names were adopted.
  completed_at?: string | null; reversed_at?: string | null; reversal_of_transaction_id?: string | null;
  pricing_mode?: TradeTransaction["pricingMode"] | null;
  purchase_source?: TradeTransaction["purchaseSource"] | null;
  paid_by_worker_id?: string | null; keep_as_bundle?: boolean | null;
};
type ItemRow = {
  id: string; transaction_id: string; inventory_purchase_id?: string | null; created_inventory_purchase_id?: string | null;
  prior_inventory_purchase_id?: string | null; direction: TradeItem["direction"]; item_name: string; item_type: TradeItem["itemType"];
  quantity: number; market_value: number; agreed_trade_value: number; historical_cost_basis: number; allocated_cost_basis: number;
  cash_allocation?: number | null; image_url?: string | null; image_path?: string | null; back_image_url?: string | null; back_image_path?: string | null;
  collector_number?: string | null; card_set?: string | null; pokemon_tcg_card_id?: string | null; card_condition?: TradeItem["cardCondition"] | null;
  sticker_price?: number | null; grading_company?: string | null; grade?: string | null; certificate_number?: string | null;
  notes?: string | null; created_at: string; updated_at: string;
  trade_percentage?: number | null; sold_price?: number | null; bought_price?: number | null;
  created_sales_record_id?: string | null; created_business_expense_id?: string | null;
  zero_cost_basis_confirmed?: boolean | null;
  card_set_id?: string | null; card_set_code?: string | null; card_rarity?: string | null; card_game?: TradeItem["cardGame"] | null; card_language?: string | null;
  data_provider?: TradeItem["dataProvider"] | null; provider_card_id?: string | null; card_code?: string | null; market_price_currency?: string | null;
  official_card_image_url?: string | null; tcgplayer_url?: string | null; market_price_source?: string | null;
  market_price_variant?: string | null; market_price_updated_at?: string | null; market_price_checked_at?: string | null;
  tcgplayer_pricing?: TradeItem["tcgplayerPricing"] | null; target_buy_percentage?: number | null; target_buy_price?: number | null;
  card_selection_source?: TradeItem["cardSelectionSource"] | null; cost_basis_is_estimate?: boolean | null;
};
type ShareRow = { id?: string; transaction_item_id: string; worker_id: string; ownership_percentage: number; allocated_cost_basis?: number | null; allocated_trade_value?: number | null };
type PaymentRow = { id: string; transaction_id: string; direction: "received" | "paid"; payment_method: string; amount: number };
type ImageRow = { id: string; transaction_id: string; transaction_item_id?: string | null; image_type: string; image_url: string; image_path: string; sort_order?: number | null };

const imageAttachment = (row: ImageRow): TransactionImageAttachment => ({
  id: row.id,
  transactionId: row.transaction_id,
  transactionItemId: row.transaction_item_id || undefined,
  imageType: (row.image_type === "transaction" ? "general" : row.image_type) as TransactionImageType,
  imageUrl: row.image_url,
  imagePath: row.image_path,
  sortOrder: Number(row.sort_order || 0)
});

function transactionImagePath(url?: string) {
  if (!url) return undefined;
  const marker = "/storage/v1/object/public/transaction-images/";
  return url.includes(marker) ? decodeURIComponent(url.split(marker)[1]) : undefined;
}

function isMissingColumnError(error?: { code?: string; message?: string } | null) {
  return Boolean(error && (
    error.code === "42703"
    || error.code === "PGRST204"
    || /column .* does not exist|could not find the .* column|schema cache/i.test(error.message || "")
  ));
}

function withoutReconciliationItemColumns(payload: ReturnType<typeof buildTransactionItemPayload>) {
  const {
    zero_cost_basis_confirmed: _zeroCostBasisConfirmed,
    card_set_id: _cardSetId,
    card_set_code: _cardSetCode,
    card_rarity: _cardRarity,
    card_game: _cardGame,
    card_language: _cardLanguage,
    data_provider: _dataProvider,
    provider_card_id: _providerCardId,
    card_code: _cardCode,
    official_card_image_url: _officialCardImageUrl,
    tcgplayer_url: _tcgplayerUrl,
    market_price_source: _marketPriceSource,
    market_price_variant: _marketPriceVariant,
    market_price_updated_at: _marketPriceUpdatedAt,
    market_price_checked_at: _marketPriceCheckedAt,
    market_price_currency: _marketPriceCurrency,
    tcgplayer_pricing: _tcgplayerPricing,
    target_buy_percentage: _targetBuyPercentage,
    target_buy_price: _targetBuyPrice,
    card_selection_source: _cardSelectionSource,
    cost_basis_is_estimate: _costBasisIsEstimate,
    ...legacy
  } = payload;
  return legacy;
}

const fromItem = (row: ItemRow, shares: TradeItemOwnershipShare[]): TradeItem => ({
  id: row.id, tradeTransactionId: row.transaction_id, inventoryPurchaseId: row.inventory_purchase_id || undefined,
  createdInventoryPurchaseId: row.created_inventory_purchase_id || undefined, priorInventoryPurchaseId: row.prior_inventory_purchase_id || undefined,
  direction: row.direction, itemName: row.item_name, itemType: row.item_type, quantity: Number(row.quantity || 1),
  marketValue: Number(row.market_value || 0), agreedTradeValue: Number(row.agreed_trade_value || 0),
  historicalCostBasis: Number(row.historical_cost_basis || 0), zeroCostBasisConfirmed: row.zero_cost_basis_confirmed === true,
  allocatedCostBasis: Number(row.allocated_cost_basis || 0),
  cashAllocation: row.cash_allocation == null ? undefined : Number(row.cash_allocation), imageUrl: row.image_url || undefined,
  imagePath: row.image_path || undefined, backImageUrl: row.back_image_url || undefined, backImagePath: row.back_image_path || undefined,
  collectorNumber: row.collector_number || undefined, cardSet: row.card_set || undefined, cardSetId: row.card_set_id || undefined,
  cardSetCode: row.card_set_code || undefined, cardRarity: row.card_rarity || undefined, cardGame: row.card_game || undefined, cardLanguage: row.card_language || undefined,
  dataProvider: row.data_provider || undefined, providerCardId: row.provider_card_id || undefined, cardCode: row.card_code || undefined,
  pokemonTcgCardId: row.pokemon_tcg_card_id || undefined, officialCardImageUrl: row.official_card_image_url || undefined,
  tcgplayerUrl: row.tcgplayer_url || undefined, marketPriceSource: row.market_price_source || undefined,
  marketPriceVariant: row.market_price_variant || undefined, marketPriceUpdatedAt: row.market_price_updated_at || undefined,
  marketPriceCheckedAt: row.market_price_checked_at || undefined, marketPriceCurrency: row.market_price_currency || undefined, tcgplayerPricing: row.tcgplayer_pricing || undefined,
  targetBuyPercentage: row.target_buy_percentage == null ? undefined : Number(row.target_buy_percentage),
  targetBuyPrice: row.target_buy_price == null ? undefined : Number(row.target_buy_price),
  cardSelectionSource: row.card_selection_source || undefined, costBasisIsEstimate: row.cost_basis_is_estimate === true,
  cardCondition: row.card_condition || undefined, stickerPrice: row.sticker_price == null ? undefined : Number(row.sticker_price),
  gradingCompany: row.grading_company || undefined, grade: row.grade || undefined, certificateNumber: row.certificate_number || undefined,
  notes: row.notes || undefined, ownershipShares: shares, createdAt: row.created_at, updatedAt: row.updated_at
  , tradePercentage: row.trade_percentage == null ? undefined : Number(row.trade_percentage),
  soldPrice: row.sold_price == null ? undefined : Number(row.sold_price), boughtPrice: row.bought_price == null ? undefined : Number(row.bought_price),
  createdSalesRecordId: row.created_sales_record_id || undefined, createdBusinessExpenseId: row.created_business_expense_id || undefined
});

export function blankTrade(): TradeTransaction {
  const timestamp = nowIso();
  return { id: id("trade"), tradeDate: timestamp, transactionType: "trade", itemMode: "multiple", pricingMode: "individual", cashReceived: 0, cashPaid: 0, status: "draft", createdAt: timestamp, updatedAt: timestamp, items: [] };
}

export function blankTradeItem(tradeId: string, direction: TradeItem["direction"]): TradeItem {
  const timestamp = nowIso();
  return { id: id("trade-item"), tradeTransactionId: tradeId, direction, itemName: "", itemType: "raw_card", quantity: 1, marketValue: 0, agreedTradeValue: 0, historicalCostBasis: 0, allocatedCostBasis: 0, ownershipShares: [], createdAt: timestamp, updatedAt: timestamp };
}

function normalizeStoredTransaction(transaction: TradeTransaction) {
  return normalizeTransactionForApplication(transaction);
}

export function getCachedTrades() {
  return read<TradeTransaction>(cacheKey).flatMap((transaction) => {
    try {
      return [normalizeStoredTransaction(transaction)];
    } catch {
      return [];
    }
  });
}

export async function listFinancialTransactions(transactionTypes?: TradeTransaction["transactionType"][]) {
  if (!isSupabaseConfigured || !supabase) {
    const values = read<TradeTransaction>(localKey).flatMap((transaction) => {
      try {
        return [normalizeStoredTransaction(transaction)];
      } catch {
        return [];
      }
    });
    return transactionTypes?.length ? values.filter((row) => transactionTypes.includes(row.transactionType)) : values;
  }
  let transactionQuery = supabase.from("financial_transactions").select("*");
  if (transactionTypes?.length) {
    transactionQuery = transactionQuery.in(
      "transaction_type",
      [...new Set(transactionTypes.map(mapTransactionTypeToDatabaseValue))]
    );
  }
  const transactions = await transactionQuery.order("transaction_date", { ascending: false });
  if (transactions.error) throw new Error(transactions.error.message);
  const ids = (transactions.data || []).map((row) => row.id);
  const items = ids.length ? await supabase.from("financial_transaction_items").select("*").in("transaction_id", ids) : { data: [], error: null };
  if (items.error) throw new Error(items.error.message);
  const itemIds = (items.data || []).map((row) => row.id);
  const shares = itemIds.length ? await supabase.from("transaction_item_ownership_shares").select("*").in("transaction_item_id", itemIds) : { data: [], error: null };
  if (shares.error) throw new Error(shares.error.message);
  const payments = ids.length ? await supabase.from("transaction_payments").select("*").in("transaction_id", ids) : { data: [], error: null };
  if (payments.error) throw new Error(payments.error.message);
  const images = ids.length ? await supabase.from("transaction_images").select("*").in("transaction_id", ids) : { data: [], error: null };
  if (images.error) throw new Error(images.error.message);
  const shareMap = new Map<string, TradeItemOwnershipShare[]>();
  (shares.data as ShareRow[] || []).forEach((row) => shareMap.set(row.transaction_item_id, [...(shareMap.get(row.transaction_item_id) || []), {
    id: row.id, workerId: row.worker_id, ownershipPercentage: Number(row.ownership_percentage),
    allocatedCostBasis: row.allocated_cost_basis == null ? undefined : Number(row.allocated_cost_basis),
    allocatedTradeValue: row.allocated_trade_value == null ? undefined : Number(row.allocated_trade_value)
  }]));
  const itemMap = new Map<string, TradeItem[]>();
  const imageRows = images.data as ImageRow[] || [];
  (items.data as ItemRow[] || []).forEach((row) => {
    const itemImages = imageRows
      .filter((value) => value.transaction_item_id === row.id)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const reusedGeneralImage = !itemImages.length && row.image_path
      ? imageRows.find((value) =>
        value.transaction_id === row.transaction_id
        && !value.transaction_item_id
        && value.image_path === row.image_path
      )
      : undefined;
    const image = itemImages.find((value) => value.image_type !== "back");
    const back = itemImages.find((value) => value.image_type === "back");
    const value = {
      ...fromItem(row, shareMap.get(row.id) || []),
      images: reusedGeneralImage
        ? [{
          ...imageAttachment(reusedGeneralImage),
          id: `reused-${row.id}-${reusedGeneralImage.id}`,
          transactionItemId: row.id,
          imageType: "front" as const,
          reusedFromImageId: reusedGeneralImage.id
        }]
        : itemImages.map(imageAttachment),
      imageUrl: image?.image_url || row.image_url || undefined,
      imagePath: image?.image_path || row.image_path || undefined,
      backImageUrl: back?.image_url || row.back_image_url || undefined,
      backImagePath: back?.image_path || row.back_image_path || undefined
    };
    itemMap.set(row.transaction_id, [...(itemMap.get(row.transaction_id) || []), value]);
  });
  const paymentMap = new Map<string, { received: number; paid: number }>();
  (payments.data as PaymentRow[] || []).forEach((row) => {
    const current = paymentMap.get(row.transaction_id) || { received: 0, paid: 0 };
    current[row.direction] += Number(row.amount || 0);
    paymentMap.set(row.transaction_id, current);
  });
  const values = (transactions.data as TransactionRow[] || []).map((row): TradeTransaction => {
    const applicationType = mapTransactionTypeToApplicationValue(row.transaction_type || "trade");
    return ({
    images: imageRows
      .filter((value) => value.transaction_id === row.id && !value.transaction_item_id)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map(imageAttachment),
    id: row.id, tradeDate: row.transaction_date, eventId: row.event_id || undefined, eventDayId: row.event_day_id || undefined,
    tradePartner: row.customer_or_seller || undefined, cashReceived: Number(row.cash_received ?? paymentMap.get(row.id)?.received ?? 0), cashPaid: Number(row.cash_paid ?? paymentMap.get(row.id)?.paid ?? 0),
    notes: row.notes || undefined, generalImageUrl: row.general_image_url || imageRows.find((value) => value.transaction_id === row.id && !value.transaction_item_id && (value.image_type === "general" || value.image_type === "transaction" || value.image_type === "receipt"))?.image_url,
    generalImagePath: row.general_image_path || imageRows.find((value) => value.transaction_id === row.id && !value.transaction_item_id && (value.image_type === "general" || value.image_type === "transaction" || value.image_type === "receipt"))?.image_path,
    proofImageUrl: imageRows.find((value) => value.transaction_id === row.id && !value.transaction_item_id && (value.image_type === "proof" || value.image_type === "receipt"))?.image_url,
    proofImagePath: imageRows.find((value) => value.transaction_id === row.id && !value.transaction_item_id && (value.image_type === "proof" || value.image_type === "receipt"))?.image_path, status: row.status,
    enteredByWorkerId: row.entered_by_worker_id || undefined, completedAt: row.completed_at || undefined, reversedAt: row.reversed_at || undefined,
    reversalOfTradeId: row.reversal_of_transaction_id || undefined, createdAt: row.created_at || row.transaction_date, updatedAt: row.updated_at || row.transaction_date, items: itemMap.get(row.id) || []
    , transactionType: applicationType, itemMode: row.item_mode || "multiple", pricingMode: row.allocation_method || row.pricing_mode || "individual",
    bundleTotal: row.bundle_total == null ? undefined : Number(row.bundle_total), paymentMethod: row.payment_method || undefined,
    purchaseSource: applicationType === "purchase" ? (row.transaction_subtype as TradeTransaction["purchaseSource"]) || row.purchase_source || undefined : undefined,
    expenseCategory: applicationType === "expense" ? row.expense_category || undefined : undefined,
    paidByWorkerId: row.paid_by_worker_id || undefined, keepAsBundle: Boolean(row.keep_as_bundle)
  });
  });
  write(cacheKey, values);
  recordSupabaseRequest("financial_transactions", "listTrades", values.length);
  return values;
}

export function listTrades() {
  return listFinancialTransactions(["trade", "cash_trade"]);
}

export class FinancialTransactionDraftError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FinancialTransactionDraftError";
    this.cause = cause;
  }
}

export function isFinancialTransactionDraftError(error: unknown): error is FinancialTransactionDraftError {
  return error instanceof FinancialTransactionDraftError;
}

async function upsertFinancialTransactionParent(transaction: TradeTransaction) {
  if (!isSupabaseConfigured || !supabase) return transaction.id;
  const payload = buildFinancialTransactionPayload(transaction);
  const saved = await supabase
    .from("financial_transactions")
    .upsert(payload, { onConflict: "id" })
    .select("id")
    .single();
  if (saved.error) throw new Error(saved.error.message);
  return saved.data.id as string;
}

export async function saveFinancialTransactionDraft(input: TradeTransaction) {
  const normalizedInput = normalizeTransactionForApplication(input);
  const draft = {
    ...normalizedInput,
    status: "draft" as const,
    updatedAt: nowIso(),
    items: normalizedInput.items.map((item) => ({ ...item, tradeTransactionId: normalizedInput.id }))
  };
  try {
    const transactionId = await upsertFinancialTransactionParent(draft);
    const persisted = {
      ...draft,
      id: transactionId,
      items: draft.items.map((item) => ({ ...item, tradeTransactionId: transactionId }))
    };
    if (!isSupabaseConfigured || !supabase) {
      const values = [persisted, ...read<TradeTransaction>(localKey).filter((row) => row.id !== persisted.id)];
      write(localKey, values);
      write(cacheKey, values);
    }
    return persisted;
  } catch (error) {
    throw new FinancialTransactionDraftError(
      error instanceof Error ? error.message : "The transaction draft could not be saved.",
      error
    );
  }
}

export async function saveTrade(input: TradeTransaction, options?: {
  syncImages?: boolean;
  syncPayments?: boolean;
  syncOwnership?: boolean;
}) {
  const normalizedInput = normalizeTransactionForApplication(input);
  const trade = { ...normalizedInput, updatedAt: nowIso(), items: normalizedInput.items.map((item) => ({ ...item, tradeTransactionId: normalizedInput.id, updatedAt: nowIso() })) };
  if (!isSupabaseConfigured || !supabase) {
    const values = [trade, ...read<TradeTransaction>(localKey).filter((row) => row.id !== trade.id)];
    write(localKey, values); write(cacheKey, values); return trade;
  }
  const transactionId = await upsertFinancialTransactionParent(trade);
  const persistedTrade = {
    ...trade,
    id: transactionId,
    items: trade.items.map((item) => ({ ...item, tradeTransactionId: transactionId }))
  };
  if (trade.status === "draft") {
    const existing = await supabase.from("financial_transaction_items").select("id").eq("transaction_id", transactionId);
    if (existing.error) throw new Error(existing.error.message);
    const activeIds = new Set(persistedTrade.items.map((item) => item.id));
    const removedIds = (existing.data || []).map((row) => row.id).filter((itemId) => !activeIds.has(itemId));
    if (removedIds.length) {
      const removed = await supabase.from("financial_transaction_items").delete().in("id", removedIds);
      if (removed.error) throw new Error(removed.error.message);
    }
  }
  if (persistedTrade.items.length) {
    const itemPayloads = persistedTrade.items.map((item) =>
      buildTransactionItemPayload({
        ...item,
        imagePath: item.imagePath || transactionImagePath(item.imageUrl),
        backImagePath: item.backImagePath || transactionImagePath(item.backImageUrl)
      })
    );
    let itemResult = await supabase.from("financial_transaction_items").upsert(itemPayloads);
    if (isMissingColumnError(itemResult.error)) {
      itemResult = await supabase.from("financial_transaction_items").upsert(itemPayloads.map(withoutReconciliationItemColumns));
    }
    if (itemResult.error) throw new Error(itemResult.error.message);
  }
  if (options?.syncPayments !== false) {
    const existingPayments = await supabase.from("transaction_payments").select("id,direction,payment_method").eq("transaction_id", transactionId);
    if (existingPayments.error) throw new Error(existingPayments.error.message);
    const paymentRows = [
      { direction: "received" as const, amount: Number(persistedTrade.cashReceived || 0) },
      { direction: "paid" as const, amount: Number(persistedTrade.cashPaid || 0) }
    ].map((payment) => buildTransactionPaymentPayload({
      id: existingPayments.data?.find((row) => row.direction === payment.direction && row.payment_method === (persistedTrade.paymentMethod || "cash"))?.id || id("payment"),
      transactionId,
      direction: payment.direction,
      paymentMethod: persistedTrade.paymentMethod || "cash",
      amount: payment.amount,
      workerId: payment.direction === "paid" ? persistedTrade.paidByWorkerId : undefined,
      updatedAt: persistedTrade.updatedAt
    }));
    const paymentResult = await supabase.from("transaction_payments").upsert(paymentRows, { onConflict: "transaction_id,direction,payment_method" });
    if (paymentResult.error) throw new Error(paymentResult.error.message);
  }
  if (options?.syncImages !== false) {
  const transactionImages = persistedTrade.images?.length
    ? persistedTrade.images
    : [
      persistedTrade.generalImageUrl && (persistedTrade.generalImagePath || transactionImagePath(persistedTrade.generalImageUrl)) ? {
        id: "", transactionId, imageType: "general" as const, imageUrl: persistedTrade.generalImageUrl,
        imagePath: persistedTrade.generalImagePath || transactionImagePath(persistedTrade.generalImageUrl)!, sortOrder: 0
      } : undefined,
      persistedTrade.proofImageUrl && (persistedTrade.proofImagePath || transactionImagePath(persistedTrade.proofImageUrl)) ? {
        id: "", transactionId, imageType: "proof" as const, imageUrl: persistedTrade.proofImageUrl,
        imagePath: persistedTrade.proofImagePath || transactionImagePath(persistedTrade.proofImageUrl)!, sortOrder: 1
      } : undefined
    ].filter(Boolean) as TransactionImageAttachment[];
  const itemImages = persistedTrade.items.flatMap((item) => item.images?.length
    ? item.images
    : [
      item.imageUrl && (item.imagePath || transactionImagePath(item.imageUrl)) ? {
        id: "", transactionId, transactionItemId: item.id, imageType: "front" as const,
        imageUrl: item.imageUrl, imagePath: item.imagePath || transactionImagePath(item.imageUrl)!, sortOrder: 0
      } : undefined,
      item.backImageUrl && (item.backImagePath || transactionImagePath(item.backImageUrl)) ? {
        id: "", transactionId, transactionItemId: item.id, imageType: "back" as const,
        imageUrl: item.backImageUrl, imagePath: item.backImagePath || transactionImagePath(item.backImageUrl)!, sortOrder: 1
      } : undefined
    ].filter(Boolean) as TransactionImageAttachment[]);
  const desiredImages = [...transactionImages, ...itemImages]
    .filter((image) => image.imagePath && !image.reusedFromImageId);
  const currentImagesWithSort = await supabase.from("transaction_images").select("id,transaction_item_id,image_type,image_path,sort_order").eq("transaction_id", transactionId);
  let currentImageData = (currentImagesWithSort.data || []) as ImageRow[];
  let currentImageError = currentImagesWithSort.error;
  if (isMissingColumnError(currentImageError)) {
    const legacyImages = await supabase.from("transaction_images").select("id,transaction_item_id,image_type,image_path").eq("transaction_id", transactionId);
    currentImageData = (legacyImages.data || []) as ImageRow[];
    currentImageError = legacyImages.error;
  }
  if (currentImageError) throw new Error(currentImageError.message);
  const desiredRows = desiredImages.map((image) => buildTransactionImagePayload(
    image,
    currentImageData.find((value) => value.image_path === image.imagePath)?.id || id("transaction-image"),
    transactionId
  ));
  if (desiredRows.length) {
    const imageResult = await supabase.from("transaction_images").upsert(desiredRows, { onConflict: "id" });
    if (imageResult.error) throw new Error(imageResult.error.message);
  }
  const desiredIds = new Set(desiredRows.map((row) => row.id));
  const removedImageIds = currentImageData.map((row) => row.id).filter((imageId) => !desiredIds.has(imageId));
  if (removedImageIds.length) {
    const removed = await supabase.from("transaction_images").delete().in("id", removedImageIds);
    if (removed.error) throw new Error(removed.error.message);
  }
  }
  if (options?.syncOwnership !== false) for (const item of persistedTrade.items) {
    if (item.ownershipShares.length) {
      const result = await supabase.from("transaction_item_ownership_shares").upsert(
        item.ownershipShares.map((share) => buildTransactionOwnershipPayload(item.id, share, persistedTrade.updatedAt)),
        { onConflict: "transaction_item_id,worker_id" }
      );
      if (result.error) throw new Error(result.error.message);
    }
    const ownershipRows = await supabase.from("transaction_item_ownership_shares").select("id,worker_id").eq("transaction_item_id", item.id);
    if (ownershipRows.error) throw new Error(ownershipRows.error.message);
    const desiredWorkers = new Set(item.ownershipShares.map((share) => share.workerId));
    const staleIds = (ownershipRows.data || []).filter((row) => !desiredWorkers.has(row.worker_id)).map((row) => row.id);
    if (staleIds.length) {
      const deletion = await supabase.from("transaction_item_ownership_shares").delete().in("id", staleIds);
      if (deletion.error) throw new Error(deletion.error.message);
    }
  }
  return persistedTrade;
}

function validateTransactionOwnership(transaction: TradeTransaction) {
  const relevantItems = transaction.transactionType === "sale"
    ? transaction.items.filter((item) => item.direction === "outgoing")
    : transaction.transactionType === "expense"
      ? []
      : transaction.items.filter((item) => item.direction === "incoming");
  for (const item of relevantItems) {
    const error = ownershipValidationError(item);
    if (error) throw new Error(`${item.itemName || "Unnamed item"}: ${error}`);
  }
}

function isMissingClaimFunction(error: { code?: string; message?: string } | null) {
  return Boolean(error && (
    error.code === "PGRST202"
    || error.code === "42883"
    || /claim_financial_transaction_inventory|schema cache|function .* does not exist/i.test(error.message || "")
  ));
}

async function claimOutgoingInventory(
  transaction: TradeTransaction,
  inventory: InventoryPurchase[],
  disposition: "sold" | "traded_out"
) {
  const outgoing = transaction.items.filter((item) => item.direction === "outgoing" && item.inventoryPurchaseId);
  const inventoryIds = outgoing.map((item) => item.inventoryPurchaseId!);
  if (!inventoryIds.length) return;
  if (new Set(inventoryIds).size !== inventoryIds.length) throw new Error("The same inventory item cannot be used more than once.");

  if (isSupabaseConfigured && supabase) {
    const claim = await supabase.rpc("claim_financial_transaction_inventory", {
      p_transaction_id: transaction.id,
      p_inventory_ids: inventoryIds,
      p_disposition: disposition
    });
    if (!claim.error) return;
    if (!isMissingClaimFunction(claim.error)) throw new Error(claim.error.message);

    // Compatibility fallback before the reconciliation migration is applied.
    // This is a fresh server check, but the migration RPC is required for
    // cross-device atomicity.
    const live = await supabase
      .from("inventory_purchases")
      .select("id,status,disposed_financial_transaction_id")
      .in("id", inventoryIds);
    if (live.error) throw new Error(live.error.message);
    const unavailable = inventoryIds.find((inventoryId) => {
      const row = live.data?.find((value) => value.id === inventoryId);
      return !row || (row.status !== "in_stock" && !(row.status === disposition && row.disposed_financial_transaction_id === transaction.id));
    });
    if (unavailable) {
      const item = outgoing.find((value) => value.inventoryPurchaseId === unavailable);
      throw new Error(`${item?.itemName || "An inventory item"} is no longer available.`);
    }
    return;
  }

  const unavailable = outgoing.find((item) => {
    const row = inventory.find((value) => value.id === item.inventoryPurchaseId);
    return !row || (row.status !== "in_stock" && !(row.status === disposition && row.disposedFinancialTransactionId === transaction.id));
  });
  if (unavailable) throw new Error(`${unavailable.itemName} is no longer available.`);
}

function inventoryFromIncoming(item: TradeItem, trade: TradeTransaction): Partial<InventoryPurchase> {
  return {
    id: item.createdInventoryPurchaseId, itemName: item.itemName, category: item.itemType, quantity: item.quantity, quantitySold: 0,
    purchaseDate: trade.tradeDate, totalCost: item.allocatedCostBasis, marketValue: item.marketValue, purchaseSource: "trade",
    seller: trade.tradePartner, eventId: trade.eventId, purchasedByWorkerId: trade.enteredByWorkerId, status: "in_stock",
    isRawCard: item.itemType === "raw_card", cardName: item.itemName, collectorNumber: item.collectorNumber, cardSet: item.cardSet,
    cardSetId: item.cardSetId, cardSetCode: item.cardSetCode, cardRarity: item.cardRarity, cardGame: item.cardGame, cardLanguage: item.cardLanguage,
    dataProvider: item.dataProvider, providerCardId: item.providerCardId, cardCode: item.cardCode, marketPriceCurrency: item.marketPriceCurrency,
    pokemonTcgCardId: item.pokemonTcgCardId, officialCardImageUrl: item.officialCardImageUrl, tcgplayerUrl: item.tcgplayerUrl,
    marketPriceSource: item.marketPriceSource, marketPriceVariant: item.marketPriceVariant,
    marketPriceUpdatedAt: item.marketPriceUpdatedAt, marketPriceCheckedAt: item.marketPriceCheckedAt,
    buyPercentage: item.targetBuyPercentage, targetBuyPrice: item.targetBuyPrice,
    cardCondition: item.cardCondition, stickerPrice: item.stickerPrice,
    gradingCompany: item.gradingCompany, grade: item.grade, certificateNumber: item.certificateNumber, imageUrl: item.imageUrl,
    imagePath: item.imagePath, frontImageUrl: item.imageUrl, frontImagePath: item.imagePath, backImageUrl: item.backImageUrl,
    backImagePath: item.backImagePath, notes: item.notes, acquisitionMethod: "trade", acquiredFinancialTransactionId: trade.id,
    scanResult: item.tcgplayerPricing ? { tcgplayerPricing: item.tcgplayerPricing } : undefined,
    agreedTradeValue: item.agreedTradeValue, priorInventoryPurchaseId: item.priorInventoryPurchaseId,
    financialTransactionId: trade.id, financialTransactionItemId: item.id
  };
}

export type TransactionSaveStage = "transaction" | "items" | "inventory" | "ownership" | "finalizing";

export async function completeTrade(input: TradeTransaction, inventory: InventoryPurchase[], onProgress?: (stage: TransactionSaveStage) => void) {
  const normalizedInput = normalizeTransactionForApplication(input);
  if (normalizedInput.status !== "draft") throw new Error("Only a draft trade can be completed.");
  const outgoing = normalizedInput.items.filter((item) => item.direction === "outgoing");
  const incoming = normalizedInput.items.filter((item) => item.direction === "incoming");
  if (!outgoing.length || !incoming.length) throw new Error("A trade needs at least one item on each side.");
  validateTransactionOwnership(normalizedInput);
  const timestamp = nowIso();
  let trade = prepareTransactionForCompletion(normalizedInput);
  onProgress?.("transaction");
  await saveTrade(trade);
  onProgress?.("inventory");
  await claimOutgoingInventory(trade, inventory, "traded_out");
  for (const item of trade.items.filter((row) => row.direction === "outgoing")) {
    const source = inventory.find((row) => row.id === item.inventoryPurchaseId);
    if (!source) throw new Error(`${item.itemName} is no longer available.`);
    await saveInventoryPurchase({ ...source, status: "traded_out", tradedAt: timestamp, disposedFinancialTransactionId: trade.id, financialTransactionId: trade.id, financialTransactionItemId: item.id });
  }
  const created: InventoryPurchase[] = [];
  onProgress?.("ownership");
  for (const item of trade.items.filter((row) => row.direction === "incoming")) {
    const saved = await saveInventoryPurchase(inventoryFromIncoming(item, trade));
    if (item.ownershipShares.length) await saveInventoryOwnership(saved.id, item.ownershipShares);
    created.push({ ...saved, ownershipShares: item.ownershipShares });
  }
  const lineage: InventoryTradeLineage[] = [];
  for (const source of outgoing) for (const target of created) lineage.push({ id: id("lineage"), sourceInventoryPurchaseId: source.inventoryPurchaseId!, resultingInventoryPurchaseId: target.id, tradeTransactionId: trade.id, relationshipType: "exchanged_for", createdAt: timestamp });
  if (isSupabaseConfigured && supabase && lineage.length) {
    const result = await supabase.from("inventory_lineage").upsert(lineage.map(buildInventoryLineagePayload), { onConflict: "source_inventory_purchase_id,resulting_inventory_purchase_id,transaction_id" });
    if (result.error) throw new Error(result.error.message);
  } else write(lineageKey, [...lineage, ...read<InventoryTradeLineage>(lineageKey)]);
  onProgress?.("finalizing");
  trade = { ...trade, status: "completed", completedAt: timestamp, updatedAt: timestamp };
  await saveTrade(trade);
  return { trade, created };
}

export async function completeFinancialTransaction(input: TradeTransaction, inventory: InventoryPurchase[], onProgress?: (stage: TransactionSaveStage) => void) {
  const normalizedInput = normalizeTransactionForApplication(input);
  if (normalizedInput.transactionType === "trade" || normalizedInput.transactionType === "cash_trade") return completeTrade(normalizedInput, inventory, onProgress);
  if (normalizedInput.status !== "draft") throw new Error("Only a draft transaction can be completed.");
  const missingBasis = missingHistoricalCostBasisItems(normalizedInput);
  if (missingBasis.length) throw new Error(`Cost basis required for: ${missingBasis.map((item) => item.itemName || "Unnamed item").join(", ")}.`);
  validateTransactionOwnership(normalizedInput);
  const timestamp = nowIso();
  let transaction = prepareTransactionForCompletion(normalizedInput);
  onProgress?.("transaction");
  await saveTrade(transaction);
  onProgress?.("items");
  if (transaction.transactionType === "sale") {
    const items = transaction.items.filter((item) => item.direction === "outgoing");
    if (!items.length) throw new Error("Add at least one inventory item to the sale.");
    onProgress?.("inventory");
    await claimOutgoingInventory(transaction, inventory, "sold");
    for (const item of items) {
      const source = inventory.find((row) => row.id === item.inventoryPurchaseId);
      if (item.inventoryPurchaseId && !source) throw new Error(`${item.itemName} is no longer available.`);
      const result = await createSaleRecord({
        id: item.createdSalesRecordId,
        eventId: transaction.eventId, eventDayId: transaction.eventDayId, imageUrl: item.imageUrl || transaction.generalImageUrl,
        imagePath: item.imagePath || transaction.generalImagePath, itemName: item.itemName, category: item.itemType, quantity: item.quantity,
        soldPrice: item.soldPrice || 0, boughtPrice: item.historicalCostBasis, marketValue: item.marketValue,
        marketPriceSource: item.marketPriceSource, marketPriceVariant: item.marketPriceVariant,
        marketPriceUpdatedAt: item.marketPriceUpdatedAt, marketPriceCheckedAt: item.marketPriceCheckedAt,
        tcgplayerUrl: item.tcgplayerUrl, cardName: item.itemName, collectorNumber: item.collectorNumber,
        cardSet: item.cardSet, cardSetId: item.cardSetId, cardSetCode: item.cardSetCode, cardRarity: item.cardRarity,
        cardGame: item.cardGame, cardLanguage: item.cardLanguage, dataProvider: item.dataProvider,
        providerCardId: item.providerCardId, cardCode: item.cardCode, marketPriceCurrency: item.marketPriceCurrency,
        cardCondition: item.cardCondition, pokemonTcgCardId: item.pokemonTcgCardId,
        officialCardImageUrl: item.officialCardImageUrl, buyPercentage: item.targetBuyPercentage,
        targetBuyPrice: item.targetBuyPrice,
        paymentMethod: transaction.paymentMethod || "cash", soldByWorkerId: transaction.enteredByWorkerId,
        inventoryPurchaseId: source?.id, notes: item.notes || transaction.notes, soldAt: transaction.tradeDate,
        financialTransactionId: transaction.id, financialTransactionItemId: item.id
      });
      item.createdSalesRecordId = result.sale.id;
      await saveSaleOwnership(result.sale.id, item.ownershipShares);
      if (source) {
        await saveInventoryPurchase({
          ...source, status: "sold", quantitySold: source.quantity, soldPrice: item.soldPrice || 0,
          soldDate: transaction.tradeDate, soldByWorkerId: transaction.enteredByWorkerId, soldEventId: transaction.eventId,
          soldPaymentMethod: transaction.paymentMethod, disposedFinancialTransactionId: transaction.id,
          financialTransactionId: transaction.id, financialTransactionItemId: item.id
        });
      }
    }
    transaction.cashReceived = transaction.items.reduce((sum, item) => sum + Number(item.soldPrice || 0), 0);
  } else if (transaction.transactionType === "purchase") {
    const items = transaction.items.filter((item) => item.direction === "incoming");
    if (!items.length) throw new Error("Add at least one purchased item.");
    onProgress?.("inventory");
    if (transaction.keepAsBundle && items.length > 1) {
      const totalCost = items.reduce((sum, item) => sum + Number(item.boughtPrice || item.allocatedCostBasis || 0), 0);
      const totalMarketValue = items.reduce((sum, item) => sum + Number(item.marketValue || 0), 0);
      const ownership = new Map<string, number>();
      items.forEach((item) => {
        const weight = totalCost > 0 ? Number(item.boughtPrice || item.allocatedCostBasis || 0) / totalCost : 1 / items.length;
        item.ownershipShares.forEach((share) => ownership.set(share.workerId, (ownership.get(share.workerId) || 0) + share.ownershipPercentage * weight));
      });
      const ownershipShares = Array.from(ownership, ([workerId, ownershipPercentage]) => ({
        id: id("ownership"), workerId, ownershipPercentage: roundMoney(ownershipPercentage)
      }));
      const saved = await saveInventoryPurchase({
        id: items[0].createdInventoryPurchaseId,
        itemName: transaction.tradePartner ? `Lot from ${transaction.tradePartner}` : items.map((item) => item.itemName).filter(Boolean).slice(0, 3).join(" + ") || "Inventory lot",
        category: items.every((item) => item.itemType === items[0].itemType) ? items[0].itemType : "other_pokemon_product",
        quantity: items.reduce((sum, item) => sum + Number(item.quantity || 1), 0), quantitySold: 0, purchaseDate: transaction.tradeDate,
        totalCost, marketValue: totalMarketValue, isRawCard: items.every((item) => item.itemType === "raw_card"),
        purchaseSource: transaction.purchaseSource || "other", seller: transaction.tradePartner, eventId: transaction.eventId,
        purchasedByWorkerId: transaction.paidByWorkerId, notes: transaction.notes, status: "in_stock",
        imageUrl: transaction.generalImageUrl || items.find((item) => item.imageUrl)?.imageUrl,
        imagePath: transaction.generalImagePath || items.find((item) => item.imagePath)?.imagePath,
        acquisitionMethod: "purchased", financialTransactionId: transaction.id, financialTransactionItemId: items[0].id
      });
      items.forEach((item) => { item.createdInventoryPurchaseId = saved.id; });
      if (ownershipShares.length) {
        onProgress?.("ownership");
        await saveInventoryOwnership(saved.id, ownershipShares);
      }
    } else for (const item of items) {
      const saved = await saveInventoryPurchase({
        id: item.createdInventoryPurchaseId,
        itemName: item.itemName, category: item.itemType, quantity: item.quantity, quantitySold: 0, purchaseDate: transaction.tradeDate,
        totalCost: item.boughtPrice || item.allocatedCostBasis, marketValue: item.marketValue, isRawCard: item.itemType === "raw_card",
        purchaseSource: transaction.purchaseSource || "other", seller: transaction.tradePartner, eventId: transaction.eventId,
        purchasedByWorkerId: transaction.paidByWorkerId, notes: item.notes || transaction.notes, status: "in_stock",
        cardName: item.itemName, collectorNumber: item.collectorNumber, cardSet: item.cardSet, pokemonTcgCardId: item.pokemonTcgCardId,
        cardSetId: item.cardSetId, cardSetCode: item.cardSetCode, cardRarity: item.cardRarity, cardGame: item.cardGame, cardLanguage: item.cardLanguage,
        dataProvider: item.dataProvider, providerCardId: item.providerCardId, cardCode: item.cardCode, marketPriceCurrency: item.marketPriceCurrency,
        officialCardImageUrl: item.officialCardImageUrl, tcgplayerUrl: item.tcgplayerUrl,
        marketPriceSource: item.marketPriceSource, marketPriceVariant: item.marketPriceVariant,
        marketPriceUpdatedAt: item.marketPriceUpdatedAt, marketPriceCheckedAt: item.marketPriceCheckedAt,
        buyPercentage: item.targetBuyPercentage, targetBuyPrice: item.targetBuyPrice,
        scanResult: item.tcgplayerPricing ? { tcgplayerPricing: item.tcgplayerPricing } : undefined,
        cardCondition: item.cardCondition, stickerPrice: item.stickerPrice, gradingCompany: item.gradingCompany, grade: item.grade,
        certificateNumber: item.certificateNumber, imageUrl: item.imageUrl || transaction.generalImageUrl, imagePath: item.imagePath,
        acquisitionMethod: "purchased", financialTransactionId: transaction.id, financialTransactionItemId: item.id
      });
      item.createdInventoryPurchaseId = saved.id;
      if (item.ownershipShares.length) {
        onProgress?.("ownership");
        await saveInventoryOwnership(saved.id, item.ownershipShares);
      }
    }
    transaction.cashPaid = transaction.items.reduce((sum, item) => sum + Number(item.boughtPrice || item.allocatedCostBasis || 0), 0);
  } else {
    const amount = transaction.bundleTotal ?? transaction.cashPaid;
    const expense = await saveBusinessExpense({
      id: transaction.items[0]?.createdBusinessExpenseId || transaction.id,
      expenseDate: transaction.tradeDate, amount, category: transaction.expenseCategory || "other",
      description: transaction.items.map((item) => item.itemName).filter(Boolean).join("; ") || transaction.notes || "Business expense", eventId: transaction.eventId,
      paidByWorkerId: transaction.paidByWorkerId, vendor: transaction.tradePartner, receiptImageUrl: transaction.proofImageUrl || transaction.generalImageUrl,
      receiptImagePath: transaction.proofImagePath || transaction.generalImagePath, notes: transaction.notes, financialTransactionId: transaction.id,
      financialTransactionItemId: transaction.items[0]?.id
    });
    if (transaction.items[0]) transaction.items[0].createdBusinessExpenseId = expense.id;
    transaction.cashPaid = amount;
  }
  onProgress?.("finalizing");
  const balances = transactionReview(transaction).internalBalances;
  if (isSupabaseConfigured && supabase && balances.length) {
    const balanceResult = await supabase.from("transaction_internal_balances").upsert(balances.map((row) =>
      buildTransactionBalancePayload({
        transactionId: transaction.id,
        owedByWorkerId: row.owedByWorkerId,
        owedToWorkerId: row.owedToWorkerId,
        amount: row.amount,
        updatedAt: timestamp
      })
    ), { onConflict: "transaction_id,owed_by_worker_id,owed_to_worker_id" });
    if (balanceResult.error) throw new Error(balanceResult.error.message);
  }
  transaction = { ...transaction, status: "completed", completedAt: timestamp, updatedAt: timestamp };
  await saveTrade(transaction);
  return { trade: transaction, created: [] as InventoryPurchase[] };
}

export async function reverseTrade(input: TradeTransaction, inventory: InventoryPurchase[]) {
  const normalizedInput = normalizeTransactionForApplication(input);
  if (normalizedInput.status !== "completed") throw new Error("Only a completed trade can be reversed.");
  const timestamp = nowIso();
  for (const item of normalizedInput.items.filter((row) => row.direction === "outgoing")) {
    const source = inventory.find((row) => row.id === item.inventoryPurchaseId);
    if (source?.status === "traded_out" && source.disposedFinancialTransactionId === input.id) await saveInventoryPurchase({ ...source, status: "in_stock", tradedAt: undefined, disposedFinancialTransactionId: undefined });
  }
  for (const item of normalizedInput.items.filter((row) => row.direction === "incoming")) {
    const received = inventory.find((row) => row.id === item.createdInventoryPurchaseId);
    if (received) await saveInventoryPurchase({ ...received, status: "reversed" });
  }
  const trade = { ...normalizedInput, status: "reversed" as const, reversedAt: timestamp, updatedAt: timestamp };
  await saveTrade(trade);
  return trade;
}

export async function listTradeLineage(inventoryId: string) {
  if (!isSupabaseConfigured || !supabase) return read<InventoryTradeLineage>(lineageKey).filter((row) => row.sourceInventoryPurchaseId === inventoryId || row.resultingInventoryPurchaseId === inventoryId);
  const [source, result] = await Promise.all([
    supabase.from("inventory_lineage").select("*").eq("source_inventory_purchase_id", inventoryId),
    supabase.from("inventory_lineage").select("*").eq("resulting_inventory_purchase_id", inventoryId)
  ]);
  if (source.error || result.error) throw new Error((source.error || result.error)!.message);
  return [...(source.data || []), ...(result.data || [])].map((row): InventoryTradeLineage => ({ id: row.id, sourceInventoryPurchaseId: row.source_inventory_purchase_id, resultingInventoryPurchaseId: row.resulting_inventory_purchase_id, tradeTransactionId: row.transaction_id, relationshipType: "exchanged_for", createdAt: row.created_at }));
}
