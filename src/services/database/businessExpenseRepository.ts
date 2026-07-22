import type { BusinessExpense, BusinessExpenseCategory } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, recordSupabaseRequest, setSupabaseStatus, supabase } from "../../utils/supabase";
import { fileToDataUrl, uploadFinancialImage } from "../images/saleImageService";

const localKey = "4nerds_business_expenses_local_v1";
const cacheKey = "4nerds_business_expenses_cache_v1";

type ExpenseRow = {
  id: string;
  expense_date: string;
  amount: number;
  category: BusinessExpenseCategory;
  description: string;
  event_id?: string | null;
  paid_by_worker_id?: string | null;
  vendor?: string | null;
  receipt_image_url?: string | null;
  receipt_image_path?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: ExpenseRow): BusinessExpense {
  return {
    id: row.id,
    expenseDate: row.expense_date,
    amount: Number(row.amount || 0),
    category: row.category || "other",
    description: row.description || "",
    eventId: row.event_id || undefined,
    paidByWorkerId: row.paid_by_worker_id || undefined,
    vendor: row.vendor || undefined,
    receiptImageUrl: row.receipt_image_url || undefined,
    receiptImagePath: row.receipt_image_path || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(value: BusinessExpense): ExpenseRow {
  return {
    id: value.id,
    expense_date: value.expenseDate,
    amount: Number(value.amount || 0),
    category: value.category,
    description: value.description,
    event_id: value.eventId || null,
    paid_by_worker_id: value.paidByWorkerId || null,
    vendor: value.vendor || null,
    receipt_image_url: value.receiptImageUrl || null,
    receipt_image_path: value.receiptImagePath || null,
    notes: value.notes || null,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}

function read(key: string) {
  try { return JSON.parse(localStorage.getItem(key) || "[]") as BusinessExpense[]; } catch { return []; }
}

function write(key: string, values: BusinessExpense[]) {
  try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* Cache is optional. */ }
}

export function getCachedBusinessExpenses() {
  return read(cacheKey);
}

export async function listBusinessExpenses(limit = 100) {
  if (!isSupabaseConfigured || !supabase) return read(localKey);
  const { data, error } = await supabase.from("business_expenses").select("*").order("expense_date", { ascending: false }).limit(limit);
  recordSupabaseRequest("business_expenses", "listBusinessExpenses", data?.length || 0);
  if (error) throw new Error(error.message);
  const values = (data || []).map((row) => fromRow(row as ExpenseRow));
  write(cacheKey, values);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return values;
}

export async function saveBusinessExpense(input: Partial<BusinessExpense>, receiptFile?: File) {
  const timestamp = nowIso();
  const recordId = input.id || id("expense");
  let receiptImageUrl = input.receiptImageUrl;
  let receiptImagePath = input.receiptImagePath;
  if (receiptFile) {
    if (isSupabaseConfigured && supabase) {
      const uploaded = await uploadFinancialImage(receiptFile, "expenses", recordId);
      receiptImageUrl = uploaded.imageUrl;
      receiptImagePath = uploaded.imagePath;
    } else {
      receiptImageUrl = await fileToDataUrl(receiptFile);
      receiptImagePath = undefined;
    }
  }
  const value: BusinessExpense = {
    id: recordId,
    expenseDate: input.expenseDate || timestamp,
    amount: Number(input.amount || 0),
    category: input.category || "other",
    description: input.description?.trim() || "Business expense",
    eventId: input.eventId,
    paidByWorkerId: input.paidByWorkerId,
    vendor: input.vendor?.trim() || undefined,
    receiptImageUrl,
    receiptImagePath,
    notes: input.notes?.trim() || undefined,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp
  };
  if (!isSupabaseConfigured || !supabase) {
    const values = [value, ...read(localKey).filter((item) => item.id !== value.id)];
    write(localKey, values);
    write(cacheKey, values);
    return value;
  }
  const { data, error } = await supabase.from("business_expenses").upsert(toRow(value)).select("*").single();
  recordSupabaseRequest("business_expenses", "saveBusinessExpense", data ? 1 : 0);
  if (error) throw new Error(error.message);
  return fromRow(data as ExpenseRow);
}

export async function deleteBusinessExpense(recordId: string) {
  write(localKey, read(localKey).filter((item) => item.id !== recordId));
  write(cacheKey, read(cacheKey).filter((item) => item.id !== recordId));
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("business_expenses").delete().eq("id", recordId);
  recordSupabaseRequest("business_expenses", "deleteBusinessExpense");
  if (error) throw new Error(error.message);
}
