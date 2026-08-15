import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPokemonApiQueries,
  escapePokemonLuceneValue,
  normalizeCardSearchText,
  parseCardSearchQuery,
  parseCollectorNumber,
  rankPokemonCardResults,
  suggestPokemonNameCorrection,
} from "../supabase/functions/_shared/pokemonCardSearchCore.ts";
import {
  buildCardSearchRequest,
  parseCompatibleCardSearchRequest,
} from "../supabase/functions/_shared/cardSearchRequestContract.ts";

test("normalizes punctuation, accents, whitespace, dashes, and special printed names", () => {
  assert.equal(normalizeCardSearchText("  Farfetch’d\t—  Flabébé\n"), "farfetchd flabebe");
  assert.equal(normalizeCardSearchText("Type: Null"), "type null");
  assert.equal(normalizeCardSearchText("Mr. Mime"), "mr mime");
  assert.equal(normalizeCardSearchText("Ho-Oh"), "ho oh");
  assert.equal(normalizeCardSearchText("Porygon-Z"), "porygon z");
});

test("parses combined names and collector-number families without losing leading zeros", () => {
  const examples = [
    ["Pikachu 067", "Pikachu", "067"],
    ["Charizard ex 125/197", "Charizard ex", "125/197"],
    ["Lance’s Charizard V SWSH133", "Lance's Charizard V", "SWSH133"],
    ["Mewtwo GX 78/73", "Mewtwo GX", "78/73"],
    ["Trainer Gallery card TG01/TG30", "Trainer Gallery card", "TG01/TG30"],
    ["Galarian Gallery card GG44/GG70", "Galarian Gallery card", "GG44/GG70"],
  ] as const;
  for (const [query, name, number] of examples) {
    const parsed = parseCardSearchQuery(query);
    assert.equal(parsed.originalName, name);
    assert.equal(parsed.collector?.normalized, number);
  }
  for (const number of ["67", "067", "SM04", "SV107", "H1", "RC29", "XY121"]) {
    assert.equal(parseCollectorNumber(number)?.normalized, number);
  }
  assert.deepEqual(parseCollectorNumber("067")?.variants, ["067", "67"]);
  assert.deepEqual(parseCollectorNumber("067/198")?.variants, ["067/198", "067", "67"]);
});

test("recognizes compact suffixes and keeps suffix families distinct", () => {
  assert.equal(parseCardSearchQuery("UmbreonGX").suffix, "GX");
  assert.equal(parseCardSearchQuery("Charizard ex").suffix, "ex");
  assert.equal(parseCardSearchQuery("Mewtwo EX").suffix, "EX");
  assert.equal(parseCardSearchQuery("Pikachu VMAX").suffix, "VMAX");

  const ranked = rankPokemonCardResults([
    { id: "v", name: "Umbreon V", number: "94" },
    { id: "vmax", name: "Umbreon VMAX", number: "95" },
    { id: "gx", name: "Umbreon GX", number: "80" },
  ], "UmbreonGX");
  assert.equal(ranked[0].id, "gx");
  assert.ok(ranked.find((card) => card.id === "gx")!.matchScore > ranked.find((card) => card.id === "v")!.matchScore);
});

test("suggests only conservative dictionary corrections and never hides the original", () => {
  assert.equal(suggestPokemonNameCorrection("Pikchu")?.suggestion, "Pikachu");
  assert.equal(suggestPokemonNameCorrection("Charzard ex")?.suggestion, "Charizard ex");
  assert.equal(suggestPokemonNameCorrection("Gyrados ex")?.suggestion, "Gyarados ex");
  assert.equal(suggestPokemonNameCorrection("Tpu Bulu GX")?.suggestion, "Tapu Bulu GX");
  assert.equal(suggestPokemonNameCorrection("Umbreon")?.suggestion, undefined);
  assert.equal(suggestPokemonNameCorrection("completely unrelated attack text"), undefined);

  const parsed = parseCardSearchQuery("Pikchu 067");
  assert.equal(parsed.originalName, "Pikchu");
  assert.equal(parsed.name, "Pikachu");
  assert.equal(parsed.correction?.original, "Pikchu");
});

