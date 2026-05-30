import type { BuyItem, BuyItemPriority } from "../../types/models";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";

type BuyItemRow = {
  id: string;
  title: string;
  description?: string | null;
  product_url?: string | null;
  image_url?: string | null;
  estimated_price?: number | null;
  quantity: number;
  priority: BuyItemPriority;
  purchased: boolean;
  purchased_by?: string | null;
  purchased_by_worker_id?: string | null;
  purchased_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

const localKey = "4nerds_buy_items_local_v1";
const previewCacheKey = "4nerds_buy_preview_cache_v1";

function fromRow(row: BuyItemRow): BuyItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    productUrl: row.product_url || undefined,
    imageUrl: row.image_url || undefined,
    estimatedPrice: row.estimated_price === null || row.estimated_price === undefined ? undefined : Number(row.estimated_price),
    quantity: Number(row.quantity || 1),
    priority: row.priority || "medium",
    purchased: Boolean(row.purchased),
    purchasedBy: row.purchased_by || undefined,
    purchasedByWorkerId: row.purchased_by_worker_id || undefined,
    purchasedAt: row.purchased_at || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(item: BuyItem): BuyItemRow {
  return {
    id: item.id,
    title: item.title,
    description: item.description || null,
    product_url: item.productUrl || null,
    image_url: item.imageUrl || null,
    estimated_price: item.estimatedPrice ?? null,
    quantity: Number(item.quantity || 1),
    priority: item.priority || "medium",
    purchased: Boolean(item.purchased),
    purchased_by: item.purchasedBy || null,
    purchased_by_worker_id: item.purchasedByWorkerId || null,
    purchased_at: item.purchasedAt || null,
    notes: item.notes || null,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function localItems() {
  try {
    return JSON.parse(localStorage.getItem(localKey) || "[]") as BuyItem[];
  } catch {
    return [] as BuyItem[];
  }
}

function saveLocalItems(items: BuyItem[]) {
  localStorage.setItem(localKey, JSON.stringify(items));
}

export async function listBuyItems() {
  if (!isSupabaseConfigured || !supabase) return localItems();
  const { data, error } = await supabase.from("buy_items").select("*").order("created_at", { ascending: false });
  if (error) throwSupabase(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return (data || []).map((row) => fromRow(row as BuyItemRow));
}

export async function saveBuyItem(item: BuyItem) {
  const saved = { ...item, updatedAt: new Date().toISOString() };
  if (!isSupabaseConfigured || !supabase) {
    saveLocalItems([saved, ...localItems().filter((existing) => existing.id !== saved.id)]);
    return saved;
  }
  const { data, error } = await supabase.from("buy_items").upsert(toRow(saved)).select("*").single();
  if (error) throwSupabase(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return fromRow(data as BuyItemRow);
}

export async function deleteBuyItem(itemId: string) {
  if (!isSupabaseConfigured || !supabase) {
    saveLocalItems(localItems().filter((item) => item.id !== itemId));
    return;
  }
  const { error } = await supabase.from("buy_items").delete().eq("id", itemId);
  if (error) throwSupabase(error.message);
}

export type ProductPreview = {
  title?: string;
  description?: string;
  imageUrl?: string;
  estimatedPrice?: number;
};

type ProductPreviewApiResponse = {
  success: boolean;
  title?: string;
  description?: string;
  image_url?: string;
  estimated_price?: number;
  source_url?: string;
  error?: string;
};

function previewCache() {
  try {
    return JSON.parse(localStorage.getItem(previewCacheKey) || "{}") as Record<string, ProductPreview>;
  } catch {
    return {};
  }
}

export async function fetchProductPreview(productUrl: string) {
  const url = productUrl.trim();
  if (!url) return {};
  const cache = previewCache();
  if (cache[url]) return cache[url];

  try {
    const response = await fetch(`/api/product-preview?url=${encodeURIComponent(url)}`);
    const payload = await response.json() as ProductPreviewApiResponse;
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Could not preview this link.");
    }
    const preview: ProductPreview = {
      title: payload.title || undefined,
      description: payload.description || undefined,
      imageUrl: payload.image_url || undefined,
      estimatedPrice: payload.estimated_price === undefined || payload.estimated_price === null ? undefined : Number(payload.estimated_price)
    };
    localStorage.setItem(previewCacheKey, JSON.stringify({ ...cache, [url]: preview }));
    return preview;
  } catch (error) {
    console.warn("Product preview failed:", error);
    throw new Error("Could not preview this link. Add details manually.");
  }
}

function throwSupabase(message: string): never {
  setSupabaseStatus({ connected: false, error: message });
  console.error("Supabase error:", message);
  throw new Error(message);
}
