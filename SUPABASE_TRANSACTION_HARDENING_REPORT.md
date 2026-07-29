# Supabase and Unified Transaction Reliability Audit

Audit date: 2026-07-29  
Repository checkpoint: `5eeac403` (`checkpoint before Supabase reliability audit`)  
Migration status: **No reconciliation migration has been executed.**

## Executive summary

The application already routes Sold, Purchased, Cost, Trade, and Cash + Trade through the canonical `financial_transactions` family and does not contain competing trade, sale, purchase, or multi-sale transaction tables. The current implementation also has good foundations: client-generated canonical transaction/item IDs, staged draft saves, legacy links through financial transaction IDs, bundle allocation logic, missing-cost-basis blocking, image compression/camera cleanup, partial-load isolation, and normalized export de-duplication.

The largest remaining risks are retry safety at the legacy materialization boundary, concurrent disposal of the same inventory, and final-state ordering. A failed or interrupted completion can currently create a second legacy sale, purchase, or expense on retry; inventory availability is checked from page state rather than claimed atomically; and a non-trade transaction is marked `completed` before its internal balances are written.

The checked-in schema and the application have also drifted. The app expects `transaction_subtype`, `allocation_method`, general image fields, and `transaction_images.sort_order`, while the existing unified SQL does not define all of them. The SQL disables RLS on every canonical unified table and grants broad anonymous access to the transaction image bucket.

Severity totals:

- Critical: 3
- High: 8
- Medium: 10
- Low: 5
- Total findings: 26

## Scope and evidence

Reviewed:

- Every `.from(...)`, `.rpc(...)`, storage bucket, and Supabase Edge Function reference in `src`, `api`, `supabase`, and repository SQL.
- Canonical unified transaction repositories, payload construction, completion and reversal flows, ownership, inventory lineage, image upload, exports, startup/recovery, loading behavior, and diagnostics.
- Legacy sales, inventory, expense, ownership, event, worker, planner, calendar, and auxiliary repositories for compatibility and failure isolation.
- Checked-in schema and migration-style SQL.
- Environment and ignore state.

Live schema limitation:

- The repository has no Supabase CLI link state, no generated `Database` type file, and no installed Supabase CLI.
- A read-only request to the project OpenAPI endpoint using the configured publishable key returned `Secret API key required`.
- No service-role or secret key was requested or used. Live columns, RLS state, policies, indexes, and bucket configuration therefore could not be independently confirmed from this workspace.
- The reconciliation plan below is based on repository SQL and actual application reads/writes. A manual runtime preflight and post-migration Supabase verification remain required.

## Canonical architecture result

All unified workflows use these canonical structures:

- `financial_transactions`
- `financial_transaction_items`
- `transaction_item_ownership_shares`
- `transaction_payments`
- `transaction_internal_balances`
- `inventory_lineage`
- `transaction_images`

Legacy-compatible structures remain:

- `sales_records`
- `inventory_purchases`
- `business_expenses`
- `inventory_ownership_shares`
- `sale_profit_shares`

No application or SQL references were found for:

- `trade_transactions`
- `trade_items`
- `sales_transactions`
- `purchase_transactions`
- `multi_sale_items`

`financial_transactions.item_mode` is the canonical database field. No application query or payload writes `entry_mode`; its only occurrence is a negative regression test.

## Data-access inventory

### Transaction and legacy financial data

| Structure | Main operations | Notes |
| --- | --- | --- |
| `financial_transactions` | select, upsert | Explicit parent payload builder exists; item mode is canonical. |
| `financial_transaction_items` | select, upsert, delete | Hand-built payload; should become typed and reusable. |
| `transaction_item_ownership_shares` | select, insert, delete | Delete-before-insert creates an avoidable partial-write window. |
| `transaction_payments` | select, upsert, delete | Existing IDs are reused; uniqueness is expected on transaction/direction/method. |
| `transaction_internal_balances` | select, upsert | Currently written after the parent is marked completed. |
| `inventory_lineage` | select, upsert | Cross-product lineage is intentional; self-reference needs a constraint. |
| `transaction_images` | select, upsert, insert, delete | App reads/writes `sort_order`; checked-in unified SQL does not define it. |
| `sales_records` | paged select, insert/update/delete | Unified rows are linked by both financial IDs. |
| `inventory_purchases` | select, insert/update/delete | Historical cost source is `total_cost`; status/disposal fields support lineage. |
| `business_expenses` | select, insert/update/delete | Unified expenses link through financial IDs. |
| `inventory_ownership_shares` | select, insert, delete | Delete-before-insert should be made idempotent. |
| `sale_profit_shares` | select, insert, delete | Application correctly uses `sales_record_id`. |

### Events, people, planner, and supporting data

The application also accesses:

- `workers`
- `events`
- `event_days`
- `event_workers`
- `event_day_workers`
- `event_price_options`
- `payment_records`
- `locations`
- `calendar_feeds`
- `event_checklist_items`
- `event_finances`
- `event_live_notes`
- `event_sales_categories`
- `event_reviews`
- `buy_items`
- `sources`
- `organizers`
- `review_candidates`
- `event_decisions`
- `app_settings`

