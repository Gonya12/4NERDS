import type { InventoryPurchase, InventoryTradeLineage, TradeItem, TradeItemOwnershipShare, TradeTransaction } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, recordSupabaseRequest, supabase } from "../../utils/supabase";
import { saveInventoryPurchase } from "./inventoryPurchaseRepository";
import { saveInventoryOwnership } from "./ownershipRepository";
import { createSaleRecord } from "./salesRepository";
import { saveBusinessExpense } from "./businessExpenseRepository";
import { transactionReview } from "../../utils/transactionMath";

const localKey = "4nerds_financial_transactions_local_v1";
const cacheKey = "4nerds_financial_transactions_cache_v1";
const lineageKey = "4nerds_inventory_lineage_local_v1";

const read = <T>(key: string): T[] => { try { return JSON.parse(localStorage.getItem(key) || "[]") as T[]; } catch { return []; } };
const write = (key: string, values: unknown[]) => { try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* optional cache */ } };

type TransactionRow = {
  id: string; transaction_date: string; event_id?: string | null; event_day_id?: string | null; customer_or_seller?: string | null;
  cash_received?: number | null; cash_paid?: number | null;
  notes?: string | null; status: TradeTransaction["status"]; entered_by_worker_id?: string | null;
  completed_at?: string | null; reversed_at?: string | null; reversal_of_transaction_id?: string | null; created_at: string; updated_at: string;
  transaction_type?: TradeTransaction["transactionType"] | null; item_mode?: TradeTransaction["itemMode"] | null;
  pricing_mode?: TradeTransaction["pricingMode"] | null; bundle_total?: number | null; payment_method?: TradeTransaction["paymentMethod"] | null;
  purchase_source?: TradeTransaction["purchaseSource"] | null; expense_category?: TradeTransaction["expenseCategory"] | null;
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
};
type ShareRow = { id?: string; transaction_item_id: string; worker_id: string; ownership_percentage: number; allocated_cost_basis?: number | null; allocated_trade_value?: number | null };
type PaymentRow = { id: string; transaction_id: string; direction: "received" | "paid"; payment_method: string; amount: number };
type ImageRow = { id: string; transaction_id: string; transaction_item_id?: string | null; image_type: string; image_url: string; image_path: string };

function transactionImagePath(url?: string) {
  if (!url) return undefined;
  const marker = "/storage/v1/object/public/transaction-images/";
  return url.includes(marker) ? decodeURIComponent(url.split(marker)[1]) : undefined;
}

