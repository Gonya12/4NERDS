import { isSupabaseConfigured, supabase, supabasePublishableKey, supabaseUrl } from "../../utils/supabase";
import { CARD_SEARCH_FUNCTION_NAME } from "../sales/cardSearchContract";

export type SupabaseHealthStatus = "pass" | "fail";

export type SupabaseHealthResult = {
  id: string;
  label: string;
  group: "table" | "storage" | "function";
  status: SupabaseHealthStatus;
  detail: string;
  durationMs: number;
};

export type SupabaseHealthReport = {
  startedAt: string;
  completedAt: string;
  passed: number;
  failed: number;
  results: SupabaseHealthResult[];
};

type Check = {
  id: string;
  label: string;
  group: SupabaseHealthResult["group"];
  run: () => Promise<string>;
};

const tableChecks: Array<{ table: string; columns: string }> = [
  {
    table: "financial_transactions",
    columns: "id,transaction_type,transaction_subtype,transaction_date,event_id,event_day_id,customer_or_seller,payment_method,cash_received,cash_paid,bundle_total,allocation_method,entered_by_worker_id,notes,status,item_mode,general_image_url,general_image_path,expense_category,completed_at,reversed_at,reversal_of_transaction_id,created_at,updated_at"
  },
  {
    table: "financial_transaction_items",
    columns: "id,transaction_id,direction,inventory_purchase_id,created_inventory_purchase_id,created_sales_record_id,created_business_expense_id,prior_inventory_purchase_id,item_name,item_type,quantity,market_value,agreed_trade_value,trade_percentage,historical_cost_basis,zero_cost_basis_confirmed,allocated_cost_basis,sold_price,bought_price,cash_allocation,image_url,image_path,back_image_url,back_image_path,collector_number,card_set,card_set_id,card_set_code,card_rarity,card_game,card_language,data_provider,provider_card_id,card_code,pokemon_tcg_card_id,official_card_image_url,tcgplayer_url,market_price_source,market_price_variant,market_price_updated_at,market_price_checked_at,market_price_currency,tcgplayer_pricing,target_buy_percentage,target_buy_price,card_selection_source,cost_basis_is_estimate,card_condition,sticker_price,grading_company,grade,certificate_number,notes,created_at,updated_at"
  },
  {
    table: "transaction_item_ownership_shares",
    columns: "id,transaction_item_id,worker_id,ownership_percentage,allocated_cost_basis,allocated_trade_value,created_at,updated_at"
  },
  {
    table: "transaction_payments",
    columns: "id,transaction_id,direction,payment_method,amount,paid_by_worker_id,note,paid_at,created_at,updated_at"
  },
  {
    table: "transaction_internal_balances",
    columns: "id,transaction_id,owed_by_worker_id,owed_to_worker_id,amount,settled,notes,created_at,updated_at"
  },
  {
    table: "inventory_lineage",
    columns: "id,source_inventory_purchase_id,resulting_inventory_purchase_id,transaction_id,relationship_type,created_at"
  },
  {
    table: "transaction_images",
    columns: "id,transaction_id,transaction_item_id,image_type,image_url,image_path,sort_order,created_at,updated_at"
  },
  {
    table: "sales_records",
    columns: "id,financial_transaction_id,financial_transaction_item_id,card_game,card_language,data_provider,provider_card_id,card_code,market_price_currency"
  },
  {
    table: "inventory_purchases",
    columns: "id,total_cost,status,financial_transaction_id,financial_transaction_item_id,acquisition_method,acquired_financial_transaction_id,disposed_financial_transaction_id,traded_at,agreed_trade_value,prior_inventory_purchase_id,card_game,card_language,data_provider,provider_card_id,card_code,market_price_currency"
  },
  {
    table: "business_expenses",
    columns: "id,financial_transaction_id,financial_transaction_item_id"
  },
  {
    table: "sale_profit_shares",
    columns: "id,sales_record_id,worker_id,ownership_percentage"
  },
  {
    table: "events",
    columns: "id"
  },
  {
    table: "event_days",
    columns: "id,event_id"
  },
  {
    table: "event_day_workers",
    columns: "id,event_day_id,worker_id"
  }
];

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function failureDetail(check: Check, error: unknown) {
  const message = messageOf(error);
  if (check.group === "storage") return `Missing bucket or inaccessible policy: ${message}`;
  if (check.group === "function") return `Function unavailable: ${message}`;
  if (/relation .* does not exist|table .*not found|PGRST205/i.test(message)) return `Missing table: ${message}`;
  if (/column .* does not exist|could not find the .* column|PGRST204|42703/i.test(message)) return `Missing column: ${message}`;
  if (/invalid input|type|22P02|42804/i.test(message)) return `Type mismatch suspected: ${message}`;
  return `Type mismatch suspected or access denied: ${message}`;
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 12_000) {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
      })
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function runSupabaseHealthCheck(): Promise<SupabaseHealthReport> {
  const startedAt = new Date().toISOString();
  if (!isSupabaseConfigured || !supabase || !supabaseUrl || !supabasePublishableKey) {
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      passed: 0,
      failed: 1,
      results: [{
        id: "configuration",
        label: "Supabase configuration",
        group: "function",
        status: "fail",
        detail: "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.",
        durationMs: 0
      }]
    };
  }
  const client = supabase;
  const projectUrl = supabaseUrl;
  const publishableKey = supabasePublishableKey;

  const checks: Check[] = tableChecks.map(({ table, columns }) => ({
    id: `table:${table}`,
    label: table,
    group: "table",
    run: async () => {
      const result = await client.from(table).select(columns).limit(0);
      if (result.error) throw new Error(result.error.message);
      return `Required columns are available (${columns.split(",").length} checked).`;
    }
  }));

  for (const bucket of ["transaction-images", "sale-images", "event-images"]) {
    checks.push({
      id: `storage:${bucket}`,
      label: `${bucket} bucket`,
      group: "storage",
      run: async () => {
        const result = await client.storage.from(bucket).list("", { limit: 1 });
        if (result.error) throw new Error(result.error.message);
        return "Bucket is reachable with the current client policy.";
      }
    });
  }

  checks.push({
    id: "function:inventory-claim",
    label: "claim_financial_transaction_inventory RPC",
    group: "function",
    run: async () => {
      const result = await client.rpc("claim_financial_transaction_inventory", {
        p_transaction_id: "00000000-0000-0000-0000-000000000000",
        p_inventory_ids: [],
        p_disposition: "sold"
      });
      if (!result.error || result.error.code === "P0002" || /was not found/i.test(result.error.message)) {
        return "Function is exposed in the schema cache.";
      }
      throw new Error(result.error.message);
    }
  });

  checks.push({
    id: `function:${CARD_SEARCH_FUNCTION_NAME}`,
    label: `${CARD_SEARCH_FUNCTION_NAME} Edge Function`,
    group: "function",
    run: async () => {
      const response = await fetch(`${projectUrl}/functions/v1/${CARD_SEARCH_FUNCTION_NAME}`, {
        method: "OPTIONS",
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`
        }
      });
      if (!response.ok) throw new Error(`OPTIONS returned HTTP ${response.status}.`);
      return "CORS preflight succeeded.";
    }
  });

  const settled = await Promise.allSettled(checks.map(async (check) => {
    const started = performance.now();
    try {
      const detail = await withTimeout(check.run(), check.label);
      return {
        id: check.id,
        label: check.label,
        group: check.group,
        status: "pass" as const,
        detail: `Ready: ${detail}`,
        durationMs: Math.round(performance.now() - started)
      };
    } catch (error) {
      return {
        id: check.id,
        label: check.label,
        group: check.group,
        status: "fail" as const,
        detail: failureDetail(check, error),
        durationMs: Math.round(performance.now() - started)
      };
    }
  }));

  const results = settled.map((result, index): SupabaseHealthResult => result.status === "fulfilled"
    ? result.value
    : {
      id: checks[index].id,
      label: checks[index].label,
      group: checks[index].group,
      status: "fail",
      detail: messageOf(result.reason),
      durationMs: 0
    });
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    results
  };
}
