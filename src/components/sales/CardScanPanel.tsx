import { Crop, LoaderCircle, ScanLine, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CardCondition, InventoryPurchase, PokemonProductCategory } from "../../types/models";
import type { CropPoint } from "../../services/sales/cardImageProcessor";
import type { CardMatch, CardScanStage, CardScanSuggestion } from "../../services/sales/cardScanService";
import { cardProviderLabel } from "../../services/sales/pokemonCardSearchService";
import type { CardGame, CardLanguage } from "../../../supabase/functions/_shared/unifiedCardSearchCore.ts";
import { normalizeImageOrientation } from "../../services/images/imageOrientation";
import { ManualCardSearch } from "./ManualCardSearch";
import { TcgplayerPricingPanel } from "./TcgplayerPricingPanel";

type Props = {
  imageFile?: File;
  backImageFile?: File;
  category: PokemonProductCategory;
  inventory: InventoryPurchase[];
  initialGame?: CardGame;
  initialLanguage?: CardLanguage;
  onApply: (suggestion: CardScanSuggestion, hash: string, processedFile?: File) => void;
  onRetakePhoto?: () => void;
};
type ScanOutcome = "Match found" | "Several possible matches" | "Partial identification" | "No reliable match" | "Timed out" | "Cancelled" | "Processing error";
type ResolvedCard = {
  source: "manual_search" | "automatic_match";
  suggestion: CardScanSuggestion;
  confirmedByUser: true;
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
const scanConditions: CardCondition[] = [
  "Near Mint / NM",
  "Lightly Played / LP",
  "Moderately Played / MP",
  "Heavily Played / HP",
  "Damaged",
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

export function CardScanPanel({ imageFile: inputImageFile, backImageFile: inputBackImageFile, category, inventory, initialGame = "pokemon", initialLanguage = "en", onApply, onRetakePhoto }: Props) {
  const [imageFile, setNormalizedImageFile] = useState<File>();
  const [backImageFile, setNormalizedBackImageFile] = useState<File>();
  const [status, setStatus] = useState<"crop" | "analyzing" | "review" | "failed">(inputImageFile && initialGame !== "other" ? "analyzing" : "crop");
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<CardScanStage>("Preparing image");
  const [hash, setHash] = useState("");
  const [suggestion, setSuggestion] = useState<CardScanSuggestion>();
  // OCR is deliberately kept separate from a confirmed catalog card. A confirmed
  // selection always wins until the user explicitly starts a new scan.
  const [resolvedCard, setResolvedCard] = useState<ResolvedCard>();
  const [processedFile, setProcessedFile] = useState<File>();
  const [corners, setCorners] = useState<CropPoint[]>(defaultCorners);
  const [cropConfidence, setCropConfidence] = useState<number | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number }>();
  const [detectingCrop, setDetectingCrop] = useState(false);
  const [manualSearchOpen, setManualSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [recognizedName, setRecognizedName] = useState("");
  const [recognizedCollectorNumber, setRecognizedCollectorNumber] = useState("");
  const [recognizedNameEdited, setRecognizedNameEdited] = useState(false);
  const [recognizedCollectorEdited, setRecognizedCollectorEdited] = useState(false);
  const [recognizedSearchError, setRecognizedSearchError] = useState("");
  const [outcome, setOutcome] = useState<ScanOutcome>();
  const [cardGame, setCardGame] = useState<CardGame>(initialGame);
  const [cardLanguage, setCardLanguage] = useState<CardLanguage>(initialGame === "pokemon" ? initialLanguage : initialGame === "one_piece" ? "en" : "unknown");
  const preview = useFilePreview(imageFile);
  const processedPreview = useFilePreview(processedFile);
  const runRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const recognizedEditTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const orientationRunRef = useRef(0);

  useEffect(() => {
    const run = ++orientationRunRef.current;
    setNormalizedImageFile(undefined);
    if (!inputImageFile) return;
    setStatus(initialGame === "other" ? "crop" : "analyzing");
    setStage("Preparing image");
    setMessage("Correcting the photo orientation before preview and recognition.");
    void normalizeImageOrientation(inputImageFile)
      .then((normalized) => { if (run === orientationRunRef.current) setNormalizedImageFile(normalized); })
      .catch((error) => {
        if (run !== orientationRunRef.current) return;
        setStatus("failed");
        setMessage(error instanceof Error ? error.message : "The card image orientation could not be prepared.");
      });
  }, [inputImageFile, initialGame]);

  useEffect(() => {
    const run = orientationRunRef.current;
    setNormalizedBackImageFile(undefined);
    if (!inputBackImageFile) return;
    void normalizeImageOrientation(inputBackImageFile)
      .then((normalized) => { if (run === orientationRunRef.current) setNormalizedBackImageFile(normalized); })
      .catch(() => { if (run === orientationRunRef.current) setNormalizedBackImageFile(undefined); });
  }, [inputBackImageFile]);

  useEffect(() => {
    setCardGame(initialGame);
    setCardLanguage(initialGame === "pokemon" ? initialLanguage : initialGame === "one_piece" ? "en" : "unknown");
  }, [initialGame, initialLanguage]);

  useEffect(() => {
    const run = ++runRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setStatus(imageFile && cardGame !== "other" ? "analyzing" : "crop");
    setSuggestion(undefined);
    setResolvedCard(undefined);
    setProcessedFile(undefined);
    setHash("");
    setMessage("");
    setOutcome(undefined);
    setShowAllMatches(false);
    setCropConfidence(null);
    setSourceDimensions(undefined);
    setCorners(defaultCorners);
    if (!imageFile) return () => controller.abort();
    setStage("Detecting and cropping card");
    setMessage("Preparing the card photo for automatic recognition.");
    setDetectingCrop(true);
    void import("../../services/sales/cardImageProcessor")
      .then(({ detectCardFrame }) => detectCardFrame(imageFile, controller.signal))
      .then((detection) => {
        if (run !== runRef.current) return;
        setCorners(detection.corners);
        setSourceDimensions({ width: detection.width, height: detection.height });
        setCropConfidence(detection.confidence);
        if (cardGame === "other") {
          setStatus("crop");
          setMessage("Automatic card recognition is unavailable for Other / Manual. Adjust the crop or search manually.");
          return;
        }
        void scan(false, detection.confidence < 0.48, detection.corners, { width: detection.width, height: detection.height }, detection.confidence);
      })
      .catch((error) => {
        if (run !== runRef.current || controller.signal.aborted) return;
        if (cardGame === "other") {
          setStatus("crop");
          setMessage(error instanceof Error ? error.message : "Adjust the crop corners manually.");
        } else {
          void scan(false, true);
        }
      })
      .finally(() => { if (run === runRef.current) setDetectingCrop(false); });
    return () => controller.abort();
  }, [imageFile]);

  useEffect(() => {
    setRecognizedName(suggestion?.cardName || suggestion?.correctedNameCandidate || "");
    setRecognizedCollectorNumber(suggestion?.collectorNumber || "");
    setRecognizedNameEdited(false);
    setRecognizedCollectorEdited(false);
    setRecognizedSearchError("");
  }, [suggestion?.cardName, suggestion?.correctedNameCandidate, suggestion?.collectorNumber]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current += 1;
      controllerRef.current?.abort();
      if (recognizedEditTimerRef.current != null) window.clearTimeout(recognizedEditTimerRef.current);
      queueMicrotask(() => {
        if (!mountedRef.current) {
          void import("../../services/sales/cardScanService").then(({ cancelCardScan }) => cancelCardScan());
        }
      });
    };
  }, []);

  async function scan(
    force = false,
    useFullImage = false,
    cropOverride?: CropPoint[],
    dimensionsOverride?: { width: number; height: number },
    confidenceOverride?: number,
  ) {
    if (!imageFile) { setMessage("Add a front image before scanning."); return; }
    const run = ++runRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setDetectingCrop(false);
    setStatus("analyzing");
    setMessage("");
    setSuggestion(undefined);
    setResolvedCard(undefined);
    setOutcome(undefined);
    setStage("Preparing image");
    try {
      let source = imageFile;
      const submittedCorners = cropOverride || corners;
      const submittedDimensions = dimensionsOverride || sourceDimensions;
      if (import.meta.env.DEV) console.info("[Visual card scanner] crop submission", {
        imageDimensions: submittedDimensions,
        originalFileSize: imageFile.size,
        cropCoordinates: useFullImage ? null : submittedCorners,
        useFullImage,
      });
      if (!useFullImage) {
        setStage("Detecting and cropping card");
        const { cropCardPerspective } = await import("../../services/sales/cardImageProcessor");
        source = await cropCardPerspective(imageFile, submittedCorners, controller.signal);
      }
      if (run !== runRef.current) return;
      setProcessedFile(source);
      const { scanPokemonCard } = await import("../../services/sales/cardScanService");
      const result = await scanPokemonCard(source, category, backImageFile, force, {
        signal: controller.signal,
        onStage: setStage,
        skipCrop: true,
        game: cardGame,
        language: cardLanguage,
        cardBounds: {
          sourceWidth: submittedDimensions?.width,
          sourceHeight: submittedDimensions?.height,
          corners: useFullImage ? null : submittedCorners,
          confidence: confidenceOverride ?? cropConfidence,
          cropped: !useFullImage,
        },
        inputDebug: {
          originalDimensions: submittedDimensions,
          originalFileSize: imageFile.size,
          originalMimeType: imageFile.type,
          cropCoordinates: useFullImage ? null : submittedCorners,
        },
      });
      if (run !== runRef.current) return;
      const scanSuggestion: CardScanSuggestion = result.suggestion;
      if ("correctedFile" in result && result.correctedFile) setProcessedFile(result.correctedFile);
      setSuggestion(scanSuggestion);
      setHash(result.hash);
      setStatus("review");
      const matchCount = scanSuggestion.possibleMatches?.length || 0;
      const recognizedSomething = Boolean(
        scanSuggestion.cardName
        || scanSuggestion.correctedNameCandidate
        || scanSuggestion.collectorNumber
        || scanSuggestion.cardSet
        || scanSuggestion.aiIdentification?.hp
        || scanSuggestion.aiIdentification?.stage_or_subtype
        || scanSuggestion.aiIdentification?.ability_names.length
        || scanSuggestion.aiIdentification?.attack_names.length
        || scanSuggestion.aiIdentification?.visible_text.length,
      );
      setOutcome(matchCount > 1 ? "Several possible matches" : matchCount === 1 ? "Match found" : recognizedSomething ? "Partial identification" : "No reliable match");
      if (scanSuggestion.aiRecognitionConfidence != null && scanSuggestion.aiRecognitionConfidence < 0.25 && matchCount === 0 && !recognizedSomething) {
        setManualSearchOpen(true);
      }
      setMessage(scanSuggestion.aiRecognitionConfidence != null && scanSuggestion.aiRecognitionConfidence < 0.25 && matchCount === 0 && !recognizedSomething
        ? "Couldn't confidently identify this card. Search is prefilled with any text that was readable."
        : scanSuggestion.likelyMatchProviderId
        ? "Found likely match. Confirm the exact printing before applying it."
        : matchCount > 1
          ? "We found a few possible matches. Choose the exact card."
        : matchCount === 1
          ? "One possible match found. Confirm it before applying."
          : recognizedSomething
            ? "We couldn't determine the exact printing. Review the recognized information and search for matches."
            : "Couldn't confidently identify this card.");
    } catch (error) {
      if (run !== runRef.current) return;
      setStatus("failed");
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      const timedOut = error instanceof Error && /timed out|timeout/i.test(error.message);
      setOutcome(cancelled ? "Cancelled" : timedOut ? "Timed out" : "Processing error");
      setMessage(cancelled
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
    setOutcome("Cancelled");
    setMessage("Cancelled. Adjust the crop or enter the details manually.");
  }

  async function chooseMatch(match: CardMatch) {
    if (!suggestion) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    try {
      const { confirmPokemonCardMatch } = await import("../../services/sales/cardScanService");
      const confirmed = await confirmPokemonCardMatch(suggestion, match, controller.signal);
      setSuggestion(confirmed);
      setResolvedCard({ source: "automatic_match", suggestion: confirmed, confirmedByUser: true });
      setOutcome("Match found");
      setMessage("Exact card confirmed. Choose a finish when needed, then apply the suggestions.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load pricing for that card.");
    } finally {
      setSearching(false);
    }
  }

  async function searchRecognizedMatches(overrides: {
    name?: string;
    collectorNumber?: string;
    nameEdited?: boolean;
    collectorEdited?: boolean;
  } = {}) {
    const name = (overrides.name ?? recognizedName).trim();
    const collectorNumber = (overrides.collectorNumber ?? recognizedCollectorNumber).trim();
    if (!name && !collectorNumber) {
      setRecognizedSearchError("Enter a card name or collector number first.");
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    setRecognizedSearchError("");
    setMessage("Searching the card catalog with the recognized information…");
    try {
      const { latestScannerSearchDebug, searchRecognizedCardText } = await import("../../services/sales/pokemonCardIdentificationService");
      const candidates = await searchRecognizedCardText({
        name,
        collectorNumber,
        game: cardGame === "one_piece" ? "one_piece" : "pokemon",
        language: cardGame === "pokemon" && cardLanguage === "ja" ? "ja" : "en",
        nameConfidence: (overrides.nameEdited ?? recognizedNameEdited) ? "high" : suggestion?.fieldConfidence?.cardName || "low",
        collectorNumberConfidence: (overrides.collectorEdited ?? recognizedCollectorEdited) ? "high" : suggestion?.fieldConfidence?.collectorNumber || "low",
      }, controller.signal);
      setSuggestion((current) => current ? {
        ...current,
        correctedNameCandidate: name || current.correctedNameCandidate,
        collectorNumber: collectorNumber || null,
        fieldConfidence: {
          ...current.fieldConfidence,
          cardName: (overrides.nameEdited ?? recognizedNameEdited) ? "high" : current.fieldConfidence.cardName,
          collectorNumber: (overrides.collectorEdited ?? recognizedCollectorEdited) ? "high" : current.fieldConfidence.collectorNumber,
        },
        possibleMatches: candidates,
        likelyMatchProviderId: undefined,
        technicalDetails: current.technicalDetails ? {
          ...current.technicalDetails,
          scannerDebug: {
            ...current.technicalDetails.scannerDebug,
            search: latestScannerSearchDebug(),
          },
        } : current.technicalDetails,
      } : current);
      setShowAllMatches(true);
      setOutcome(candidates.length > 1 ? "Several possible matches" : candidates.length === 1 ? "Match found" : "Partial identification");
      setMessage(candidates.length
        ? "We found a few possible matches. Choose the exact printing."
        : "We couldn't determine the exact printing. Correct the recognized text, adjust the crop, or search manually.");
      if (!candidates.length) setRecognizedSearchError("No catalog candidates matched those fields. You can edit them and search again.");
    } catch (error) {
      if (controller.signal.aborted) return;
      setRecognizedSearchError(error instanceof Error ? error.message : "Could not search for matching cards.");
    } finally {
      setSearching(false);
    }
  }

  function queueRecognizedSearch(nextName: string, nextCollectorNumber: string, editedField: "name" | "collector") {
    if (recognizedEditTimerRef.current != null) window.clearTimeout(recognizedEditTimerRef.current);
    recognizedEditTimerRef.current = window.setTimeout(() => {
      void searchRecognizedMatches({
        name: nextName,
        collectorNumber: nextCollectorNumber,
        nameEdited: editedField === "name" || recognizedNameEdited,
        collectorEdited: editedField === "collector" || recognizedCollectorEdited,
      });
    }, 500);
  }

  const reviewSuggestion = resolvedCard?.suggestion || suggestion;
  const duplicateCertificate = reviewSuggestion?.certificateNumber
    && inventory.some((row) => row.certificateNumber?.trim().toLowerCase() === reviewSuggestion.certificateNumber?.trim().toLowerCase());
  const hasUsefulSuggestion = Boolean(reviewSuggestion && (
    reviewSuggestion.cardName
    || reviewSuggestion.correctedNameCandidate
    || reviewSuggestion.collectorNumber
    || reviewSuggestion.cardSet
    || reviewSuggestion.aiIdentification?.hp
    || reviewSuggestion.aiIdentification?.stage_or_subtype
    || reviewSuggestion.aiIdentification?.ability_names.length
    || reviewSuggestion.aiIdentification?.attack_names.length
    || reviewSuggestion.aiIdentification?.visible_text.length
    || reviewSuggestion.condition
    || reviewSuggestion.stickerPrice != null
    || reviewSuggestion.possibleMatches?.length
  ));
  const isAiScan = Boolean(reviewSuggestion?.aiIdentification);
  const likelyMatch = reviewSuggestion?.possibleMatches?.find((match) => match.providerCardId === reviewSuggestion.likelyMatchProviderId);
  const displayedMatches = reviewSuggestion?.possibleMatches
    ? likelyMatch && !showAllMatches ? [likelyMatch] : reviewSuggestion.possibleMatches
    : [];
  const needsCondition = Boolean(resolvedCard && category !== "graded_card" && !reviewSuggestion?.condition);
  const recognizedNameConfidence = recognizedNameEdited ? "high" : reviewSuggestion?.fieldConfidence?.cardName || "low";
  const recognizedCollectorConfidence = recognizedCollectorEdited ? "high" : reviewSuggestion?.fieldConfidence?.collectorNumber || "low";
  const recognizedSummary = [recognizedName, recognizedCollectorNumber ? `#${recognizedCollectorNumber.replace(/^#/, "")}` : ""].filter(Boolean).join(" • ");
  const edit = (key: keyof CardScanSuggestion, value: string | number | null) => {
    if (resolvedCard) {
      setResolvedCard({ ...resolvedCard, suggestion: { ...resolvedCard.suggestion, [key]: value } });
      return;
    }
    setSuggestion((current) => current ? { ...current, [key]: value } : current);
  };
  const field = (key: keyof CardScanSuggestion, label: string, type: "text" | "number" = "text") => {
    const value = reviewSuggestion?.[key];
    const fieldConfidence = reviewSuggestion?.fieldConfidence?.[String(key)];
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
        <p className="font-black text-violet-900 dark:text-violet-100">Multi-game card scanner</p>
        <p className="text-xs text-violet-700 dark:text-violet-300">Pokémon photos use AI visual reading, then the existing official catalog search. Suggestions are never saved until you confirm them.</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setManualSearchOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-black text-white dark:bg-white dark:text-slate-900"><Search size={17} />Search Card Manually</button>
        {status === "analyzing" ? <button type="button" onClick={() => void cancelAnalysis()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-rose-700 px-3 text-sm font-black text-white"><X size={17} />Cancel</button> : null}
      </div>
    </div>
    <div className="grid gap-2 rounded-xl bg-white/70 p-2 sm:grid-cols-2 dark:bg-slate-900/60">
      <label className="text-xs font-black text-slate-600 dark:text-slate-300">Card game
        <select value={cardGame} disabled={status === "analyzing"} onChange={(event) => {
          const game = event.target.value as CardGame;
          setCardGame(game);
          if (game !== "pokemon") setCardLanguage(game === "one_piece" ? "en" : "unknown");
          setSuggestion(undefined); setResolvedCard(undefined); setOutcome(undefined);
        }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
          <option value="pokemon">Pokémon</option>
          <option value="one_piece">One Piece</option>
          <option value="other">Other / Manual</option>
        </select>
      </label>
      {cardGame === "pokemon" ? <label className="text-xs font-black text-slate-600 dark:text-slate-300">Printing language
        <select value={cardLanguage} disabled={status === "analyzing"} onChange={(event) => { setCardLanguage(event.target.value as CardLanguage); setSuggestion(undefined); setResolvedCard(undefined); setOutcome(undefined); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
          <option value="en">English</option>
          <option value="ja">Japanese</option>
        </select>
      </label> : <p className="self-end rounded-xl bg-slate-100 p-3 text-xs font-bold dark:bg-slate-800">{cardGame === "one_piece" ? "One Piece OCR prioritizes exact card codes such as OP01-001." : "Manual mode skips catalog matching."}</p>}
    </div>

    {!imageFile && status !== "analyzing" ? <p className="rounded-xl bg-white/70 p-3 text-sm font-bold text-violet-800 dark:bg-slate-900/60 dark:text-violet-200">No photo is required. Search the official card catalog now, or add a photo when you want to use local OCR.</p> : null}

    {status === "crop" && imageFile ? <div className="space-y-3">
      <div className="rounded-xl bg-white/70 p-2 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
        <strong>Crop review:</strong> place each handle on a card corner. The saved crop excludes the on-screen camera guide.
      </div>
      {preview ? <div className="text-center"><CornerCropEditor imageUrl={preview} corners={corners} onChange={setCorners} /></div> : null}
      <p className={`text-xs font-bold ${cropConfidence != null && cropConfidence < 0.48 ? "text-amber-700 dark:text-amber-300" : "text-violet-700 dark:text-violet-200"}`}>
        {detectingCrop ? "Detecting card edges…" : message}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={detectingCrop || cardGame === "other"} onClick={() => void scan(false, false)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-black text-white disabled:opacity-40"><Crop size={17} />Analyze Selected Crop</button>
        <button type="button" disabled={cardGame === "other"} onClick={() => void scan(false, true)} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black disabled:opacity-40 dark:bg-slate-800">Use Full Image</button>
      </div>
    </div> : null}

    {status === "analyzing" ? <div aria-live="polite" className="rounded-xl bg-violet-100 p-3 text-sm font-bold text-violet-900 dark:bg-violet-950 dark:text-violet-100">
      <LoaderCircle className="mr-2 inline animate-spin" size={18} />{stage === "Matching with TCG database" || stage === "Searching card catalog" ? "Searching for matches" : "Scanning card"}…
      <p className="mt-1 text-xs font-normal">{stage}…</p>
      <p className="mt-1 text-xs font-normal">Cancel always leaves the photo and manual entry available.</p>
    </div> : null}

    {status !== "crop" && processedPreview ? <div className="space-y-1">
      {import.meta.env.DEV ? <p className="text-xs font-black text-sky-800 dark:text-sky-200">Image actually sent to the full-card scanner</p> : null}
      <img src={processedPreview} alt="Processed card crop sent to scanner" className="mx-auto max-h-80 rounded-xl bg-black object-contain" />
    </div> : null}
    {outcome ? <p role="status" className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white dark:bg-white dark:text-slate-900">State: {outcome}</p> : null}
    {message && status !== "crop" ? <p className={`text-sm font-bold ${status === "failed" ? "text-rose-700" : "text-violet-700 dark:text-violet-200"}`}>{message}</p> : null}
    {outcome === "No reliable match" && hasUsefulSuggestion ? <div className="space-y-2">
      <p className="text-sm font-bold text-amber-700 dark:text-amber-300">We couldn't identify this card confidently. Search manually with the recognized text or adjust the crop.</p>
      <div className="grid gap-2 sm:grid-cols-2">
      <button type="button" onClick={() => setManualSearchOpen(true)} className="min-h-11 rounded-xl bg-slate-900 px-3 text-sm font-black text-white dark:bg-white dark:text-slate-900">Search Card Manually</button>
      <button type="button" onClick={() => void scan(true, false)} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Try Again</button>
      <button type="button" onClick={onRetakePhoto} disabled={!onRetakePhoto} className="min-h-11 rounded-xl bg-violet-600 px-3 text-sm font-black text-white disabled:opacity-40">Retake Photo</button>
      <button type="button" onClick={() => { setSuggestion(undefined); setMessage("Continue with the normal form. No OCR text was copied into the record."); }} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Enter Everything Manually</button>
      </div>
    </div> : null}

    {reviewSuggestion && !hasUsefulSuggestion ? <div className="space-y-2 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
      <strong>We could not identify this card automatically.</strong>
      <p>The photo and every existing form value are still available.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setManualSearchOpen(true)} className="min-h-11 rounded-lg bg-violet-700 px-3 py-2 font-black text-white">Search Card Manually</button>
        <button type="button" onClick={() => setStatus("crop")} className="min-h-11 rounded-lg bg-amber-900 px-3 py-2 font-black text-white">Crop and Retry</button>
        <button type="button" onClick={onRetakePhoto} className="min-h-11 rounded-lg bg-slate-200 px-3 py-2 font-black text-slate-900 disabled:opacity-40" disabled={!onRetakePhoto}>Retake Photo</button>
        <button type="button" onClick={() => { setSuggestion(undefined); setMessage("Continue with the normal form. No OCR text was copied into the record."); }} className="min-h-11 rounded-lg bg-slate-200 px-3 py-2 font-black text-slate-900">Enter Everything Manually</button>
      </div>
    </div> : null}

    {reviewSuggestion && hasUsefulSuggestion ? <div className="space-y-3">
      {resolvedCard?.source === "manual_search" ? <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
        <p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Card selected manually</p>
        <div className="mt-2 flex gap-3">
          {reviewSuggestion.officialImageUrl ? <img src={reviewSuggestion.officialImageUrl} alt={`${reviewSuggestion.cardName} official card`} className="h-32 w-24 rounded-lg bg-white object-contain" /> : null}
          <div className="min-w-0"><p className="font-black">{reviewSuggestion.cardName} · {reviewSuggestion.cardCode || reviewSuggestion.collectorNumber}</p><p className="text-sm">{reviewSuggestion.cardSet}{reviewSuggestion.cardRarity ? ` · ${reviewSuggestion.cardRarity}` : ""}</p><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Source: {cardProviderLabel(reviewSuggestion.dataProvider)} · {reviewSuggestion.marketPriceCurrency || "provider currency"} pricing below</p></div>
        </div>
      </div> : null}
      {reviewSuggestion.correctedNameCandidate && !reviewSuggestion.cardName ? <div className="rounded-xl border border-violet-200 bg-white p-3 dark:bg-slate-900">
        <p className="text-xs font-bold text-slate-500">{isAiScan ? "AI visual identification — exact printing not yet confirmed" : "Cleaned OCR candidate — not yet confirmed"}</p>
        <p className="font-black">{reviewSuggestion.correctedNameCandidate}</p>
        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] ${confidenceClass[reviewSuggestion.correctedNameConfidence || "low"]}`}>{isAiScan ? "AI Match" : "OCR"}: {reviewSuggestion.correctedNameConfidence || "low"}</span>
      </div> : null}
      {!resolvedCard && hasUsefulSuggestion && (!displayedMatches.length || recognizedNameConfidence === "low" || recognizedCollectorConfidence === "low") ? <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
        <div>
          <p className="font-black text-amber-950 dark:text-amber-100">{displayedMatches.length ? "Review uncertain recognized information." : "We couldn't determine the exact printing."}</p>
          {recognizedSummary ? <p className="mt-1 text-sm text-amber-800 dark:text-amber-200"><span className="font-bold">Recognized:</span> {recognizedSummary}</p> : null}
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {[reviewSuggestion.cardSet, reviewSuggestion.aiIdentification?.hp ? `${reviewSuggestion.aiIdentification.hp} HP` : "", reviewSuggestion.cardGame, reviewSuggestion.language].filter(Boolean).join(" • ")}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-black">Card Name <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] ${confidenceClass[recognizedNameConfidence]}`}>{recognizedNameConfidence}</span>
            <input value={recognizedName} onChange={(event) => {
              const next = event.target.value;
              setRecognizedName(next);
              setRecognizedNameEdited(true);
              queueRecognizedSearch(next, recognizedCollectorNumber, "name");
            }} className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-3 text-base text-slate-950 dark:border-amber-800 dark:bg-slate-950 dark:text-white" />
            {recognizedNameConfidence === "low" ? <span className="mt-1 block font-medium text-amber-800 dark:text-amber-200">Not sure about this value — edit it if needed.</span> : null}
          </label>
          <label className="text-xs font-black">Collector Number <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] ${confidenceClass[recognizedCollectorConfidence]}`}>{recognizedCollectorConfidence}</span>
            <input value={recognizedCollectorNumber} onChange={(event) => {
              const next = event.target.value;
              setRecognizedCollectorNumber(next);
              setRecognizedCollectorEdited(true);
              queueRecognizedSearch(recognizedName, next, "collector");
            }} placeholder="56" className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-3 text-base text-slate-950 dark:border-amber-800 dark:bg-slate-950 dark:text-white" />
            {recognizedCollectorConfidence === "low" ? <span className="mt-1 block font-medium text-amber-800 dark:text-amber-200">Not sure about this value — edit it if needed.</span> : null}
          </label>
        </div>
        {recognizedSearchError ? <p role="alert" className="text-xs font-bold text-rose-700 dark:text-rose-300">{recognizedSearchError}</p> : null}
        <button type="button" disabled={searching} onClick={() => void searchRecognizedMatches()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 text-sm font-black text-white disabled:opacity-40">{searching ? <LoaderCircle size={17} className="animate-spin" /> : <Search size={17} />} Search Matches</button>
        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" onClick={() => setManualSearchOpen(true)} className="min-h-10 rounded-xl bg-slate-900 px-3 text-xs font-black text-white dark:bg-white dark:text-slate-900">Search Card Manually</button>
          <button type="button" onClick={() => void scan(true, false)} className="min-h-10 rounded-xl bg-white px-3 text-xs font-black text-slate-800 dark:bg-slate-900 dark:text-white">Try Again</button>
          <button type="button" onClick={() => setStatus("crop")} className="min-h-10 rounded-xl bg-white px-3 text-xs font-black text-slate-800 dark:bg-slate-900 dark:text-white">Adjust Crop</button>
        </div>
      </section> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        {resolvedCard ? field("cardName", "Card name (confirmed/manual)") : null}
        {resolvedCard ? field("collectorNumber", "Collector number") : null}
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
      {displayedMatches.length ? <div className="space-y-2">
        <p className="text-xs font-black">Possible {cardProviderLabel(displayedMatches[0]?.provider)} records — confirmation required</p>
        {displayedMatches.map((match) => <article key={`${match.provider}:${match.providerCardId}`} className={`flex gap-3 rounded-xl border bg-white p-2 text-xs dark:bg-slate-900 ${match.providerCardId === reviewSuggestion.likelyMatchProviderId ? "border-emerald-400 ring-2 ring-emerald-200 dark:ring-emerald-900" : "border-violet-200"}`}>
          {match.imageSmall ? <img src={match.imageSmall} alt={`${match.name} official card`} loading="lazy" className="h-28 w-20 rounded object-contain" /> : null}
          <div className="min-w-0 flex-1">
            {match.providerCardId === reviewSuggestion.likelyMatchProviderId ? <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Likely Match · AI Match: High</p> : null}
            <p className="font-black">{match.name} · {match.cardCode || match.collectorNumber}</p>
            <p>{match.setName}{match.rarity ? ` · ${match.rarity}` : ""}</p>
            <p>{match.matchScore}% match{match.pricing?.market != null ? ` · ${match.pricing.currency || "USD"} ${match.pricing.market.toFixed(2)} market` : ""}</p>
            <p className="text-slate-500">{match.reasons.join(" · ")}</p>
            <button type="button" disabled={searching} onClick={() => void chooseMatch(match)} className="mt-2 rounded-lg bg-violet-600 px-3 py-2 font-black text-white disabled:opacity-40">Use This Card</button>
          </div>
        </article>)}
        {likelyMatch && reviewSuggestion.possibleMatches && reviewSuggestion.possibleMatches.length > 1 && !showAllMatches ? <button type="button" onClick={() => setShowAllMatches(true)} className="min-h-10 w-full rounded-xl border border-violet-300 px-3 text-xs font-black text-violet-700 dark:text-violet-300">See Other Matches</button> : null}
        <button type="button" onClick={() => setSuggestion((current) => current ? { ...current, possibleMatches: [] } : current)} className="text-xs font-black text-violet-700 dark:text-violet-300">None of These / Enter Manually</button>
      </div> : null}
      {resolvedCard && category !== "graded_card" ? <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
        <p className="text-xs font-black uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Choose condition</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {scanConditions.map((condition) => <button type="button" key={condition} onClick={() => edit("condition", condition)} className={`min-h-10 rounded-xl px-3 text-xs font-black ${reviewSuggestion.condition === condition ? "bg-emerald-600 text-white" : "bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{condition.replace(/.*\/ /, "")}</button>)}
        </div>
        {needsCondition ? <p className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300">Select a condition before applying this card.</p> : null}
      </section> : null}
      <TcgplayerPricingPanel suggestion={reviewSuggestion} isSlab={category === "graded_card"} onChange={(next) => resolvedCard ? setResolvedCard({ ...resolvedCard, suggestion: next }) : setSuggestion(next)} />
      {reviewSuggestion.warnings.filter((warning) => !resolvedCard || !/no pokémon tcg api match|market price unavailable|raw ocr is available/i.test(warning)).map((warning) => <p key={warning} className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
      {import.meta.env.DEV && reviewSuggestion.technicalDetails?.scannerDebug ? <details className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/30">
        <summary className="cursor-pointer font-black text-sky-900 dark:text-sky-100">Scanner Debug</summary>
        <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <div><dt className="font-black">recognizedCardName</dt><dd><code>{JSON.stringify(reviewSuggestion.technicalDetails.scannerDebug.usefulness?.recognizedName ?? null)}</code></dd></div>
          <div><dt className="font-black">Name confidence</dt><dd className="capitalize">{reviewSuggestion.fieldConfidence.cardName || "Unknown"}</dd></div>
          <div><dt className="font-black">collectorNumber</dt><dd><code>{JSON.stringify(reviewSuggestion.technicalDetails.scannerDebug.usefulness?.recognizedCollectorNumber ?? reviewSuggestion.collectorNumber ?? null)}</code></dd></div>
          <div><dt className="font-black">Number confidence</dt><dd className="capitalize">{reviewSuggestion.fieldConfidence.collectorNumber || "Unknown"}</dd></div>
          <div className="sm:col-span-2"><dt className="font-black">Card bounds</dt><dd className="break-all">{reviewSuggestion.technicalDetails.scannerDebug.cardBounds ? JSON.stringify(reviewSuggestion.technicalDetails.scannerDebug.cardBounds) : "Not available"}</dd></div>
          <div><dt className="font-black">Parsed top region</dt><dd>{reviewSuggestion.technicalDetails.scannerDebug.topRegion?.selectedName || "Name unavailable"} · HP {reviewSuggestion.technicalDetails.scannerDebug.topRegion?.selectedHp ?? "?"}</dd></div>
          <div><dt className="font-black">Top confidence</dt><dd>{reviewSuggestion.technicalDetails.scannerDebug.topRegion?.confidence ?? 0}</dd></div>
          <div><dt className="font-black">Ability region</dt><dd>{reviewSuggestion.aiIdentification?.ability_names.join(", ") || "Not recognized"}</dd></div>
          <div><dt className="font-black">Ability confidence</dt><dd className="capitalize">{reviewSuggestion.aiIdentification?.field_confidence.ability || "Unknown"}</dd></div>
          <div><dt className="font-black">Attack region</dt><dd>{reviewSuggestion.aiIdentification?.attack_names.join(", ") || "Not recognized"}{reviewSuggestion.aiIdentification?.attack_damage.length ? ` · ${reviewSuggestion.aiIdentification.attack_damage.join(", ")}` : ""}</dd></div>
          <div><dt className="font-black">Attack confidence</dt><dd className="capitalize">{reviewSuggestion.aiIdentification?.field_confidence.attack || "Unknown"}</dd></div>
          <div className="sm:col-span-2"><dt className="font-black">Name catalog validation</dt><dd>{reviewSuggestion.technicalDetails.scannerDebug.nameCatalogValidation ? `${reviewSuggestion.technicalDetails.scannerDebug.nameCatalogValidation.status}: ${reviewSuggestion.technicalDetails.scannerDebug.nameCatalogValidation.reason}` : "Not available"}</dd></div>
          <div className="sm:col-span-2"><dt className="font-black">Query</dt><dd>{reviewSuggestion.technicalDetails.scannerDebug.search?.queries.map((entry) => entry.query).join(" → ") || "No query sent"}</dd></div>
          <div><dt className="font-black">Candidates returned</dt><dd>{reviewSuggestion.technicalDetails.scannerDebug.search?.providerCandidateCount ?? 0}</dd></div>
          <div><dt className="font-black">Name threshold</dt><dd>{Math.round((reviewSuggestion.technicalDetails.scannerDebug.search?.confidenceThreshold ?? 0) * 100)}%</dd></div>
          <div><dt className="font-black">Fallback used</dt><dd>{reviewSuggestion.technicalDetails.scannerDebug.search?.fallbackUsed ? "Yes" : "No"}</dd></div>
          <div><dt className="font-black">Final state</dt><dd>{outcome || "Pending"}</dd></div>
          <div><dt className="font-black">Candidate list shown</dt><dd>{displayedMatches.length}</dd></div>
        </dl>
        {reviewSuggestion.technicalDetails.scannerDebug.topRegion?.attempts.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {reviewSuggestion.technicalDetails.scannerDebug.topRegion.attempts.map((attempt, index) => <div key={`${attempt.topRatio}-${index}`} className="rounded-lg bg-white/80 p-2 dark:bg-slate-950/60">
            <p className="font-black">Top crop {index + 1}: {Math.round(attempt.topRatio * 100)}%{attempt.enhanced ? " · enhanced/sharpened" : ""}</p>
            {attempt.previewDataUrl ? <img src={attempt.previewDataUrl} alt={`Top-region scanner crop ${index + 1}`} className="mt-2 max-h-40 w-full rounded bg-black object-contain" /> : null}
            <p className="mt-1">{attempt.outputWidth}×{attempt.outputHeight} from {attempt.sourceWidth}×{attempt.sourceHeight}</p>
            <details className="mt-1"><summary className="cursor-pointer font-black">Raw top response</summary><pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap">{JSON.stringify(attempt.rawResponse ?? null, null, 2)}</pre></details>
          </div>)}
        </div> : null}
        <details className="mt-3 rounded-lg bg-white/80 p-2 dark:bg-slate-950/60">
          <summary className="cursor-pointer font-black">Raw full-region response</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap">{JSON.stringify(reviewSuggestion.technicalDetails.scannerDebug.visualRecognition?.rawProviderResponse ?? reviewSuggestion.technicalDetails.scannerDebug.visualRecognition?.rawIdentification ?? null, null, 2)}</pre>
        </details>
        <details className="mt-3 rounded-lg bg-white/80 p-2 dark:bg-slate-950/60">
          <summary className="cursor-pointer font-black">Complete pipeline trace</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap">{JSON.stringify(reviewSuggestion.technicalDetails.scannerDebug, null, 2)}</pre>
        </details>
      </details> : null}
      {reviewSuggestion.technicalDetails ? <details className="rounded-xl bg-slate-100 p-2 text-xs dark:bg-slate-900">
        <summary className="cursor-pointer font-black">Technical Details (raw OCR)</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify(reviewSuggestion.technicalDetails, null, 2)}</pre>
      </details> : null}
      {duplicateCertificate ? <p className="rounded-xl bg-rose-100 p-2 text-sm font-black text-rose-800">Possible duplicate slab certificate.</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setStatus("crop")} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Adjust Crop / Rescan</button>
        <button type="button" disabled={isAiScan && (!resolvedCard || needsCondition)} onClick={() => { onApply(reviewSuggestion, hash, processedFile); setMessage("Suggestions applied. Confirm the normal form, then press Save."); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-40"><Sparkles size={17} />Apply Suggestions</button>
      </div>
      <p className="text-xs text-slate-500">Sticker price never fills Cash Paid or Cost Basis. A single photo is not a physical condition grade.</p>
    </div> : null}

    {status === "failed" ? <div className="space-y-2">
      <p className="text-sm font-black text-rose-700 dark:text-rose-300">Card recognition could not complete.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => void scan(true, false)} className="min-h-11 rounded-xl bg-violet-600 px-3 text-sm font-black text-white">Try Again</button>
        <button type="button" onClick={() => setManualSearchOpen(true)} className="min-h-11 rounded-xl bg-slate-900 px-3 text-sm font-black text-white dark:bg-white dark:text-slate-900">Search Card Manually</button>
        <button type="button" onClick={() => setStatus("crop")} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Adjust Crop</button>
        <button type="button" onClick={onRetakePhoto} disabled={!onRetakePhoto} className="min-h-11 rounded-xl bg-violet-600 px-3 text-sm font-black text-white disabled:opacity-40"><ScanLine className="mr-1 inline" size={17} />Retake Photo</button>
        <button type="button" onClick={() => { setSuggestion(undefined); setMessage("Continue with the normal form. No OCR text was copied into the record."); }} className="min-h-11 rounded-xl bg-slate-200 px-3 text-sm font-black dark:bg-slate-800">Enter Everything Manually</button>
      </div>
    </div> : null}

    <ManualCardSearch
      open={manualSearchOpen}
      category={category}
      baseSuggestion={suggestion}
      initialName={recognizedName || suggestion?.cardName || suggestion?.correctedNameCandidate || ""}
      initialCollectorNumber={recognizedCollectorNumber || suggestion?.collectorNumber || ""}
      initialSet={suggestion?.cardSet || ""}
      initialLanguage={suggestion?.language || cardLanguage}
      initialGame={suggestion?.cardGame || cardGame}
      onClose={() => setManualSearchOpen(false)}
      onApply={(confirmed) => {
        // Invalidate any outstanding OCR/API request before committing the user
        // choice. Its eventual response must never replace this selection.
        runRef.current += 1;
        controllerRef.current?.abort();
        setResolvedCard({ source: "manual_search", suggestion: confirmed, confirmedByUser: true });
        setStatus("review");
        setOutcome("Match found");
        setMessage("Card selected manually. Choose a finish when needed, then apply the suggestions.");
      }}
    />
  </section>;
}
