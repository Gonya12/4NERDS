import { Clock3, ExternalLink, LoaderCircle, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePokemonCardSearch } from "../../hooks/usePokemonCardSearch";
import type { PokemonProductCategory } from "../../types/models";
import type { CardMatch, CardScanSuggestion } from "../../services/sales/cardScanService";
import {
  cardProviderLabel,
  type ManualCardSearchInput,
} from "../../services/sales/pokemonCardSearchService";
import {
  extractOnePieceCardCode,
  type CardGame,
  type CardLanguage,
} from "../../../supabase/functions/_shared/unifiedCardSearchCore.ts";
import { ImageLightbox } from "./ImageLightbox";
import { TcgplayerPricingPanel } from "./TcgplayerPricingPanel";

type Props = {
  open: boolean;
  category: PokemonProductCategory;
  baseSuggestion?: CardScanSuggestion;
  initialName?: string;
  initialCollectorNumber?: string;
  initialSet?: string;
  initialLanguage?: string;
  initialGame?: CardGame;
  onClose: () => void;
  onApply: (suggestion: CardScanSuggestion) => void;
};

type SearchTerms = {
  game: CardGame;
  query: string;
  set: string;
  language: CardLanguage;
  finish: string;
  cardType: string;
};

const recentSearchesKey = (game: CardGame, language: CardLanguage) => `4nerds_recent_card_searches_v3:${game}:${language}`;
const inputClass = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-violet-900";

function blankSuggestion(category: PokemonProductCategory): CardScanSuggestion {
  return {
    suggestedType: category === "graded_card" ? "graded_card" : "raw_card",
    cardName: null,
    collectorNumber: null,
    cardSet: null,
    language: null,
    cardGame: "pokemon",
    cardLanguage: "en",
    dataProvider: "pokemontcg",
    condition: null,
    stickerPrice: null,
    gradingCompany: null,
    grade: null,
    certificateNumber: null,
    labelInformation: null,
    barcodeText: null,
    overallConfidence: "low",
    fieldConfidence: {},
    warnings: [],
  };
}

function readRecentSearches(game: CardGame, language: CardLanguage) {
  try {
    const values = JSON.parse(localStorage.getItem(recentSearchesKey(game, language)) || "[]") as SearchTerms[];
    return values.filter((value) => value?.query).slice(0, 6);
  } catch {
    return [] as SearchTerms[];
  }
}

function searchLabel(terms: SearchTerms) {
  return [terms.query, terms.set, terms.language].filter(Boolean).join(" · ");
}

