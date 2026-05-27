import type { SalesRecord } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";
import { fileToDataUrl, uploadSaleImage } from "../images/saleImageService";

const pendingKey = "4nerds_pending_sales_v1";

type SalesRow = {
  id: string;
  event_id?: string | null;
  event_day_id?: string | null;
  image_url?: string | null;
  image_path?: string | null;
  item_name?: string | null;
  sold_price?: number | null;
  bought_price?: number | null;
  bought_from?: string | null;
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
    soldPrice: row.sold_price === null || row.sold_price === undefined ? undefined : Number(row.sold_price),
    boughtPrice: row.bought_price === null || row.bought_price === undefined ? undefined : Number(row.bought_price),
    boughtFrom: row.bought_from || undefined,
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
    sold_price: sale.soldPrice ?? null,
    bought_price: sale.boughtPrice ?? null,
    bought_from: sale.boughtFrom || null,
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

export async function listSalesRecords() {
  const localPending = pendingSales();
  if (!isSupabaseConfigured || !supabase) return localPending;
  const { data, error } = await supabase.from("sales_records").select("*").order("sold_at", { ascending: false });
  if (error) throwSupabase(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return [...localPending, ...(data || []).map((row) => fromRow(row as SalesRow))];
}

export async function listSalesRecordsForEvent(eventId: string) {
  const localPending = pendingSales().filter((sale) => sale.eventId === eventId);
  if (!isSupabaseConfigured || !supabase) return localPending;
  const { data, error } = await supabase.from("sales_records").select("*").eq("event_id", eventId).order("sold_at", { ascending: false });
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
    soldPrice: input.soldPrice,
    boughtPrice: input.boughtPrice,
    boughtFrom: input.boughtFrom,
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
