-- Sales Control schema sync
-- Safe, additive, repeatable migration for the CURRENT Sales Control code.
-- Existing rows are preserved. No tables, columns, or data are removed.

-- ---------------------------------------------------------------------------
-- Supporting tables read by Sales Control dropdowns and relationships
-- ---------------------------------------------------------------------------

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workers add column if not exists name text;
alter table public.workers add column if not exists active boolean not null default true;
alter table public.workers add column if not exists created_at timestamptz not null default now();
alter table public.workers add column if not exists updated_at timestamptz not null default now();

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date,
  start_time text,
  end_time text,
  venue_name text,
  address text,
  city text,
  state text,
  registration_status text not null default 'unknown',
  image_url text,
  image_path text,
  status text not null default 'interested',
  event_stage text not null default 'new',
  split_mode text not null default 'equal',
  event_cost numeric(10, 2) not null default 0,
  external_source text,
  external_source_id text,
  calendar_feed_id uuid,
  imported_from_calendar boolean not null default false,
  manually_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events add column if not exists name text;
alter table public.events add column if not exists start_date date;
alter table public.events add column if not exists end_date date;
alter table public.events add column if not exists start_time text;
alter table public.events add column if not exists end_time text;
alter table public.events add column if not exists venue_name text;
alter table public.events add column if not exists address text;
alter table public.events add column if not exists city text;
alter table public.events add column if not exists state text;
alter table public.events add column if not exists registration_status text not null default 'unknown';
alter table public.events add column if not exists image_url text;
alter table public.events add column if not exists image_path text;
alter table public.events add column if not exists status text not null default 'interested';
alter table public.events add column if not exists event_stage text not null default 'new';
alter table public.events add column if not exists split_mode text not null default 'equal';
alter table public.events add column if not exists event_cost numeric(10, 2) not null default 0;
alter table public.events add column if not exists external_source text;
alter table public.events add column if not exists external_source_id text;
alter table public.events add column if not exists calendar_feed_id uuid;
alter table public.events add column if not exists imported_from_calendar boolean not null default false;
alter table public.events add column if not exists manually_edited boolean not null default false;
alter table public.events add column if not exists created_at timestamptz not null default now();
alter table public.events add column if not exists updated_at timestamptz not null default now();