const transactionRow = (trade: TradeTransaction): TransactionRow => ({
  id: trade.id, transaction_date: trade.tradeDate, event_id: trade.eventId || null, event_day_id: trade.eventDayId || null,
  customer_or_seller: trade.tradePartner || null, cash_received: Number(trade.cashReceived || 0), cash_paid: Number(trade.cashPaid || 0),
  notes: trade.notes || null, status: trade.status,
  entered_by_worker_id: trade.enteredByWorkerId || null, completed_at: trade.completedAt || null, reversed_at: trade.reversedAt || null,
  reversal_of_transaction_id: trade.reversalOfTradeId || null, created_at: trade.createdAt, updated_at: trade.updatedAt
  , transaction_type: trade.transactionType, item_mode: trade.itemMode, pricing_mode: trade.pricingMode,
  bundle_total: trade.bundleTotal ?? null, payment_method: trade.paymentMethod || null, purchase_source: trade.purchaseSource || null,
  expense_category: trade.expenseCategory || null, paid_by_worker_id: trade.paidByWorkerId || null, keep_as_bundle: Boolean(trade.keepAsBundle)
});
const itemRow = (item: TradeItem): ItemRow => ({
  id: item.id, transaction_id: item.tradeTransactionId, inventory_purchase_id: item.inventoryPurchaseId || null,
  created_inventory_purchase_id: item.createdInventoryPurchaseId || null, prior_inventory_purchase_id: item.priorInventoryPurchaseId || null,
  direction: item.direction, item_name: item.itemName, item_type: item.itemType, quantity: item.quantity,
  market_value: item.marketValue, agreed_trade_value: item.agreedTradeValue, historical_cost_basis: item.historicalCostBasis,
  allocated_cost_basis: item.allocatedCostBasis, cash_allocation: item.cashAllocation ?? null, image_url: item.imageUrl || null,
  image_path: item.imagePath || transactionImagePath(item.imageUrl) || null, back_image_url: item.backImageUrl || null, back_image_path: item.backImagePath || transactionImagePath(item.backImageUrl) || null,
  collector_number: item.collectorNumber || null, card_set: item.cardSet || null, pokemon_tcg_card_id: item.pokemonTcgCardId || null,
  card_condition: item.cardCondition || null, sticker_price: item.stickerPrice ?? null, grading_company: item.gradingCompany || null,
  grade: item.grade || null, certificate_number: item.certificateNumber || null, notes: item.notes || null,
  created_at: item.createdAt, updated_at: item.updatedAt
  , trade_percentage: item.tradePercentage ?? null, sold_price: item.soldPrice ?? null, bought_price: item.boughtPrice ?? null,
  created_sales_record_id: item.createdSalesRecordId || null, created_business_expense_id: item.createdBusinessExpenseId || null
});
const fromItem = (row: ItemRow, shares: TradeItemOwnershipShare[]): TradeItem => ({
  id: row.id, tradeTransactionId: row.transaction_id, inventoryPurchaseId: row.inventory_purchase_id || undefined,
  createdInventoryPurchaseId: row.created_inventory_purchase_id || undefined, priorInventoryPurchaseId: row.prior_inventory_purchase_id || undefined,
  direction: row.direction, itemName: row.item_name, itemType: row.item_type, quantity: Number(row.quantity || 1),
  marketValue: Number(row.market_value || 0), agreedTradeValue: Number(row.agreed_trade_value || 0),
  historicalCostBasis: Number(row.historical_cost_basis || 0), allocatedCostBasis: Number(row.allocated_cost_basis || 0),
  cashAllocation: row.cash_allocation == null ? undefined : Number(row.cash_allocation), imageUrl: row.image_url || undefined,
  imagePath: row.image_path || undefined, backImageUrl: row.back_image_url || undefined, backImagePath: row.back_image_path || undefined,
  collectorNumber: row.collector_number || undefined, cardSet: row.card_set || undefined, pokemonTcgCardId: row.pokemon_tcg_card_id || undefined,
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

export function getCachedTrades() { return read<TradeTransaction>(cacheKey); }

export async function listFinancialTransactions(transactionTypes?: TradeTransaction["transactionType"][]) {
  if (!isSupabaseConfigured || !supabase) {
    const values = read<TradeTransaction>(localKey);
    return transactionTypes?.length ? values.filter((row) => transactionTypes.includes(row.transactionType)) : values;
  }
  let transactionQuery = supabase.from("financial_transactions").select("*");
  if (transactionTypes?.length) transactionQuery = transactionQuery.in("transaction_type", transactionTypes);
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
    const image = imageRows.find((value) => value.transaction_item_id === row.id && value.image_type !== "back");
    const back = imageRows.find((value) => value.transaction_item_id === row.id && value.image_type === "back");
    const value = { ...fromItem(row, shareMap.get(row.id) || []), imageUrl: image?.image_url || row.image_url || undefined, imagePath: image?.image_path || row.image_path || undefined, backImageUrl: back?.image_url || row.back_image_url || undefined, backImagePath: back?.image_path || row.back_image_path || undefined };
    itemMap.set(row.transaction_id, [...(itemMap.get(row.transaction_id) || []), value]);
  });
  const paymentMap = new Map<string, { received: number; paid: number }>();
  (payments.data as PaymentRow[] || []).forEach((row) => {
    const current = paymentMap.get(row.transaction_id) || { received: 0, paid: 0 };
    current[row.direction] += Number(row.amount || 0);
    paymentMap.set(row.transaction_id, current);
  });
  const values = (transactions.data as TransactionRow[] || []).map((row): TradeTransaction => ({
    id: row.id, tradeDate: row.transaction_date, eventId: row.event_id || undefined, eventDayId: row.event_day_id || undefined,
    tradePartner: row.customer_or_seller || undefined, cashReceived: Number(row.cash_received ?? paymentMap.get(row.id)?.received ?? 0), cashPaid: Number(row.cash_paid ?? paymentMap.get(row.id)?.paid ?? 0),
    notes: row.notes || undefined, generalImageUrl: imageRows.find((value) => value.transaction_id === row.id && !value.transaction_item_id && value.image_type === "transaction")?.image_url,
    generalImagePath: imageRows.find((value) => value.transaction_id === row.id && !value.transaction_item_id && value.image_type === "transaction")?.image_path,
    proofImageUrl: imageRows.find((value) => value.transaction_id === row.id && !value.transaction_item_id && value.image_type === "proof")?.image_url,
    proofImagePath: imageRows.find((value) => value.transaction_id === row.id && !value.transaction_item_id && value.image_type === "proof")?.image_path, status: row.status,
    enteredByWorkerId: row.entered_by_worker_id || undefined, completedAt: row.completed_at || undefined, reversedAt: row.reversed_at || undefined,
    reversalOfTradeId: row.reversal_of_transaction_id || undefined, createdAt: row.created_at, updatedAt: row.updated_at, items: itemMap.get(row.id) || []
    , transactionType: row.transaction_type || "trade", itemMode: row.item_mode || "multiple", pricingMode: row.pricing_mode || "individual",
    bundleTotal: row.bundle_total == null ? undefined : Number(row.bundle_total), paymentMethod: row.payment_method || undefined,
    purchaseSource: row.purchase_source || undefined, expenseCategory: row.expense_category || undefined,
    paidByWorkerId: row.paid_by_worker_id || undefined, keepAsBundle: Boolean(row.keep_as_bundle)
  }));
  write(cacheKey, values);
  recordSupabaseRequest("financial_transactions", "listTrades", values.length);
  return values;
}

