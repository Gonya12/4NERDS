-- Additive multi-game metadata for canonical transaction items and the two
-- legacy-compatible item tables. Existing English Pokémon identifiers remain
-- valid and are mirrored into the provider-neutral columns.

alter table if exists public.financial_transaction_items
  add column if not exists card_game text,
  add column if not exists card_language text,
  add column if not exists data_provider text,
  add column if not exists provider_card_id text,
  add column if not exists card_code text,
  add column if not exists market_price_currency text;

alter table if exists public.sales_records
  add column if not exists card_game text,
  add column if not exists card_language text,
  add column if not exists data_provider text,
  add column if not exists provider_card_id text,
  add column if not exists card_code text,
  add column if not exists market_price_currency text;

alter table if exists public.inventory_purchases
  add column if not exists card_game text,
  add column if not exists card_language text,
  add column if not exists data_provider text,
  add column if not exists provider_card_id text,
  add column if not exists card_code text,
  add column if not exists market_price_currency text;

update public.financial_transaction_items
set
  card_game = coalesce(card_game, case when pokemon_tcg_card_id is not null then 'pokemon' else 'other' end),
  card_language = case
    when lower(coalesce(card_language, '')) in ('ja', 'japanese', '日本語') then 'ja'
    when pokemon_tcg_card_id is not null or lower(coalesce(card_language, '')) in ('en', 'english') then 'en'
    else coalesce(nullif(card_language, ''), 'unknown')
  end,
  data_provider = coalesce(data_provider, case when pokemon_tcg_card_id is not null then 'pokemontcg' else 'manual' end),
  provider_card_id = coalesce(provider_card_id, pokemon_tcg_card_id),
  market_price_currency = coalesce(market_price_currency, case when market_value is not null then 'USD' end);

update public.sales_records
set
  card_game = coalesce(card_game, case when pokemon_tcg_card_id is not null then 'pokemon' else 'other' end),
  card_language = case
    when lower(coalesce(card_language, '')) in ('ja', 'japanese', '日本語') then 'ja'
    when pokemon_tcg_card_id is not null or lower(coalesce(card_language, '')) in ('en', 'english') then 'en'
    else coalesce(nullif(card_language, ''), 'unknown')
  end,
  data_provider = coalesce(data_provider, case when pokemon_tcg_card_id is not null then 'pokemontcg' else 'manual' end),
  provider_card_id = coalesce(provider_card_id, pokemon_tcg_card_id),
  market_price_currency = coalesce(market_price_currency, case when market_value is not null then 'USD' end);

update public.inventory_purchases
set
  card_game = coalesce(card_game, case when pokemon_tcg_card_id is not null then 'pokemon' else 'other' end),
  card_language = case
    when lower(coalesce(card_language, '')) in ('ja', 'japanese', '日本語') then 'ja'
    when pokemon_tcg_card_id is not null or lower(coalesce(card_language, '')) in ('en', 'english') then 'en'
    else coalesce(nullif(card_language, ''), 'unknown')
  end,
  data_provider = coalesce(data_provider, case when pokemon_tcg_card_id is not null then 'pokemontcg' else 'manual' end),
  provider_card_id = coalesce(provider_card_id, pokemon_tcg_card_id),
  market_price_currency = coalesce(market_price_currency, case when market_value is not null then 'USD' end);

do $$
declare
  target_table text;
begin
  foreach target_table in array array['financial_transaction_items', 'sales_records', 'inventory_purchases']
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target_table,
      target_table || '_card_game_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (card_game is null or card_game in (''pokemon'', ''one_piece'', ''other'')) not valid',
      target_table,
      target_table || '_card_game_check'
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target_table,
      target_table || '_card_language_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (card_language is null or card_language in (''en'', ''ja'', ''unknown'')) not valid',
      target_table,
      target_table || '_card_language_check'
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target_table,
      target_table || '_data_provider_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (data_provider is null or data_provider in (''pokemontcg'', ''tcgdex'', ''optcgapi'', ''manual'')) not valid',
      target_table,
      target_table || '_data_provider_check'
    );
  end loop;
end $$;

create index if not exists financial_transaction_items_card_catalog_idx
  on public.financial_transaction_items (card_game, card_language, data_provider);
create index if not exists sales_records_card_catalog_idx
  on public.sales_records (card_game, card_language, data_provider);
create index if not exists inventory_purchases_card_catalog_idx
  on public.inventory_purchases (card_game, card_language, data_provider);
