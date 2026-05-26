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
    cacheStatus,
    mode: isSupabaseConfigured ? "Team Sync" : "Local Mode",
    appMode: isSupabaseConfigured ? "Team Sync Mode" : "Manual Local Mode",
    urlDetected: Boolean(supabaseUrl),
    publishableKeyDetected: Boolean(supabasePublishableKey)
  };
}

export async function testSupabaseConnection() {
  if (!supabase) {
    const error = "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing.";
    setSupabaseStatus({ connected: false, error });
    console.log("Using Local mode");
    return { ok: false, error };
  }

  console.log("Using Supabase mode");
  const { error } = await supabase.from("events").select("id").limit(1);
  if (error) {
    setSupabaseStatus({ connected: false, error: error.message });
    console.error("Supabase error:", error.message);
    return { ok: false, error: error.message };
  }

  setSupabaseStatus({ connected: true, error: "", synced: true });
  return { ok: true, error: "" };
}