export function listTrades() {
  return listFinancialTransactions(["trade", "cash_trade"]);
}

export async function saveTrade(input: TradeTransaction) {
  const trade = { ...input, updatedAt: nowIso(), items: input.items.map((item) => ({ ...item, tradeTransactionId: input.id, updatedAt: nowIso() })) };
  if (!isSupabaseConfigured || !supabase) {
    const values = [trade, ...read<TradeTransaction>(localKey).filter((row) => row.id !== trade.id)];
    write(localKey, values); write(cacheKey, values); return trade;
  }
  const saved = await supabase.from("financial_transactions").upsert(transactionRow(trade)).select("id").single();
  if (saved.error) throw new Error(saved.error.message);
  const transactionId = saved.data.id as string;
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
    const itemResult = await supabase.from("financial_transaction_items").upsert(persistedTrade.items.map(itemRow));
    if (itemResult.error) throw new Error(itemResult.error.message);
    for (const item of persistedTrade.items) {
      const deletion = await supabase.from("transaction_item_ownership_shares").delete().eq("transaction_item_id", item.id);
      if (deletion.error) throw new Error(deletion.error.message);
      if (item.ownershipShares.length) {
        const result = await supabase.from("transaction_item_ownership_shares").insert(item.ownershipShares.map((share) => ({
          transaction_item_id: item.id, worker_id: share.workerId, ownership_percentage: share.ownershipPercentage,
          allocated_cost_basis: share.allocatedCostBasis ?? null, allocated_trade_value: share.allocatedTradeValue ?? null
        })));
        if (result.error) throw new Error(result.error.message);
      }
    }
  }
  const existingPayments = await supabase.from("transaction_payments").select("id,direction,payment_method").eq("transaction_id", transactionId);
  if (existingPayments.error) throw new Error(existingPayments.error.message);
  const paymentRows = [
    { direction: "received" as const, amount: Number(persistedTrade.cashReceived || 0) },
    { direction: "paid" as const, amount: Number(persistedTrade.cashPaid || 0) }
  ].map((payment) => ({
    id: existingPayments.data?.find((row) => row.direction === payment.direction && row.payment_method === (persistedTrade.paymentMethod || "cash"))?.id || id("payment"),
    transaction_id: transactionId, direction: payment.direction, payment_method: persistedTrade.paymentMethod || "cash",
    amount: payment.amount, worker_id: payment.direction === "paid" ? persistedTrade.paidByWorkerId || null : null, updated_at: persistedTrade.updatedAt
  }));
  const paymentResult = await supabase.from("transaction_payments").upsert(paymentRows);
  if (paymentResult.error) throw new Error(paymentResult.error.message);
  const imageRows = [
    persistedTrade.generalImageUrl && (persistedTrade.generalImagePath || transactionImagePath(persistedTrade.generalImageUrl)) ? { transaction_id: transactionId, transaction_item_id: null, image_type: "transaction", image_url: persistedTrade.generalImageUrl, image_path: persistedTrade.generalImagePath || transactionImagePath(persistedTrade.generalImageUrl)! } : null,
    persistedTrade.proofImageUrl && (persistedTrade.proofImagePath || transactionImagePath(persistedTrade.proofImageUrl)) ? { transaction_id: transactionId, transaction_item_id: null, image_type: "proof", image_url: persistedTrade.proofImageUrl, image_path: persistedTrade.proofImagePath || transactionImagePath(persistedTrade.proofImageUrl)! } : null,
    ...persistedTrade.items.flatMap((item) => [
      item.imageUrl && (item.imagePath || transactionImagePath(item.imageUrl)) ? { transaction_id: transactionId, transaction_item_id: item.id, image_type: "item", image_url: item.imageUrl, image_path: item.imagePath || transactionImagePath(item.imageUrl)! } : null,
      item.backImageUrl && (item.backImagePath || transactionImagePath(item.backImageUrl)) ? { transaction_id: transactionId, transaction_item_id: item.id, image_type: "back", image_url: item.backImageUrl, image_path: item.backImagePath || transactionImagePath(item.backImageUrl)! } : null
    ])
  ].filter(Boolean);
  if (imageRows.length) {
    const currentImages = await supabase.from("transaction_images").select("id,transaction_item_id,image_type").eq("transaction_id", transactionId);
    if (currentImages.error) throw new Error(currentImages.error.message);
    const withIds = imageRows.map((row) => ({ ...row!, id: currentImages.data?.find((value) => value.transaction_item_id === row!.transaction_item_id && value.image_type === row!.image_type)?.id || id("transaction-image"), updated_at: persistedTrade.updatedAt }));
    const imageResult = await supabase.from("transaction_images").upsert(withIds);
    if (imageResult.error) throw new Error(imageResult.error.message);
  }
  return persistedTrade;
}

