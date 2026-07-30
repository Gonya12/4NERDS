-- Unified transaction schema reconciliation.
-- Review before applying. This migration is additive and does not delete business data.

create table if not exists public.financial_transactions (
  id uuid primary key,
  transaction_type text not null,
  transaction_subtype text,
  transaction_date timestamptz not null default now(),
  event_id uuid references public.events(id) on delete set null,
  event_day_id uuid references public.event_days(id) on delete set null,
  customer_or_seller text,
  payment_method text,
  cash_received numeric(12,2) not null default 0,
  cash_paid numeric(12,2) not null default 0,
  bundle_total numeric(12,2),
  allocation_method text not null default 'individual',
  entered_by_worker_id uuid references public.workers(id) on delete set null,
  notes text,
  status text not null default 'draft',
  item_mode text not null default 'single',
  general_image_url text,
  general_image_path text,
  expense_category text,
  completed_at timestamptz,
  reversed_at timestamptz,
  reversal_of_transaction_id uuid references public.financial_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_transaction_items (
  id uuid primary key,
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  direction text not null,
  source_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  created_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  created_sales_record_id uuid references public.sales_records(id) on delete set null,
  created_business_expense_id uuid references public.business_expenses(id) on delete set null,
  prior_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null,
  item_name text not null,
  item_type text not null default 'other_pokemon_product',
  quantity integer not null default 1,
  market_value numeric(12,2) not null default 0,
  agreed_trade_value numeric(12,2) not null default 0,
  trade_percentage numeric(7,3),
  cost_basis numeric(12,2) not null default 0,
  zero_cost_basis_confirmed boolean not null default false,
  sold_price numeric(12,2),
  purchase_price numeric(12,2),
  allocated_cash_amount numeric(12,2),
  image_url text,
  image_path text,
  back_image_url text,
  back_image_path text,
  collector_number text,
  set_name text,
  card_set text,
  card_set_id text,
  card_set_code text,
  card_rarity text,
  card_language text,
  pokemon_tcg_card_id text,
  official_card_image_url text,
  tcgplayer_url text,
  market_price_source text,
  market_price_variant text,
  market_price_updated_at timestamptz,
  market_price_checked_at timestamptz,
  tcgplayer_pricing jsonb,
  target_buy_percentage numeric(7,3),
  target_buy_price numeric(12,2),
  card_selection_source text,
  cost_basis_is_estimate boolean not null default false,
  card_condition text,
  sticker_price numeric(12,2),
  sticker_condition text,
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
  ownership_percentage numeric(7,3) not null,
  allocated_cost_basis numeric(12,2),
  allocated_trade_value numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transaction_payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  direction text not null,
  payment_method text not null default 'cash',
  amount numeric(12,2) not null default 0,
  paid_by_worker_id uuid references public.workers(id) on delete set null,
  note text,
  paid_at timestamptz not null default now(),
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
  image_type text not null default 'general',
  image_url text not null,
  image_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Canonical financial transaction fields. No alternate item-mode column is created.
alter table public.financial_transactions add column if not exists transaction_subtype text;
alter table public.financial_transactions add column if not exists transaction_date timestamptz not null default now();
alter table public.financial_transactions add column if not exists event_id uuid references public.events(id) on delete set null;
alter table public.financial_transactions add column if not exists event_day_id uuid references public.event_days(id) on delete set null;
alter table public.financial_transactions add column if not exists customer_or_seller text;
alter table public.financial_transactions add column if not exists payment_method text;
alter table public.financial_transactions add column if not exists cash_received numeric(12,2) not null default 0;
alter table public.financial_transactions add column if not exists cash_paid numeric(12,2) not null default 0;
alter table public.financial_transactions add column if not exists bundle_total numeric(12,2);
alter table public.financial_transactions add column if not exists allocation_method text;
alter table public.financial_transactions add column if not exists entered_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.financial_transactions add column if not exists notes text;
alter table public.financial_transactions add column if not exists status text not null default 'draft';
alter table public.financial_transactions add column if not exists item_mode text not null default 'single';
alter table public.financial_transactions add column if not exists general_image_url text;
alter table public.financial_transactions add column if not exists general_image_path text;
alter table public.financial_transactions add column if not exists expense_category text;
alter table public.financial_transactions add column if not exists completed_at timestamptz;
alter table public.financial_transactions add column if not exists reversed_at timestamptz;
alter table public.financial_transactions add column if not exists reversal_of_transaction_id uuid references public.financial_transactions(id) on delete set null;
alter table public.financial_transactions add column if not exists created_at timestamptz not null default now();
alter table public.financial_transactions add column if not exists updated_at timestamptz not null default now();

-- Preserve values from the pre-canonical pricing name without creating another
-- item-mode column or removing the compatibility column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'financial_transactions' and column_name = 'pricing_mode'
  ) then
    execute $sql$
      update public.financial_transactions
      set allocation_method = pricing_mode
      where allocation_method is null and pricing_mode is not null
    $sql$;
  end if;
end $$;

update public.financial_transactions
set allocation_method = 'individual'
where allocation_method is null;

alter table public.financial_transactions
  alter column allocation_method set default 'individual',
  alter column allocation_method set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.financial_transactions'::regclass
      and conname = 'financial_transactions_item_mode_check'
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_item_mode_check
      check (item_mode in ('single', 'multiple')) not valid;
  end if;
  if not exists (
    select 1 from public.financial_transactions
    where item_mode is null or item_mode not in ('single', 'multiple')
  ) then
    alter table public.financial_transactions validate constraint financial_transactions_item_mode_check;
  else
    raise warning 'financial_transactions_item_mode_check remains NOT VALID because existing item_mode values require review';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.financial_transactions'::regclass
      and conname = 'financial_transactions_allocation_method_check'
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_allocation_method_check
      check (allocation_method in ('individual', 'bundle_total')) not valid;
  end if;
  if not exists (
    select 1 from public.financial_transactions
    where allocation_method not in ('individual', 'bundle_total')
  ) then
    alter table public.financial_transactions validate constraint financial_transactions_allocation_method_check;
  else
    raise warning 'financial_transactions_allocation_method_check remains NOT VALID because existing allocation values require review';
  end if;
end $$;

-- Current canonical item fields used by the application.
alter table public.financial_transaction_items add column if not exists transaction_id uuid references public.financial_transactions(id) on delete cascade;
alter table public.financial_transaction_items add column if not exists created_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null;
alter table public.financial_transaction_items add column if not exists created_sales_record_id uuid references public.sales_records(id) on delete set null;
alter table public.financial_transaction_items add column if not exists created_business_expense_id uuid references public.business_expenses(id) on delete set null;
alter table public.financial_transaction_items add column if not exists prior_inventory_purchase_id uuid references public.inventory_purchases(id) on delete set null;
alter table public.financial_transaction_items add column if not exists zero_cost_basis_confirmed boolean not null default false;
alter table public.financial_transaction_items add column if not exists set_name text;
alter table public.financial_transaction_items add column if not exists card_set text;
alter table public.financial_transaction_items add column if not exists card_set_id text;
alter table public.financial_transaction_items add column if not exists card_set_code text;
alter table public.financial_transaction_items add column if not exists card_rarity text;
alter table public.financial_transaction_items add column if not exists card_language text;
alter table public.financial_transaction_items add column if not exists official_card_image_url text;
alter table public.financial_transaction_items add column if not exists tcgplayer_url text;
alter table public.financial_transaction_items add column if not exists market_price_source text;
alter table public.financial_transaction_items add column if not exists market_price_variant text;
alter table public.financial_transaction_items add column if not exists market_price_updated_at timestamptz;
alter table public.financial_transaction_items add column if not exists market_price_checked_at timestamptz;
alter table public.financial_transaction_items add column if not exists tcgplayer_pricing jsonb;
alter table public.financial_transaction_items add column if not exists target_buy_percentage numeric(7,3);
alter table public.financial_transaction_items add column if not exists target_buy_price numeric(12,2);
alter table public.financial_transaction_items add column if not exists card_selection_source text;
alter table public.financial_transaction_items add column if not exists cost_basis_is_estimate boolean not null default false;
alter table public.financial_transaction_items add column if not exists sticker_price numeric(12,2);
alter table public.financial_transaction_items add column if not exists sticker_condition text;

alter table public.transaction_images add column if not exists transaction_id uuid references public.financial_transactions(id) on delete cascade;
alter table public.transaction_images add column if not exists transaction_item_id uuid references public.financial_transaction_items(id) on delete cascade;
alter table public.transaction_images add column if not exists sort_order integer not null default 0;
alter table public.transaction_item_ownership_shares add column if not exists transaction_item_id uuid references public.financial_transaction_items(id) on delete cascade;
alter table public.transaction_payments add column if not exists transaction_id uuid references public.financial_transactions(id) on delete cascade;
alter table public.transaction_payments add column if not exists paid_by_worker_id uuid references public.workers(id) on delete set null;
alter table public.transaction_payments add column if not exists note text;
alter table public.transaction_payments add column if not exists paid_at timestamptz not null default now();
alter table public.transaction_internal_balances add column if not exists transaction_id uuid references public.financial_transactions(id) on delete cascade;
alter table public.inventory_lineage add column if not exists transaction_id uuid references public.financial_transactions(id) on delete restrict;

-- Legacy compatibility links.
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

-- sale_profit_shares uses sales_record_id canonically. Conditionally copy a
-- historical singular spelling if that spelling exists in a live project.
alter table public.sale_profit_shares add column if not exists sales_record_id uuid;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sale_profit_shares' and column_name = 'sale_record_id'
  ) then
    execute $sql$
      update public.sale_profit_shares
      set sales_record_id = sale_record_id
      where sales_record_id is null and sale_record_id is not null
    $sql$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sale_profit_shares'::regclass
      and conname = 'sale_profit_shares_sales_record_id_fkey'
  ) then
    alter table public.sale_profit_shares
      add constraint sale_profit_shares_sales_record_id_fkey
      foreign key (sales_record_id) references public.sales_records(id) on delete cascade not valid;
  end if;
  if not exists (
    select 1
    from public.sale_profit_shares shares
    left join public.sales_records sales on sales.id = shares.sales_record_id
    where shares.sales_record_id is not null and sales.id is null
  ) then
    alter table public.sale_profit_shares validate constraint sale_profit_shares_sales_record_id_fkey;
  end if;
