import type { InventoryPurchase, InventoryTradeLineage, TradeItem, TradeItemOwnershipShare, TradeTransaction } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, recordSupabaseRequest, supabase } from "../../utils/supabase";
import { saveInventoryPurchase } from "./inventoryPurchaseRepository";
import { saveInventoryOwnership } from "./ownershipRepository";

const localKey = "4nerds_trade_transactions_local_v1";
const cacheKey = "4nerds_trade_transactions_cache_v1";
const lineageKey = "4nerds_trade_lineage_local_v1";

const read = <T>(key: string): T[] => { try { return JSON.parse(localStorage.getItem(key) || "[]") as T[]; } catch { return []; } };
const write = (key: string, values: unknown[]) => { try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* optional cache */ } };

type TransactionRow = {
  id: string; trade_date: string; event_id?: string | null; event_day_id?: string | null; trade_partner?: string | null;
  cash_received: number; cash_paid: number; notes?: string | null; general_image_url?: string | null; general_image_path?: string | null;
  proof_image_url?: string | null; proof_image_path?: string | null; status: TradeTransaction["status"]; entered_by_worker_id?: string | null;
  completed_at?: string | null; reversed_at?: string | null; reversal_of_trade_id?: string | null; created_at: string; updated_at: string;
};
type ItemRow = {
  id: string; trade_transaction_id: string; inventory_purchase_id?: string | null; created_inventory_purchase_id?: string | null;
  prior_inventory_purchase_id?: string | null; direction: TradeItem["direction"]; item_name: string; item_type: TradeItem["itemType"];
  quantity: number; market_value: number; agreed_trade_value: number; historical_cost_basis: number; allocated_cost_basis: number;
  cash_allocation?: number | null; image_url?: string | null; image_path?: string | null; back_image_url?: string | null; back_image_path?: string | null;
  collector_number?: string | null; card_set?: string | null; pokemon_tcg_card_id?: string | null; card_condition?: TradeItem["cardCondition"] | null;
  sticker_price?: number | null; grading_company?: string | null; grade?: string | null; certificate_number?: string | null;
  notes?: string | null; created_at: string; updated_at: string;
};
type ShareRow = { id?: string; trade_item_id: string; worker_id: string; ownership_percentage: number; allocated_cost_basis?: number | null; allocated_trade_value?: number | null };

const transactionRow = (trade: TradeTransaction): TransactionRow => ({
  id: trade.id, trade_date: trade.tradeDate, event_id: trade.eventId || null, event_day_id: trade.eventDayId || null,
  trade_partner: trade.tradePartner || null, cash_received: Number(trade.cashReceived || 0), cash_paid: Number(trade.cashPaid || 0),
  notes: trade.notes || null, general_image_url: trade.generalImageUrl || null, general_image_path: trade.generalImagePath || null,
  proof_image_url: trade.proofImageUrl || null, proof_image_path: trade.proofImagePath || null, status: trade.status,
  entered_by_worker_id: trade.enteredByWorkerId || null, completed_at: trade.completedAt || null, reversed_at: trade.reversedAt || null,
  reversal_of_trade_id: trade.reversalOfTradeId || null, created_at: trade.createdAt, updated_at: trade.updatedAt
});
const itemRow = (item: TradeItem): ItemRow => ({
  id: item.id, trade_transaction_id: item.tradeTransactionId, inventory_purchase_id: item.inventoryPurchaseId || null,
  created_inventory_purchase_id: item.createdInventoryPurchaseId || null, prior_inventory_purchase_id: item.priorInventoryPurchaseId || null,
  direction: item.direction, item_name: item.itemName, item_type: item.itemType, quantity: item.quantity,
  market_value: item.marketValue, agreed_trade_value: item.agreedTradeValue, historical_cost_basis: item.historicalCostBasis,
  allocated_cost_basis: item.allocatedCostBasis, cash_allocation: item.cashAllocation ?? null, image_url: item.imageUrl || null,
  image_path: item.imagePath || null, back_image_url: item.backImageUrl || null, back_image_path: item.backImagePath || null,
  collector_number: item.collectorNumber || null, card_set: item.cardSet || null, pokemon_tcg_card_id: item.pokemonTcgCardId || null,
  card_condition: item.cardCondition || null, sticker_price: item.stickerPrice ?? null, grading_company: item.gradingCompany || null,
  grade: item.grade || null, certificate_number: item.certificateNumber || null, notes: item.notes || null,
  created_at: item.createdAt, updated_at: item.updatedAt
});
const fromItem = (row: ItemRow, shares: TradeItemOwnershipShare[]): TradeItem => ({
  id: row.id, tradeTransactionId: row.trade_transaction_id, inventoryPurchaseId: row.inventory_purchase_id || undefined,
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
});

