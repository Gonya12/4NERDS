create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('sale-images', 'sale-images', true)
on conflict (id) do update set public = true;

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venue_name text,
  address text,
  city text,
  state text,
  zip text,
  instagram_handle text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ics_url text not null,
  enabled boolean not null default true,
  auto_import boolean not null default false,
  last_checked_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.calendar_feeds (id, name, ics_url, enabled, auto_import)
select
  '5f4d64a9-c424-4432-8db7-18bd4c07c1c9'::uuid,
  'NJ Pokémon Events Calendar',
  'https://calendar.google.com/calendar/ical/5f4d64a9c42414328db718bd4c07c1c912543a838042231abe151ebdc178d7a1%40group.calendar.google.com/public/basic.ics',
  true,
  false
where not exists (
  select 1
  from public.calendar_feeds
  where ics_url = 'https://calendar.google.com/calendar/ical/5f4d64a9c42414328db718bd4c07c1c912543a838042231abe151ebdc178d7a1%40group.calendar.google.com/public/basic.ics'
);

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
  registration_status text not null default 'unknown' check (registration_status in ('open', 'closed', 'unknown', 'sold_out', 'waitlist')),
  registration_url text,
  source_url text,
  notes text,
  image_url text,
  image_path text,
  location_id uuid references public.locations(id),
  location_instagram_handle text,
  organizer_instagram_handle text,
  status text not null default 'interested',
  event_stage text not null default 'new' check (event_stage in ('new', 'applied', 'paid', 'past')),
  external_source text,
  external_source_id text,
  calendar_feed_id uuid references public.calendar_feeds(id) on delete set null,
  imported_from_calendar boolean not null default false,
  manually_edited boolean not null default false,
  packing_notes text,
  booth_number text,
  setup_time text,
  parking_notes text,
  floor_section text,
  entry_instructions text,
  split_mode text not null default 'equal' check (split_mode in ('equal', 'weighted_by_days')),
  event_cost numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.event_workers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, worker_id)
);

create table if not exists public.event_day_workers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  event_day_id uuid not null references public.event_days(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_day_id, worker_id)
);

create table if not exists public.event_price_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null,
  price numeric(10, 2) not null default 0,
  pricing_type text not null default 'flat' check (pricing_type in ('flat', 'per_day', 'package')),
  applies_to_day_ids uuid[],
  description text,
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  amount_paid numeric(10, 2) not null default 0,
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_checklist_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_finances (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  total_sales numeric(10, 2) not null default 0,
  total_expenses numeric(10, 2) not null default 0,
  gas_cost numeric(10, 2) not null default 0,
  food_cost numeric(10, 2) not null default 0,
  misc_cost numeric(10, 2) not null default 0,
  profit_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id)
);

create table if not exists public.event_live_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  worker_id uuid references public.workers(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_sales_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  category text not null,
  amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, category)
);

create table if not exists public.event_reviews (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  overall_rating numeric(3, 1) not null default 0,
  traffic_rating numeric(3, 1) not null default 0,
  organizer_rating numeric(3, 1) not null default 0,
  profit_rating numeric(3, 1) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id)
);

