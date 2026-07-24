-- Sales Control read-performance indexes.
-- Safe to run repeatedly. This file does not modify or delete existing data.

create index if not exists idx_sales_records_sold_at
  on public.sales_records (sold_at desc);
create index if not exists idx_sales_records_event_id
  on public.sales_records (event_id);
create index if not exists idx_sales_records_event_day_id
  on public.sales_records (event_day_id);
create index if not exists idx_sales_records_inventory_purchase_id
  on public.sales_records (inventory_purchase_id);

create index if not exists idx_inventory_purchases_purchase_date
  on public.inventory_purchases (purchase_date desc);
create index if not exists idx_inventory_purchases_status
  on public.inventory_purchases (status);
create index if not exists idx_inventory_purchases_event_id
  on public.inventory_purchases (event_id);
create index if not exists idx_inventory_purchases_purchased_by_worker_id
  on public.inventory_purchases (purchased_by_worker_id);

create index if not exists idx_business_expenses_expense_date
  on public.business_expenses (expense_date desc);
create index if not exists idx_business_expenses_event_id
  on public.business_expenses (event_id);
create index if not exists idx_business_expenses_paid_by_worker_id
  on public.business_expenses (paid_by_worker_id);

create index if not exists idx_events_start_date
  on public.events (start_date desc);
create index if not exists idx_event_days_event_id_date
  on public.event_days (event_id, date);
create index if not exists idx_event_workers_event_id
  on public.event_workers (event_id);
create index if not exists idx_event_day_workers_event_id
  on public.event_day_workers (event_id);
create index if not exists idx_event_price_options_event_id
  on public.event_price_options (event_id);
create index if not exists idx_payment_records_event_id
  on public.payment_records (event_id);

create index if not exists idx_inventory_ownership_shares_purchase_id
  on public.inventory_ownership_shares (inventory_purchase_id);
create index if not exists idx_sale_profit_shares_sale_id
  on public.sale_profit_shares (sales_record_id);