export function blankTrade(): TradeTransaction {
  const timestamp = nowIso();
  return { id: id("trade"), tradeDate: timestamp, cashReceived: 0, cashPaid: 0, status: "draft", createdAt: timestamp, updatedAt: timestamp, items: [] };
}

export function blankTradeItem(tradeId: string, direction: TradeItem["direction"]): TradeItem {
  const timestamp = nowIso();
  return { id: id("trade-item"), tradeTransactionId: tradeId, direction, itemName: "", itemType: "raw_card", quantity: 1, marketValue: 0, agreedTradeValue: 0, historicalCostBasis: 0, allocatedCostBasis: 0, ownershipShares: [], createdAt: timestamp, updatedAt: timestamp };
}

export function getCachedTrades() { return read<TradeTransaction>(cacheKey); }

export async function listTrades() {
  if (!isSupabaseConfigured || !supabase) return read<TradeTransaction>(localKey);
  const transactions = await supabase.from("trade_transactions").select("*").order("trade_date", { ascending: false });
  if (transactions.error) throw new Error(transactions.error.message);
  const ids = (transactions.data || []).map((row) => row.id);
  const items = ids.length ? await supabase.from("trade_items").select("*").in("trade_transaction_id", ids) : { data: [], error: null };
  if (items.error) throw new Error(items.error.message);
  const itemIds = (items.data || []).map((row) => row.id);
  const shares = itemIds.length ? await supabase.from("trade_item_ownership_shares").select("*").in("trade_item_id", itemIds) : { data: [], error: null };
  if (shares.error) throw new Error(shares.error.message);
  const shareMap = new Map<string, TradeItemOwnershipShare[]>();
  (shares.data as ShareRow[] || []).forEach((row) => shareMap.set(row.trade_item_id, [...(shareMap.get(row.trade_item_id) || []), {
    id: row.id, workerId: row.worker_id, ownershipPercentage: Number(row.ownership_percentage),
    allocatedCostBasis: row.allocated_cost_basis == null ? undefined : Number(row.allocated_cost_basis),
    allocatedTradeValue: row.allocated_trade_value == null ? undefined : Number(row.allocated_trade_value)
  }]));
  const itemMap = new Map<string, TradeItem[]>();
  (items.data as ItemRow[] || []).forEach((row) => itemMap.set(row.trade_transaction_id, [...(itemMap.get(row.trade_transaction_id) || []), fromItem(row, shareMap.get(row.id) || [])]));
  const values = (transactions.data as TransactionRow[] || []).map((row): TradeTransaction => ({
    id: row.id, tradeDate: row.trade_date, eventId: row.event_id || undefined, eventDayId: row.event_day_id || undefined,
    tradePartner: row.trade_partner || undefined, cashReceived: Number(row.cash_received || 0), cashPaid: Number(row.cash_paid || 0),
    notes: row.notes || undefined, generalImageUrl: row.general_image_url || undefined, generalImagePath: row.general_image_path || undefined,
    proofImageUrl: row.proof_image_url || undefined, proofImagePath: row.proof_image_path || undefined, status: row.status,
    enteredByWorkerId: row.entered_by_worker_id || undefined, completedAt: row.completed_at || undefined, reversedAt: row.reversed_at || undefined,
    reversalOfTradeId: row.reversal_of_trade_id || undefined, createdAt: row.created_at, updatedAt: row.updated_at, items: itemMap.get(row.id) || []
  }));
  write(cacheKey, values);
  recordSupabaseRequest("trade_transactions", "listTrades", values.length);
  return values;
}

