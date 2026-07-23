-- Flexible Sales Control ownership shares. Safe and additive.

create table if not exists public.inventory_ownership_shares (
  id uuid primary key default gen_random_uuid(),
  inventory_purchase_id uuid not null references public.inventory_purchases(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  ownership_percentage numeric(6, 3) not null,
  contribution_amount numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_purchase_id, worker_id)
);

create table if not exists public.sale_profit_shares (
  id uuid primary key default gen_random_uuid(),
  sales_record_id uuid not null references public.sales_records(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  ownership_percentage numeric(6, 3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sales_record_id, worker_id)
);

alter table public.inventory_ownership_shares add column if not exists inventory_purchase_id uuid references public.inventory_purchases(id) on delete cascade;
alter table public.inventory_ownership_shares add column if not exists worker_id uuid references public.workers(id) on delete cascade;
alter table public.inventory_ownership_shares add column if not exists ownership_percentage numeric(6, 3);
alter table public.inventory_ownership_shares add column if not exists contribution_amount numeric(12, 2);
alter table public.inventory_ownership_shares add column if not exists created_at timestamptz not null default now();
alter table public.inventory_ownership_shares add column if not exists updated_at timestamptz not null default now();

alter table public.sale_profit_shares add column if not exists sales_record_id uuid references public.sales_records(id) on delete cascade;
alter table public.sale_profit_shares add column if not exists worker_id uuid references public.workers(id) on delete cascade;
alter table public.sale_profit_shares add column if not exists ownership_percentage numeric(6, 3);
alter table public.sale_profit_shares add column if not exists created_at timestamptz not null default now();
alter table public.sale_profit_shares add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_inventory_ownership_purchase_id on public.inventory_ownership_shares(inventory_purchase_id);
create index if not exists idx_inventory_ownership_worker_id on public.inventory_ownership_shares(worker_id);
create unique index if not exists uq_inventory_ownership_purchase_worker on public.inventory_ownership_shares(inventory_purchase_id, worker_id);
create index if not exists idx_sale_profit_shares_sales_record_id on public.sale_profit_shares(sales_record_id);
create index if not exists idx_sale_profit_shares_worker_id on public.sale_profit_shares(worker_id);
create unique index if not exists uq_sale_profit_shares_sale_worker on public.sale_profit_shares(sales_record_id, worker_id);
