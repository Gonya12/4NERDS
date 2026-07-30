-- Canonical visible sticker metadata for unified financial transaction items.
-- These fields are informational and are never copied into accounting columns
-- by a database trigger or generated value.

alter table if exists public.financial_transaction_items
  add column if not exists sticker_price numeric(12,2),
  add column if not exists sticker_condition text;

notify pgrst, 'reload schema';