There is no realtime channel subscription and no existing database RPC call in the application.

### Storage and network functions

Storage buckets referenced:

- `transaction-images`
- `sale-images`
- `event-images`

Server/Edge endpoints:

- Supabase Edge Function `pokemon-card-search`
  - Optional secret: `POKEMON_TCG_API_KEY`
  - Handles CORS, validation, and upstream errors.
  - Needs a server-side upstream timeout and less verbose upstream-body logging.
- `api/calendar-feed.ts`
  - No secret.
  - URL validation and timeout are present.
- `api/product-preview.ts`
  - No secret.
  - URL validation and timeout are present.

Client environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

No service-role key is referenced by frontend code.

## Findings

| ID | Severity | Finding | Evidence and impact | Planned repair |
| --- | --- | --- | --- | --- |
| F-01 | Critical | Legacy rows are not idempotent across interrupted retries. | Unified sale, purchase, lot, and expense completion creates a generated legacy ID, then persists that ID back to the canonical item. A failure between those steps lets Retry create another legacy row. | Preassign deterministic materialization IDs on canonical items, persist the draft first, and reuse them on every retry. |
| F-02 | Critical | Inventory is not atomically claimed. | Sale/trade completion validates against inventory already loaded by the page. Two devices can both pass the check. | Add a safe inventory-claim RPC with same-transaction retry semantics, plus a pre-migration live-query fallback. |
| F-03 | Critical | Completion state precedes dependent balance writes. | Non-trade completion saves `status = completed`, then upserts internal balances. A balance failure exposes an incomplete transaction as final. | Persist balances before the final parent transition; preserve `draft` on validation/dependency failure. |
| F-04 | High | Checked-in schema is missing columns used by current transaction code. | The app expects `transaction_subtype`, `allocation_method`, general image fields, and other current fields not present in the original unified table definition. | Add only canonical, application-used columns with `ADD COLUMN IF NOT EXISTS`; backfill compatible legacy names safely. |
| F-05 | High | `transaction_images.sort_order` is used but absent from checked-in unified SQL. | Image list/save requests can produce an unknown-column error. | Add `sort_order integer NOT NULL DEFAULT 0` and supporting indexes. |
| F-06 | High | The Supabase client is untyped. | `createClient` has no `Database` generic, so table/column drift is caught only at runtime. | Add an audited database type snapshot and type the single shared client; regenerate from live schema when authorized. |
| F-07 | High | Ownership replacement deletes valid rows before the replacement is accepted. | Transaction, inventory, and sale ownership repositories delete all shares, then insert. Insert failure leaves ownership empty. | Upsert desired `(parent, worker)` rows first and delete only stale rows afterward. |
| F-08 | High | Unified sale materialization does not persist legacy profit ownership. | A legacy `sales_records` row is created, but `sale_profit_shares` is not written from item ownership. Legacy owner charts can under-report. | Save sale ownership after deterministic sale upsert and make the ownership operation retry-safe. |
| F-09 | High | Unified tables are explicitly configured with RLS disabled in checked-in SQL. | Any client holding the publishable key can depend entirely on grants/API exposure. | Do not silently change RLS in the reconciliation migration; document and verify live state, then deploy an explicit authenticated authorization design separately. |
| F-10 | High | Transaction image storage has one broad anonymous `FOR ALL` policy. | Public anonymous callers can potentially mutate any object in the bucket. | Replace with explicit operation policies in a separately reviewed auth model; reconciliation only establishes required bucket/metadata compatibility. |
| F-11 | High | Image object upload and metadata insert are not atomic. | Metadata failure can orphan an object; retry can create another object path. The canonical transaction itself is not duplicated. | Preserve the parent UUID, use stable attachment IDs/paths where possible, and report upload vs draft failures independently. |
| F-12 | Medium | Live generated schema types cannot currently be refreshed. | No CLI/link state and metadata endpoint requires a secret key. | Keep a clearly labeled audited snapshot, add preflight, and list live type generation as a deployment prerequisite. |
| F-13 | Medium | Repository item, payment, image, balance, and share payloads are inline and weakly typed. | Schema-incompatible properties can enter during future form changes. | Centralize typed allowlist payload builders and strip `undefined` values. |
| F-14 | Medium | Repository completion does not independently enforce ownership validity. | UI checks can be bypassed by future callers. Current validation also does not reject duplicate worker entries. | Add repository-level ownership validation: unique workers, finite percentages, exact 100% tolerance. |
| F-15 | Medium | Inventory lineage lacks a self-reference guard in checked-in SQL. | A malformed operation could record an item as exchanged for itself. | Add a safe `NOT VALID` check, validate only after confirming no conflicting data, and retain the existing unique index. |
| F-16 | Medium | Canonical transaction listing is broad and unpaginated. | `select("*")` plus all child collections grows with the entire transaction history. | Use explicit columns and add paging/limits after the reliability change; keep current behavior compatible in this patch. |
| F-17 | Medium | Several auxiliary repositories use broad `select("*")`. | Adds payload and schema-coupling cost. | Track as performance cleanup; change only high-value transaction queries in this pass. |
| F-18 | Medium | The Edge Function has no server-side timeout for the Pokémon upstream request. | A stalled upstream can consume function time even though the browser has its own timeout. | Add `AbortController`, return a clear 504, and avoid logging upstream response bodies. |
| F-19 | Medium | Transaction completion is staged but not a single database transaction. | Failures can leave a draft with some legacy/inventory work already applied. | Make every stage idempotent and resumable now; use atomic RPCs for claim/final transition where practical. |
| F-20 | Medium | Abandoned claimed inventory needs visible recovery semantics. | An atomic claim can intentionally reserve an item for a draft; a permanently abandoned draft must not silently strand it. | Keep the transaction as an identifiable draft and include release/cancel follow-up in deployment operations. |
| F-21 | Medium | Live bucket existence/policies cannot be verified from the available key. | Upload behavior may differ from checked-in SQL. | Add manual preflight checks for bucket access and metadata columns; verify in Supabase after migration. |
| F-22 | Low | `.env` and `dist` had been tracked despite ignore rules. | The current `.env` contains only URL/publishable-key variables, but history includes the file. | Removed both from the index in checkpoint `5eeac403`; local files remain. Rotate any value if it was ever treated as confidential. |
| F-23 | Low | Multiple Supabase client paths appear in imports. | They are re-export shims, not separate initialized clients, but they can confuse maintenance. | Keep the one initialized client and document/reduce shims opportunistically. |
| F-24 | Low | No lint script or ESLint configuration exists. | “Lint” cannot currently be run as a distinct validation gate. | Report as not configured; use TypeScript build and test suite as available gates. |
| F-25 | Low | Supabase CLI lint cannot run in this workspace. | CLI is absent and the project is not linked. | List exact post-migration commands for an authenticated environment; do not fabricate a pass. |
| F-26 | Low | Some image retries may leave duplicate metadata/object candidates even though the transaction UUID is preserved. | Current image paths are time-based; a failed metadata stage can lose the stable relationship. | Reuse attachment identity on Retry and expose upload cleanup/retry state separately from draft state. |

