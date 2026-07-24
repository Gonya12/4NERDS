import type { InventoryPurchase, InventoryStatus, PokemonProductCategory, PurchaseSource } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, recordSupabaseRequest, setSupabaseStatus, startSupabaseQueryTrace, supabase } from "../../utils/supabase";
import { fileToDataUrl, uploadFinancialImage } from "../images/saleImageService";

const localKey = "4nerds_inventory_purchases_local_v1";
const cacheKey = "4nerds_inventory_purchases_cache_v1";

type PurchaseRow = {
  id: string;
  image_url?: string | null;
  image_path?: string | null;
  item_name: string;
  category: PokemonProductCategory;
  quantity: number;
  quantity_sold?: number | null;
  purchase_date: string;
  total_cost: number;
  market_value?: number | null;
  is_raw_card: boolean;
  buy_percentage?: number | null;
  target_buy_price?: number | null;
  purchase_source?: PurchaseSource | null;
  seller?: string | null;
  event_id?: string | null;
  purchased_by_worker_id?: string | null;
  notes?: string | null;
  status: InventoryStatus;
  sold_price?: number | null;
  sold_date?: string | null;
  sold_by_worker_id?: string | null;
  sold_event_id?: string | null;
  sold_payment_method?: InventoryPurchase["soldPaymentMethod"] | null;
  buyer_note?: string | null;
  card_name?: string | null;
  collector_number?: string | null;
  card_set?: string | null;
  card_language?: string | null;
  card_condition?: InventoryPurchase["cardCondition"] | null;
  sticker_price?: number | null;
  grading_company?: string | null;
  grade?: string | null;
  certificate_number?: string | null;
  front_image_url?: string | null;
  front_image_path?: string | null;
  back_image_url?: string | null;
  back_image_path?: string | null;
  scan_confidence?: InventoryPurchase["scanConfidence"] | null;
  scan_status?: InventoryPurchase["scanStatus"] | null;
  image_hash?: string | null;
  scan_result?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: PurchaseRow): InventoryPurchase {
  return {
    id: row.id,
    imageUrl: row.image_url || undefined,
    imagePath: row.image_path || undefined,
    itemName: row.item_name,
    category: row.category || "other_pokemon_product",
    quantity: Number(row.quantity || 1),
    quantitySold: Math.max(0, Number(row.quantity_sold || 0)),
    purchaseDate: row.purchase_date,
    totalCost: Number(row.total_cost || 0),
    marketValue: row.market_value === null || row.market_value === undefined ? undefined : Number(row.market_value),
    isRawCard: Boolean(row.is_raw_card),
    buyPercentage: row.buy_percentage === null || row.buy_percentage === undefined ? undefined : Number(row.buy_percentage),
    targetBuyPrice: row.target_buy_price === null || row.target_buy_price === undefined ? undefined : Number(row.target_buy_price),
    purchaseSource: row.purchase_source || undefined,
    seller: row.seller || undefined,
    eventId: row.event_id || undefined,
    purchasedByWorkerId: row.purchased_by_worker_id || undefined,
    notes: row.notes || undefined,
    status: row.status || "in_stock",
    soldPrice: row.sold_price === null || row.sold_price === undefined ? undefined : Number(row.sold_price),
    soldDate: row.sold_date || undefined,
    soldByWorkerId: row.sold_by_worker_id || undefined,
    soldEventId: row.sold_event_id || undefined,
    soldPaymentMethod: row.sold_payment_method || undefined,
    buyerNote: row.buyer_note || undefined,
    cardName: row.card_name || undefined,
    collectorNumber: row.collector_number || undefined,
    cardSet: row.card_set || undefined,
    cardLanguage: row.card_language || undefined,
    cardCondition: row.card_condition || undefined,
    stickerPrice: row.sticker_price == null ? undefined : Number(row.sticker_price),
    gradingCompany: row.grading_company || undefined,
    grade: row.grade || undefined,
    certificateNumber: row.certificate_number || undefined,
    frontImageUrl: row.front_image_url || undefined,
    frontImagePath: row.front_image_path || undefined,
    backImageUrl: row.back_image_url || undefined,
    backImagePath: row.back_image_path || undefined,
    scanConfidence: row.scan_confidence || undefined,
    scanStatus: row.scan_status || "not_scanned",
    imageHash: row.image_hash || undefined,
    scanResult: row.scan_result || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(value: InventoryPurchase): PurchaseRow {
  return {
    id: value.id,
    image_url: value.imageUrl || null,
    image_path: value.imagePath || null,
    item_name: value.itemName,
    category: value.category,
    quantity: Number(value.quantity || 1),
    quantity_sold: Math.max(0, Number(value.quantitySold || 0)),
    purchase_date: value.purchaseDate,
    total_cost: Number(value.totalCost || 0),
    market_value: value.marketValue ?? null,
    is_raw_card: Boolean(value.isRawCard),
    buy_percentage: value.buyPercentage ?? null,
    target_buy_price: value.targetBuyPrice ?? null,
    purchase_source: value.purchaseSource || null,
    seller: value.seller || null,
    event_id: value.eventId || null,
    purchased_by_worker_id: value.purchasedByWorkerId || null,
    notes: value.notes || null,
    status: value.status,
    sold_price: value.soldPrice ?? null,
    sold_date: value.soldDate || null,
    sold_by_worker_id: value.soldByWorkerId || null,
    sold_event_id: value.soldEventId || null,
    sold_payment_method: value.soldPaymentMethod || null,
    buyer_note: value.buyerNote || null,
    card_name: value.cardName || null,
    collector_number: value.collectorNumber || null,
    card_set: value.cardSet || null,
    card_language: value.cardLanguage || null,
    card_condition: value.cardCondition || null,
    sticker_price: value.stickerPrice ?? null,
    grading_company: value.gradingCompany || null,
    grade: value.grade || null,
    certificate_number: value.certificateNumber || null,
    front_image_url: value.frontImageUrl || value.imageUrl || null,
    front_image_path: value.frontImagePath || value.imagePath || null,
    back_image_url: value.backImageUrl || null,
    back_image_path: value.backImagePath || null,
    scan_confidence: value.scanConfidence || null,
    scan_status: value.scanStatus || "not_scanned",
    image_hash: value.imageHash || null,
    scan_result: value.scanResult || null,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}

function read(key: string) {
  try { return JSON.parse(localStorage.getItem(key) || "[]") as InventoryPurchase[]; } catch { return []; }
}

function write(key: string, values: InventoryPurchase[]) {
  try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* Cache is optional. */ }
}

export function getCachedInventoryPurchases() {
  return read(cacheKey);
}

export async function listInventoryPurchases(limit = 100) {
  if (!isSupabaseConfigured || !supabase) return read(localKey);
  const columns = "id,image_url,image_path,item_name,category,quantity,quantity_sold,purchase_date,total_cost,market_value,is_raw_card,buy_percentage,target_buy_price,purchase_source,seller,event_id,purchased_by_worker_id,notes,status,sold_price,sold_date,sold_by_worker_id,sold_event_id,sold_payment_method,buyer_note,card_name,collector_number,card_set,card_language,card_condition,sticker_price,grading_company,grade,certificate_number,front_image_url,front_image_path,back_image_url,back_image_path,scan_confidence,scan_status,image_hash,created_at,updated_at";
  const completeTrace = startSupabaseQueryTrace("inventory_purchases", "listInventoryPurchases", columns);
  const { data, error } = await supabase.from("inventory_purchases")
    .select(columns)
    .order("purchase_date", { ascending: false }).limit(limit);
  completeTrace(data?.length || 0, error);
  recordSupabaseRequest("inventory_purchases", "listInventoryPurchases", data?.length || 0);
  if (error) throw new Error(error.message);
  const values = (data || []).map((row) => fromRow(row as PurchaseRow));
  write(cacheKey, values);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return values;
}

export async function saveInventoryPurchase(input: Partial<InventoryPurchase>, imageFile?: File, backImageFile?: File) {
  const timestamp = nowIso();
  const recordId = input.id || id("purchase");
  let imageUrl = input.imageUrl;
  let imagePath = input.imagePath;
  let backImageUrl = input.backImageUrl;
  let backImagePath = input.backImagePath;
  if (imageFile) {
    if (isSupabaseConfigured && supabase) {
      const uploaded = await uploadFinancialImage(imageFile, "purchases", recordId);
      imageUrl = uploaded.imageUrl;
      imagePath = uploaded.imagePath;
    } else {
      imageUrl = await fileToDataUrl(imageFile);
      imagePath = undefined;
    }
  }
  if (backImageFile) {
    if (isSupabaseConfigured && supabase) {
      const uploaded = await uploadFinancialImage(backImageFile, "purchases", `${recordId}-back`);
      backImageUrl = uploaded.imageUrl;
      backImagePath = uploaded.imagePath;
    } else {
      backImageUrl = await fileToDataUrl(backImageFile);
      backImagePath = undefined;
    }
  }
  const value: InventoryPurchase = {
    id: recordId,
    imageUrl,
    imagePath,
    itemName: input.itemName?.trim() || "Untitled Pokemon item",
    category: input.category || "other_pokemon_product",
    quantity: Math.max(1, Number(input.quantity || 1)),
    quantitySold: Math.min(Math.max(0, Number(input.quantitySold || 0)), Math.max(1, Number(input.quantity || 1))),
    purchaseDate: input.purchaseDate || timestamp,
    totalCost: Number(input.totalCost || 0),
    marketValue: input.marketValue,
    isRawCard: Boolean(input.isRawCard),
    buyPercentage: input.buyPercentage,
    targetBuyPrice: input.targetBuyPrice,
    purchaseSource: input.purchaseSource,
    seller: input.seller?.trim() || undefined,
    eventId: input.eventId,
    purchasedByWorkerId: input.purchasedByWorkerId,
    notes: input.notes?.trim() || undefined,
    status: input.status || "in_stock",
    soldPrice: input.soldPrice,
    soldDate: input.soldDate,
    soldByWorkerId: input.soldByWorkerId,
    soldEventId: input.soldEventId,
    soldPaymentMethod: input.soldPaymentMethod,
    buyerNote: input.buyerNote?.trim() || undefined,
    cardName: input.cardName?.trim() || undefined,
    collectorNumber: input.collectorNumber?.trim() || undefined,
    cardSet: input.cardSet?.trim() || undefined,
    cardLanguage: input.cardLanguage?.trim() || undefined,
    cardCondition: input.cardCondition,
    stickerPrice: input.stickerPrice,
    gradingCompany: input.gradingCompany?.trim() || undefined,
    grade: input.grade?.trim() || undefined,
    certificateNumber: input.certificateNumber?.trim() || undefined,
    frontImageUrl: input.frontImageUrl || imageUrl,
    frontImagePath: input.frontImagePath || imagePath,
    backImageUrl,
    backImagePath,
    scanConfidence: input.scanConfidence,
    scanStatus: input.scanStatus || "not_scanned",
    imageHash: input.imageHash,
    scanResult: input.scanResult,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp
  };
  if (!isSupabaseConfigured || !supabase) {
    const values = [value, ...read(localKey).filter((item) => item.id !== value.id)];
    write(localKey, values);
    write(cacheKey, values);
    return value;
  }
  const { data, error } = await supabase.from("inventory_purchases").upsert(toRow(value)).select("*").single();
  recordSupabaseRequest("inventory_purchases", "saveInventoryPurchase", data ? 1 : 0);
  if (error) throw new Error(error.message);
  return fromRow(data as PurchaseRow);
}

export async function deleteInventoryPurchase(recordId: string) {
  write(localKey, read(localKey).filter((item) => item.id !== recordId));
  write(cacheKey, read(cacheKey).filter((item) => item.id !== recordId));
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("inventory_purchases").delete().eq("id", recordId);
  recordSupabaseRequest("inventory_purchases", "deleteInventoryPurchase");
  if (error) throw new Error(error.message);
}
