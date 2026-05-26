import type { Location } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";
import { db } from "../storage/localDb";

type LocationRow = {
  id: string;
  name: string;
  venue_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  instagram_handle?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: LocationRow): Location {
  return {
    id: row.id,
    name: row.name,
    venueName: row.venue_name || undefined,
    address: row.address || undefined,
    city: row.city || undefined,
    state: row.state || undefined,
    zip: row.zip || undefined,
    instagramHandle: row.instagram_handle || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(location: Location): LocationRow {
  return {
    id: location.id,
    name: location.name,
    venue_name: location.venueName || null,
    address: location.address || null,
    city: location.city || null,
    state: location.state || null,
    zip: location.zip || null,
    instagram_handle: location.instagramHandle || null,
    notes: location.notes || null,
    created_at: location.createdAt,
    updated_at: location.updatedAt
  };
}

export async function listLocations() {
  if (!isSupabaseConfigured || !supabase) return db.locations.orderBy("name").toArray();
  const { data, error } = await supabase.from("locations").select("*").order("name");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return (data || []).map((row) => fromRow(row as LocationRow));
}

export async function saveLocation(location: Location) {
  const saved = { ...location, updatedAt: nowIso() };
  if (!isSupabaseConfigured || !supabase) {
    await db.locations.put(saved);
    return saved;
  }
  const { data, error } = await supabase.from("locations").upsert(toRow(saved)).select("*").single();
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return fromRow(data as LocationRow);
}

export async function addLocation(name: string) {
  const timestamp = nowIso();
  return saveLocation({ id: id("location"), name: name.trim(), createdAt: timestamp, updatedAt: timestamp });
}

export async function deleteLocation(locationId: string) {
  if (!isSupabaseConfigured || !supabase) {
    await db.locations.delete(locationId);
    return;
  }
  const { error } = await supabase.from("locations").delete().eq("id", locationId);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}
