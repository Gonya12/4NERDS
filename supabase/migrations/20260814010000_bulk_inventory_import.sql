-- Durable bulk inventory import queue. Bulk imports represent existing-owned
-- inventory and intentionally do not create financial transactions.

create extension if not exists pgcrypto;

alter table if exists public.inventory_purchases
  add column if not exists provider_base_market numeric(12,2),
  add column if not exists cost_basis_known boolean not null default true,
  add column if not exists zero_cost_basis_confirmed boolean not null default false;

alter table if exists public.inventory_purchases
  drop constraint if exists inventory_purchases_cost_basis_state_check;
alter table if exists public.inventory_purchases
  add constraint inventory_purchases_cost_basis_state_check
  check (cost_basis_known or not zero_cost_basis_confirmed) not valid;

create table if not exists public.bulk_inventory_import_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'uploading'
    check (status in ('uploading','queued','processing','review','completed','cancelled')),
  expected_card_game text not null default 'pokemon'
    check (expected_card_game in ('pokemon','one_piece')),
  expected_language text not null default 'en'
    check (expected_language in ('en','ja')),
  original_count integer not null default 0 check (original_count >= 0),
  uploaded_count integer not null default 0 check (uploaded_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  ready_count integer not null default 0 check (ready_count >= 0),
  needs_review_count integer not null default 0 check (needs_review_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  confirmed_count integer not null default 0 check (confirmed_count >= 0),
  created_by_worker_id uuid references public.workers(id) on delete set null,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bulk_inventory_import_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bulk_inventory_import_jobs(id) on delete cascade,
  upload_order integer not null check (upload_order >= 0),
  status text not null default 'waiting'
    check (status in ('waiting','processing','identified','needs_review','failed','confirmed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_retry_at timestamptz,
  locked_at timestamptz,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  source_image_path text not null,
  source_image_url text not null,
  thumbnail_path text,
  thumbnail_url text,
  image_hash text,
  possible_duplicate boolean not null default false,
  duplicate_of_item_id uuid references public.bulk_inventory_import_items(id) on delete set null,
  recognized_name text,
  recognized_collector_number text,
  recognized_set text,
  recognized_card_game text,
  recognized_language text,
  field_confidence jsonb not null default '{}'::jsonb,
  raw_recognition jsonb,
  selected_candidate jsonb,
  alternative_candidates jsonb not null default '[]'::jsonb,
  candidate_score numeric(6,2),
  overall_confidence text check (overall_confidence is null or overall_confidence in ('high','medium','low')),
  condition text,
  base_market numeric(12,2),
  adjusted_market numeric(12,2),
  market_source text,
  market_variant text,
  market_currency text,
  market_checked_at timestamptz,
  quantity integer not null default 1 check (quantity > 0),
  cost_basis numeric(12,2) check (cost_basis is null or cost_basis >= 0),
  zero_cost_basis_confirmed boolean not null default false,
  ownership_shares jsonb not null default '[]'::jsonb,
  inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  error_code text,
  error_message text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, upload_order),
  check (
    (cost_basis is null and not zero_cost_basis_confirmed)
    or cost_basis > 0
    or (cost_basis = 0 and zero_cost_basis_confirmed)
  )
);

create index if not exists bulk_import_items_job_status_idx
  on public.bulk_inventory_import_items(job_id, status, upload_order);
create index if not exists bulk_import_items_claim_idx
  on public.bulk_inventory_import_items(status, next_retry_at, created_at);
create index if not exists bulk_import_items_hash_idx
  on public.bulk_inventory_import_items(job_id, image_hash)
  where image_hash is not null;

create or replace function public.refresh_bulk_inventory_import_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  totals record;
  current_status text;
begin
  select status into current_status
  from public.bulk_inventory_import_jobs
  where id = p_job_id;

  select
    count(*)::integer as uploaded,
    count(*) filter (where status in ('identified','needs_review','failed','confirmed'))::integer as processed,
    count(*) filter (where status = 'identified')::integer as ready,
    count(*) filter (where status = 'needs_review')::integer as needs_review,
    count(*) filter (where status = 'failed')::integer as failed,
    count(*) filter (where status = 'confirmed')::integer as confirmed,
    count(*) filter (where status in ('waiting','processing'))::integer as remaining
  into totals
  from public.bulk_inventory_import_items
  where job_id = p_job_id;

  update public.bulk_inventory_import_jobs
  set uploaded_count = totals.uploaded,
      processed_count = totals.processed,
      ready_count = totals.ready,
      needs_review_count = totals.needs_review,
      failed_count = totals.failed,
      confirmed_count = totals.confirmed,
      status = case
        when current_status = 'cancelled' then 'cancelled'
        when current_status = 'uploading' then 'uploading'
        when totals.uploaded > 0 and totals.confirmed = totals.uploaded then 'completed'
        when totals.remaining > 0 then 'processing'
        when totals.uploaded > 0 then 'review'
        else current_status
      end,
      completed_at = case when totals.uploaded > 0 and totals.confirmed = totals.uploaded then now() else completed_at end,
      updated_at = now()
  where id = p_job_id;
end;
$$;

create or replace function public.bulk_inventory_import_item_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_bulk_inventory_import_job(coalesce(new.job_id, old.job_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists bulk_inventory_import_item_changed_trigger on public.bulk_inventory_import_items;
create trigger bulk_inventory_import_item_changed_trigger
after insert or update or delete on public.bulk_inventory_import_items
for each row execute function public.bulk_inventory_import_item_changed();

create or replace function public.claim_bulk_inventory_import_items(p_limit integer default 2)
returns setof public.bulk_inventory_import_items
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bulk_inventory_import_items
  set status = 'waiting',
      locked_at = null,
      error_code = 'STALE_LEASE_RECOVERED',
      error_message = 'Processing lease expired and was safely requeued.',
      updated_at = now()
  where status = 'processing'
    and locked_at < now() - interval '15 minutes';

  return query
  with claimable as (
    select item.id
    from public.bulk_inventory_import_items item
    join public.bulk_inventory_import_jobs job on job.id = item.job_id
    where job.status not in ('cancelled','completed')
      and item.status = 'waiting'
      and item.attempt_count < item.max_attempts
      and (item.next_retry_at is null or item.next_retry_at <= now())
    order by item.created_at, item.upload_order
    for update of item skip locked
    limit least(greatest(coalesce(p_limit, 2), 1), 4)
  )
  update public.bulk_inventory_import_items item
  set status = 'processing',
      attempt_count = item.attempt_count + 1,
      locked_at = now(),
      error_code = null,
      error_message = null,
      updated_at = now()
  from claimable
  where item.id = claimable.id
  returning item.*;
end;
$$;

revoke all on function public.claim_bulk_inventory_import_items(integer) from public;
grant execute on function public.claim_bulk_inventory_import_items(integer) to service_role;
grant execute on function public.refresh_bulk_inventory_import_job(uuid) to anon, authenticated, service_role;

alter table public.bulk_inventory_import_jobs enable row level security;
alter table public.bulk_inventory_import_items enable row level security;

grant select, insert, update, delete on table public.bulk_inventory_import_jobs to anon, authenticated;
grant select, insert, update, delete on table public.bulk_inventory_import_items to anon, authenticated;
grant all on table public.bulk_inventory_import_jobs to service_role;
grant all on table public.bulk_inventory_import_items to service_role;

drop policy if exists bulk_inventory_import_jobs_team_access on public.bulk_inventory_import_jobs;
create policy bulk_inventory_import_jobs_team_access
on public.bulk_inventory_import_jobs for all to anon, authenticated
using (true) with check (true);

drop policy if exists bulk_inventory_import_items_team_access on public.bulk_inventory_import_items;
create policy bulk_inventory_import_items_team_access
on public.bulk_inventory_import_items for all to anon, authenticated
using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bulk-inventory-imports',
  'bulk-inventory-imports',
  true,
  12582912,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bulk_inventory_imports_read on storage.objects;
create policy bulk_inventory_imports_read
on storage.objects for select to anon, authenticated
using (bucket_id = 'bulk-inventory-imports');

drop policy if exists bulk_inventory_imports_insert on storage.objects;
create policy bulk_inventory_imports_insert
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'bulk-inventory-imports');

drop policy if exists bulk_inventory_imports_update on storage.objects;
create policy bulk_inventory_imports_update
on storage.objects for update to anon, authenticated
using (bucket_id = 'bulk-inventory-imports')
with check (bucket_id = 'bulk-inventory-imports');

drop policy if exists bulk_inventory_imports_delete on storage.objects;
create policy bulk_inventory_imports_delete
on storage.objects for delete to anon, authenticated
using (bucket_id = 'bulk-inventory-imports');

notify pgrst, 'reload schema';
