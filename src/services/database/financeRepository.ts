import type { EventFinance } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";

type FinanceRow = {
  id: string;
  event_id: string;
  total_sales: number;
  total_expenses: number;
  gas_cost: number;
  food_cost: number;
  misc_cost: number;
  profit_notes?: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: FinanceRow): EventFinance {
  return {
    id: row.id,
    eventId: row.event_id,
    totalSales: Number(row.total_sales || 0),
    totalExpenses: Number(row.total_expenses || 0),
    gasCost: Number(row.gas_cost || 0),
    foodCost: Number(row.food_cost || 0),
    miscCost: Number(row.misc_cost || 0),
    profitNotes: row.profit_notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(finance: EventFinance): FinanceRow {
  return {
    id: finance.id,
    event_id: finance.eventId,
    total_sales: Number(finance.totalSales || 0),
    total_expenses: Number(finance.totalExpenses || 0),
    gas_cost: Number(finance.gasCost || 0),
    food_cost: Number(finance.foodCost || 0),
    misc_cost: Number(finance.miscCost || 0),
    profit_notes: finance.profitNotes || null,
    created_at: finance.createdAt,
    updated_at: finance.updatedAt
  };
}

export function emptyFinance(eventId: string): EventFinance {
  const timestamp = nowIso();
  return {
    id: id("finance"),
    eventId,
    totalSales: 0,
    totalExpenses: 0,
    gasCost: 0,
    foodCost: 0,
    miscCost: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export async function getFinance(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return undefined;
  const { data, error } = await supabase.from("event_finances").select("*").eq("event_id", eventId).maybeSingle();
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return data ? fromRow(data as FinanceRow) : undefined;
}

export async function saveFinance(finance: EventFinance) {
  if (!isSupabaseConfigured || !supabase) return finance;
  const saved = { ...finance, updatedAt: nowIso() };
  const { data, error } = await supabase.from("event_finances").upsert(toRow(saved)).select("*").single();
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return fromRow(data as FinanceRow);
}