end $$;

-- Lookup indexes are always safe. Unique indexes are installed only when
-- existing data already satisfies the intended invariant.
create index if not exists idx_financial_transactions_type_date on public.financial_transactions(transaction_type, transaction_date desc);
create index if not exists idx_financial_transactions_status on public.financial_transactions(status);
create index if not exists idx_financial_transactions_event on public.financial_transactions(event_id);
create index if not exists idx_financial_transactions_event_day on public.financial_transactions(event_day_id);
create index if not exists idx_financial_transaction_items_transaction on public.financial_transaction_items(transaction_id);
create index if not exists idx_financial_transaction_items_source_inventory on public.financial_transaction_items(source_inventory_purchase_id);
create index if not exists idx_transaction_item_ownership_item on public.transaction_item_ownership_shares(transaction_item_id);
create index if not exists idx_transaction_payments_transaction on public.transaction_payments(transaction_id);
create index if not exists idx_transaction_internal_balances_transaction on public.transaction_internal_balances(transaction_id);
create index if not exists idx_inventory_lineage_source on public.inventory_lineage(source_inventory_purchase_id);
create index if not exists idx_inventory_lineage_result on public.inventory_lineage(resulting_inventory_purchase_id);
create index if not exists idx_transaction_images_transaction_sort on public.transaction_images(transaction_id, sort_order);
create index if not exists idx_transaction_images_item_sort on public.transaction_images(transaction_item_id, sort_order);
create index if not exists idx_sales_records_financial_transaction on public.sales_records(financial_transaction_id);
create index if not exists idx_inventory_purchases_financial_transaction on public.inventory_purchases(financial_transaction_id);
create index if not exists idx_inventory_purchases_disposed_transaction on public.inventory_purchases(disposed_financial_transaction_id);
create index if not exists idx_business_expenses_financial_transaction on public.business_expenses(financial_transaction_id);
create index if not exists idx_sale_profit_shares_sales_record on public.sale_profit_shares(sales_record_id);