function inventoryFromIncoming(item: TradeItem, trade: TradeTransaction): Partial<InventoryPurchase> {
  return {
    id: item.createdInventoryPurchaseId, itemName: item.itemName, category: item.itemType, quantity: item.quantity, quantitySold: 0,
    purchaseDate: trade.tradeDate, totalCost: item.allocatedCostBasis, marketValue: item.marketValue, purchaseSource: "trade",
    seller: trade.tradePartner, eventId: trade.eventId, purchasedByWorkerId: trade.enteredByWorkerId, status: "in_stock",
    isRawCard: item.itemType === "raw_card", cardName: item.itemName, collectorNumber: item.collectorNumber, cardSet: item.cardSet,
    pokemonTcgCardId: item.pokemonTcgCardId, cardCondition: item.cardCondition, stickerPrice: item.stickerPrice,
    gradingCompany: item.gradingCompany, grade: item.grade, certificateNumber: item.certificateNumber, imageUrl: item.imageUrl,
    imagePath: item.imagePath, frontImageUrl: item.imageUrl, frontImagePath: item.imagePath, backImageUrl: item.backImageUrl,
    backImagePath: item.backImagePath, notes: item.notes, acquisitionMethod: "trade", acquiredFinancialTransactionId: trade.id,
    agreedTradeValue: item.agreedTradeValue, priorInventoryPurchaseId: item.priorInventoryPurchaseId,
    financialTransactionId: trade.id, financialTransactionItemId: item.id
  };
}