test("builds escaped bounded Lucene queries from structured input", () => {
  const escaped = escapePokemonLuceneValue('Mr. Mime +(Test): "GX"');
  assert.equal(escaped, "Mr. Mime \\+\\(Test\\)\\: \\\"GX\\\"");
  const queries = buildPokemonApiQueries(parseCardSearchQuery({
    query: "Lance’s Charizard V SWSH133",
    set: "SWSH Promo",
  }));
  assert.match(queries[0].query, /name:"Lance's Charizard V" number:SWSH133 set.name:"SWSH Promo"/);
  assert.ok(queries.length <= 10);
  assert.ok(queries.some((query) => query.query === "number:SWSH133"));
});

test("builds progressive prefix and exact fallbacks for short Pokémon names", () => {
  const pika = buildPokemonApiQueries(parseCardSearchQuery("pika")).map((value) => value.query);
  assert.deepEqual(pika.slice(0, 2), ["name:pika*", "name:pika"]);

  const numbered = buildPokemonApiQueries(parseCardSearchQuery("Pikachu 067")).map((value) => value.query);
  assert.deepEqual(numbered.slice(0, 4), [
    "name:pikachu number:067",
    "number:067",
    "name:pikachu",
    "name:pika*",
  ]);
  assert.ok(numbered.includes("number:67"));

  const ranked = rankPokemonCardResults([
    { id: "pikachu", name: "Pikachu", number: "25" },
    { id: "unrelated", name: "Raichu", number: "26" },
  ], "pika");
  assert.equal(ranked[0].id, "pikachu");
  assert.notEqual(ranked[0].confidence, "unreliable");
});

test("generates hyphenated and spaced suffix queries without merging suffix types", () => {
  const queries = buildPokemonApiQueries(parseCardSearchQuery("Pikachu GX 067")).map((value) => value.query);
  assert.equal(queries[0], 'name:"Pikachu\\-GX" number:067');
  assert.ok(queries.includes('name:"Pikachu GX" number:067'));
  assert.ok(queries.includes('name:"Pikachu" number:067'));
  assert.ok(queries.includes("number:067"));
  assert.ok(queries.every((query) => !query.includes("VMAX")));
});

test("number-only search ranks exact numbers across sets and weak results stay unreliable", () => {
  const ranked = rankPokemonCardResults([
    { id: "a", name: "Pikachu", number: "067", set: { id: "set-a" } },
    { id: "b", name: "Raichu", number: "67", set: { id: "set-b" } },
    { id: "c", name: "Unrelated", number: "999", set: { id: "set-c" } },
  ], "067");
  assert.deepEqual(ranked.slice(0, 2).map((card) => card.id), ["a", "b"]);
  assert.ok(ranked.slice(0, 2).every((card) => card.confidence === "likely"));
  assert.equal(ranked[2].confidence, "unreliable");
});

test("invalid punctuation cannot create a raw query or crash parsing", () => {
  assert.doesNotThrow(() => parseCardSearchQuery('"; DROP TABLE cards; --'));
  const queries = buildPokemonApiQueries(parseCardSearchQuery('Pikachu +(test):"'));
  assert.ok(queries.every((query) => !query.query.includes(':""')));
  assert.ok(queries.every((query) => !query.query.includes("\n")));
});

test("canonical request builder preserves the visible query and rejects empty or invalid requests", () => {
  assert.deepEqual(buildCardSearchRequest({
    game: "pokemon",
    language: "en",
    query: "  Dragonite  ",
    page: 1,
    pageSize: 30,
  }), {
    game: "pokemon",
    language: "en",
    query: "Dragonite",
    name: "Dragonite",
    collectorNumber: null,
    set: null,
    page: 1,
    pageSize: 30,
  });
  assert.deepEqual(buildCardSearchRequest({
    game: "pokemon",
    language: "en",
    query: "",
    collectorNumber: "067",
  }), {
    game: "pokemon",
    language: "en",
    query: "067",
    name: null,
    collectorNumber: "067",
    set: null,
    page: 1,
    pageSize: 30,
  });
  assert.throws(() => buildCardSearchRequest({ game: "other", language: "unknown", query: "Dragonite" }), /game/i);
  assert.throws(() => buildCardSearchRequest({ game: "pokemon", language: "en", query: "" }), /query|collector/i);
});

