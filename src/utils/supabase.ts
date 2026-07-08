import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      realtime: { params: { eventsPerSecond: 5 } }
    })
  : undefined;

let lastSupabaseError = "";
let lastSyncTime = "";
let lastConnected = false;
let lastSyncDurationMs = 0;
let lastEventsLoaded = 0;
let lastQueryCount = 0;
let cacheStatus = "Not checked";
let sessionRequestCount = 0;
let lastPageLoaded = "";
let lastFailedQuery = "";
const actionCooldowns = new Map<string, number>();

type SupabaseRequestLog = {
  table: string;
  functionName: string;
  timestamp: string;
  route: string;
  rows?: number;
};

const recentRequests: SupabaseRequestLog[] = [];

export function setSupabaseStatus(status: { error?: string; connected?: boolean; synced?: boolean; durationMs?: number; eventsLoaded?: number; queryCount?: number; cacheStatus?: string }) {
  if (status.error !== undefined) lastSupabaseError = status.error;
  if (status.connected !== undefined) lastConnected = status.connected;
  if (status.synced) lastSyncTime = new Date().toISOString();
  if (status.durationMs !== undefined) lastSyncDurationMs = status.durationMs;
  if (status.eventsLoaded !== undefined) lastEventsLoaded = status.eventsLoaded;
  if (status.queryCount !== undefined) lastQueryCount = status.queryCount;
  if (status.cacheStatus !== undefined) cacheStatus = status.cacheStatus;
}

export function getSupabaseStatus() {
  return {
    configured: isSupabaseConfigured,
    connected: lastConnected,
    error: lastSupabaseError,
    lastSyncTime,
    lastSyncDurationMs,
    lastEventsLoaded,
    lastQueryCount,
    sessionRequestCount,
    lastPageLoaded,
    lastFailedQuery,
    recentRequests: recentRequests.slice(-10).reverse(),
    cacheStatus,
    mode: isSupabaseConfigured ? "Team Sync" : "Local Mode",
    appMode: isSupabaseConfigured ? "Team Sync Mode" : "Manual Local Mode",
    urlDetected: Boolean(supabaseUrl),
    publishableKeyDetected: Boolean(supabasePublishableKey)
  };
}

export function formatSupabaseError(context: { functionName: string; table: string; error: unknown; route?: string }) {
  const error = context.error as { message?: string; code?: string; details?: string; hint?: string; status?: number; statusText?: string };
  const route = context.route || (typeof window !== "undefined" ? window.location.pathname : "server");
  const timestamp = new Date().toISOString();
  const message = error?.message || String(context.error || "Unknown Supabase error");
  const lines = [
    `${context.functionName} query failed on ${context.table}: ${message}`,
    `table: ${context.table}`,
    `function: ${context.functionName}`,
    `route: ${route}`,
    `timestamp: ${timestamp}`
  ];
  if (error?.code) lines.push(`code: ${error.code}`);
  if (error?.details) lines.push(`details: ${error.details}`);
  if (error?.hint) lines.push(`hint: ${error.hint}`);
  if (error?.status) lines.push(`status: ${error.status}`);
  if (error?.statusText) lines.push(`statusText: ${error.statusText}`);
  return lines.join("\n");
}

export function recordSupabaseError(context: { functionName: string; table: string; error: unknown; connected?: boolean }) {
  const details = formatSupabaseError(context);
  lastFailedQuery = details;
  setSupabaseStatus({ connected: context.connected ?? false, error: details });
  console.error("[Supabase Error]", details, context.error);
  return details;
}

export function recordSupabaseRequest(table: string, functionName: string, rows?: number) {
  sessionRequestCount += 1;
  const timestamp = new Date().toISOString();
  const route = typeof window !== "undefined" ? window.location.pathname : "server";
  const entry = { table, functionName, timestamp, route, rows };
  recentRequests.push(entry);
  if (recentRequests.length > 100) recentRequests.shift();
  if (import.meta.env.DEV) {
    console.info("Supabase query", entry);
  }
}

export function recordPageLoad(page: string) {
  lastPageLoaded = page;
}

export function canRunAction(key: string, cooldownMs = 45_000) {
  const lastRun = actionCooldowns.get(key) || 0;
  return Date.now() - lastRun >= cooldownMs;
}

export function markActionRun(key: string) {
  actionCooldowns.set(key, Date.now());
}

export function actionCooldownRemainingSeconds(key: string, cooldownMs = 45_000) {
  const lastRun = actionCooldowns.get(key) || 0;
  return Math.max(0, Math.ceil((cooldownMs - (Date.now() - lastRun)) / 1000));
}

export async function testSupabaseConnection() {
  if (!supabase) {
    const error = "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing.";
    setSupabaseStatus({ connected: false, error });
    return { ok: false, error };
  }

  const { data, error } = await supabase.from("events").select("id").limit(1);
  recordSupabaseRequest("events", "testSupabaseConnection", data?.length || 0);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    return { ok: false, error: error.message };
  }

  setSupabaseStatus({ connected: true, error: "", synced: true });
  return { ok: true, error: "" };
}
