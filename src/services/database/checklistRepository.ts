import type { EventChecklistItem } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";

export const defaultChecklistLabels = [
  "Table paid",
  "Inventory packed",
  "Binder packed",
  "Slabs packed",
  "Cash/change ready",
  "Banner packed",
  "Display stands packed",
  "Charger packed",
  "Snacks/water",
  "Arrive on time"
];

type ChecklistRow = {
  id: string;
  event_id: string;
  label: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
};

function fromRow(row: ChecklistRow): EventChecklistItem {
  return {
    id: row.id,
    eventId: row.event_id,
    label: row.label,
    completed: Boolean(row.completed),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(item: EventChecklistItem): ChecklistRow {
  return {
    id: item.id,
    event_id: item.eventId,
    label: item.label,
    completed: item.completed,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

export function defaultChecklistItems(eventId: string) {
  const timestamp = nowIso();
  return defaultChecklistLabels.map((label) => ({
    id: id("checklist"),
    eventId,
    label,
    completed: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}

export async function listChecklistItems(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return [] as EventChecklistItem[];
  const { data, error } = await supabase.from("event_checklist_items").select("*").eq("event_id", eventId).order("created_at");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return (data || []).map((row) => fromRow(row as ChecklistRow));
}

export async function seedChecklistIfEmpty(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return defaultChecklistItems(eventId);
  const existing = await listChecklistItems(eventId);
  if (existing.length) return existing;
  const rows = defaultChecklistItems(eventId).map(toRow);
  const { data, error } = await supabase.from("event_checklist_items").insert(rows).select("*");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return (data || []).map((row) => fromRow(row as ChecklistRow));
}

export async function saveChecklistItem(item: EventChecklistItem) {
  if (!isSupabaseConfigured || !supabase) return item;
  const saved = { ...item, updatedAt: nowIso() };
  const { data, error } = await supabase.from("event_checklist_items").upsert(toRow(saved)).select("*").single();
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return fromRow(data as ChecklistRow);
}

export async function deleteChecklistItem(itemId: string) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("event_checklist_items").delete().eq("id", itemId);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}
