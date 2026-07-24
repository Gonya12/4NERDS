import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const pokemonCardsUrl = "https://api.pokemontcg.io/v2/cards";
const selectedFields = "id,name,number,set,rarity,images,tcgplayer,subtypes,supertype";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SearchRequest = {
  q?: string;
  id?: string;
  page?: number;
  pageSize?: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validQuery(value: string) {
  return value.length > 0
    && value.length <= 240
    && !/[\r\n\u0000-\u001f]/.test(value)
    && /^[\p{L}\p{N}\s"'./:&()_*-]+$/u.test(value);
}

function safeQuery(value: unknown) {
  return String(value || "").normalize("NFKC").replace(/[\r\n\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function upstreamMessage(status: number) {
  if (status === 400) return "The card search query was not accepted. Try searching by card name only.";
  if (status === 401 || status === 403) return "The Pokémon TCG API authentication is unavailable.";
  if (status === 429) return "The Pokémon TCG API rate limit was reached. Try again shortly.";
  if (status >= 500) return "The Pokémon TCG API is temporarily unavailable. Try again shortly.";
  return "The Pokémon TCG API request could not be completed.";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let input: SearchRequest;
  try {
    input = await request.json();
  } catch {
    return json({ error: "A valid JSON request body is required." }, 400);
  }

  const cardId = String(input.id || "").trim();
  const query = safeQuery(input.q);
  if (cardId && !/^[a-z0-9-]{2,80}$/i.test(cardId)) {
    return json({ error: "Invalid Pokémon card ID." }, 400);
  }
  if (!cardId && !validQuery(query)) {
    return json({ error: "Invalid or empty Pokémon card query." }, 400);
  }

  const page = Math.min(100, Math.max(1, Math.floor(Number(input.page) || 1)));
  const pageSize = Math.min(20, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
  const params = new URLSearchParams({ select: selectedFields, page: String(page), pageSize: String(pageSize) });
  if (!cardId) params.set("q", query);
  const endpoint = cardId
    ? `${pokemonCardsUrl}/${encodeURIComponent(cardId)}?${params.toString()}`
    : `${pokemonCardsUrl}?${params.toString()}`;
  const apiKey = Deno.env.get("POKEMON_TCG_API_KEY");
  const headers = apiKey ? { "X-Api-Key": apiKey } : undefined;

  try {
    console.info("pokemon-card-search request", { stage: "upstream_request", cardId: Boolean(cardId), query, page, pageSize, endpoint });
    const upstream = await fetch(endpoint, { headers });
    const body = await upstream.text();
    console.info("pokemon-card-search response", { stage: "upstream_response", status: upstream.status, body: body.slice(0, 800) });
    if (!upstream.ok) return json({ success: false, code: upstream.status === 400 ? "INVALID_SEARCH_QUERY" : upstream.status === 429 ? "RATE_LIMITED" : upstream.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "UPSTREAM_REQUEST_FAILED", message: upstreamMessage(upstream.status) }, upstream.status);
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": upstream.ok ? "public, max-age=120" : "no-store",
      },
    });
  } catch (error) {
    console.error("pokemon-card-search failure", { stage: "network", message: error instanceof Error ? error.message : "Unknown error" });
    return json({ success: false, code: "UPSTREAM_CONNECTION_FAILED", message: "The Pokémon TCG API could not be reached. Try again shortly." }, 502);
  }
});