test("Edge compatibility parser accepts canonical and temporary legacy query fields", () => {
  const expectedQuery = "Dragonite";
  for (const field of ["query", "search", "searchQuery", "rawQuery", "q", "cardName", "name"]) {
    const parsed = parseCompatibleCardSearchRequest({
      game: "pokemon",
      language: "en",
      [field]: ` ${expectedQuery} `,
    });
    assert.equal(parsed.query, expectedQuery, field);
  }
  assert.equal(parseCompatibleCardSearchRequest({
    game: "pokemon",
    language: "en",
    query: "",
    collector_number: "067",
  }).collectorNumber, "067");
  assert.equal(parseCompatibleCardSearchRequest({
    game: "pokemon",
    language: "en",
    query: "",
    cardNumber: "149",
  }).collectorNumber, "149");
  assert.equal(parseCompatibleCardSearchRequest({
    game: "pokemon",
    language: "en",
    query: "",
    searchQuery: "Dragonite",
  }).query, "Dragonite");
  assert.equal(buildPokemonApiQueries(parseCardSearchQuery(
    parseCompatibleCardSearchRequest({ game: "pokemon", language: "en", query: "Dragonite" }),
  ))[0].query, "name:dragonite");
});

test("direct Edge request bodies A through E produce usable provider queries", () => {
  const cases = [
    [{ game: "pokemon", language: "en", query: "Dragonite" }, "name:dragonite"],
    [{ game: "pokemon", language: "en", name: "Dragonite", query: "" }, "name:dragonite"],
    [{ game: "pokemon", language: "en", query: "Dragonite 149" }, "name:dragonite number:149"],
    [{ game: "pokemon", language: "en", query: "149" }, "number:149"],
    [{ game: "pokemon", language: "en", query: "pika" }, "name:pika*"],
  ] as const;
  for (const [body, expectedProviderQuery] of cases) {
    const request = parseCompatibleCardSearchRequest(body);
    const parsed = parseCardSearchQuery(request);
    assert.ok(parsed.originalName || parsed.collector, JSON.stringify(body));
    assert.equal(buildPokemonApiQueries(parsed)[0].query, expectedProviderQuery);
  }
});

test("client cancellation and Edge rate-limit contracts prevent stale or retry-loop behavior", () => {
  const hook = readFileSync(new URL("../src/hooks/usePokemonCardSearch.ts", import.meta.url), "utf8");
  const edge = readFileSync(new URL("../supabase/functions/pokemon-card-search/index.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/services/sales/pokemonCardSearchService.ts", import.meta.url), "utf8");
  const contract = readFileSync(new URL("../src/services/sales/cardSearchContract.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/components/sales/ManualCardSearch.tsx", import.meta.url), "utf8");
  assert.match(hook, /requestId\.current/);
  assert.match(hook, /controller\.current\?\.abort/);
  assert.match(hook, /currentRequest !== requestId\.current/);
  assert.match(edge, /Retry-After/);
  assert.match(edge, /result\.status === 429/);
  assert.match(edge, /for \(const candidate of queries\)/);
  assert.match(edge, /results:\s*normalizedResult\.matches/);
  assert.match(edge, /POKEMON_TCG_API_KEY is not configured/);
  assert.match(edge, /status:\s*204/);
  assert.match(client, /payload\.results/);
  assert.match(client, /edgeFunctionReached/);
  assert.match(client, /providerResponseStatus/);
  assert.match(client, /buildCardSearchRequest/);
  assert.match(contract, /cardSearchRequestContract\.ts/);
  assert.match(edge, /parseCompatibleCardSearchRequest/);
  assert.match(edge, /receivedKeys/);
  assert.match(edge, /providerQuery/);
  assert.match(hook, /lastInput\.current\s*=\s*\{\s*\.\.\.input\s*\}/);
  assert.doesNotMatch(client, /Check the card search and try again/);
  assert.match(contract, /CARD_SEARCH_FUNCTION_NAME\s*=\s*"pokemon-card-search"/);
  assert.match(ui, /Developer Debug/);
  assert.doesNotMatch(edge, /while\s*\(/);
});
