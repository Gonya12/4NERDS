-- Safe, repeatable TCGplayer pricing provenance fields for inventory purchases.
alter table public.inventory_purchases add column if not exists market_price_source text;
alter table public.inventory_purchases add column if not exists market_price_variant text;
alter table public.inventory_purchases add column if not exists market_price_updated_at timestamptz;
alter table public.inventory_purchases add column if not exists market_price_checked_at timestamptz;

create index if not exists idx_inventory_purchases_market_price_source
  on public.inventory_purchases (market_price_source);
