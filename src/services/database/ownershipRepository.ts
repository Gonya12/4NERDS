import type { OwnershipShare } from "../../types/models";
import { isSupabaseConfigured, recordSupabaseRequest, supabase } from "../../utils/supabase";

type InventoryRow = { id: string; inventory_purchase_id: string; worker_id: string; ownership_percentage: number; contribution_amount?: number | null };
type SaleRow = { id: string; sales_record_id: string; worker_id: string; ownership_percentage: number };

const toShare = (row: InventoryRow | SaleRow): OwnershipShare => ({
  id: row.id,
  workerId: row.worker_id,
  ownershipPercentage: Number(row.ownership_percentage),
  contributionAmount: "contribution_amount" in row && row.contribution_amount != null ? Number(row.contribution_amount) : undefined
});

export async function listOwnershipShares() {
  if (!isSupabaseConfigured || !supabase) return { inventory: new Map<string, OwnershipShare[]>(), sales: new Map<string, OwnershipShare[]>() };
  const [inventoryResult, salesResult] = await Promise.all([
    supabase.from("inventory_ownership_shares").select("*"),
    supabase.from("sale_profit_shares").select("*")
  ]);
  recordSupabaseRequest("inventory_ownership_shares", "listOwnershipShares:inventory", inventoryResult.data?.length || 0);
  recordSupabaseRequest("sale_profit_shares", "listOwnershipShares:sales", salesResult.data?.length || 0);
  const error = inventoryResult.error || salesResult.error;
  if (error) throw new Error(error.message);
  const inventory = new Map<string, OwnershipShare[]>();
  const sales = new Map<string, OwnershipShare[]>();
  (inventoryResult.data as InventoryRow[] || []).forEach((row) => inventory.set(row.inventory_purchase_id, [...(inventory.get(row.inventory_purchase_id) || []), toShare(row)]));
  (salesResult.data as SaleRow[] || []).forEach((row) => sales.set(row.sales_record_id, [...(sales.get(row.sales_record_id) || []), toShare(row)]));
  return { inventory, sales };
}

export async function saveInventoryOwnership(inventoryPurchaseId: string, shares: OwnershipShare[]) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error: deleteError } = await supabase.from("inventory_ownership_shares").delete().eq("inventory_purchase_id", inventoryPurchaseId);
  if (deleteError) throw new Error(deleteError.message);
  if (!shares.length) return;
  const timestamp = new Date().toISOString();
  const { error } = await supabase.from("inventory_ownership_shares").insert(shares.map((share) => ({
    inventory_purchase_id: inventoryPurchaseId, worker_id: share.workerId, ownership_percentage: share.ownershipPercentage,
    contribution_amount: share.contributionAmount ?? null, created_at: timestamp, updated_at: timestamp
  })));
  if (error) throw new Error(error.message);
}

export async function saveSaleOwnership(salesRecordId: string, shares: OwnershipShare[]) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error: deleteError } = await supabase.from("sale_profit_shares").delete().eq("sales_record_id", salesRecordId);
  if (deleteError) throw new Error(deleteError.message);
  if (!shares.length) return;
  const timestamp = new Date().toISOString();
  const { error } = await supabase.from("sale_profit_shares").insert(shares.map((share) => ({
    sales_record_id: salesRecordId, worker_id: share.workerId, ownership_percentage: share.ownershipPercentage,
    created_at: timestamp, updated_at: timestamp
  })));
  if (error) throw new Error(error.message);
}
