import type { EventPriceOption, PricingType } from "../../types/models";
import { nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";

type PriceOptionRow = {
  id: string;
  event_id: string;
  label: string;
  price: number;
  pricing_type: PricingType;
  applies_to_day_ids?: string[] | null;
  description?: string | null;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
};

function fromRow(row: PriceOptionRow): EventPriceOption {
  return {
    id: row.id,
    eventId: row.event_id,
    label: row.label,
    price: Number(row.price || 0),
    pricingType: row.pricing_type || "flat",
    appliesToDayIds: row.applies_to_day_ids || undefined,
    description: row.description || undefined,
    isSelected: Boolean(row.is_selected),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(option: EventPriceOption): PriceOptionRow {
  return {
    id: option.id,
    event_id: option.eventId,
    label: option.label,
    price: Number(option.price || 0),
    pricing_type: option.pricingType || "flat",
    applies_to_day_ids: option.appliesToDayIds || null,
    description: option.description || null,
    is_selected: option.isSelected,
    created_at: option.createdAt,
    updated_at: option.updatedAt
  };
}

export async function listPriceOptions(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return [] as EventPriceOption[];
  const { data, error } = await supabase.from("event_price_options").select("*").eq("event_id", eventId).order("created_at");
  if (error) throwSupabase(error.message);
  return (data || []).map((row) => fromRow(row as PriceOptionRow));
}

export async function replacePriceOptions(eventId: string, options: EventPriceOption[]) {
  if (!isSupabaseConfigured || !supabase) return options;
  const { error: deleteError } = await supabase.from("event_price_options").delete().eq("event_id", eventId);
  if (deleteError) throwSupabase(deleteError.message);
  const timestamp = nowIso();
  const rows = options.map((option) => toRow({ ...option, eventId, updatedAt: timestamp }));
  if (rows.length) {
    const { error } = await supabase.from("event_price_options").insert(rows);
    if (error) throwSupabase(error.message);
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return options;
}

export async function savePriceOption(option: EventPriceOption) {
  if (!isSupabaseConfigured || !supabase) return option;
  const saved = { ...option, updatedAt: nowIso() };
  const { data, error } = await supabase.from("event_price_options").upsert(toRow(saved)).select("*").single();
  if (error) throwSupabase(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return fromRow(data as PriceOptionRow);
}

export async function deletePriceOption(optionId: string) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("event_price_options").delete().eq("id", optionId);
  if (error) throwSupabase(error.message);
  setSupabaseStatus({ connected: true, error: "", synced: true });
}

function throwSupabase(message: string): never {
  setSupabaseStatus({ connected: false, error: message });
  console.error("Supabase error:", message);
  throw new Error(message);
}