create table if not exists public.event_days (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  date date not null,
  start_time text,
  end_time text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_days add column if not exists event_id uuid references public.events(id) on delete cascade;
alter table public.event_days add column if not exists date date;
alter table public.event_days add column if not exists start_time text;
alter table public.event_days add column if not exists end_time text;
alter table public.event_days add column if not exists note text;
alter table public.event_days add column if not exists created_at timestamptz not null default now();
alter table public.event_days add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Inventory purchases: every column read/written by inventoryPurchaseRepository
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_purchases (
  id uuid primary key default gen_random_uuid(),
  image_url text,
  image_path text,
  item_name text not null default 'Untitled Pokemon item',
  category text not null default 'other_pokemon_product',
  quantity integer not null default 1,
  quantity_sold integer not null default 0,
  purchase_date timestamptz not null default now(),
  total_cost numeric(10, 2) not null default 0,
  market_value numeric(10, 2),
  is_raw_card boolean not null default false,
  buy_percentage numeric(5, 2),
  target_buy_price numeric(10, 2),
  purchase_source text,
  seller text,
  event_id uuid references public.events(id) on delete set null,
  purchased_by_worker_id uuid references public.workers(id) on delete set null,
  notes text,
  status text not null default 'in_stock',
  sold_price numeric(10, 2),
  sold_date timestamptz,
  sold_by_worker_id uuid references public.workers(id) on delete set null,
  sold_event_id uuid references public.events(id) on delete set null,
  sold_payment_method text,
  buyer_note text,
  card_name text,
  collector_number text,
  card_set text,
  card_language text,
  card_condition text,
  sticker_price numeric(10, 2),
  grading_company text,
  grade text,
  certificate_number text,
  front_image_url text,
  front_image_path text,
  back_image_url text,
  back_image_path text,
  scan_confidence text,
  scan_status text not null default 'not_scanned',
  image_hash text,
  scan_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_purchases add column if not exists image_url text;
alter table public.inventory_purchases add column if not exists image_path text;
alter table public.inventory_purchases add column if not exists item_name text not null default 'Untitled Pokemon item';
alter table public.inventory_purchases add column if not exists category text not null default 'other_pokemon_product';
alter table public.inventory_purchases add column if not exists quantity integer not null default 1;
alter table public.inventory_purchases add column if not exists quantity_sold integer not null default 0;
alter table public.inventory_purchases add column if not exists purchase_date timestamptz not null default now();
alter table public.inventory_purchases add column if not exists total_cost numeric(10, 2) not null default 0;
alter table public.inventory_purchases add column if not exists market_value numeric(10, 2);
alter table public.inventory_purchases add column if not exists is_raw_card boolean not null default false;
alter table public.inventory_purchases add column if not exists buy_percentage numeric(5, 2);
alter table public.inventory_purchases add column if not exists target_buy_price numeric(10, 2);
alter table public.inventory_purchases add column if not exists purchase_source text;
alter table public.inventory_purchases add column if not exists seller text;
alter table public.inventory_purchases add column if not exists event_id uuid references public.events(id) on delete set null;
alter table public.inventory_purchases add column if not exists purchased_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.inventory_purchases add column if not exists notes text;
alter table public.inventory_purchases add column if not exists status text not null default 'in_stock';
alter table public.inventory_purchases add column if not exists sold_price numeric(10, 2);
alter table public.inventory_purchases add column if not exists sold_date timestamptz;
alter table public.inventory_purchases add column if not exists sold_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.inventory_purchases add column if not exists sold_event_id uuid references public.events(id) on delete set null;
alter table public.inventory_purchases add column if not exists sold_payment_method text;
alter table public.inventory_purchases add column if not exists buyer_note text;
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
alter table public.inventory_purchases add column if not exists created_at timestamptz not null default now();
alter table public.inventory_purchases add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Sales records: every explicit select and upsert column in salesRepository
-- ---------------------------------------------------------------------------

create table if not exists public.sales_records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  event_day_id uuid references public.event_days(id) on delete set null,
  image_url text,
  image_path text,
  item_name text,
  category text,
  quantity integer not null default 1,
  sold_price numeric(10, 2),
  bought_price numeric(10, 2),
  market_value numeric(10, 2),
  bought_from text,
  purchase_source text,
  payment_method text,
  sold_by_worker_id uuid references public.workers(id) on delete set null,
  is_raw_card boolean not null default false,
  buy_percentage numeric(5, 2),
  target_buy_price numeric(10, 2),
  inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  notes text,
  sold_at timestamptz not null default now(),
  pending_upload boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales_records add column if not exists event_id uuid references public.events(id) on delete set null;
alter table public.sales_records add column if not exists event_day_id uuid references public.event_days(id) on delete set null;
alter table public.sales_records add column if not exists image_url text;
alter table public.sales_records add column if not exists image_path text;
alter table public.sales_records add column if not exists item_name text;
alter table public.sales_records add column if not exists category text;
alter table public.sales_records add column if not exists quantity integer not null default 1;
alter table public.sales_records add column if not exists sold_price numeric(10, 2);
alter table public.sales_records add column if not exists bought_price numeric(10, 2);
alter table public.sales_records add column if not exists market_value numeric(10, 2);
alter table public.sales_records add column if not exists bought_from text;
alter table public.sales_records add column if not exists purchase_source text;
alter table public.sales_records add column if not exists payment_method text;
alter table public.sales_records add column if not exists sold_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.sales_records add column if not exists is_raw_card boolean not null default false;
alter table public.sales_records add column if not exists buy_percentage numeric(5, 2);
alter table public.sales_records add column if not exists target_buy_price numeric(10, 2);
alter table public.sales_records add column if not exists inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null;
alter table public.sales_records add column if not exists notes text;
alter table public.sales_records add column if not exists sold_at timestamptz not null default now();
alter table public.sales_records add column if not exists pending_upload boolean not null default false;
alter table public.sales_records add column if not exists created_at timestamptz not null default now();
alter table public.sales_records add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Business expenses: every column read/written by businessExpenseRepository
-- ---------------------------------------------------------------------------

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date timestamptz not null default now(),
  amount numeric(10, 2) not null default 0,
  category text not null default 'other',
  description text not null default '',
  event_id uuid references public.events(id) on delete set null,
  paid_by_worker_id uuid references public.workers(id) on delete set null,
  vendor text,
  receipt_image_url text,
  receipt_image_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_expenses add column if not exists expense_date timestamptz not null default now();
alter table public.business_expenses add column if not exists amount numeric(10, 2) not null default 0;
alter table public.business_expenses add column if not exists category text not null default 'other';
alter table public.business_expenses add column if not exists description text not null default '';
alter table public.business_expenses add column if not exists event_id uuid references public.events(id) on delete set null;
alter table public.business_expenses add column if not exists paid_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.business_expenses add column if not exists vendor text;
alter table public.business_expenses add column if not exists receipt_image_url text;
alter table public.business_expenses add column if not exists receipt_image_path text;
alter table public.business_expenses add column if not exists notes text;
alter table public.business_expenses add column if not exists created_at timestamptz not null default now();
alter table public.business_expenses add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Legacy naming compatibility (non-destructive value copies only)
-- These blocks run only when the legacy source column actually exists.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_purchases' and column_name = 'raw_card'
  ) then
    execute 'update public.inventory_purchases
             set is_raw_card = coalesce(raw_card, false)
             where raw_card is not null and is_raw_card is distinct from raw_card';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'business_expenses' and column_name = 'vendor_or_store'
  ) then
    execute 'update public.business_expenses
             set vendor = vendor_or_store
             where vendor is null and vendor_or_store is not null';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_purchases' and column_name = 'actual_bought_price'
  ) then
    execute 'update public.inventory_purchases
             set total_cost = actual_bought_price
             where actual_bought_price is not null and coalesce(total_cost, 0) = 0';
  end if;
