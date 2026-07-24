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
  const query = String(input.q || "").trim();
  if (cardId && !/^[a-z0-9-]{2,80}$/i.test(cardId)) {
    return json({ error: "Invalid Pokémon card ID." }, 400);
  }
  if (!cardId && !validQuery(query)) {
    return json({ error: "Invalid or empty Pokémon card query." }, 400);
  }

  const page = Math.min(100, Math.max(1, Math.floor(Number(input.page) || 1)));
  const pageSize = Math.min(20, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
  const endpoint = cardId
    ? `${pokemonCardsUrl}/${encodeURIComponent(cardId)}?select=${selectedFields}`
    : `${pokemonCardsUrl}?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&select=${selectedFields}`;
  const apiKey = Deno.env.get("POKEMON_TCG_API_KEY");
  const headers = apiKey ? { "X-Api-Key": apiKey } : undefined;

  try {
    const upstream = await fetch(endpoint, { headers });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": upstream.ok ? "public, max-age=120" : "no-store",
      },
    });
  } catch {
    return json({ error: "The Pokémon TCG API could not be reached." }, 502);
  }
});