create table if not exists public.sales_records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  event_day_id uuid references public.event_days(id) on delete set null,
  image_url text,
  image_path text,
  item_name text,
  sold_price numeric(10, 2),
  bought_price numeric(10, 2),
  bought_from text,
  notes text,
  sold_at timestamptz not null default now(),
  pending_upload boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_purchases (
  id uuid primary key default gen_random_uuid(),
  image_url text,
  image_path text,
  item_name text not null,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.buy_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  product_url text,
  image_url text,
  estimated_price numeric(10, 2),
  quantity integer not null default 1,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  purchased boolean not null default false,
  purchased_by text,
  purchased_by_worker_id uuid references public.workers(id) on delete set null,
  purchased_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events add column if not exists image_url text;
alter table public.events add column if not exists image_path text;
alter table public.events add column if not exists location_id uuid references public.locations(id);
alter table public.events add column if not exists location_instagram_handle text;
alter table public.events add column if not exists organizer_instagram_handle text;
alter table public.events add column if not exists status text not null default 'interested';
alter table public.events add column if not exists event_stage text not null default 'new';
alter table public.events add column if not exists external_source text;
alter table public.events add column if not exists external_source_id text;
alter table public.events add column if not exists calendar_feed_id uuid references public.calendar_feeds(id) on delete set null;
alter table public.events add column if not exists imported_from_calendar boolean not null default false;
alter table public.events add column if not exists manually_edited boolean not null default false;
alter table public.events add column if not exists packing_notes text;
alter table public.events add column if not exists booth_number text;
alter table public.events add column if not exists setup_time text;
alter table public.events add column if not exists parking_notes text;
alter table public.events add column if not exists floor_section text;
alter table public.events add column if not exists entry_instructions text;
alter table public.events add column if not exists split_mode text not null default 'equal';
alter table public.events add column if not exists updated_at timestamptz not null default now();
alter table public.event_workers add column if not exists updated_at timestamptz not null default now();
alter table public.event_day_workers add column if not exists updated_at timestamptz not null default now();
alter table public.event_price_options add column if not exists updated_at timestamptz not null default now();
alter table public.payment_records add column if not exists updated_at timestamptz not null default now();
alter table public.payment_records add column if not exists paid_at timestamptz;
alter table public.payment_records alter column paid_at type timestamptz using paid_at::timestamptz;
alter table public.event_checklist_items add column if not exists updated_at timestamptz not null default now();
alter table public.event_finances add column if not exists updated_at timestamptz not null default now();
alter table public.event_live_notes add column if not exists updated_at timestamptz not null default now();
alter table public.event_sales_categories add column if not exists updated_at timestamptz not null default now();
alter table public.event_reviews add column if not exists updated_at timestamptz not null default now();
alter table public.sales_records add column if not exists updated_at timestamptz not null default now();
alter table public.sales_records add column if not exists pending_upload boolean not null default false;
alter table public.sales_records add column if not exists category text;
alter table public.sales_records add column if not exists quantity integer not null default 1;
alter table public.sales_records add column if not exists market_value numeric(10, 2);
alter table public.sales_records add column if not exists purchase_source text;
alter table public.sales_records add column if not exists payment_method text;
alter table public.sales_records add column if not exists sold_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.sales_records add column if not exists is_raw_card boolean not null default false;
alter table public.sales_records add column if not exists buy_percentage numeric(5, 2);
alter table public.sales_records add column if not exists target_buy_price numeric(10, 2);
alter table public.sales_records add column if not exists inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null;
alter table public.inventory_purchases add column if not exists quantity_sold integer not null default 0;
alter table public.inventory_purchases add column if not exists sold_price numeric(10, 2);
alter table public.inventory_purchases add column if not exists sold_date timestamptz;
alter table public.inventory_purchases add column if not exists sold_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.inventory_purchases add column if not exists sold_event_id uuid references public.events(id) on delete set null;
alter table public.inventory_purchases add column if not exists sold_payment_method text;
alter table public.inventory_purchases add column if not exists buyer_note text;
alter table public.buy_items add column if not exists updated_at timestamptz not null default now();
alter table public.buy_items add column if not exists purchased boolean not null default false;
alter table public.buy_items add column if not exists purchased_by text;
alter table public.buy_items add column if not exists purchased_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.buy_items add column if not exists purchased_at timestamptz;
alter table public.calendar_feeds add column if not exists updated_at timestamptz not null default now();

insert into public.workers (name, active)
values
  ('Gonzalo', true),
  ('Thiago', true),
  ('Ivan', true),
  ('Nahuel', true),
  ('Slave 1', true),
  ('Slave 2', true),
  ('Slave 3', true)
on conflict (name) do nothing;

alter table public.workers replica identity full;
alter table public.events replica identity full;
alter table public.event_workers replica identity full;
alter table public.event_day_workers replica identity full;
alter table public.event_price_options replica identity full;
alter table public.payment_records replica identity full;
alter table public.locations replica identity full;
alter table public.calendar_feeds replica identity full;
alter table public.event_days replica identity full;
alter table public.event_checklist_items replica identity full;
alter table public.event_finances replica identity full;
alter table public.event_live_notes replica identity full;
alter table public.event_sales_categories replica identity full;
alter table public.event_reviews replica identity full;
alter table public.sales_records replica identity full;
alter table public.buy_items replica identity full;
alter table public.inventory_purchases replica identity full;
alter table public.business_expenses replica identity full;

alter table public.workers enable row level security;
alter table public.events enable row level security;
alter table public.event_workers enable row level security;
alter table public.event_day_workers enable row level security;
alter table public.event_price_options enable row level security;
alter table public.payment_records enable row level security;
alter table public.locations enable row level security;
alter table public.event_days enable row level security;
alter table public.event_checklist_items enable row level security;
alter table public.event_finances enable row level security;
alter table public.event_live_notes enable row level security;
alter table public.event_sales_categories enable row level security;
alter table public.event_reviews enable row level security;
alter table public.sales_records enable row level security;
alter table public.buy_items enable row level security;
alter table public.inventory_purchases enable row level security;
alter table public.business_expenses enable row level security;
alter table public.calendar_feeds enable row level security;

drop policy if exists "private MVP anon read workers" on public.workers;
drop policy if exists "private MVP anon write workers" on public.workers;
drop policy if exists "private MVP anon read events" on public.events;
drop policy if exists "private MVP anon write events" on public.events;
drop policy if exists "private MVP anon read event workers" on public.event_workers;
drop policy if exists "private MVP anon write event workers" on public.event_workers;
drop policy if exists "private MVP anon read event day workers" on public.event_day_workers;
drop policy if exists "private MVP anon write event day workers" on public.event_day_workers;
drop policy if exists "private MVP anon read price options" on public.event_price_options;
drop policy if exists "private MVP anon write price options" on public.event_price_options;
drop policy if exists "private MVP anon read payment records" on public.payment_records;
drop policy if exists "private MVP anon write payment records" on public.payment_records;
drop policy if exists "private MVP anon read locations" on public.locations;
drop policy if exists "private MVP anon write locations" on public.locations;
drop policy if exists "private MVP anon read event days" on public.event_days;
drop policy if exists "private MVP anon write event days" on public.event_days;
drop policy if exists "private MVP anon read checklist" on public.event_checklist_items;
drop policy if exists "private MVP anon write checklist" on public.event_checklist_items;
drop policy if exists "private MVP anon read finances" on public.event_finances;
drop policy if exists "private MVP anon write finances" on public.event_finances;
drop policy if exists "private MVP anon read live notes" on public.event_live_notes;
drop policy if exists "private MVP anon write live notes" on public.event_live_notes;
drop policy if exists "private MVP anon read sales categories" on public.event_sales_categories;
drop policy if exists "private MVP anon write sales categories" on public.event_sales_categories;
drop policy if exists "private MVP anon read reviews" on public.event_reviews;
drop policy if exists "private MVP anon write reviews" on public.event_reviews;
drop policy if exists "private MVP anon read sales records" on public.sales_records;
drop policy if exists "private MVP anon write sales records" on public.sales_records;
drop policy if exists "private MVP anon read buy items" on public.buy_items;
drop policy if exists "private MVP anon write buy items" on public.buy_items;
drop policy if exists "private MVP anon read inventory purchases" on public.inventory_purchases;
drop policy if exists "private MVP anon write inventory purchases" on public.inventory_purchases;
drop policy if exists "private MVP anon read business expenses" on public.business_expenses;
drop policy if exists "private MVP anon write business expenses" on public.business_expenses;
drop policy if exists "private MVP anon read calendar feeds" on public.calendar_feeds;
drop policy if exists "private MVP anon write calendar feeds" on public.calendar_feeds;

create policy "private MVP anon read workers" on public.workers for select to anon using (true);
create policy "private MVP anon write workers" on public.workers for all to anon using (true) with check (true);
create policy "private MVP anon read events" on public.events for select to anon using (true);
create policy "private MVP anon write events" on public.events for all to anon using (true) with check (true);
create policy "private MVP anon read event workers" on public.event_workers for select to anon using (true);
create policy "private MVP anon write event workers" on public.event_workers for all to anon using (true) with check (true);
create policy "private MVP anon read event day workers" on public.event_day_workers for select to anon using (true);
create policy "private MVP anon write event day workers" on public.event_day_workers for all to anon using (true) with check (true);
create policy "private MVP anon read price options" on public.event_price_options for select to anon using (true);
create policy "private MVP anon write price options" on public.event_price_options for all to anon using (true) with check (true);
create policy "private MVP anon read payment records" on public.payment_records for select to anon using (true);
create policy "private MVP anon write payment records" on public.payment_records for all to anon using (true) with check (true);
create policy "private MVP anon read locations" on public.locations for select to anon using (true);
create policy "private MVP anon write locations" on public.locations for all to anon using (true) with check (true);
create policy "private MVP anon read event days" on public.event_days for select to anon using (true);
create policy "private MVP anon write event days" on public.event_days for all to anon using (true) with check (true);
create policy "private MVP anon read checklist" on public.event_checklist_items for select to anon using (true);
create policy "private MVP anon write checklist" on public.event_checklist_items for all to anon using (true) with check (true);
create policy "private MVP anon read finances" on public.event_finances for select to anon using (true);
create policy "private MVP anon write finances" on public.event_finances for all to anon using (true) with check (true);
create policy "private MVP anon read live notes" on public.event_live_notes for select to anon using (true);
create policy "private MVP anon write live notes" on public.event_live_notes for all to anon using (true) with check (true);
create policy "private MVP anon read sales categories" on public.event_sales_categories for select to anon using (true);
create policy "private MVP anon write sales categories" on public.event_sales_categories for all to anon using (true) with check (true);
create policy "private MVP anon read reviews" on public.event_reviews for select to anon using (true);
create policy "private MVP anon write reviews" on public.event_reviews for all to anon using (true) with check (true);
create policy "private MVP anon read sales records" on public.sales_records for select to anon using (true);
create policy "private MVP anon write sales records" on public.sales_records for all to anon using (true) with check (true);
create policy "private MVP anon read buy items" on public.buy_items for select to anon using (true);
create policy "private MVP anon write buy items" on public.buy_items for all to anon using (true) with check (true);
create policy "private MVP anon read inventory purchases" on public.inventory_purchases for select to anon using (true);
create policy "private MVP anon write inventory purchases" on public.inventory_purchases for all to anon using (true) with check (true);
create policy "private MVP anon read business expenses" on public.business_expenses for select to anon using (true);
create policy "private MVP anon write business expenses" on public.business_expenses for all to anon using (true) with check (true);
create policy "private MVP anon read calendar feeds" on public.calendar_feeds for select to anon using (true);
create policy "private MVP anon write calendar feeds" on public.calendar_feeds for all to anon using (true) with check (true);

drop policy if exists "private MVP event images read" on storage.objects;
drop policy if exists "private MVP event images insert" on storage.objects;
drop policy if exists "private MVP event images update" on storage.objects;
drop policy if exists "private MVP event images delete" on storage.objects;
drop policy if exists "private MVP sale images read" on storage.objects;
drop policy if exists "private MVP sale images insert" on storage.objects;
drop policy if exists "private MVP sale images update" on storage.objects;
drop policy if exists "private MVP sale images delete" on storage.objects;

create policy "private MVP event images read" on storage.objects for select to anon using (bucket_id = 'event-images');
create policy "private MVP event images insert" on storage.objects for insert to anon with check (bucket_id = 'event-images');
create policy "private MVP event images update" on storage.objects for update to anon using (bucket_id = 'event-images') with check (bucket_id = 'event-images');
create policy "private MVP event images delete" on storage.objects for delete to anon using (bucket_id = 'event-images');
create policy "private MVP sale images read" on storage.objects for select to anon using (bucket_id = 'sale-images');
create policy "private MVP sale images insert" on storage.objects for insert to anon with check (bucket_id = 'sale-images');
create policy "private MVP sale images update" on storage.objects for update to anon using (bucket_id = 'sale-images') with check (bucket_id = 'sale-images');
create policy "private MVP sale images delete" on storage.objects for delete to anon using (bucket_id = 'sale-images');

do $$
begin
  alter publication supabase_realtime add table public.workers;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_workers;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_day_workers;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_price_options;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.payment_records;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.locations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_days;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_checklist_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_finances;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_live_notes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_sales_categories;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.event_reviews;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sales_records;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.buy_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.inventory_purchases;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.business_expenses;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.calendar_feeds;
exception when duplicate_object then null;
end $$;

create index if not exists idx_events_start_date on public.events(start_date);
create index if not exists idx_events_status_start_date on public.events(status, start_date);
create index if not exists idx_events_event_stage on public.events(event_stage);
create index if not exists idx_events_status on public.events(status);
create index if not exists idx_events_registration_status on public.events(registration_status);
create index if not exists idx_event_days_event_id on public.event_days(event_id);
create index if not exists idx_event_days_date on public.event_days(date);
create index if not exists idx_event_day_workers_event_id on public.event_day_workers(event_id);
create index if not exists idx_event_day_workers_day_id on public.event_day_workers(event_day_id);
create index if not exists idx_payment_records_event_id on public.payment_records(event_id);
create index if not exists idx_event_price_options_event_id on public.event_price_options(event_id);
create index if not exists idx_event_checklist_items_event_id on public.event_checklist_items(event_id);
create index if not exists idx_event_live_notes_event_id on public.event_live_notes(event_id);
create index if not exists idx_event_finances_event_id on public.event_finances(event_id);
create index if not exists idx_event_sales_categories_event_id on public.event_sales_categories(event_id);
create index if not exists idx_event_reviews_event_id on public.event_reviews(event_id);
create index if not exists idx_sales_records_event_id on public.sales_records(event_id);
create index if not exists idx_sales_records_event_day_id on public.sales_records(event_day_id);
create index if not exists idx_sales_records_sold_at on public.sales_records(sold_at);
create index if not exists idx_sales_records_pending_upload on public.sales_records(pending_upload);
create index if not exists idx_sales_records_category on public.sales_records(category);
create index if not exists idx_sales_records_sold_by_worker_id on public.sales_records(sold_by_worker_id);
create index if not exists idx_sales_records_inventory_purchase_id on public.sales_records(inventory_purchase_id);
create index if not exists idx_inventory_purchases_purchase_date on public.inventory_purchases(purchase_date);
create index if not exists idx_inventory_purchases_event_id on public.inventory_purchases(event_id);
create index if not exists idx_inventory_purchases_status on public.inventory_purchases(status);
create index if not exists idx_inventory_purchases_sold_date on public.inventory_purchases(sold_date);
create index if not exists idx_business_expenses_expense_date on public.business_expenses(expense_date);
create index if not exists idx_business_expenses_event_id on public.business_expenses(event_id);
create index if not exists idx_business_expenses_category on public.business_expenses(category);
create index if not exists idx_buy_items_created_at on public.buy_items(created_at);
create index if not exists idx_buy_items_purchased on public.buy_items(purchased);
create index if not exists idx_buy_items_priority on public.buy_items(priority);
create index if not exists idx_buy_items_purchased_by_worker_id on public.buy_items(purchased_by_worker_id);
create index if not exists idx_events_external_source_id on public.events(external_source_id);
create unique index if not exists idx_events_external_source_unique on public.events(external_source, external_source_id) where external_source_id is not null;
create index if not exists idx_events_calendar_feed_id on public.events(calendar_feed_id);
create index if not exists idx_calendar_feeds_enabled on public.calendar_feeds(enabled);