export async function saveTrade(input: TradeTransaction) {
  const trade = { ...input, updatedAt: nowIso(), items: input.items.map((item) => ({ ...item, tradeTransactionId: input.id, updatedAt: nowIso() })) };
  if (!isSupabaseConfigured || !supabase) {
    const values = [trade, ...read<TradeTransaction>(localKey).filter((row) => row.id !== trade.id)];
    write(localKey, values); write(cacheKey, values); return trade;
  }
  const saved = await supabase.from("trade_transactions").upsert(transactionRow(trade));
  if (saved.error) throw new Error(saved.error.message);
  if (trade.status === "draft") {
    const existing = await supabase.from("trade_items").select("id").eq("trade_transaction_id", trade.id);
    if (existing.error) throw new Error(existing.error.message);
    const activeIds = new Set(trade.items.map((item) => item.id));
    const removedIds = (existing.data || []).map((row) => row.id).filter((itemId) => !activeIds.has(itemId));
    if (removedIds.length) {
      const removed = await supabase.from("trade_items").delete().in("id", removedIds);
      if (removed.error) throw new Error(removed.error.message);
    }
  }
  if (trade.items.length) {
    const itemResult = await supabase.from("trade_items").upsert(trade.items.map(itemRow));
    if (itemResult.error) throw new Error(itemResult.error.message);
    for (const item of trade.items) {
      const deletion = await supabase.from("trade_item_ownership_shares").delete().eq("trade_item_id", item.id);
      if (deletion.error) throw new Error(deletion.error.message);
      if (item.ownershipShares.length) {
        const result = await supabase.from("trade_item_ownership_shares").insert(item.ownershipShares.map((share) => ({
          trade_item_id: item.id, worker_id: share.workerId, ownership_percentage: share.ownershipPercentage,
          allocated_cost_basis: share.allocatedCostBasis ?? null, allocated_trade_value: share.allocatedTradeValue ?? null
        })));
        if (result.error) throw new Error(result.error.message);
      }
    }
  }
  return trade;
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
    backImagePath: item.backImagePath, notes: item.notes, acquisitionMethod: "trade", acquiredTradeTransactionId: trade.id,
    agreedTradeValue: item.agreedTradeValue, priorInventoryPurchaseId: item.priorInventoryPurchaseId
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
    await saveInventoryPurchase({ ...source, status: "traded_out", tradedAt: timestamp, disposedTradeTransactionId: trade.id });
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
    const result = await supabase.from("inventory_trade_lineage").upsert(lineage.map((row) => ({ id: row.id, source_inventory_purchase_id: row.sourceInventoryPurchaseId, resulting_inventory_purchase_id: row.resultingInventoryPurchaseId, trade_transaction_id: row.tradeTransactionId, relationship_type: row.relationshipType, created_at: row.createdAt })), { onConflict: "source_inventory_purchase_id,resulting_inventory_purchase_id,trade_transaction_id" });
    if (result.error) throw new Error(result.error.message);
  } else write(lineageKey, [...lineage, ...read<InventoryTradeLineage>(lineageKey)]);
  trade = { ...trade, status: "completed", completedAt: timestamp, updatedAt: timestamp };
  await saveTrade(trade);
  return { trade, created };
}

export async function reverseTrade(input: TradeTransaction, inventory: InventoryPurchase[]) {
  if (input.status !== "completed") throw new Error("Only a completed trade can be reversed.");
  const timestamp = nowIso();
  for (const item of input.items.filter((row) => row.direction === "outgoing")) {
    const source = inventory.find((row) => row.id === item.inventoryPurchaseId);
    if (source?.status === "traded_out" && source.disposedTradeTransactionId === input.id) await saveInventoryPurchase({ ...source, status: "in_stock", tradedAt: undefined, disposedTradeTransactionId: undefined });
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
    supabase.from("inventory_trade_lineage").select("*").eq("source_inventory_purchase_id", inventoryId),
    supabase.from("inventory_trade_lineage").select("*").eq("resulting_inventory_purchase_id", inventoryId)
  ]);
  if (source.error || result.error) throw new Error((source.error || result.error)!.message);
  return [...(source.data || []), ...(result.data || [])].map((row): InventoryTradeLineage => ({ id: row.id, sourceInventoryPurchaseId: row.source_inventory_purchase_id, resultingInventoryPurchaseId: row.resulting_inventory_purchase_id, tradeTransactionId: row.trade_transaction_id, relationshipType: "exchanged_for", createdAt: row.created_at }));
}