export async function completeTrade(input: TradeTransaction, inventory: InventoryPurchase[]) {
  if (input.status !== "draft") throw new Error("Only a draft trade can be completed.");
  const outgoing = input.items.filter((item) => item.direction === "outgoing");
  const incoming = input.items.filter((item) => item.direction === "incoming");
  if (!outgoing.length || !incoming.length) throw new Error("A trade needs at least one item on each side.");
  const unavailable = outgoing.find((item) => inventory.find((row) => row.id === item.inventoryPurchaseId)?.status !== "in_stock");
  if (unavailable) throw new Error(`${unavailable.itemName} is no longer available.`);
  const timestamp = nowIso();
  let trade: TradeTransaction = { ...input, status: "draft", items: input.items.map((item) => item.direction === "incoming" ? { ...item, createdInventoryPurchaseId: item.createdInventoryPurchaseId || id("purchase") } : item) };
  await saveTrade(trade);
  for (const item of trade.items.filter((row) => row.direction === "outgoing")) {
    const source = inventory.find((row) => row.id === item.inventoryPurchaseId)!;
    await saveInventoryPurchase({ ...source, status: "traded_out", tradedAt: timestamp, disposedFinancialTransactionId: trade.id, financialTransactionId: trade.id, financialTransactionItemId: item.id });
  }
  const created: InventoryPurchase[] = [];
  for (const item of trade.items.filter((row) => row.direction === "incoming")) {
    const saved = await saveInventoryPurchase(inventoryFromIncoming(item, trade));
    if (item.ownershipShares.length) await saveInventoryOwnership(saved.id, item.ownershipShares);
    created.push({ ...saved, ownershipShares: item.ownershipShares });
  }
  const lineage: InventoryTradeLineage[] = [];
  for (const source of outgoing) for (const target of created) lineage.push({ id: id("lineage"), sourceInventoryPurchaseId: source.inventoryPurchaseId!, resultingInventoryPurchaseId: target.id, tradeTransactionId: trade.id, relationshipType: "exchanged_for", createdAt: timestamp });
  if (isSupabaseConfigured && supabase && lineage.length) {
    const result = await supabase.from("inventory_lineage").upsert(lineage.map((row) => ({ id: row.id, source_inventory_purchase_id: row.sourceInventoryPurchaseId, resulting_inventory_purchase_id: row.resultingInventoryPurchaseId, transaction_id: row.tradeTransactionId, relationship_type: row.relationshipType, created_at: row.createdAt })), { onConflict: "source_inventory_purchase_id,resulting_inventory_purchase_id,transaction_id" });
    if (result.error) throw new Error(result.error.message);
  } else write(lineageKey, [...lineage, ...read<InventoryTradeLineage>(lineageKey)]);
  trade = { ...trade, status: "completed", completedAt: timestamp, updatedAt: timestamp };
  await saveTrade(trade);
  return { trade, created };
}

