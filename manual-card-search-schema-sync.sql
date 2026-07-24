-- Manual Pokémon card search metadata. Safe, additive, and repeatable.
-- Run this entire file in Supabase SQL Editor. Existing records are preserved.

alter table public.inventory_purchases add column if not exists card_set_id text;
alter table public.inventory_purchases add column if not exists card_set_code text;
alter table public.inventory_purchases add column if not exists card_rarity text;
alter table public.inventory_purchases add column if not exists pokemon_tcg_card_id text;
alter table public.inventory_purchases add column if not exists official_card_image_url text;
alter table public.inventory_purchases add column if not exists tcgplayer_url text;

alter table public.sales_records add column if not exists card_name text;
alter table public.sales_records add column if not exists collector_number text;
alter table public.sales_records add column if not exists card_set text;
alter table public.sales_records add column if not exists card_set_id text;
alter table public.sales_records add column if not exists card_set_code text;
alter table public.sales_records add column if not exists card_rarity text;
alter table public.sales_records add column if not exists card_language text;
alter table public.sales_records add column if not exists card_condition text;
alter table public.sales_records add column if not exists sticker_price numeric(10, 2);
alter table public.sales_records add column if not exists pokemon_tcg_card_id text;
alter table public.sales_records add column if not exists official_card_image_url text;
alter table public.sales_records add column if not exists market_price_source text;
alter table public.sales_records add column if not exists market_price_variant text;
alter table public.sales_records add column if not exists market_price_updated_at timestamptz;
alter table public.sales_records add column if not exists market_price_checked_at timestamptz;
alter table public.sales_records add column if not exists tcgplayer_url text;

create index if not exists idx_inventory_purchases_pokemon_tcg_card_id
  on public.inventory_purchases (pokemon_tcg_card_id)
  where pokemon_tcg_card_id is not null and btrim(pokemon_tcg_card_id) <> '';
create index if not exists idx_sales_records_pokemon_tcg_card_id
  on public.sales_records (pokemon_tcg_card_id)
  where pokemon_tcg_card_id is not null and btrim(pokemon_tcg_card_id) <> '';
