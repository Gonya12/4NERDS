import type { PaymentRecord } from "../../types/models";
import { db } from "../storage/localDb";
import { isSupabaseConfigured, setSupabaseStatus, supabase } from "../../utils/supabase";

type PaymentRow = {
  id: string;
  event_id: string;
  worker_id: string;
  amount_paid: number;
  paid_at?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    workerId: row.worker_id,
    amountPaid: Number(row.amount_paid || 0),
    paidAt: row.paid_at || undefined,
    note: row.note || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRow(record: PaymentRecord): PaymentRow {
  return {
    id: record.id,
    event_id: record.eventId,
    worker_id: record.workerId,
    amount_paid: Number(record.amountPaid || 0),
    paid_at: record.paidAt || null,
    note: record.note || null,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

export async function listPaymentRecords(eventId: string) {
  if (!isSupabaseConfigured || !supabase) {
    const event = await db.events.get(eventId);
    return event?.paymentRecords || [];
  }
  const { data, error } = await supabase.from("payment_records").select("*").eq("event_id", eventId);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return (data || []).map((row) => fromRow(row as PaymentRow));
}

export async function savePaymentRecord(record: PaymentRecord) {
  if (!isSupabaseConfigured || !supabase) {
    const event = await db.events.get(record.eventId);
    if (!event) return;
    const existing = event.paymentRecords || [];
    await db.events.put({
      ...event,
      paymentRecords: existing.some((payment) => payment.id === record.id)
        ? existing.map((payment) => payment.id === record.id ? record : payment)
        : [...existing, record],
      updatedAt: new Date().toISOString()
    });
    return;
  }
  const { data, error } = await supabase.from("payment_records").upsert(toRow(record)).select("*");
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}

export async function deletePaymentRecord(recordId: string) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("payment_records").delete().eq("id", recordId);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    throw error;
  }
  setSupabaseStatus({ connected: true, error: "", synced: true });
}