do $$
begin
  if not exists (
    select transaction_item_id, worker_id
    from public.transaction_item_ownership_shares
    group by transaction_item_id, worker_id
    having count(*) > 1
  ) then
    create unique index if not exists uq_transaction_item_owner
      on public.transaction_item_ownership_shares(transaction_item_id, worker_id);
  else
    raise warning 'uq_transaction_item_owner was not created because duplicate ownership rows require review';
  end if;

  if not exists (
    select inventory_purchase_id, worker_id
    from public.inventory_ownership_shares
    group by inventory_purchase_id, worker_id
    having count(*) > 1
  ) then
    create unique index if not exists uq_inventory_ownership_purchase_worker
      on public.inventory_ownership_shares(inventory_purchase_id, worker_id);
  else
    raise warning 'uq_inventory_ownership_purchase_worker was not created because duplicate ownership rows require review';
  end if;

  if not exists (
    select sales_record_id, worker_id
    from public.sale_profit_shares
    where sales_record_id is not null
    group by sales_record_id, worker_id
    having count(*) > 1
  ) then
    create unique index if not exists uq_sale_profit_shares_sale_worker
      on public.sale_profit_shares(sales_record_id, worker_id);
  else
    raise warning 'uq_sale_profit_shares_sale_worker was not created because duplicate profit-share rows require review';
  end if;

  if not exists (
    select transaction_id, direction, payment_method
    from public.transaction_payments
    group by transaction_id, direction, payment_method
    having count(*) > 1
  ) then
    create unique index if not exists uq_transaction_payment_direction_method
      on public.transaction_payments(transaction_id, direction, payment_method);
  else
    raise warning 'uq_transaction_payment_direction_method was not created because duplicate payment rows require review';
  end if;

  if not exists (
    select transaction_id, owed_by_worker_id, owed_to_worker_id
    from public.transaction_internal_balances
    group by transaction_id, owed_by_worker_id, owed_to_worker_id
    having count(*) > 1
  ) then
    create unique index if not exists uq_transaction_internal_balance_workers
      on public.transaction_internal_balances(transaction_id, owed_by_worker_id, owed_to_worker_id);
  else
    raise warning 'uq_transaction_internal_balance_workers was not created because duplicate balance rows require review';
  end if;

  if not exists (
    select source_inventory_purchase_id, resulting_inventory_purchase_id, transaction_id
    from public.inventory_lineage
    group by source_inventory_purchase_id, resulting_inventory_purchase_id, transaction_id
    having count(*) > 1
  ) then
    create unique index if not exists uq_inventory_lineage
      on public.inventory_lineage(source_inventory_purchase_id, resulting_inventory_purchase_id, transaction_id);
  else
    raise warning 'uq_inventory_lineage was not created because duplicate lineage rows require review';
  end if;

  if not exists (
    select transaction_id, image_path
    from public.transaction_images
    group by transaction_id, image_path
    having count(*) > 1
  ) then
    create unique index if not exists uq_transaction_image_path
      on public.transaction_images(transaction_id, image_path);
  else
    raise warning 'uq_transaction_image_path was not created because duplicate image metadata requires review';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inventory_lineage'::regclass
      and conname = 'inventory_lineage_no_self_reference'
  ) then
    alter table public.inventory_lineage
      add constraint inventory_lineage_no_self_reference
      check (source_inventory_purchase_id <> resulting_inventory_purchase_id) not valid;
  end if;
  if not exists (
    select 1 from public.inventory_lineage
    where source_inventory_purchase_id = resulting_inventory_purchase_id
  ) then
    alter table public.inventory_lineage validate constraint inventory_lineage_no_self_reference;
  end if;
