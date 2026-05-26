create extension if not exists pgcrypto;

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

alter table public.events add column if not exists image_url text;
alter table public.events add column if not exists image_path text;
alter table public.events add column if not exists location_id uuid references public.locations(id);
alter table public.events add column if not exists location_instagram_handle text;
alter table public.events add column if not exists organizer_instagram_handle text;
alter table public.events add column if not exists updated_at timestamptz not null default now();
alter table public.event_workers add column if not exists updated_at timestamptz not null default now();
alter table public.payment_records add column if not exists updated_at timestamptz not null default now();
alter table public.payment_records add column if not exists paid_at timestamptz;
alter table public.payment_records alter column paid_at type timestamptz using paid_at::timestamptz;

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
alter table public.payment_records replica identity full;
alter table public.locations replica identity full;
alter table public.event_days replica identity full;

alter table public.workers enable row level security;
alter table public.events enable row level security;
alter table public.event_workers enable row level security;
alter table public.payment_records enable row level security;
alter table public.locations enable row level security;
alter table public.event_days enable row level security;

drop policy if exists "private MVP anon read workers" on public.workers;
drop policy if exists "private MVP anon write workers" on public.workers;
drop policy if exists "private MVP anon read events" on public.events;
drop policy if exists "private MVP anon write events" on public.events;
drop policy if exists "private MVP anon read event workers" on public.event_workers;
drop policy if exists "private MVP anon write event workers" on public.event_workers;
drop policy if exists "private MVP anon read payment records" on public.payment_records;
drop policy if exists "private MVP anon write payment records" on public.payment_records;
drop policy if exists "private MVP anon read locations" on public.locations;
drop policy if exists "private MVP anon write locations" on public.locations;
drop policy if exists "private MVP anon read event days" on public.event_days;
drop policy if exists "private MVP anon write event days" on public.event_days;

create policy "private MVP anon read workers" on public.workers for select to anon using (true);
create policy "private MVP anon write workers" on public.workers for all to anon using (true) with check (true);
create policy "private MVP anon read events" on public.events for select to anon using (true);
create policy "private MVP anon write events" on public.events for all to anon using (true) with check (true);
create policy "private MVP anon read event workers" on public.event_workers for select to anon using (true);
create policy "private MVP anon write event workers" on public.event_workers for all to anon using (true) with check (true);
create policy "private MVP anon read payment records" on public.payment_records for select to anon using (true);
create policy "private MVP anon write payment records" on public.payment_records for all to anon using (true) with check (true);
create policy "private MVP anon read locations" on public.locations for select to anon using (true);
create policy "private MVP anon write locations" on public.locations for all to anon using (true) with check (true);
create policy "private MVP anon read event days" on public.event_days for select to anon using (true);
create policy "private MVP anon write event days" on public.event_days for all to anon using (true) with check (true);

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
