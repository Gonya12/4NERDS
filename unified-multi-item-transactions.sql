-- Generalize the existing canonical trade transaction header/item model.
-- Safe and repeatable: no data is deleted, renamed, or automatically migrated.

alter table public.trade_transactions add column if not exists transaction_type text not null default 'trade';
alter table public.trade_transactions add column if not exists item_mode text not null default 'multiple';
alter table public.trade_transactions add column if not exists pricing_mode text not null default 'individual';
alter table public.trade_transactions add column if not exists bundle_total numeric(12,2);
alter table public.trade_transactions add column if not exists payment_method text;
alter table public.trade_transactions add column if not exists purchase_source text;
alter table public.trade_transactions add column if not exists expense_category text;
alter table public.trade_transactions add column if not exists paid_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.trade_transactions add column if not exists keep_as_bundle boolean not null default false;

alter table public.trade_items add column if not exists trade_percentage numeric(7,3);
alter table public.trade_items add column if not exists sold_price numeric(12,2);
alter table public.trade_items add column if not exists bought_price numeric(12,2);
alter table public.trade_items add column if not exists created_sales_record_id uuid references public.sales_records(id) on delete set null;
alter table public.trade_items add column if not exists created_business_expense_id uuid references public.business_expenses(id) on delete set null;

alter table public.sales_records add column if not exists financial_transaction_id uuid references public.trade_transactions(id) on delete set null;
alter table public.inventory_purchases add column if not exists financial_transaction_id uuid references public.trade_transactions(id) on delete set null;
alter table public.business_expenses add column if not exists financial_transaction_id uuid references public.trade_transactions(id) on delete set null;

create table if not exists public.transaction_internal_balances (
  id uuid primary key default gen_random_uuid(),
  trade_transaction_id uuid not null references public.trade_transactions(id) on delete cascade,
  owed_by_worker_id uuid not null references public.workers(id) on delete restrict,
  owed_to_worker_id uuid not null references public.workers(id) on delete restrict,
  amount numeric(12,2) not null default 0,
  settled boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_trade_transactions_type on public.trade_transactions(transaction_type);
create index if not exists idx_trade_transactions_type_date on public.trade_transactions(transaction_type, trade_date desc);
create index if not exists idx_sales_records_financial_transaction on public.sales_records(financial_transaction_id);
create index if not exists idx_inventory_purchases_financial_transaction on public.inventory_purchases(financial_transaction_id);
create index if not exists idx_business_expenses_financial_transaction on public.business_expenses(financial_transaction_id);
create index if not exists idx_transaction_internal_balances_transaction on public.transaction_internal_balances(trade_transaction_id);
create unique index if not exists uq_transaction_internal_balance_workers on public.transaction_internal_balances(trade_transaction_id, owed_by_worker_id, owed_to_worker_id);

-- Match the current private MVP access pattern.
alter table public.transaction_internal_balances disable row level security;
