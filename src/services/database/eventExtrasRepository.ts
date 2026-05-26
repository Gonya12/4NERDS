import type { EventLiveNote, EventReview, EventSalesCategory, SalesCategory } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";

const categories: SalesCategory[] = ["Pokemon", "One Piece", "Slabs", "Accessories", "Sealed", "Other"];

type LiveNoteRow = { id: string; event_id: string; worker_id?: string | null; content: string; created_at: string; updated_at: string };
type SalesRow = { id: string; event_id: string; category: SalesCategory; amount: number; created_at: string; updated_at: string };
type ReviewRow = { id: string; event_id: string; overall_rating: number; traffic_rating: number; organizer_rating: number; profit_rating: number; notes?: string | null; created_at: string; updated_at: string };

const liveFromRow = (row: LiveNoteRow): EventLiveNote => ({
  id: row.id,
  eventId: row.event_id,
  workerId: row.worker_id || undefined,
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const salesFromRow = (row: SalesRow): EventSalesCategory => ({
  id: row.id,
  eventId: row.event_id,
  category: row.category,
  amount: Number(row.amount || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const reviewFromRow = (row: ReviewRow): EventReview => ({
  id: row.id,
  eventId: row.event_id,
  overallRating: Number(row.overall_rating || 0),
  trafficRating: Number(row.traffic_rating || 0),
  organizerRating: Number(row.organizer_rating || 0),
  profitRating: Number(row.profit_rating || 0),
  notes: row.notes || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export function defaultSalesCategories(eventId: string) {
  const timestamp = nowIso();
  return categories.map((category) => ({ id: id("sale"), eventId, category, amount: 0, createdAt: timestamp, updatedAt: timestamp }));
}

export function emptyReview(eventId: string): EventReview {
  const timestamp = nowIso();
  return { id: id("review"), eventId, overallRating: 0, trafficRating: 0, organizerRating: 0, profitRating: 0, createdAt: timestamp, updatedAt: timestamp };
}

export async function listLiveNotes(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return [] as EventLiveNote[];
  const { data, error } = await supabase.from("event_live_notes").select("*").eq("event_id", eventId).order("updated_at", { ascending: false });
  if (error) throwSupabase(error.message);
  return (data || []).map((row) => liveFromRow(row as LiveNoteRow));
}

export async function saveLiveNote(note: EventLiveNote) {
  if (!isSupabaseConfigured || !supabase) return note;
  const saved = { ...note, updatedAt: nowIso() };
  const { data, error } = await supabase.from("event_live_notes").upsert({
    id: saved.id,
    event_id: saved.eventId,
    worker_id: saved.workerId || null,
    content: saved.content,
    created_at: saved.createdAt,
    updated_at: saved.updatedAt
  }).select("*").single();
  if (error) throwSupabase(error.message);
  return liveFromRow(data as LiveNoteRow);
}

export async function listSalesCategories(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return [] as EventSalesCategory[];
  const { data, error } = await supabase.from("event_sales_categories").select("*").eq("event_id", eventId);
  if (error) throwSupabase(error.message);
  return (data || []).map((row) => salesFromRow(row as SalesRow));
}

export async function seedSalesCategories(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return defaultSalesCategories(eventId);
  const existing = await listSalesCategories(eventId);
  const existingCategories = new Set(existing.map((item) => item.category));
  const missing = defaultSalesCategories(eventId).filter((item) => !existingCategories.has(item.category));
  if (missing.length) {
    const { error } = await supabase.from("event_sales_categories").insert(missing.map((item) => ({
      id: item.id,
      event_id: item.eventId,
      category: item.category,
      amount: item.amount,
      created_at: item.createdAt,
      updated_at: item.updatedAt
    })));
    if (error) throwSupabase(error.message);
  }
  return listSalesCategories(eventId);
}

export async function saveSalesCategory(item: EventSalesCategory) {
  if (!isSupabaseConfigured || !supabase) return item;
  const saved = { ...item, updatedAt: nowIso() };
  const { data, error } = await supabase.from("event_sales_categories").upsert({
    id: saved.id,
    event_id: saved.eventId,
    category: saved.category,
    amount: Number(saved.amount || 0),
    created_at: saved.createdAt,
    updated_at: saved.updatedAt
  }).select("*").single();
  if (error) throwSupabase(error.message);
  return salesFromRow(data as SalesRow);
}

export async function getReview(eventId: string) {
  if (!isSupabaseConfigured || !supabase) return undefined;
  const { data, error } = await supabase.from("event_reviews").select("*").eq("event_id", eventId).maybeSingle();
  if (error) throwSupabase(error.message);
  return data ? reviewFromRow(data as ReviewRow) : undefined;
}

export async function saveReview(review: EventReview) {
  if (!isSupabaseConfigured || !supabase) return review;
  const saved = { ...review, updatedAt: nowIso() };
  const { data, error } = await supabase.from("event_reviews").upsert({
    id: saved.id,
    event_id: saved.eventId,
    overall_rating: Number(saved.overallRating || 0),
    traffic_rating: Number(saved.trafficRating || 0),
    organizer_rating: Number(saved.organizerRating || 0),
    profit_rating: Number(saved.profitRating || 0),
    notes: saved.notes || null,
    created_at: saved.createdAt,
    updated_at: saved.updatedAt
  }).select("*").single();
  if (error) throwSupabase(error.message);
  return reviewFromRow(data as ReviewRow);
}

function throwSupabase(message: string): never {
  setSupabaseStatus({ connected: false, error: message });
  console.error("Supabase error:", message);
  throw new Error(message);
}
