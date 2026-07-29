import type { OwnershipShare } from "../../types/models";
import { isSupabaseConfigured, recordSupabaseRequest, startSupabaseQueryTrace, supabase } from "../../utils/supabase";

type InventoryRow = { id: string; inventory_purchase_id: string; worker_id: string; ownership_percentage: number; contribution_amount?: number | null };
type SaleRow = { id: string; sales_record_id: string; worker_id: string; ownership_percentage: number };

const toShare = (row: InventoryRow | SaleRow): OwnershipShare => ({
  id: row.id,
  workerId: row.worker_id,
  ownershipPercentage: Number(row.ownership_percentage),
  contributionAmount: "contribution_amount" in row && row.contribution_amount != null ? Number(row.contribution_amount) : undefined
});

export async function listOwnershipShares(inventoryPurchaseIds: string[] = [], salesRecordIds: string[] = []) {
  if (!isSupabaseConfigured || !supabase) return { inventory: new Map<string, OwnershipShare[]>(), sales: new Map<string, OwnershipShare[]>() };
  if (!inventoryPurchaseIds.length && !salesRecordIds.length) return { inventory: new Map<string, OwnershipShare[]>(), sales: new Map<string, OwnershipShare[]>() };
  const completeTrace = startSupabaseQueryTrace("ownership shares", "listOwnershipShares", "inventory_purchase_id,sales_record_id,worker_id,ownership_percentage,contribution_amount");
  const [inventoryResult, salesResult] = await Promise.all([
    inventoryPurchaseIds.length
      ? supabase.from("inventory_ownership_shares").select("id,inventory_purchase_id,worker_id,ownership_percentage,contribution_amount").in("inventory_purchase_id", inventoryPurchaseIds)
      : Promise.resolve({ data: [], error: null }),
    salesRecordIds.length
      ? supabase.from("sale_profit_shares").select("id,sales_record_id,worker_id,ownership_percentage").in("sales_record_id", salesRecordIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  completeTrace(
    (inventoryResult.data?.length || 0) + (salesResult.data?.length || 0),
    inventoryResult.error || salesResult.error
  );
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
  const timestamp = new Date().toISOString();
  if (shares.length) {
    const { error } = await supabase.from("inventory_ownership_shares").upsert(shares.map((share) => ({
      inventory_purchase_id: inventoryPurchaseId, worker_id: share.workerId, ownership_percentage: share.ownershipPercentage,
      contribution_amount: share.contributionAmount ?? null, updated_at: timestamp
    })), { onConflict: "inventory_purchase_id,worker_id" });
    if (error) throw new Error(error.message);
  }
  const existing = await supabase.from("inventory_ownership_shares").select("id,worker_id").eq("inventory_purchase_id", inventoryPurchaseId);
  if (existing.error) throw new Error(existing.error.message);
  const desiredWorkers = new Set(shares.map((share) => share.workerId));
  const staleIds = (existing.data || []).filter((row) => !desiredWorkers.has(row.worker_id)).map((row) => row.id);
  if (staleIds.length) {
    const deletion = await supabase.from("inventory_ownership_shares").delete().in("id", staleIds);
    if (deletion.error) throw new Error(deletion.error.message);
  }
}

export async function saveSaleOwnership(salesRecordId: string, shares: OwnershipShare[]) {
  if (!isSupabaseConfigured || !supabase) return;
  const timestamp = new Date().toISOString();
  if (shares.length) {
    const { error } = await supabase.from("sale_profit_shares").upsert(shares.map((share) => ({
      sales_record_id: salesRecordId, worker_id: share.workerId, ownership_percentage: share.ownershipPercentage,
      updated_at: timestamp
    })), { onConflict: "sales_record_id,worker_id" });
    if (error) throw new Error(error.message);
  }
  const existing = await supabase.from("sale_profit_shares").select("id,worker_id").eq("sales_record_id", salesRecordId);
  if (existing.error) throw new Error(existing.error.message);
  const desiredWorkers = new Set(shares.map((share) => share.workerId));
  const staleIds = (existing.data || []).filter((row) => !desiredWorkers.has(row.worker_id)).map((row) => row.id);
  if (staleIds.length) {
    const deletion = await supabase.from("sale_profit_shares").delete().in("id", staleIds);
    if (deletion.error) throw new Error(deletion.error.message);
  }
}
