-- Canonical unified Sales Control transaction system.
-- Safe and repeatable. Existing sales, inventory, expenses, and transactions are preserved.

create table if not exists public.financial_transactions (
  id uuid primary key,
  transaction_type text not null check (transaction_type in ('sale','purchase','expense','trade','cash_trade')),
  transaction_date timestamptz not null default now(),
  event_id uuid references public.events(id) on delete set null,
  event_day_id uuid references public.event_days(id) on delete set null,
  customer_or_seller text,
  item_mode text not null default 'single' check (item_mode in ('single','multiple')),
  pricing_mode text not null default 'individual' check (pricing_mode in ('individual','bundle_total')),
  bundle_total numeric(12,2),
  payment_method text,
  purchase_source text,
  expense_category text,
  entered_by_worker_id uuid references public.workers(id) on delete set null,
  paid_by_worker_id uuid references public.workers(id) on delete set null,
  keep_as_bundle boolean not null default false,
  cash_received numeric(12,2) not null default 0 check (cash_received >= 0),
  cash_paid numeric(12,2) not null default 0 check (cash_paid >= 0),
  notes text,
  status text not null default 'draft' check (status in ('draft','completed','cancelled','reversed')),
  completed_at timestamptz,
  reversed_at timestamptz,
  reversal_of_transaction_id uuid references public.financial_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_transaction_items (
  id uuid primary key,
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  direction text not null check (direction in ('outgoing','incoming','expense')),
  inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  created_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  created_sales_record_id uuid references public.sales_records(id) on delete set null,
  created_business_expense_id uuid references public.business_expenses(id) on delete set null,
  prior_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  item_name text not null,
  item_type text not null default 'other_pokemon_product',
  quantity integer not null default 1 check (quantity > 0),
  market_value numeric(12,2) not null default 0,
  agreed_trade_value numeric(12,2) not null default 0,
  trade_percentage numeric(7,3),
  historical_cost_basis numeric(12,2) not null default 0,
  allocated_cost_basis numeric(12,2) not null default 0,
  sold_price numeric(12,2),
  bought_price numeric(12,2),
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

create table if not exists public.transaction_item_ownership_shares (
  id uuid primary key default gen_random_uuid(),
  transaction_item_id uuid not null references public.financial_transaction_items(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  ownership_percentage numeric(7,3) not null check (ownership_percentage > 0 and ownership_percentage <= 100),
  allocated_cost_basis numeric(12,2),
  allocated_trade_value numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transaction_payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  direction text not null check (direction in ('received','paid')),
  payment_method text not null default 'cash',
  amount numeric(12,2) not null default 0 check (amount >= 0),
  worker_id uuid references public.workers(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transaction_internal_balances (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  owed_by_worker_id uuid not null references public.workers(id) on delete restrict,
  owed_to_worker_id uuid not null references public.workers(id) on delete restrict,
  amount numeric(12,2) not null default 0,
  settled boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_lineage (
  id uuid primary key default gen_random_uuid(),
  source_inventory_purchase_id uuid not null references public.inventory_purchases(id) on delete restrict,
  resulting_inventory_purchase_id uuid not null references public.inventory_purchases(id) on delete restrict,
  transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  relationship_type text not null default 'exchanged_for',
  created_at timestamptz not null default now()
);

create table if not exists public.transaction_images (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  transaction_item_id uuid references public.financial_transaction_items(id) on delete cascade,
  image_type text not null default 'transaction',
  image_url text not null,
  image_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add canonical fields safely when the tables already exist.
alter table public.financial_transactions add column if not exists customer_or_seller text;
alter table public.financial_transactions add column if not exists cash_received numeric(12,2) not null default 0;
alter table public.financial_transactions add column if not exists cash_paid numeric(12,2) not null default 0;
alter table public.financial_transaction_items add column if not exists transaction_id uuid references public.financial_transactions(id) on delete cascade;
alter table public.transaction_item_ownership_shares add column if not exists transaction_item_id uuid references public.financial_transaction_items(id) on delete cascade;
alter table public.transaction_payments add column if not exists transaction_id uuid references public.financial_transactions(id) on delete cascade;
alter table public.transaction_internal_balances add column if not exists transaction_id uuid references public.financial_transactions(id) on delete cascade;
alter table public.inventory_lineage add column if not exists transaction_id uuid references public.financial_transactions(id) on delete restrict;
alter table public.transaction_images add column if not exists transaction_id uuid references public.financial_transactions(id) on delete cascade;
alter table public.transaction_images add column if not exists transaction_item_id uuid references public.financial_transaction_items(id) on delete cascade;

alter table public.sales_records add column if not exists financial_transaction_id uuid references public.financial_transactions(id) on delete set null;
alter table public.sales_records add column if not exists financial_transaction_item_id uuid references public.financial_transaction_items(id) on delete set null;
alter table public.inventory_purchases add column if not exists financial_transaction_id uuid references public.financial_transactions(id) on delete set null;
alter table public.inventory_purchases add column if not exists financial_transaction_item_id uuid references public.financial_transaction_items(id) on delete set null;
alter table public.business_expenses add column if not exists financial_transaction_id uuid references public.financial_transactions(id) on delete set null;
alter table public.business_expenses add column if not exists financial_transaction_item_id uuid references public.financial_transaction_items(id) on delete set null;
alter table public.inventory_purchases add column if not exists acquisition_method text default 'purchased';
alter table public.inventory_purchases add column if not exists acquired_financial_transaction_id uuid references public.financial_transactions(id) on delete set null;
alter table public.inventory_purchases add column if not exists disposed_financial_transaction_id uuid references public.financial_transactions(id) on delete set null;
alter table public.inventory_purchases add column if not exists traded_at timestamptz;
alter table public.inventory_purchases add column if not exists agreed_trade_value numeric(12,2);
alter table public.inventory_purchases add column if not exists prior_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null;

create index if not exists idx_financial_transactions_type_date on public.financial_transactions(transaction_type, transaction_date desc);
create index if not exists idx_financial_transactions_status on public.financial_transactions(status);
create index if not exists idx_financial_transactions_event on public.financial_transactions(event_id);
create index if not exists idx_financial_transaction_items_transaction on public.financial_transaction_items(transaction_id);
create index if not exists idx_financial_transaction_items_inventory on public.financial_transaction_items(inventory_purchase_id);
create index if not exists idx_financial_transaction_items_name on public.financial_transaction_items(item_name);
create unique index if not exists uq_transaction_item_owner on public.transaction_item_ownership_shares(transaction_item_id, worker_id);
create unique index if not exists uq_transaction_payment_direction_method on public.transaction_payments(transaction_id, direction, payment_method);
create unique index if not exists uq_transaction_internal_balance_workers on public.transaction_internal_balances(transaction_id, owed_by_worker_id, owed_to_worker_id);
create unique index if not exists uq_inventory_lineage on public.inventory_lineage(source_inventory_purchase_id, resulting_inventory_purchase_id, transaction_id);
create index if not exists idx_transaction_images_transaction on public.transaction_images(transaction_id);
create index if not exists idx_transaction_images_item on public.transaction_images(transaction_item_id);
create index if not exists idx_sales_records_financial_transaction on public.sales_records(financial_transaction_id);
create index if not exists idx_inventory_purchases_financial_transaction on public.inventory_purchases(financial_transaction_id);
create index if not exists idx_business_expenses_financial_transaction on public.business_expenses(financial_transaction_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transaction-images', 'transaction-images', true, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = true;

alter table public.financial_transactions disable row level security;
alter table public.financial_transaction_items disable row level security;
alter table public.transaction_item_ownership_shares disable row level security;
alter table public.transaction_payments disable row level security;
alter table public.transaction_internal_balances disable row level security;
alter table public.inventory_lineage disable row level security;
alter table public.transaction_images disable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'transaction images anon access') then
    execute 'create policy "transaction images anon access" on storage.objects for all to anon using (bucket_id = ''transaction-images'') with check (bucket_id = ''transaction-images'')';
  end if;
end $$;
