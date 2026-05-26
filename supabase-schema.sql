create table if not exists public.events (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.organizers (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.sources (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.review_candidates (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.app_settings (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.event_decisions (
  id text primary key,
  event_id text not null,
  user_name text not null,
  decision text not null check (decision in ('interested', 'maybe', 'not_going')),
  notes text,
  reminder_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, user_name)
);

alter table public.events replica identity full;
alter table public.organizers replica identity full;
alter table public.sources replica identity full;
alter table public.review_candidates replica identity full;
alter table public.app_settings replica identity full;
alter table public.event_decisions replica identity full;

alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.sources;
alter publication supabase_realtime add table public.review_candidates;
alter publication supabase_realtime add table public.event_decisions;

alter table public.events enable row level security;
alter table public.organizers enable row level security;
alter table public.sources enable row level security;
alter table public.review_candidates enable row level security;
alter table public.app_settings enable row level security;
alter table public.event_decisions enable row level security;

create policy "private MVP anon read events" on public.events for select to anon using (true);
create policy "private MVP anon write events" on public.events for all to anon using (true) with check (true);
create policy "private MVP anon read organizers" on public.organizers for select to anon using (true);
create policy "private MVP anon write organizers" on public.organizers for all to anon using (true) with check (true);
create policy "private MVP anon read sources" on public.sources for select to anon using (true);
create policy "private MVP anon write sources" on public.sources for all to anon using (true) with check (true);
create policy "private MVP anon read review candidates" on public.review_candidates for select to anon using (true);
create policy "private MVP anon write review candidates" on public.review_candidates for all to anon using (true) with check (true);
create policy "private MVP anon read app settings" on public.app_settings for select to anon using (true);
create policy "private MVP anon write app settings" on public.app_settings for all to anon using (true) with check (true);
create policy "private MVP anon read decisions" on public.event_decisions for select to anon using (true);
create policy "private MVP anon write decisions" on public.event_decisions for all to anon using (true) with check (true);
