/*
 * Audited Supabase type snapshot.
 *
 * This workspace is not linked to the Supabase CLI and the configured
 * publishable key cannot read the project OpenAPI schema. Keep the canonical
 * transaction structures strict here, while legacy/supporting tables remain
 * permissive until deployment can regenerate this file from the live project.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type LooseRow = Record<string, any>;
type LooseTable = {
  Row: LooseRow;
  Insert: LooseRow;
  Update: LooseRow;
  Relationships: [];
};

export type FinancialTransactionRow = {
  id: string;
  transaction_type: "sold" | "purchased" | "cost" | "trade" | "cash_trade";
  transaction_subtype: string | null;
  transaction_date: string;
  event_id: string | null;
  event_day_id: string | null;
  customer_or_seller: string | null;
  payment_method: string | null;
  cash_received: number;
  cash_paid: number;
  bundle_total: number | null;
  allocation_method: "individual" | "bundle_total";
  entered_by_worker_id: string | null;
  notes: string | null;
  status: "draft" | "completed" | "cancelled" | "reversed";
  item_mode: "single" | "multiple";
  general_image_url: string | null;
  general_image_path: string | null;
  expense_category: string | null;
  completed_at: string | null;
  reversed_at: string | null;
  reversal_of_transaction_id: string | null;
  created_at: string;
  updated_at: string;
  [compatibilityColumn: string]: any;
};

export type FinancialTransactionItemRow = {
  id: string;
  transaction_id: string;
  direction: "outgoing" | "incoming" | "expense";
  inventory_purchase_id: string | null;
  created_inventory_purchase_id: string | null;
  created_sales_record_id: string | null;
  created_business_expense_id: string | null;
  prior_inventory_purchase_id: string | null;
  item_name: string;
  item_type: string;
  quantity: number;
  market_value: number;
  agreed_trade_value: number;
  trade_percentage: number | null;
  cost_basis: number;
  zero_cost_basis_confirmed: boolean;
  sold_price: number | null;
  purchase_price: number | null;
  allocated_cash_amount: number | null;
  image_url: string | null;
  image_path: string | null;
  back_image_url: string | null;
  back_image_path: string | null;
  collector_number: string | null;
  card_set: string | null;
  card_set_id: string | null;
  card_set_code: string | null;
  card_rarity: string | null;
  card_game: "pokemon" | "one_piece" | "other" | null;
  card_language: string | null;
  data_provider: "pokemontcg" | "tcgdex" | "optcgapi" | "manual" | null;
  provider_card_id: string | null;
  card_code: string | null;
  pokemon_tcg_card_id: string | null;
  official_card_image_url: string | null;
  tcgplayer_url: string | null;
  market_price_source: string | null;
  market_price_variant: string | null;
  market_price_updated_at: string | null;
  market_price_checked_at: string | null;
  market_price_currency: string | null;
  tcgplayer_pricing: Json | null;
  target_buy_percentage: number | null;
  target_buy_price: number | null;
  card_selection_source: string | null;
  cost_basis_is_estimate: boolean;
  card_condition: string | null;
  sticker_price: number | null;
  grading_company: string | null;
  grade: string | null;
  certificate_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TransactionPaymentRow = {
  id: string;
  transaction_id: string;
  direction: "received" | "paid";
  payment_method: string;
  amount: number;
  paid_by_worker_id: string | null;
  note: string | null;
  paid_at: string;
  created_at: string;
  updated_at: string;
};

type CanonicalTable<Row extends LooseRow> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, "id">;
  Update: Partial<Row>;
  Relationships: [];
};

type TransactionPaymentTable = {
  Row: TransactionPaymentRow;
  Insert: Pick<TransactionPaymentRow,
    "transaction_id"
    | "direction"
    | "payment_method"
    | "amount"
    | "paid_by_worker_id"
    | "note"
    | "paid_at"
  > & { id?: string };
  Update: Partial<Omit<TransactionPaymentRow, "id">>;
  Relationships: [];
};

type CanonicalTables = {
  financial_transactions: CanonicalTable<FinancialTransactionRow>;
  financial_transaction_items: CanonicalTable<FinancialTransactionItemRow>;
  transaction_item_ownership_shares: LooseTable;
  transaction_payments: TransactionPaymentTable;
  transaction_internal_balances: LooseTable;
  inventory_lineage: LooseTable;
  transaction_images: LooseTable;
};

export type Database = {
  public: {
    Tables: Record<string, LooseTable> & CanonicalTables;
    Views: Record<string, never>;
    Functions: Record<string, {
      Args: Record<string, any>;
      Returns: any;
    }> & {
      claim_financial_transaction_inventory: {
        Args: {
          p_transaction_id: string;
          p_inventory_ids: string[];
          p_disposition: "sold" | "traded_out";
        };
        Returns: Array<{
          inventory_id: string;
          inventory_status: string;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