end $$;

-- Keep compatibility thumbnail fields populated for slab/front images.
update public.inventory_purchases
set front_image_url = image_url
where front_image_url is null and image_url is not null;

update public.inventory_purchases
set front_image_path = image_path
where front_image_path is null and image_path is not null;

update public.inventory_purchases
set image_url = front_image_url
where image_url is null and front_image_url is not null;

update public.inventory_purchases
set image_path = front_image_path
where image_path is null and front_image_path is not null;

-- ---------------------------------------------------------------------------
-- Indexes used by ordering, filters, joins, search, and duplicate warnings
-- ---------------------------------------------------------------------------

create index if not exists idx_workers_name on public.workers(name);
create index if not exists idx_workers_active on public.workers(active);
create index if not exists idx_events_start_date on public.events(start_date);
create index if not exists idx_event_days_event_id on public.event_days(event_id);
create index if not exists idx_event_days_date on public.event_days(date);

create index if not exists idx_sales_records_sold_at on public.sales_records(sold_at);
create index if not exists idx_sales_records_event_id on public.sales_records(event_id);
create index if not exists idx_sales_records_event_day_id on public.sales_records(event_day_id);
create index if not exists idx_sales_records_sold_by_worker_id on public.sales_records(sold_by_worker_id);
create index if not exists idx_sales_records_inventory_purchase_id on public.sales_records(inventory_purchase_id);
create index if not exists idx_sales_records_pending_upload on public.sales_records(pending_upload);
create index if not exists idx_sales_records_category on public.sales_records(category);

create index if not exists idx_inventory_purchases_purchase_date on public.inventory_purchases(purchase_date);
create index if not exists idx_inventory_purchases_status on public.inventory_purchases(status);
create index if not exists idx_inventory_purchases_event_id on public.inventory_purchases(event_id);
create index if not exists idx_inventory_purchases_purchased_by_worker_id on public.inventory_purchases(purchased_by_worker_id);
create index if not exists idx_inventory_purchases_sold_by_worker_id on public.inventory_purchases(sold_by_worker_id);
create index if not exists idx_inventory_purchases_sold_event_id on public.inventory_purchases(sold_event_id);
create index if not exists idx_inventory_purchases_sold_date on public.inventory_purchases(sold_date);
create index if not exists idx_inventory_purchases_card_name on public.inventory_purchases(card_name);
create index if not exists idx_inventory_purchases_collector_number on public.inventory_purchases(collector_number);
create index if not exists idx_inventory_purchases_card_set on public.inventory_purchases(card_set);
create index if not exists idx_inventory_purchases_card_condition on public.inventory_purchases(card_condition);
create index if not exists idx_inventory_purchases_certificate_number on public.inventory_purchases(certificate_number)
  where certificate_number is not null and btrim(certificate_number) <> '';
create index if not exists idx_inventory_purchases_scan_status on public.inventory_purchases(scan_status);
create index if not exists idx_inventory_purchases_image_hash on public.inventory_purchases(image_hash)
  where image_hash is not null and btrim(image_hash) <> '';

create index if not exists idx_business_expenses_expense_date on public.business_expenses(expense_date);
create index if not exists idx_business_expenses_event_id on public.business_expenses(event_id);
create index if not exists idx_business_expenses_paid_by_worker_id on public.business_expenses(paid_by_worker_id);
create index if not exists idx_business_expenses_category on public.business_expenses(category);
create index if not exists idx_business_expenses_vendor on public.business_expenses(vendor);