export async function completeFinancialTransaction(input: TradeTransaction, inventory: InventoryPurchase[]) {
  if (input.transactionType === "trade" || input.transactionType === "cash_trade") return completeTrade(input, inventory);
  if (input.status !== "draft") throw new Error("Only a draft transaction can be completed.");
  const timestamp = nowIso();
  let transaction: TradeTransaction = { ...input, status: "draft" };
  await saveTrade(transaction);
  if (transaction.transactionType === "sale") {
    const items = transaction.items.filter((item) => item.direction === "outgoing");
    if (!items.length) throw new Error("Add at least one inventory item to the sale.");
    for (const item of items) {
      const source = inventory.find((row) => row.id === item.inventoryPurchaseId);
      if (!source || source.status !== "in_stock") throw new Error(`${item.itemName} is no longer available.`);
      const result = await createSaleRecord({
        eventId: transaction.eventId, eventDayId: transaction.eventDayId, imageUrl: item.imageUrl || transaction.generalImageUrl,
        imagePath: item.imagePath || transaction.generalImagePath, itemName: item.itemName, category: item.itemType, quantity: item.quantity,
        soldPrice: item.soldPrice || 0, boughtPrice: item.historicalCostBasis, marketValue: item.marketValue,
        paymentMethod: transaction.paymentMethod || "cash", soldByWorkerId: transaction.enteredByWorkerId,
        inventoryPurchaseId: source.id, notes: item.notes || transaction.notes, soldAt: transaction.tradeDate,
        financialTransactionId: transaction.id, financialTransactionItemId: item.id
      });
      item.createdSalesRecordId = result.sale.id;
      await saveInventoryPurchase({
        ...source, status: "sold", quantitySold: source.quantity, soldPrice: item.soldPrice || 0,
        soldDate: transaction.tradeDate, soldByWorkerId: transaction.enteredByWorkerId, soldEventId: transaction.eventId,
        soldPaymentMethod: transaction.paymentMethod, financialTransactionId: transaction.id, financialTransactionItemId: item.id
      });
    }
    transaction.cashReceived = transaction.items.reduce((sum, item) => sum + Number(item.soldPrice || 0), 0);
  } else if (transaction.transactionType === "purchase") {
    const items = transaction.items.filter((item) => item.direction === "incoming");
    if (!items.length) throw new Error("Add at least one purchased item.");
    for (const item of items) {
      const saved = await saveInventoryPurchase({
        itemName: item.itemName, category: item.itemType, quantity: item.quantity, quantitySold: 0, purchaseDate: transaction.tradeDate,
        totalCost: item.boughtPrice || item.allocatedCostBasis, marketValue: item.marketValue, isRawCard: item.itemType === "raw_card",
        purchaseSource: transaction.purchaseSource || "other", seller: transaction.tradePartner, eventId: transaction.eventId,
        purchasedByWorkerId: transaction.paidByWorkerId, notes: item.notes || transaction.notes, status: "in_stock",
        cardName: item.itemName, collectorNumber: item.collectorNumber, cardSet: item.cardSet, pokemonTcgCardId: item.pokemonTcgCardId,
        cardCondition: item.cardCondition, stickerPrice: item.stickerPrice, gradingCompany: item.gradingCompany, grade: item.grade,
        certificateNumber: item.certificateNumber, imageUrl: item.imageUrl || transaction.generalImageUrl, imagePath: item.imagePath,
        acquisitionMethod: "purchased", financialTransactionId: transaction.id, financialTransactionItemId: item.id
      });
      item.createdInventoryPurchaseId = saved.id;
      if (item.ownershipShares.length) await saveInventoryOwnership(saved.id, item.ownershipShares);
    }
    transaction.cashPaid = transaction.items.reduce((sum, item) => sum + Number(item.boughtPrice || item.allocatedCostBasis || 0), 0);
  } else {
    const amount = transaction.bundleTotal ?? transaction.cashPaid;
    const expense = await saveBusinessExpense({
      expenseDate: transaction.tradeDate, amount, category: transaction.expenseCategory || "other",
      description: transaction.items[0]?.itemName || transaction.notes || "Business expense", eventId: transaction.eventId,
      paidByWorkerId: transaction.paidByWorkerId, vendor: transaction.tradePartner, receiptImageUrl: transaction.generalImageUrl,
      receiptImagePath: transaction.generalImagePath, notes: transaction.notes, financialTransactionId: transaction.id,
      financialTransactionItemId: transaction.items[0]?.id
    });
    if (transaction.items[0]) transaction.items[0].createdBusinessExpenseId = expense.id;
    transaction.cashPaid = amount;
  }
  transaction = { ...transaction, status: "completed", completedAt: timestamp, updatedAt: timestamp };
  await saveTrade(transaction);
  const balances = transactionReview(transaction).internalBalances;
  if (isSupabaseConfigured && supabase && balances.length) {
    const balanceResult = await supabase.from("transaction_internal_balances").upsert(balances.map((row) => ({
      transaction_id: transaction.id, owed_by_worker_id: row.owedByWorkerId, owed_to_worker_id: row.owedToWorkerId,
      amount: row.amount, settled: false, updated_at: timestamp
    })), { onConflict: "transaction_id,owed_by_worker_id,owed_to_worker_id" });
    if (balanceResult.error) throw new Error(balanceResult.error.message);
  }
  return { trade: transaction, created: [] as InventoryPurchase[] };
}

export async function reverseTrade(input: TradeTransaction, inventory: InventoryPurchase[]) {
  if (input.status !== "completed") throw new Error("Only a completed trade can be reversed.");
  const timestamp = nowIso();
  for (const item of input.items.filter((row) => row.direction === "outgoing")) {
    const source = inventory.find((row) => row.id === item.inventoryPurchaseId);
    if (source?.status === "traded_out" && source.disposedFinancialTransactionId === input.id) await saveInventoryPurchase({ ...source, status: "in_stock", tradedAt: undefined, disposedFinancialTransactionId: undefined });
  }
  for (const item of input.items.filter((row) => row.direction === "incoming")) {
    const received = inventory.find((row) => row.id === item.createdInventoryPurchaseId);
    if (received) await saveInventoryPurchase({ ...received, status: "reversed" });
  }
  const trade = { ...input, status: "reversed" as const, reversedAt: timestamp, updatedAt: timestamp };
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
