-- 4 Nerds canonical trade system. Safe to run repeatedly.
-- This migration preserves all sales, purchases, inventory and financial records.

create table if not exists public.trade_transactions (
  id uuid primary key,
  trade_date timestamptz not null default now(),
  event_id uuid references public.events(id) on delete set null,
  event_day_id uuid references public.event_days(id) on delete set null,
  trade_partner text,
  cash_received numeric(12,2) not null default 0 check (cash_received >= 0),
  cash_paid numeric(12,2) not null default 0 check (cash_paid >= 0),
  notes text,
  general_image_url text,
  general_image_path text,
  proof_image_url text,
  proof_image_path text,
  status text not null default 'draft' check (status in ('draft','completed','cancelled','reversed')),
  entered_by_worker_id uuid references public.workers(id) on delete set null,
  completed_at timestamptz,
  reversed_at timestamptz,
  reversal_of_trade_id uuid references public.trade_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trade_items (
  id uuid primary key,
  trade_transaction_id uuid not null references public.trade_transactions(id) on delete cascade,
  inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  created_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  prior_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  direction text not null check (direction in ('outgoing','incoming')),
  item_name text not null,
  item_type text not null default 'other_pokemon_product',
  quantity integer not null default 1 check (quantity > 0),
  market_value numeric(12,2) not null default 0,
  agreed_trade_value numeric(12,2) not null default 0,
  historical_cost_basis numeric(12,2) not null default 0,
  allocated_cost_basis numeric(12,2) not null default 0,
  cash_allocation numeric(12,2),
  image_url text,
  image_path text,
  back_image_url text,
  back_image_path text,
  collector_number text,
  card_set text,
  pokemon_tcg_card_id text,
  card_condition text,
  sticker_price numeric(12,2),
  grading_company text,
  grade text,
  certificate_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trade_item_ownership_shares (
  id uuid primary key default gen_random_uuid(),
  trade_item_id uuid not null references public.trade_items(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  ownership_percentage numeric(7,3) not null check (ownership_percentage > 0 and ownership_percentage <= 100),
  allocated_cost_basis numeric(12,2),
  allocated_trade_value numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_trade_lineage (
  id uuid primary key default gen_random_uuid(),
  source_inventory_purchase_id uuid not null references public.inventory_purchases(id) on delete restrict,
  resulting_inventory_purchase_id uuid not null references public.inventory_purchases(id) on delete restrict,
  trade_transaction_id uuid not null references public.trade_transactions(id) on delete restrict,
  relationship_type text not null default 'exchanged_for',
  created_at timestamptz not null default now()
);

alter table public.inventory_purchases add column if not exists acquisition_method text default 'purchased';
alter table public.inventory_purchases add column if not exists acquired_trade_transaction_id uuid references public.trade_transactions(id) on delete set null;
alter table public.inventory_purchases add column if not exists disposed_trade_transaction_id uuid references public.trade_transactions(id) on delete set null;
alter table public.inventory_purchases add column if not exists traded_at timestamptz;
alter table public.inventory_purchases add column if not exists agreed_trade_value numeric(12,2);
alter table public.inventory_purchases add column if not exists prior_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null;

create index if not exists idx_trade_transactions_date on public.trade_transactions(trade_date desc);
create index if not exists idx_trade_transactions_status on public.trade_transactions(status);
create index if not exists idx_trade_transactions_event on public.trade_transactions(event_id);
create index if not exists idx_trade_transactions_worker on public.trade_transactions(entered_by_worker_id);
create index if not exists idx_trade_items_transaction on public.trade_items(trade_transaction_id);
create index if not exists idx_trade_items_inventory on public.trade_items(inventory_purchase_id);
create index if not exists idx_trade_items_created_inventory on public.trade_items(created_inventory_purchase_id);
create index if not exists idx_trade_items_name on public.trade_items(item_name);
create index if not exists idx_trade_items_collector on public.trade_items(collector_number);
create unique index if not exists uq_trade_item_owner on public.trade_item_ownership_shares(trade_item_id, worker_id);
create unique index if not exists uq_inventory_trade_lineage on public.inventory_trade_lineage(source_inventory_purchase_id, resulting_inventory_purchase_id, trade_transaction_id);

-- Current private MVP access pattern. Run in Supabase SQL Editor without RLS enforcement.
alter table public.trade_transactions disable row level security;
alter table public.trade_items disable row level security;
alter table public.trade_item_ownership_shares disable row level security;
alter table public.inventory_trade_lineage disable row level security;
