import type { PokemonProductCategory, PurchaseSource, SalePaymentMethod, SalesRecord } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, recordSupabaseRequest, setSupabaseStatus, startSupabaseQueryTrace, supabase } from "../../utils/supabase";
import { fileToDataUrl, uploadSaleImage } from "../images/saleImageService";

const pendingKey = "4nerds_pending_sales_v1";
const cacheKey = "4nerds_sales_cache_v1";

type SalesRow = {
  id: string;
  event_id?: string | null;
  event_day_id?: string | null;
  image_url?: string | null;
  image_path?: string | null;
  item_name?: string | null;
  category?: PokemonProductCategory | null;
  quantity?: number | null;
  sold_price?: number | null;
  bought_price?: number | null;
  market_value?: number | null;
  bought_from?: string | null;
  purchase_source?: PurchaseSource | null;
  payment_method?: SalePaymentMethod | null;
  sold_by_worker_id?: string | null;
  is_raw_card?: boolean | null;
  buy_percentage?: number | null;
  target_buy_price?: number | null;
  inventory_purchase_id?: string | null;
  notes?: string | null;
  sold_at: string;
  pending_upload: boolean;
  created_at: string;
  updated_at: string;
};

function fromRow(row: SalesRow): SalesRecord {
  return {
    id: row.id,
    eventId: row.event_id || undefined,
    eventDayId: row.event_day_id || undefined,
    imageUrl: row.image_url || undefined,
    imagePath: row.image_path || undefined,
    itemName: row.item_name || undefined,
    category: row.category || undefined,
    quantity: Number(row.quantity || 1),
    soldPrice: row.sold_price === null || row.sold_price === undefined ? undefined : Number(row.sold_price),
    boughtPrice: row.bought_price === null || row.bought_price === undefined ? undefined : Number(row.bought_price),
    marketValue: row.market_value === null || row.market_value === undefined ? undefined : Number(row.market_value),
    boughtFrom: row.bought_from || undefined,
    purchaseSource: row.purchase_source || undefined,
    paymentMethod: row.payment_method || undefined,
    soldByWorkerId: row.sold_by_worker_id || undefined,
    isRawCard: Boolean(row.is_raw_card),
    buyPercentage: row.buy_percentage === null || row.buy_percentage === undefined ? undefined : Number(row.buy_percentage),
    targetBuyPrice: row.target_buy_price === null || row.target_buy_price === undefined ? undefined : Number(row.target_buy_price),
    inventoryPurchaseId: row.inventory_purchase_id || undefined,
    notes: row.notes || undefined,
    soldAt: row.sold_at,
    pendingUpload: Boolean(row.pending_upload),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(sale: SalesRecord): SalesRow {
  return {
    id: sale.id,
    event_id: sale.eventId || null,
    event_day_id: sale.eventDayId || null,
    image_url: sale.imageUrl || null,
    image_path: sale.imagePath || null,
    item_name: sale.itemName || null,
    category: sale.category || null,
    quantity: Number(sale.quantity || 1),
    sold_price: sale.soldPrice ?? null,
    bought_price: sale.boughtPrice ?? null,
    market_value: sale.marketValue ?? null,
    bought_from: sale.boughtFrom || null,
    purchase_source: sale.purchaseSource || null,
    payment_method: sale.paymentMethod || null,
    sold_by_worker_id: sale.soldByWorkerId || null,
    is_raw_card: Boolean(sale.isRawCard),
    buy_percentage: sale.buyPercentage ?? null,
    target_buy_price: sale.targetBuyPrice ?? null,
    inventory_purchase_id: sale.inventoryPurchaseId || null,
    notes: sale.notes || null,
    sold_at: sale.soldAt,
    pending_upload: sale.pendingUpload,
    created_at: sale.createdAt,
    updated_at: sale.updatedAt
  };
}

function pendingSales() {
  try {
    return JSON.parse(localStorage.getItem(pendingKey) || "[]") as SalesRecord[];
  } catch {
    return [] as SalesRecord[];
  }
}

function savePendingSales(sales: SalesRecord[]) {
  localStorage.setItem(pendingKey, JSON.stringify(sales));
}

export function listPendingSales() {
  return pendingSales();
}

export function getCachedSalesRecords() {
  try {
    return JSON.parse(localStorage.getItem(cacheKey) || "[]") as SalesRecord[];
  } catch {
    return [] as SalesRecord[];
  }
}

export async function listSalesRecords() {
  return (await listSalesRecordsPage(0, 50)).records;
}

export async function listSalesRecordsPage(page = 0, pageSize = 50) {
  const localPending = pendingSales();
  if (!isSupabaseConfigured || !supabase) return { records: localPending, hasMore: false };
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const columns = "id,event_id,event_day_id,image_url,image_path,item_name,category,quantity,sold_price,bought_price,market_value,bought_from,purchase_source,payment_method,sold_by_worker_id,is_raw_card,buy_percentage,target_buy_price,inventory_purchase_id,notes,sold_at,pending_upload,created_at,updated_at";
  const completeTrace = startSupabaseQueryTrace("sales_records", "listSalesRecordsPage", columns);
  const extended = await supabase
    .from("sales_records")
    .select(columns)
    .order("sold_at", { ascending: false })
    .range(from, to);
  let data = extended.data as unknown as SalesRow[] | null;
  let error = extended.error;
  completeTrace(data?.length || 0, error);
  recordSupabaseRequest("sales_records", "listSalesRecordsPage", data?.length || 0);
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    const legacy = await supabase
      .from("sales_records")
      .select("id,event_id,event_day_id,image_url,image_path,item_name,sold_price,bought_price,bought_from,notes,sold_at,pending_upload,created_at,updated_at")
      .order("sold_at", { ascending: false })
      .range(from, to);
    data = legacy.data as unknown as SalesRow[] | null;
    error = legacy.error;
    recordSupabaseRequest("sales_records", "listSalesRecordsPage:legacyFallback", data?.length || 0);
  }
  if (error) throwSupabase(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  const remote = (data || []).map((row) => fromRow(row as SalesRow));
  const records = page === 0 ? [...localPending, ...remote] : remote;
  if (page === 0) {
    try { localStorage.setItem(cacheKey, JSON.stringify(records)); } catch { /* Cache is optional. */ }
  }
  return { records, hasMore: remote.length === pageSize };
}

export async function listSalesRecordsForEvent(eventId: string) {
  const localPending = pendingSales().filter((sale) => sale.eventId === eventId);
  if (!isSupabaseConfigured || !supabase) return localPending;
  const { data, error } = await supabase.from("sales_records").select("*").eq("event_id", eventId).order("sold_at", { ascending: false });
  recordSupabaseRequest("sales_records", "listSalesRecordsForEvent", data?.length || 0);
  if (error) throwSupabase(error.message);
  return [...localPending, ...(data || []).map((row) => fromRow(row as SalesRow))];
}

export async function saveSaleRecord(sale: SalesRecord) {
  const saved = { ...sale, updatedAt: nowIso() };
  if (!isSupabaseConfigured || !supabase || saved.pendingUpload) {
    savePendingSales([saved, ...pendingSales().filter((item) => item.id !== saved.id)]);
    return saved;
  }
  const { data, error } = await supabase.from("sales_records").upsert(toRow(saved)).select("*").single();
  recordSupabaseRequest("sales_records", "saveSaleRecord", data ? 1 : 0);
  if (error) throwSupabase(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return fromRow(data as SalesRow);
}

export async function createSaleRecord(input: Partial<SalesRecord>, imageFile?: File) {
  const timestamp = nowIso();
  const saleId = input.id || id("sale");
  let imageUrl = input.imageUrl;
  let imagePath = input.imagePath;
  let pendingUpload = false;
  let localMessage = "";

  if (imageFile) {
    try {
      const uploaded = await uploadSaleImage(imageFile, saleId);
      imageUrl = uploaded.imageUrl;
      imagePath = uploaded.imagePath;
    } catch {
      imageUrl = await fileToDataUrl(imageFile);
      pendingUpload = true;
      localMessage = "Saved locally, will upload when connection improves.";
    }
  }

  const sale: SalesRecord = {
    id: saleId,
    eventId: input.eventId,
    eventDayId: input.eventDayId,
    imageUrl,
    imagePath,
    itemName: input.itemName,
    category: input.category,
    quantity: Number(input.quantity || 1),
    soldPrice: input.soldPrice,
    boughtPrice: input.boughtPrice,
    marketValue: input.marketValue,
    boughtFrom: input.boughtFrom,
    purchaseSource: input.purchaseSource,
    paymentMethod: input.paymentMethod,
    soldByWorkerId: input.soldByWorkerId,
    isRawCard: Boolean(input.isRawCard),
    buyPercentage: input.buyPercentage,
    targetBuyPrice: input.targetBuyPrice,
    inventoryPurchaseId: input.inventoryPurchaseId,
    notes: input.notes,
    soldAt: input.soldAt || timestamp,
    pendingUpload,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp
  };

  return { sale: await saveSaleRecord(sale), message: localMessage || "Sale saved." };
}

export async function deleteSaleRecord(saleId: string) {
  savePendingSales(pendingSales().filter((sale) => sale.id !== saleId));
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("sales_records").delete().eq("id", saleId);
  recordSupabaseRequest("sales_records", "deleteSaleRecord");
  if (error) throwSupabase(error.message);
}

export async function syncPendingSales() {
  if (!isSupabaseConfigured || !supabase) return { synced: 0, failed: pendingSales().length };
  const pending = pendingSales();
  const remaining: SalesRecord[] = [];
  let synced = 0;
  for (const sale of pending) {
    try {
      let syncedSale = { ...sale };
      if (sale.imageUrl?.startsWith("data:")) {
        const file = await dataUrlToFile(sale.imageUrl, `pending-${sale.id}.jpg`);
        const uploaded = await uploadSaleImage(file, sale.id);
        syncedSale = { ...syncedSale, imageUrl: uploaded.imageUrl, imagePath: uploaded.imagePath };
      }
      const { error } = await supabase.from("sales_records").upsert(toRow({ ...syncedSale, pendingUpload: false, updatedAt: nowIso() }));
      recordSupabaseRequest("sales_records", "syncPendingSales");
      if (error) throw error;
      synced += 1;
    } catch {
      remaining.push(sale);
    }
  }
  savePendingSales(remaining);
  return { synced, failed: remaining.length };
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

function throwSupabase(message: string): never {
  setSupabaseStatus({ connected: false, error: message });
  console.error("Supabase error:", message);
  throw new Error(message);
}
