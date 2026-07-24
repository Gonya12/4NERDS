import { ScanLine, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { InventoryPurchase, PokemonProductCategory } from "../../types/models";
import { scanPokemonCard, type CardScanSuggestion } from "../../services/sales/cardScanService";

type Props = {
  imageFile?: File;
  backImageFile?: File;
  category: PokemonProductCategory;
  inventory: InventoryPurchase[];
  onApply: (suggestion: CardScanSuggestion, hash: string) => void;
};

const confidenceClass = { high: "bg-emerald-100 text-emerald-700", medium: "bg-amber-100 text-amber-700", low: "bg-rose-100 text-rose-700" };

export function CardScanPanel({ imageFile, backImageFile, category, inventory, onApply }: Props) {
  const [status, setStatus] = useState<"idle" | "analyzing" | "review" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState("");
  const [suggestion, setSuggestion] = useState<CardScanSuggestion>();

  async function scan(force = false) {
    if (!imageFile) { setMessage("Add a front image before scanning."); return; }
    setStatus("analyzing"); setMessage("");
    try {
      const result = await scanPokemonCard(imageFile, category, backImageFile, force);
      setSuggestion(result.suggestion); setHash(result.hash); setStatus("review");
      const useful = Boolean(result.suggestion.cardName || result.suggestion.collectorNumber || result.suggestion.condition || result.suggestion.stickerPrice != null || result.suggestion.possibleMatches?.length);
      setMessage(useful
        ? (result.cached ? "Loaded cached scan. Review every field before applying." : "Readable information found. Review every field before applying.")
        : "No readable card information was found. Move closer, fill the frame, keep the top and bottom text sharp, and avoid glare.");
    } catch (error) {
      setStatus("failed"); setMessage(error instanceof Error ? error.message : "Card analysis failed.");
    }
  }

  useEffect(() => {
    if (imageFile) void scan();
  }, [imageFile, backImageFile]);

  const duplicateCertificate = suggestion?.certificateNumber && inventory.some((row) => row.certificateNumber?.trim().toLowerCase() === suggestion.certificateNumber?.trim().toLowerCase());
  const hasUsefulSuggestion = Boolean(suggestion && (suggestion.cardName || suggestion.collectorNumber || suggestion.condition || suggestion.stickerPrice != null || suggestion.possibleMatches?.length));
  const field = (key: keyof CardScanSuggestion, label: string, type: "text" | "number" = "text") => {
    const value = suggestion?.[key];
    const confidence = suggestion?.fieldConfidence?.[String(key)];
    return <label className="block"><span className="mb-1 flex items-center gap-2 text-xs font-black">{label}{confidence ? <span className={`rounded-full px-2 py-0.5 text-[10px] ${confidenceClass[confidence]}`}>{confidence}</span> : null}</span><input type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "0.01" : undefined} value={value == null || typeof value === "object" ? "" : String(value)} onChange={(event) => setSuggestion((current) => current ? { ...current, [key]: type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value } : current)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" /></label>;
  };

  return <section className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900 dark:bg-violet-950/20">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-black text-violet-900 dark:text-violet-100">Pokémon card scanner</p><p className="text-xs text-violet-700 dark:text-violet-300">Suggestions only. Sticker price never becomes actual bought price.</p></div><button type="button" disabled={!imageFile || status === "analyzing"} onClick={() => void scan(status === "review")} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-black text-white disabled:opacity-50"><ScanLine size={17} />{status === "analyzing" ? "Analyzing image…" : status === "failed" ? "Retry Scan" : status === "review" ? "Rescan" : "Scan Card"}</button></div>
    <div className="rounded-xl bg-white/70 p-2 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-300"><strong>Photo tips:</strong> shoot straight-on, avoid glare, keep the name and bottom number visible, and include the full slab label. Slabs should have separate front and back photos.</div>
    {message ? <p className={`text-sm font-bold ${status === "failed" ? "text-rose-700" : "text-violet-700 dark:text-violet-200"}`}>{message}</p> : null}
    {suggestion && !hasUsefulSuggestion ? <div className="space-y-2 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100"><strong>No readable card information was found.</strong><p>Retake or replace the photo, crop closer to the card, or use the normal form for manual entry.</p>{suggestion.technicalDetails ? <details className="text-xs"><summary className="cursor-pointer font-black">Technical Details</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify(suggestion.technicalDetails, null, 2)}</pre></details> : null}</div> : null}
    {suggestion && hasUsefulSuggestion ? <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-3">{field("cardName", "Card name")}{field("collectorNumber", "Collector number")}{field("cardSet", "Set / code")}{field("language", "Language")}{field("condition", "Condition")}{field("stickerPrice", "Sticker / asking price", "number")}{category === "graded_card" ? <>{field("gradingCompany", "Grading company")}{field("grade", "Grade")}{field("certificateNumber", "Certificate number")}</> : null}</div>
      {suggestion.possibleMatches?.length ? <div className="space-y-2"><div className="flex items-center justify-between"><p className="text-xs font-black">Possible Pokémon TCG matches</p><span className="text-[10px] text-slate-500">Try another match below</span></div>{suggestion.possibleMatches.map((match) => <article key={match.id} className="flex gap-3 rounded-xl border border-violet-200 bg-white p-2 text-xs dark:bg-slate-900">{match.imageUrl ? <img src={match.imageUrl} alt="" loading="lazy" className="h-24 w-16 rounded object-contain" /> : null}<div className="min-w-0 flex-1"><p className="font-black">{match.cardName} · {match.collectorNumber}</p><p>{match.setName}{match.rarity ? ` · ${match.rarity}` : ""}</p><p>{match.marketPrice != null ? `$${match.marketPrice.toFixed(2)} market · ` : ""}{match.matchConfidence} match</p><button type="button" onClick={() => setSuggestion((current) => current ? { ...current, cardName: match.cardName, collectorNumber: match.collectorNumber, cardSet: match.setName, possibleMatches: [] } : current)} className="mt-2 rounded-lg bg-violet-600 px-3 py-1.5 font-black text-white">Use This Card</button></div></article>)}<button type="button" onClick={() => setSuggestion((current) => current ? { ...current, possibleMatches: [] } : current)} className="text-xs font-black text-violet-700 dark:text-violet-300">Edit Manually</button></div> : null}
      {suggestion.warnings?.map((warning) => <p key={warning} className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
      {suggestion.technicalDetails ? <details className="rounded-xl bg-slate-100 p-2 text-xs dark:bg-slate-900"><summary className="cursor-pointer font-black">Technical Details</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify(suggestion.technicalDetails, null, 2)}</pre></details> : null}
      {duplicateCertificate ? <p className="rounded-xl bg-rose-100 p-2 text-sm font-black text-rose-800">Possible duplicate slab certificate.</p> : null}<button type="button" onClick={() => { onApply(suggestion, hash); setMessage("Suggestions applied. Confirm the normal inventory form, then Save."); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white"><Sparkles size={17} />Apply Suggestions</button></div> : null}
  </section>;
}
