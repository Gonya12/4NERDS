import { Clock3, ExternalLink, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PokemonProductCategory } from "../../types/models";
import type {
  CardMatch,
  CardScanSuggestion,
  ManualCardSearchInput,
} from "../../services/sales/cardScanService";
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
  onClose: () => void;
  onApply: (suggestion: CardScanSuggestion) => void;
};

type SearchTerms = {
  name: string;
  collectorNumber: string;
  set: string;
  language: string;
};

const recentSearchesKey = "4nerds_recent_manual_card_searches_v1";
const inputClass = "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-950 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white";

function blankSuggestion(category: PokemonProductCategory): CardScanSuggestion {
  return {
    suggestedType: category === "graded_card" ? "graded_card" : "raw_card",
    cardName: null,
    collectorNumber: null,
    cardSet: null,
    language: null,
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

function readRecentSearches() {
  try {
    const values = JSON.parse(localStorage.getItem(recentSearchesKey) || "[]") as SearchTerms[];
    return values.filter((value) => value && (value.name || value.collectorNumber || value.set)).slice(0, 5);
  } catch {
    return [] as SearchTerms[];
  }
}

function searchLabel(terms: SearchTerms) {
  return [
    terms.name,
    terms.collectorNumber && `#${terms.collectorNumber}`,
    terms.set,
    terms.language,
  ].filter(Boolean).join(" · ");
}

function variantLabel(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

export function ManualCardSearch({
  open,
  category,
  baseSuggestion,
  initialName = "",
  initialCollectorNumber = "",
  initialSet = "",
  initialLanguage = "",
  onClose,
  onApply,
}: Props) {
  const [terms, setTerms] = useState<SearchTerms>({
    name: initialName,
    collectorNumber: initialCollectorNumber,
    set: initialSet,
    language: initialLanguage,
  });
  const [recentSearches, setRecentSearches] = useState<SearchTerms[]>([]);
  const [results, setResults] = useState<CardMatch[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<CardScanSuggestion>();
  const [largeMatch, setLargeMatch] = useState<CardMatch>();
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      controllerRef.current?.abort();
      setLoading(false);
      setSelecting(false);
      return;
    }
    setTerms({
      name: initialName,
      collectorNumber: initialCollectorNumber,
      set: initialSet,
      language: initialLanguage,
    });
    setRecentSearches(readRecentSearches());
    setResults([]);
    setPage(1);
    setHasMore(false);
    setTotalCount(0);
    setError("");
    setSearched(false);
    setSelected(undefined);
    setLoading(false);
    setSelecting(false);
  }, [open, initialName, initialCollectorNumber, initialSet, initialLanguage]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  if (!open) return null;

  async function runSearch(nextPage = 1, append = false, nextTerms = terms) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError("");
    if (!append) {
      setSelected(undefined);
      setResults([]);
    }
    try {
      const { searchPokemonCardsManually } = await import("../../services/sales/cardScanService");
      const input: ManualCardSearchInput = { ...nextTerms, page: nextPage, pageSize: 20 };
      const response = await searchPokemonCardsManually(input, controller.signal);
      const normalized = {
        name: response.normalizedTerms.name,
        collectorNumber: response.normalizedTerms.collectorNumber,
        set: response.normalizedTerms.set,
        language: response.normalizedTerms.language,
      };
      setTerms(normalized);
      setResults((current) => {
        const values = append ? [...current, ...response.matches] : response.matches;
        return [...new Map(values.map((match) => [match.id, match])).values()];
      });
      setPage(response.page);
      setHasMore(response.hasMore);
      setTotalCount(response.totalCount);
      setSearched(true);
      if (!append) {
        const nextRecent = [
          normalized,
          ...readRecentSearches().filter((value) => searchLabel(value) !== searchLabel(normalized)),
        ].slice(0, 5);
        localStorage.setItem(recentSearchesKey, JSON.stringify(nextRecent));
        setRecentSearches(nextRecent);
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      setSearched(true);
      setError(reason instanceof Error ? reason.message : "Manual card search failed.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function chooseCard(match: CardMatch) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSelecting(true);
    setError("");
    try {
      const { confirmPokemonCardMatch } = await import("../../services/sales/cardScanService");
      const confirmed = await confirmPokemonCardMatch(
        baseSuggestion || blankSuggestion(category),
        match,
        controller.signal,
      );
      setSelected({
        ...confirmed,
        language: terms.language || confirmed.language,
        overallConfidence: "high",
        warnings: confirmed.warnings.filter((warning) => !/no .*match|search manually/i.test(warning)),
      });
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Could not load the selected card.");
      }
    } finally {
      if (!controller.signal.aborted) setSelecting(false);
    }
  }

  const pricing = selected?.tcgplayerPricing;
  const requiresVariant = Boolean(pricing && pricing.variants.length > 1 && !pricing.selectedVariant);
  const selectedVariant = pricing?.variants.find((variant) => variant.variant === pricing.selectedVariant);

  return <>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search Card Manually"
      className="fixed inset-0 z-[95] overflow-y-auto bg-slate-950/80 p-2 backdrop-blur-sm sm:p-5"
    >
      <section className="mx-auto my-2 w-full max-w-6xl space-y-4 rounded-3xl bg-white p-4 shadow-2xl sm:p-6 dark:bg-slate-900">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Pokémon TCG API</p>
            <h2 className="text-2xl font-black text-ink dark:text-white">Search Card Manually</h2>
            <p className="mt-1 text-sm text-slate-500">Find the exact printing, choose its physical finish, then return to the unsaved form.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close manual card search" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800"><X size={20} /></button>
        </header>

        <form
          className="grid gap-3 rounded-2xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4 dark:bg-slate-950"
          onSubmit={(event) => { event.preventDefault(); void runSearch(); }}
        >
          <label className="text-xs font-black text-slate-600 dark:text-slate-300">Card / Pokémon name
            <input value={terms.name} onChange={(event) => setTerms({ ...terms, name: event.target.value })} placeholder="Charizard ex" className={`mt-1 ${inputClass}`} />
          </label>
          <label className="text-xs font-black text-slate-600 dark:text-slate-300">Collector number <span className="font-normal">(optional)</span>
            <input value={terms.collectorNumber} onChange={(event) => setTerms({ ...terms, collectorNumber: event.target.value })} placeholder="025/165" className={`mt-1 ${inputClass}`} />
          </label>
          <label className="text-xs font-black text-slate-600 dark:text-slate-300">Set name or ID <span className="font-normal">(optional)</span>
            <input value={terms.set} onChange={(event) => setTerms({ ...terms, set: event.target.value })} placeholder="Pokemon 151 or sv3pt5" className={`mt-1 ${inputClass}`} />
          </label>
          <label className="text-xs font-black text-slate-600 dark:text-slate-300">Language <span className="font-normal">(optional)</span>
            <input value={terms.language} onChange={(event) => setTerms({ ...terms, language: event.target.value })} placeholder="English" className={`mt-1 ${inputClass}`} />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-black text-white disabled:opacity-50">
              {loading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}Search
            </button>
            <button type="button" disabled={loading} onClick={() => {
              controllerRef.current?.abort();
              setTerms({ name: "", collectorNumber: "", set: "", language: "" });
              setResults([]);
              setSelected(undefined);
              setSearched(false);
              setError("");
            }} className="min-h-11 rounded-xl bg-slate-200 px-5 text-sm font-black dark:bg-slate-800">Clear</button>
          </div>
          {terms.language ? <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">Language is preserved in the draft. The official Pokémon TCG API catalog may not include every non-English printing.</p> : null}
        </form>

        {recentSearches.length ? <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 font-black text-slate-500"><Clock3 size={14} />Recent</span>
          {recentSearches.map((recent) => <button
            type="button"
            key={searchLabel(recent)}
            disabled={loading}
            onClick={() => { setTerms(recent); void runSearch(1, false, recent); }}
            className="min-h-9 rounded-full bg-slate-100 px-3 font-bold dark:bg-slate-800"
          >{searchLabel(recent)}</button>)}
        </div> : null}

        {error ? <p role="alert" className="rounded-xl bg-rose-100 p-3 text-sm font-black text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">{error}</p> : null}
        {loading && !results.length ? <p role="status" className="rounded-xl bg-violet-50 p-4 text-sm font-bold text-violet-800 dark:bg-violet-950/30 dark:text-violet-200"><LoaderCircle className="mr-2 inline animate-spin" size={18} />Searching the official card catalog…</p> : null}

        {selected ? <section className="space-y-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
          <div className="flex flex-col gap-3 sm:flex-row">
            {selected.officialImageUrl ? <img src={selected.officialImageUrl} alt={`${selected.cardName} official card`} className="mx-auto h-64 w-44 rounded-xl object-contain sm:mx-0" /> : null}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Exact card selected</p>
              <h3 className="text-xl font-black">{selected.cardName} · {selected.collectorNumber}</h3>
              <p>{selected.cardSet}{selected.cardSetCode ? ` · ${selected.cardSetCode}` : ""}{selected.cardRarity ? ` · ${selected.cardRarity}` : ""}</p>
              <p className="mt-2 text-xs text-slate-500">API card ID: {selected.pokemonTcgCardId}</p>
            </div>
          </div>
          <TcgplayerPricingPanel suggestion={selected} isSlab={category === "graded_card"} onChange={setSelected} />
          {requiresVariant ? <p className="text-sm font-black text-amber-700 dark:text-amber-300">Choose the finish printed on your physical card before applying it.</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setSelected(undefined)} className="min-h-11 rounded-xl bg-slate-200 px-4 text-sm font-black dark:bg-slate-800">Choose a Different Card</button>
            <button
              type="button"
              disabled={requiresVariant}
              onClick={() => {
                onApply(selected);
                onClose();
              }}
              className="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-40"
            >Apply Selected Card{selectedVariant?.market != null ? ` · $${selectedVariant.market.toFixed(2)} market` : ""}</button>
          </div>
          {!pricing?.variants.length ? <p className="text-xs font-bold text-amber-700 dark:text-amber-300">This card has no available TCGplayer price. It can still be applied; Market Value will remain blank and editable.</p> : null}
        </section> : null}

        {searched && !loading && !results.length && !error ? <section className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <h3 className="font-black">No official cards matched those terms.</h3>
          <p className="mt-1">Try removing the set, searching the collector number alone, or using a shorter card name. Your photo and existing form values are unchanged.</p>
          <button type="button" onClick={onClose} className="mt-3 min-h-10 rounded-xl bg-amber-900 px-4 font-black text-white">Enter Everything Manually</button>
        </section> : null}

        {results.length ? <>
          <div className="flex items-end justify-between gap-3">
            <div><h3 className="text-lg font-black">Official card results</h3><p className="text-xs text-slate-500">{totalCount} matching record{totalCount === 1 ? "" : "s"}. Compare the image, set, and collector number.</p></div>
            {loading ? <LoaderCircle className="animate-spin text-violet-600" size={20} /> : null}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {results.map((match) => <article key={match.id} className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 p-3 sm:grid-cols-[10rem_minmax(0,1fr)] dark:border-slate-700">
              <img src={match.imageUrl} alt={`${match.cardName} official card`} loading="lazy" className="mx-auto h-60 w-40 rounded-xl bg-slate-100 object-contain dark:bg-slate-950" />
              <div className="min-w-0 space-y-1">
                <h4 className="text-lg font-black">{match.cardName}</h4>
                <p className="font-bold">#{match.collectorNumber} · {match.setName}</p>
                <p className="text-sm text-slate-500">{match.setReleaseDate || "Release date unavailable"}{match.rarity ? ` · ${match.rarity}` : ""}</p>
                <p className="text-sm font-black">{match.marketPrice == null ? "Market price unavailable" : `$${match.marketPrice.toFixed(2)} available market`}</p>
                <p className="text-xs text-slate-500">{match.tcgplayerPricing?.variants.length
                  ? `Finishes: ${match.tcgplayerPricing.variants.map((variant) => variantLabel(variant.variant)).join(", ")}`
                  : "No TCGplayer finish pricing listed"}</p>
                <div className="grid gap-2 pt-2 sm:grid-cols-2">
                  <button type="button" disabled={selecting} onClick={() => void chooseCard(match)} className="min-h-11 rounded-xl bg-violet-600 px-3 text-sm font-black text-white disabled:opacity-40">{selecting ? "Loading…" : "Use This Card"}</button>
                  <button type="button" disabled={!match.largeImageUrl} onClick={() => setLargeMatch(match)} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black disabled:opacity-40 dark:bg-slate-800">View Larger</button>
                </div>
                {match.tcgplayerPricing?.url ? <a href={match.tcgplayerPricing.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 pt-1 text-xs font-black text-sky-700 underline dark:text-sky-300"><ExternalLink size={13} />TCGplayer product</a> : null}
              </div>
            </article>)}
          </div>
          {hasMore ? <button type="button" disabled={loading} onClick={() => void runSearch(page + 1, true)} className="min-h-11 w-full rounded-xl bg-slate-200 px-4 text-sm font-black disabled:opacity-40 dark:bg-slate-800">{loading ? "Loading…" : "Load More"}</button> : null}
        </> : null}
      </section>
    </div>
    <ImageLightbox imageUrl={largeMatch?.largeImageUrl} title={largeMatch ? `${largeMatch.cardName} · ${largeMatch.setName} #${largeMatch.collectorNumber}` : "Official card"} onClose={() => setLargeMatch(undefined)} />
  </>;
}