## Existing controls that passed review

- Unified parent payloads are explicitly allowlisted.
- `expense_category` is included only for expense transactions.
- `item_mode` is written as `single` or `multiple`; `entry_mode` is not queried.
- Multi-item cost basis is loaded from inventory `total_cost`, not current market value.
- Missing cost basis blocks final profit and requires explicit confirmation for a true zero.
- Trade value and cash components remain separate from ordinary sales revenue.
- Legacy rows linked to canonical transaction IDs are filtered out of normalized exports, preventing double-counting.
- CSV exports include BOM/CRLF handling and spreadsheet-formula escaping.
- XLSX export uses a real workbook writer.
- Sales Control loads independent sources with `Promise.allSettled`, timeouts, and cached-data fallback.
- Transaction drafts use client-generated IDs and local recovery.
- Camera streams and blob/object URLs are cleaned up.
- Upload and transaction error state are already separated in the unified UI.
- Lineage uses an idempotent conflict key.

## Reconciliation plan

The follow-up migration will:

1. Preserve all existing tables and rows.
2. Reconcile only the canonical transaction structures.
3. Add missing canonical columns with `IF NOT EXISTS`.
4. Backfill `allocation_method` from `pricing_mode` only when the source exists and the target is empty.
5. Keep `item_mode` as the only database item-mode field.
6. Add `transaction_images.sort_order`.
7. Preserve `sales_record_id` as the canonical `sale_profit_shares` foreign key and conditionally backfill it from a legacy singular name if such a column exists.
8. Add/repair unique and lookup indexes without dropping business data.
9. Add safe lineage and ownership constraints only after conflict checks.
10. Ensure the `transaction-images` bucket metadata exists.
11. Add an idempotent inventory-claim RPC.
12. End with `NOTIFY pgrst, 'reload schema'`.

It will not:

- Drop, truncate, rename, or replace a business table.
- Create a competing transaction table.
- Create or write `entry_mode`.
- Delete or rewrite valid transaction data.
- Enable or disable RLS without a separately approved authorization design.
- Run automatically from this repository.

## Required post-migration verification

Run in an authenticated Supabase environment after reviewing and applying the migration:

1. Regenerate TypeScript database types from the linked project.
2. Run Supabase database lint/advisors.
3. Inspect RLS/grants for every canonical and legacy table.
4. Inspect bucket policies for `transaction-images`, `sale-images`, and `event-images`.
5. Run the in-app Supabase Health Check.
6. Execute the transaction retry/concurrency/image test matrix.
7. Confirm PostgREST schema cache reload and absence of unknown-column errors.
