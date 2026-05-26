create table if not exists public.workers (
  id text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id text primary key,
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
  event_cost numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compatibility with the older JSON demo schema, if it already exists.
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
alter table public.events add column if not exists registration_url text;
alter table public.events add column if not exists source_url text;
alter table public.events add column if not exists notes text;
alter table public.events add column if not exists event_cost numeric(10, 2) not null default 0;
alter table public.events add column if not exists created_at timestamptz not null default now();
alter table public.events add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'payload'
  ) then
    alter table public.events alter column payload drop not null;
  end if;
end $$;

create table if not exists public.event_workers (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  worker_id text not null references public.workers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, worker_id)
);

create table if not exists public.payment_records (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  worker_id text not null references public.workers(id) on delete cascade,
  amount_paid numeric(10, 2) not null default 0,
  paid_at date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workers replica identity full;
alter table public.events replica identity full;
alter table public.event_workers replica identity full;
alter table public.payment_records replica identity full;

alter table public.workers enable row level security;
alter table public.events enable row level security;
alter table public.event_workers enable row level security;
alter table public.payment_records enable row level security;

drop policy if exists "private MVP anon read workers" on public.workers;
drop policy if exists "private MVP anon write workers" on public.workers;
drop policy if exists "private MVP anon read events" on public.events;
drop policy if exists "private MVP anon write events" on public.events;
drop policy if exists "private MVP anon read event workers" on public.event_workers;
drop policy if exists "private MVP anon write event workers" on public.event_workers;
drop policy if exists "private MVP anon read payment records" on public.payment_records;
drop policy if exists "private MVP anon write payment records" on public.payment_records;

create policy "private MVP anon read workers" on public.workers for select to anon using (true);
create policy "private MVP anon write workers" on public.workers for all to anon using (true) with check (true);
create policy "private MVP anon read events" on public.events for select to anon using (true);
create policy "private MVP anon write events" on public.events for all to anon using (true) with check (true);
create policy "private MVP anon read event workers" on public.event_workers for select to anon using (true);
create policy "private MVP anon write event workers" on public.event_workers for all to anon using (true) with check (true);
create policy "private MVP anon read payment records" on public.payment_records for select to anon using (true);
create policy "private MVP anon write payment records" on public.payment_records for all to anon using (true) with check (true);

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
