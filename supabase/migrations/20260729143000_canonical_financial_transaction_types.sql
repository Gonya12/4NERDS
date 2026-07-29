-- Canonicalize only financial_transactions.transaction_type.
-- Subtypes and item_mode remain independent classifications.

alter table public.financial_transactions
  drop constraint if exists financial_transactions_transaction_type_check;

with normalized as (
  select
    id,
    regexp_replace(
      regexp_replace(lower(trim(transaction_type)), '[_+‐‑‒–—―-]+', ' ', 'g'),
      '\s+',
      ' ',
      'g'
    ) as value
  from public.financial_transactions
)
update public.financial_transactions as transactions
set transaction_type = case normalized.value
  when 'sale' then 'sold'
  when 'sold' then 'sold'
  when 'multi sale' then 'sold'
  when 'multi item sale' then 'sold'
  when 'bundle sale' then 'sold'

  when 'purchase' then 'purchased'
  when 'purchased' then 'purchased'
  when 'inventory purchase' then 'purchased'
  when 'lot purchase' then 'purchased'
  when 'purchase lot' then 'purchased'

  when 'expense' then 'cost'
  when 'cost' then 'cost'
  when 'business expense' then 'cost'
  when 'table fee' then 'cost'
  when 'event cost' then 'cost'

  when 'trade' then 'trade'
  when 'multi item trade' then 'trade'

  when 'cash trade' then 'cash_trade'
  when 'cash and trade' then 'cash_trade'
  when 'mixed trade' then 'cash_trade'
  when 'partial trade' then 'cash_trade'
  when 'multi item cash trade' then 'cash_trade'
  else transactions.transaction_type
end
from normalized
where normalized.id = transactions.id;

do $$
begin
  if exists (
    select 1
    from public.financial_transactions
    where transaction_type not in ('sold', 'purchased', 'cost', 'trade', 'cash_trade')
  ) then
    raise exception 'Unknown financial transaction types remain; review them before applying the canonical constraint';
  end if;
end $$;

alter table public.financial_transactions
  add constraint financial_transactions_transaction_type_check
  check (transaction_type in ('sold', 'purchased', 'cost', 'trade', 'cash_trade'));
