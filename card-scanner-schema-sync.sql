-- Pokémon card scanner schema sync. Safe, additive, and repeatable.
-- Run this entire file in Supabase SQL Editor. Existing inventory is preserved.

alter table public.inventory_purchases add column if not exists card_name text;
alter table public.inventory_purchases add column if not exists collector_number text;
alter table public.inventory_purchases add column if not exists card_set text;
alter table public.inventory_purchases add column if not exists card_language text;
alter table public.inventory_purchases add column if not exists card_condition text;
alter table public.inventory_purchases add column if not exists sticker_price numeric(10, 2);
alter table public.inventory_purchases add column if not exists grading_company text;
alter table public.inventory_purchases add column if not exists grade text;
alter table public.inventory_purchases add column if not exists certificate_number text;
alter table public.inventory_purchases add column if not exists front_image_url text;
alter table public.inventory_purchases add column if not exists front_image_path text;
alter table public.inventory_purchases add column if not exists back_image_url text;
alter table public.inventory_purchases add column if not exists back_image_path text;
alter table public.inventory_purchases add column if not exists scan_confidence text;
alter table public.inventory_purchases add column if not exists scan_status text not null default 'not_scanned';
alter table public.inventory_purchases add column if not exists image_hash text;
alter table public.inventory_purchases add column if not exists scan_result jsonb;

create index if not exists idx_inventory_purchases_card_name on public.inventory_purchases(card_name);
create index if not exists idx_inventory_purchases_collector_number on public.inventory_purchases(collector_number);
create index if not exists idx_inventory_purchases_card_set on public.inventory_purchases(card_set);
create index if not exists idx_inventory_purchases_certificate_number on public.inventory_purchases(certificate_number)
  where certificate_number is not null and btrim(certificate_number) <> '';
create index if not exists idx_inventory_purchases_scan_status on public.inventory_purchases(scan_status);
create index if not exists idx_inventory_purchases_image_hash on public.inventory_purchases(image_hash)
  where image_hash is not null and btrim(image_hash) <> '';

-- Certificate uniqueness is deliberately reviewed in the app instead of enforced
-- here because existing production data may already contain legitimate duplicates.
