import { Crop, LoaderCircle, ScanLine, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { InventoryPurchase, PokemonProductCategory } from "../../types/models";
import type { CropPoint } from "../../services/sales/cardImageProcessor";
import type { CardMatch, CardScanStage, CardScanSuggestion } from "../../services/sales/cardScanService";
import { TcgplayerPricingPanel } from "./TcgplayerPricingPanel";

type Props = {
  imageFile?: File;
  backImageFile?: File;
  category: PokemonProductCategory;
  inventory: InventoryPurchase[];
  onApply: (suggestion: CardScanSuggestion, hash: string, processedFile?: File) => void;
};

const confidenceClass = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-rose-100 text-rose-700",
};
const defaultCorners: CropPoint[] = [
  { x: 0.08, y: 0.06 },
  { x: 0.92, y: 0.06 },
  { x: 0.92, y: 0.94 },
  { x: 0.08, y: 0.94 },
];

function useFilePreview(file?: File) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function CornerCropEditor({
  imageUrl,
  corners,
  onChange,
}: {
  imageUrl: string;
  corners: CropPoint[];
  onChange: (corners: CropPoint[]) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  function move(clientX: number, clientY: number) {
    if (dragging == null || !frameRef.current) return;
    const bounds = frameRef.current.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    };
    onChange(corners.map((corner, index) => index === dragging ? point : corner));
  }

  return <div
    ref={frameRef}
    className="relative mx-auto inline-block max-w-full touch-none overflow-hidden rounded-xl bg-black"
    onPointerMove={(event) => move(event.clientX, event.clientY)}
    onPointerUp={() => setDragging(null)}
    onPointerCancel={() => setDragging(null)}
  >
    <img src={imageUrl} alt="Adjust card crop" className="block max-h-[55vh] max-w-full select-none" draggable={false} />
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon
        points={corners.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
        fill="rgba(124,58,237,.12)"
        stroke="white"
        strokeWidth="0.8"
        strokeDasharray="2 1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
    {corners.map((point, index) => <button
      key={index}
      type="button"
      aria-label={`Move crop corner ${index + 1}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(index);
      }}
      className="absolute size-8 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-violet-600 shadow-lg"
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
    />)}
  </div>;
}

export function CardScanPanel({ imageFile, backImageFile, category, inventory, onApply }: Props) {
  const [status, setStatus] = useState<"crop" | "analyzing" | "review" | "failed">("crop");
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<CardScanStage>("Preparing image");
  const [hash, setHash] = useState("");
  const [suggestion, setSuggestion] = useState<CardScanSuggestion>();
  const [processedFile, setProcessedFile] = useState<File>();
  const [corners, setCorners] = useState<CropPoint[]>(defaultCorners);
  const [cropConfidence, setCropConfidence] = useState<number | null>(null);
  const [detectingCrop, setDetectingCrop] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const preview = useFilePreview(imageFile);
  const processedPreview = useFilePreview(processedFile);
  const runRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const run = ++runRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setStatus("crop");
    setSuggestion(undefined);
    setProcessedFile(undefined);
    setHash("");
    setMessage("");
    setCropConfidence(null);
    setCorners(defaultCorners);
    if (!imageFile) return () => controller.abort();
    setDetectingCrop(true);
    void import("../../services/sales/cardImageProcessor")
      .then(({ detectCardFrame }) => detectCardFrame(imageFile, controller.signal))
      .then((detection) => {
        if (run !== runRef.current) return;
        setCorners(detection.corners);
        setCropConfidence(detection.confidence);
        setMessage(detection.confidence >= 0.48
          ? "Card edges detected. Adjust any corner that is not on the printed card."
          : "Automatic detection is uncertain. Move all four corners onto the card before analyzing.");
      })
      .catch((error) => {
        if (run !== runRef.current || controller.signal.aborted) return;
        setMessage(error instanceof Error ? error.message : "Adjust the crop corners manually.");
      })
      .finally(() => { if (run === runRef.current) setDetectingCrop(false); });
    return () => controller.abort();
  }, [imageFile]);

  useEffect(() => () => {
    runRef.current += 1;
    controllerRef.current?.abort();
    void import("../../services/sales/cardScanService").then(({ cancelCardScan }) => cancelCardScan());
  }, []);

  async function scan(force = false, useFullImage = false) {
    if (!imageFile) { setMessage("Add a front image before scanning."); return; }
    const run = ++runRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("analyzing");
    setMessage("");
    setSuggestion(undefined);
    setStage("Preparing image");
    try {
      let source = imageFile;
      if (!useFullImage) {
        setStage("Detecting and cropping card");
        const { cropCardPerspective } = await import("../../services/sales/cardImageProcessor");
        source = await cropCardPerspective(imageFile, corners, controller.signal);
      }
      if (run !== runRef.current) return;
      setProcessedFile(source);
      const { scanPokemonCard } = await import("../../services/sales/cardScanService");
      const result = await scanPokemonCard(source, category, backImageFile, force, {
        signal: controller.signal,
        onStage: setStage,
        skipCrop: true,
      });
      if (run !== runRef.current) return;
      setSuggestion(result.suggestion);
      setHash(result.hash);
      setStatus("review");
      const matchCount = result.suggestion.possibleMatches?.length || 0;
      setMessage(matchCount > 1
        ? "Several possible matches found. Choose the exact card."
        : matchCount === 1
          ? "One possible match found. Confirm it before applying."
          : "No reliable match was found. Search manually, adjust the crop, or enter the card manually.");
    } catch (error) {
      if (run !== runRef.current) return;
      setStatus("failed");
      setMessage(error instanceof DOMException && error.name === "AbortError"
        ? "Cancelled. The photo and crop are still available."
        : error instanceof Error ? error.message : "Card analysis failed.");
    }
  }

  async function cancelAnalysis() {
    runRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    const { cancelCardScan } = await import("../../services/sales/cardScanService");
    await cancelCardScan();
    setStatus("crop");
    setMessage("Cancelled. Adjust the crop or enter the details manually.");
  }

  async function chooseMatch(match: CardMatch) {
    if (!suggestion) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    try {
      const { confirmPokemonCardMatch } = await import("../../services/sales/cardScanService");
      setSuggestion(await confirmPokemonCardMatch(suggestion, match, controller.signal));
      setMessage("Exact card confirmed. Choose a finish when needed, then apply the suggestions.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load pricing for that card.");
    } finally {
      setSearching(false);
    }
  }

  async function runManualSearch() {
    const query = manualSearch.trim();
    if (!query) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    try {
      const { searchPokemonCards } = await import("../../services/sales/cardScanService");
      const matches = await searchPokemonCards(query, suggestion?.collectorNumber || null, controller.signal);
      setSuggestion((current) => current ? {
        ...current,
        correctedNameCandidate: matches[0]?.cardName || query,
        correctedNameConfidence: matches[0]?.matchConfidence || "low",
        possibleMatches: matches,
      } : {
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
        correctedNameCandidate: matches[0]?.cardName || query,
        correctedNameConfidence: matches[0]?.matchConfidence || "low",
        possibleMatches: matches,
        warnings: matches.length ? [] : ["No Pokémon TCG API results were found for that search."],
      });
      setStatus("review");
      setMessage(matches.length ? "Manual search results are ready. Choose the exact card." : "No API results found. Manual entry remains available.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Manual search failed.");
    } finally {
      setSearching(false);
    }
  }

  const duplicateCertificate = suggestion?.certificateNumber
    && inventory.some((row) => row.certificateNumber?.trim().toLowerCase() === suggestion.certificateNumber?.trim().toLowerCase());
  const hasUsefulSuggestion = Boolean(suggestion && (
    suggestion.cardName
    || suggestion.collectorNumber
    || suggestion.condition
    || suggestion.stickerPrice != null
    || suggestion.possibleMatches?.length
  ));
  const edit = (key: keyof CardScanSuggestion, value: string | number | null) => {
    setSuggestion((current) => current ? { ...current, [key]: value } : current);
  };
  const field = (key: keyof CardScanSuggestion, label: string, type: "text" | "number" = "text") => {
    const value = suggestion?.[key];
    const fieldConfidence = suggestion?.fieldConfidence?.[String(key)];
    return <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-black">
        {label}
        {fieldConfidence ? <span className={`rounded-full px-2 py-0.5 text-[10px] ${confidenceClass[fieldConfidence]}`}>{fieldConfidence}</span> : null}
      </span>
      <input
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "0.01" : undefined}
        value={value == null || typeof value === "object" ? "" : String(value)}
        onChange={(event) => edit(key, type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
      />
    </label>;
  };

  return <section className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900 dark:bg-violet-950/20">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-black text-violet-900 dark:text-violet-100">Pokémon card scanner</p>
        <p className="text-xs text-violet-700 dark:text-violet-300">Free local OCR. Suggestions are never saved until the normal form is saved.</p>
      </div>
      {status === "analyzing" ? <button type="button" onClick={() => void cancelAnalysis()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-rose-700 px-3 text-sm font-black text-white"><X size={17} />Cancel</button> : null}
    </div>

    {status === "crop" && imageFile ? <div className="space-y-3">
      <div className="rounded-xl bg-white/70 p-2 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
        <strong>Crop review:</strong> place each handle on a card corner. The saved crop excludes the on-screen camera guide.
      </div>
      {preview ? <div className="text-center"><CornerCropEditor imageUrl={preview} corners={corners} onChange={setCorners} /></div> : null}
      <p className={`text-xs font-bold ${cropConfidence != null && cropConfidence < 0.48 ? "text-amber-700 dark:text-amber-300" : "text-violet-700 dark:text-violet-200"}`}>
        {detectingCrop ? "Detecting card edges…" : message}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={detectingCrop} onClick={() => void scan(false, false)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-black text-white disabled:opacity-40"><Crop size={17} />Analyze Selected Crop</button>
        <button type="button" onClick={() => void scan(false, true)} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Use Full Image</button>
      </div>
    </div> : null}

    {status === "analyzing" ? <div className="rounded-xl bg-violet-100 p-3 text-sm font-bold text-violet-900 dark:bg-violet-950 dark:text-violet-100">
      <LoaderCircle className="mr-2 inline animate-spin" size={18} />{stage}…
      <p className="mt-1 text-xs font-normal">The scan has a hard timeout. Cancel always leaves manual entry available.</p>
    </div> : null}

    {status !== "crop" && processedPreview ? <img src={processedPreview} alt="Processed card crop" className="mx-auto max-h-80 rounded-xl bg-black object-contain" /> : null}
    {message && status !== "crop" ? <p className={`text-sm font-bold ${status === "failed" ? "text-rose-700" : "text-violet-700 dark:text-violet-200"}`}>{message}</p> : null}

    {status !== "analyzing" ? <div className="flex gap-2">
      <input
        value={manualSearch}
        onChange={(event) => setManualSearch(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void runManualSearch(); } }}
        placeholder="Manual Pokémon card search"
        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
      />
      <button type="button" disabled={searching || !manualSearch.trim()} onClick={() => void runManualSearch()} className="rounded-xl bg-slate-900 px-3 text-white disabled:opacity-40 dark:bg-white dark:text-slate-900" aria-label="Search Pokémon cards">
        {searching ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}
      </button>
    </div> : null}

    {suggestion && !hasUsefulSuggestion ? <div className="space-y-2 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
      <strong>No readable card information was found.</strong>
      <p>Adjust the crop, retake the photo, search manually, or use the normal form.</p>
      <button type="button" onClick={() => setStatus("crop")} className="rounded-lg bg-amber-900 px-3 py-2 font-black text-white">Adjust Crop</button>
    </div> : null}

    {suggestion && hasUsefulSuggestion ? <div className="space-y-3">
      {suggestion.correctedNameCandidate && !suggestion.cardName ? <div className="rounded-xl border border-violet-200 bg-white p-3 dark:bg-slate-900">
        <p className="text-xs font-bold text-slate-500">Cleaned OCR candidate — not yet confirmed</p>
        <p className="font-black">{suggestion.correctedNameCandidate}</p>
        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] ${confidenceClass[suggestion.correctedNameConfidence || "low"]}`}>{suggestion.correctedNameConfidence || "low"} confidence</span>
      </div> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        {field("cardName", "Card name (confirmed/manual)")}
        {field("collectorNumber", "Collector number")}
        {field("cardSet", "Set / code")}
        {field("language", "Language")}
        {field("condition", "Visible sticker condition")}
        {field("stickerPrice", "Sticker / asking price", "number")}
        {category === "graded_card" ? <>
          {field("gradingCompany", "Grading company")}
          {field("grade", "Grade")}
          {field("certificateNumber", "Certificate number")}
        </> : null}
      </div>
      {suggestion.possibleMatches?.length ? <div className="space-y-2">
        <p className="text-xs font-black">Possible Pokémon TCG API records — confirmation required</p>
        {suggestion.possibleMatches.map((match) => <article key={match.id} className="flex gap-3 rounded-xl border border-violet-200 bg-white p-2 text-xs dark:bg-slate-900">
          {match.imageUrl ? <img src={match.imageUrl} alt={`${match.cardName} official card`} loading="lazy" className="h-28 w-20 rounded object-contain" /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-black">{match.cardName} · {match.collectorNumber}</p>
            <p>{match.setName}{match.rarity ? ` · ${match.rarity}` : ""}</p>
            <p>{match.matchScore}% match{match.marketPrice != null ? ` · $${match.marketPrice.toFixed(2)} market` : ""}</p>
            <p className="text-slate-500">{match.reasons.join(" · ")}</p>
            <button type="button" disabled={searching} onClick={() => void chooseMatch(match)} className="mt-2 rounded-lg bg-violet-600 px-3 py-2 font-black text-white disabled:opacity-40">Use This Card</button>
          </div>
        </article>)}
        <button type="button" onClick={() => setSuggestion((current) => current ? { ...current, possibleMatches: [] } : current)} className="text-xs font-black text-violet-700 dark:text-violet-300">None of These / Enter Manually</button>
      </div> : null}
      <TcgplayerPricingPanel suggestion={suggestion} isSlab={category === "graded_card"} onChange={setSuggestion} />
      {suggestion.warnings.map((warning) => <p key={warning} className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
      {suggestion.technicalDetails ? <details className="rounded-xl bg-slate-100 p-2 text-xs dark:bg-slate-900">
        <summary className="cursor-pointer font-black">Technical Details (raw OCR)</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify(suggestion.technicalDetails, null, 2)}</pre>
      </details> : null}
      {duplicateCertificate ? <p className="rounded-xl bg-rose-100 p-2 text-sm font-black text-rose-800">Possible duplicate slab certificate.</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setStatus("crop")} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Adjust Crop / Rescan</button>
        <button type="button" onClick={() => { onApply(suggestion, hash, processedFile); setMessage("Suggestions applied. Confirm the normal form, then press Save."); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white"><Sparkles size={17} />Apply Suggestions</button>
      </div>
      <p className="text-xs text-slate-500">Sticker price never fills Actual Bought Price. A single photo is not a physical condition grade.</p>
    </div> : null}

    {status === "failed" ? <div className="grid gap-2 sm:grid-cols-3">
      <button type="button" onClick={() => setStatus("crop")} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Adjust Crop</button>
      <button type="button" onClick={() => void scan(true, false)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-black text-white"><ScanLine size={17} />Retry</button>
      <button type="button" onClick={() => { setSuggestion(undefined); setMessage("Continue with the normal form."); }} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Enter Manually</button>
    </div> : null}
  </section>;
}