end $$;

-- Atomically reserve outgoing inventory for one draft. Retrying the same
-- transaction is idempotent; a competing transaction receives an exception.
create or replace function public.claim_financial_transaction_inventory(
  p_transaction_id uuid,
  p_inventory_ids uuid[],
  p_disposition text
)
returns table (inventory_id uuid, inventory_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_transaction_status text;
  v_requested integer;
  v_distinct integer;
  v_claimed integer;
begin
  if p_disposition not in ('sold', 'traded_out') then
    raise exception 'Unsupported inventory disposition: %', p_disposition using errcode = '22023';
  end if;

  select status
    into v_transaction_status
    from public.financial_transactions
    where id = p_transaction_id
    for update;

  if not found then
    raise exception 'Financial transaction % was not found', p_transaction_id using errcode = 'P0002';
  end if;
  if v_transaction_status <> 'draft' then
    raise exception 'Inventory can only be claimed by a draft transaction' using errcode = '23514';
  end if;

  select count(*), count(distinct value)
    into v_requested, v_distinct
    from unnest(coalesce(p_inventory_ids, array[]::uuid[])) as values_list(value)
    where value is not null;

  if v_requested = 0 then
    return;
  end if;
  if v_requested <> coalesce(array_length(p_inventory_ids, 1), 0) or v_requested <> v_distinct then
    raise exception 'Inventory claim IDs must be non-null and unique' using errcode = '22023';
  end if;

  update public.inventory_purchases
    set status = p_disposition,
        disposed_financial_transaction_id = p_transaction_id,
        financial_transaction_id = p_transaction_id,
        updated_at = now()
    where id = any(p_inventory_ids)
      and (
        status = 'in_stock'
        or (
          disposed_financial_transaction_id = p_transaction_id
          and status = p_disposition
        )
      );

  get diagnostics v_claimed = row_count;
  if v_claimed <> v_requested then
    raise exception 'One or more inventory items are unavailable for transaction %', p_transaction_id
      using errcode = 'P0001';
  end if;

  return query
    select purchases.id, purchases.status::text
    from public.inventory_purchases purchases
    where purchases.id = any(p_inventory_ids)
    order by purchases.id;
end $$;

revoke all on function public.claim_financial_transaction_inventory(uuid, uuid[], text) from public;
grant execute on function public.claim_financial_transaction_inventory(uuid, uuid[], text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transaction-images',
  'transaction-images',
  true,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