function variantLabel(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

const confidenceLabels = {
  exact: { label: "Exact Match", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  likely: { label: "Likely Match", className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  possible: { label: "Possible Match", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100" },
  unreliable: { label: "No Reliable Match", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
};

export function ManualCardSearch({
  open,
  category,
  baseSuggestion,
  initialName = "",
  initialCollectorNumber = "",
  initialSet = "",
  initialLanguage = "",
  initialGame = "pokemon",
  onClose,
  onApply,
}: Props) {
  const initialQuery = [initialName, initialCollectorNumber].filter(Boolean).join(" ");
  const [terms, setTerms] = useState<SearchTerms>({
    game: initialGame,
    query: initialQuery,
    set: initialSet,
    language: initialLanguage === "ja" || /japanese/i.test(initialLanguage) ? "ja" : "en",
    finish: "",
    cardType: "",
  });
  const [recentSearches, setRecentSearches] = useState<SearchTerms[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [selected, setSelected] = useState<CardScanSuggestion>();
  const [retryMatch, setRetryMatch] = useState<CardMatch>();
  const [largeMatch, setLargeMatch] = useState<CardMatch>();
  const { result, loading, error, search, retry, cancel, clear } = usePokemonCardSearch();

  useEffect(() => {
    if (!open) {
      cancel();
      setSelecting(false);
      return;
    }
    const language = initialLanguage === "ja" || /japanese/i.test(initialLanguage) ? "ja" : "en";
    setTerms({ game: initialGame, query: initialQuery, set: initialSet, language, finish: "", cardType: "" });
    setRecentSearches(readRecentSearches(initialGame, language));
    setSelectionMessage("");
    setSelectionError("");
    setSelected(undefined);
    setRetryMatch(undefined);
    clear();
  }, [open, initialQuery, initialSet, initialLanguage, initialGame, cancel, clear]);

  const searchInput = (nextTerms: SearchTerms, page = 1, disableCorrection = false): ManualCardSearchInput => ({
    ...nextTerms,
    page,
    pageSize: 20,
    disableCorrection,
  });

  async function runSearch(nextTerms = terms, page = 1, append = false, disableCorrection = false) {
    setSelectionError("");
    setSelected(undefined);
    const response = await search(searchInput(nextTerms, page, disableCorrection), append);
    if (!response || append) return;
    const nextRecent = [
      nextTerms,
      ...readRecentSearches(nextTerms.game, nextTerms.language).filter((value) => searchLabel(value) !== searchLabel(nextTerms)),
    ].slice(0, 6);
    localStorage.setItem(recentSearchesKey(nextTerms.game, nextTerms.language), JSON.stringify(nextRecent));
    setRecentSearches(nextRecent);
  }

  async function chooseCard(match: CardMatch) {
    cancel();
    setSelecting(true);
    setSelectionError("");
    setRetryMatch(undefined);
    setSelectionMessage(`Loading ${terms.game === "one_piece" ? "OPTCG API" : terms.language === "ja" ? "TCGdex" : "TCGplayer"} pricing…`);
    const controller = new AbortController();
    try {
      const { confirmPokemonCardMatch } = await import("../../services/sales/cardScanService");
      const confirmed = await confirmPokemonCardMatch(baseSuggestion || blankSuggestion(category), match, controller.signal);
      const nextSelected: CardScanSuggestion = {
        ...confirmed,
        language: terms.language,
        cardLanguage: terms.language,
        cardGame: terms.game,
        overallConfidence: "high",
        warnings: confirmed.warnings.filter((warning) => !/no .*match|search manually/i.test(warning)),
      };
      if (nextSelected.tcgplayerPricing?.variants.length !== 1) {
        setSelected(nextSelected);
        setSelectionMessage(nextSelected.tcgplayerPricing?.variants.length
          ? nextSelected.cardGame === "one_piece"
            ? "Choose the matching One Piece printing."
            : nextSelected.cardLanguage === "ja"
              ? "Choose the matching provider variant for this Japanese printing."
              : "Choose the finish printed on the physical card."
          : "Card ready. This provider has no market price for the selected printing.");
        return;
      }
      onApply(nextSelected);
      onClose();
    } catch (reason) {
      setSelectionError(reason instanceof Error ? reason.message : "Could not load the selected card.");
      setRetryMatch(match);
    } finally {
      setSelecting(false);
      setSelectionMessage("");
    }
  }

  function applyManualMetadata() {
    const manual = {
      ...(baseSuggestion || blankSuggestion(category)),
      cardName: terms.query.trim() || baseSuggestion?.cardName || null,
      collectorNumber: terms.game === "one_piece"
        ? extractOnePieceCardCode(terms.query) || baseSuggestion?.collectorNumber || null
        : baseSuggestion?.collectorNumber || null,
      cardSet: terms.set.trim() || baseSuggestion?.cardSet || null,
      cardGame: terms.game,
      cardLanguage: terms.game === "pokemon" ? terms.language : terms.game === "one_piece" ? "en" as const : "unknown" as const,
      language: terms.game === "pokemon" ? terms.language : terms.game === "one_piece" ? "en" : "unknown",
      dataProvider: "manual" as const,
      providerCardId: undefined,
      cardCode: terms.game === "one_piece" ? extractOnePieceCardCode(terms.query) || undefined : undefined,
      pokemonTcgCardId: undefined,
      officialImageUrl: undefined,
      tcgplayerUrl: undefined,
      tcgplayerPricing: undefined,
      overallConfidence: "low" as const,
      warnings: ["Manual card metadata; verify the printed name, number, set, and market value."],
    };
    onApply(manual);
    onClose();
  }

  const matches = result?.matches || [];
  const topConfidence = matches[0]?.searchConfidence || "unreliable";
  const correction = terms.game === "pokemon" && terms.language === "en" ? result?.parsed.correction : undefined;
  const pricing = selected?.tcgplayerPricing;
  const requiresVariant = Boolean(pricing && pricing.variants.length > 1 && !pricing.selectedVariant);
  const selectedVariant = pricing?.variants.find((variant) => variant.variant === pricing.selectedVariant);
  const canNameFallback = Boolean(result?.parsed.originalName && result.parsed.collector);
  const canNumberFallback = Boolean(result?.parsed.collector && result.parsed.originalName);
  const grouped = useMemo(() => {
    const order = ["exact", "likely", "possible"] as const;
    return order.map((confidence) => ({
      confidence,
      matches: matches.filter((match) => match.searchConfidence === confidence),
    })).filter((group) => group.matches.length);
  }, [matches]);

  if (!open) return null;

  return <>
    <div role="dialog" aria-modal="true" aria-label="Search cards" className="fixed inset-0 z-[95] overflow-y-auto bg-slate-950/80 p-2 backdrop-blur-sm sm:p-5">
      <section className="mx-auto my-2 w-full max-w-6xl space-y-4 rounded-3xl bg-white p-4 shadow-2xl sm:p-6 dark:bg-slate-900">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Smart card search</p>
            <h2 className="text-2xl font-black text-ink dark:text-white">Find the exact card printing</h2>
            <p className="mt-1 text-sm text-slate-500">Choose the game first, then search a name, collector number, or card code. Provider metadata stays isolated per game and language.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close card search" className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800"><X size={20} /></button>
        </header>

        <form className="space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950" onSubmit={(event) => { event.preventDefault(); if (terms.game !== "other") void runSearch(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-black text-slate-600 dark:text-slate-300">Card game
              <select value={terms.game} onChange={(event) => {
                const game = event.target.value as CardGame;
                const language = game === "pokemon" ? terms.language : game === "one_piece" ? "en" : "unknown";
                const next = { ...terms, game, language, finish: "" } as SearchTerms;
                cancel(); clear(); setSelected(undefined); setTerms(next); setRecentSearches(readRecentSearches(game, language));
              }} className={inputClass}>
                <option value="pokemon">Pokémon</option>
                <option value="one_piece">One Piece</option>
                <option value="other">Other / Manual</option>
              </select>
            </label>
            {terms.game === "pokemon" ? <label className="text-xs font-black text-slate-600 dark:text-slate-300">Printing language
              <select value={terms.language} onChange={(event) => {
                const language = event.target.value as CardLanguage;
                cancel(); clear(); setSelected(undefined); setTerms({ ...terms, language }); setRecentSearches(readRecentSearches(terms.game, language));
              }} className={inputClass}>
                <option value="en">English</option>
                <option value="ja">Japanese</option>
              </select>
            </label> : <div className="rounded-xl bg-white p-3 text-xs font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">{terms.game === "one_piece" ? "English catalog · OPTCG API" : "External search is disabled; keep entering the item manually."}</div>}
          </div>
          <label className="block text-xs font-black text-slate-600 dark:text-slate-300">
            Card name and/or collector number
            <input
              autoFocus
              value={terms.query}
              onChange={(event) => setTerms({ ...terms, query: event.target.value })}
              placeholder={terms.game === "one_piece" ? "Roronoa Zoro, OP01-001, or ST01 001" : terms.language === "ja" ? "ピカチュウ, 016, or pasted Japanese text" : "Charizard ex 125/197, SWSH133, or Pikachu"}
              className={inputClass}
            />
          </label>
          <details>
            <summary className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-white px-3 text-xs font-black shadow-sm dark:bg-slate-900"><SlidersHorizontal size={15} />Advanced filters</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-black text-slate-600 dark:text-slate-300">Set name or ID<input value={terms.set} onChange={(event) => setTerms({ ...terms, set: event.target.value })} placeholder={terms.game === "one_piece" ? "Romance Dawn or OP-01" : "Pokémon 151"} className={inputClass} /></label>
              {terms.game === "pokemon" && terms.language === "en" ? <label className="text-xs font-black text-slate-600 dark:text-slate-300">Finish<select value={terms.finish} onChange={(event) => setTerms({ ...terms, finish: event.target.value })} className={inputClass}><option value="">Any finish</option><option value="normal">Normal</option><option value="holofoil">Holofoil</option><option value="reverse holofoil">Reverse holofoil</option><option value="1st edition">1st Edition</option></select></label> : null}
              <label className="text-xs font-black text-slate-600 dark:text-slate-300">Card type / rarity<input value={terms.cardType} onChange={(event) => setTerms({ ...terms, cardType: event.target.value })} placeholder={terms.game === "one_piece" ? "Character, Leader, SR…" : "Pokémon, Trainer, Energy…"} className={inputClass} /></label>
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={loading || terms.game === "other"} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-black text-white disabled:opacity-50">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}Search</button>
            {loading ? <button type="button" onClick={cancel} className="min-h-11 rounded-xl bg-rose-100 px-4 text-sm font-black text-rose-700 dark:bg-rose-950 dark:text-rose-200">Cancel</button> : null}
            <button type="button" onClick={() => {
              setTerms({ game: terms.game, query: "", set: "", language: terms.language, finish: "", cardType: "" });
              clear();
              setSelected(undefined);
            }} className="min-h-11 rounded-xl bg-slate-200 px-5 text-sm font-black dark:bg-slate-800">Clear</button>
            <button type="button" onClick={applyManualMetadata} className="min-h-11 rounded-xl bg-amber-100 px-5 text-sm font-black text-amber-900 dark:bg-amber-950 dark:text-amber-100">{terms.game === "other" ? "Use Other / Manual" : "Keep as manual entry"}</button>
          </div>
        </form>

        {recentSearches.length ? <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 font-black text-slate-500"><Clock3 size={14} />Recent</span>
          {recentSearches.map((recent) => <button type="button" key={searchLabel(recent)} disabled={loading} onClick={() => { setTerms(recent); void runSearch(recent); }} className="min-h-9 rounded-full bg-slate-100 px-3 font-bold dark:bg-slate-800">{searchLabel(recent)}</button>)}
        </div> : null}

        {correction ? <section className="flex flex-wrap items-center gap-2 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
          <strong>Showing results for “{correction.suggestion}”.</strong>
          <button type="button" onClick={() => {
            const next = { ...terms, query: [correction.suggestion, result?.parsed.collector?.normalized].filter(Boolean).join(" ") };
            setTerms(next);
            void runSearch(next);
          }} className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-black text-white">Search suggestion</button>
          <button type="button" onClick={() => void runSearch(terms, 1, false, true)} className="rounded-lg bg-white px-3 py-2 text-xs font-black dark:bg-slate-900">Search instead for “{correction.original}”</button>
        </section> : null}

        {error ? <div role="alert" className="rounded-xl bg-rose-100 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
          <p>{error.message}</p>
          <button type="button" onClick={() => void retry()} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl bg-rose-700 px-4 font-black text-white"><RotateCcw size={15} />Retry search</button>
        </div> : null}
        {selectionError ? <div role="alert" className="rounded-xl bg-rose-100 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"><p>{selectionError}</p>{retryMatch ? <button type="button" onClick={() => void chooseCard(retryMatch)} className="mt-2 rounded-lg bg-rose-700 px-3 py-2 font-black text-white">Retry pricing</button> : null}</div> : null}
        {selectionMessage ? <p role="status" className="rounded-xl bg-violet-50 p-3 text-sm font-black text-violet-800 dark:bg-violet-950/40 dark:text-violet-100">{selectionMessage}</p> : null}
        {result?.warnings.map((warning) => <p key={warning} role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{warning}</p>)}
        {loading && !matches.length ? <p role="status" className="rounded-xl bg-violet-50 p-4 text-sm font-bold text-violet-800 dark:bg-violet-950/30 dark:text-violet-200"><LoaderCircle className="mr-2 inline animate-spin" size={18} />Searching exact details, then safe fallbacks…</p> : null}

        {selected ? <section className="space-y-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
          <div className="flex flex-col gap-3 sm:flex-row">
            {selected.officialImageUrl ? <img src={selected.officialImageUrl} alt={`${selected.cardName} official card`} className="mx-auto h-64 w-44 rounded-xl object-contain sm:mx-0" /> : null}
            <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Card selected</p><h3 className="text-xl font-black">{selected.cardName} · {selected.cardCode || selected.collectorNumber}</h3><p>{selected.cardSet}{selected.cardSetCode ? ` · ${selected.cardSetCode}` : ""}{selected.cardRarity ? ` · ${selected.cardRarity}` : ""}</p><p className="mt-2 text-xs text-slate-500">{cardProviderLabel(selected.dataProvider)} ID: {selected.providerCardId || selected.pokemonTcgCardId} · {selected.cardGame === "one_piece" ? "One Piece" : selected.cardLanguage === "ja" ? "Pokémon · Japanese" : "Pokémon · English"}</p></div>
          </div>
          <TcgplayerPricingPanel suggestion={selected} isSlab={category === "graded_card"} onChange={setSelected} />
          {requiresVariant ? <p className="text-sm font-black text-amber-700 dark:text-amber-300">Choose the finish printed on the physical card before applying it.</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setSelected(undefined)} className="min-h-11 rounded-xl bg-slate-200 px-4 text-sm font-black dark:bg-slate-800">Choose a different card</button>
            <button type="button" disabled={requiresVariant} onClick={() => { onApply(selected); onClose(); }} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-40">Apply selected card{selectedVariant?.market != null ? ` · ${pricing?.currency || "USD"} ${selectedVariant.market.toFixed(2)} market` : ""}</button>
          </div>
          {!pricing?.variants.length ? <p className="text-xs font-bold text-amber-700 dark:text-amber-300">{selected.cardGame === "pokemon" && selected.cardLanguage === "ja" ? "Market pricing unavailable for this Japanese printing." : "No market price is available."} Applying this card will leave editable transaction prices unchanged.</p> : null}
        </section> : null}

        {result && !loading && !matches.length && !error ? <section className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <h3 className="font-black">No reliable match</h3>
          <p className="mt-1">No weak candidate was forced into the transaction. Broaden one part of the search or keep entering the item manually.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canNameFallback ? <button type="button" onClick={() => {
              const next = { ...terms, query: result.parsed.originalName, set: "" };
              setTerms(next); void runSearch(next);
            }} className="rounded-xl bg-amber-900 px-4 py-2 font-black text-white">Try name only</button> : null}
            {canNumberFallback ? <button type="button" onClick={() => {
              const next = { ...terms, query: result.parsed.collector?.normalized || "", set: "" };
              setTerms(next); void runSearch(next);
            }} className="rounded-xl bg-amber-900 px-4 py-2 font-black text-white">Try number only</button> : null}
            <button type="button" onClick={applyManualMetadata} className="rounded-xl bg-white px-4 py-2 font-black dark:bg-slate-900">Enter manually</button>
          </div>
        </section> : null}

        {matches.length ? <>
          <div className="flex items-end justify-between gap-3">
            <div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${confidenceLabels[topConfidence].className}`}>{confidenceLabels[topConfidence].label}</span><h3 className="mt-2 text-lg font-black">Ranked official card results</h3><p className="text-xs text-slate-500">{topConfidence === "possible" ? "We found similar cards. Choose the exact printing. " : ""}{result?.totalCount || matches.length} catalog record{(result?.totalCount || matches.length) === 1 ? "" : "s"} found. Confirm the image, number, set, and finish.</p></div>
            {loading ? <LoaderCircle className="animate-spin text-violet-600" size={20} /> : null}
          </div>
          {grouped.map((group) => <section key={group.confidence} className="space-y-3">
            <h4 className="text-sm font-black text-slate-600 dark:text-slate-300">{confidenceLabels[group.confidence].label}</h4>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.matches.map((match) => <article key={`${match.provider}:${match.providerCardId}`} className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 p-3 sm:grid-cols-[8rem_minmax(0,1fr)] dark:border-slate-700">
                {match.imageSmall ? <img src={match.imageSmall} alt={`${match.name} official card`} loading="lazy" className="mx-auto h-48 w-32 rounded-xl bg-slate-100 object-contain dark:bg-slate-950" /> : <div className="grid h-48 w-32 place-items-center rounded-xl bg-slate-100 text-xs text-slate-500 dark:bg-slate-950">No image</div>}
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap gap-1.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${confidenceLabels[match.searchConfidence].className}`}>{confidenceLabels[match.searchConfidence].label}</span><span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-800 dark:bg-violet-950 dark:text-violet-200">{match.game === "one_piece" ? "ONE PIECE · EN" : match.language === "ja" ? "POKÉMON · 日本語" : "POKÉMON · EN"}</span></div>
                  <h4 className="text-lg font-black">{match.name}</h4>
                  <p className="font-bold">#{match.cardCode || match.collectorNumber} · {match.setName}</p>
                  <p className="text-sm text-slate-500">{match.setCode || match.setId || "Set code unavailable"}{match.setReleaseDate ? ` · ${match.setReleaseDate}` : ""}{match.rarity ? ` · ${match.rarity}` : ""}</p>
                  {match.game === "one_piece" && (match.supertype || match.subtypes?.length) ? <p className="text-sm text-slate-500">{[match.supertype, ...(match.subtypes || [])].filter(Boolean).join(" · ")}</p> : null}
                  <p className="text-sm font-black">{match.pricing?.market == null ? "Market price unavailable" : `${match.pricing.currency || "USD"} ${match.pricing.market.toFixed(2)} market`}</p>
                  <p className="text-xs text-slate-500">{match.pricing?.variants?.length ? `${match.game === "one_piece" ? "Printings" : "Variants"}: ${match.pricing.variants.map((variant) => variantLabel(variant.name)).join(", ")}` : `No variant pricing listed · ${cardProviderLabel(match.provider)}`}</p>
                  <p className="text-xs font-bold text-violet-700 dark:text-violet-300">{match.reasons.slice(0, 2).join(" · ")}</p>
                  <div className="grid gap-2 pt-2 sm:grid-cols-2">
                    <button type="button" disabled={selecting} onClick={() => void chooseCard(match)} className="min-h-11 rounded-xl bg-violet-600 px-3 text-sm font-black text-white disabled:opacity-40">{selecting ? "Applying…" : "Use this card"}</button>
                    <button type="button" disabled={!match.imageLarge && !match.imageSmall} onClick={() => setLargeMatch(match)} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black disabled:opacity-40 dark:bg-slate-800">View larger</button>
                  </div>
                  {match.productUrl ? <a href={match.productUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 pt-1 text-xs font-black text-sky-700 underline dark:text-sky-300"><ExternalLink size={13} />Provider product</a> : null}
                  <details className="pt-1 text-xs text-slate-500"><summary className="cursor-pointer font-bold">Technical details</summary><p className="mt-1">{cardProviderLabel(match.provider)} ID: {match.providerCardId} · Ranking score: {match.matchScore}/100</p><ul className="mt-1 list-inside list-disc">{match.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
                </div>
              </article>)}
            </div>
          </section>)}
          {result?.hasMore ? <button type="button" disabled={loading} onClick={() => void runSearch(terms, result.page + 1, true)} className="min-h-11 w-full rounded-xl bg-slate-200 px-4 text-sm font-black disabled:opacity-40 dark:bg-slate-800">{loading ? "Loading…" : "Load more"}</button> : null}
        </> : null}
      </section>
    </div>
    <ImageLightbox imageUrl={largeMatch?.imageLarge || largeMatch?.imageSmall} title={largeMatch ? `${largeMatch.name} · ${largeMatch.setName} #${largeMatch.cardCode || largeMatch.collectorNumber}` : "Official card"} onClose={() => setLargeMatch(undefined)} />
  </>;
}
