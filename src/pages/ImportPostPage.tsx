import { ClipboardPaste, Instagram, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusChip } from "../components/StatusChip";
import { parserFixtures } from "../services/parser/eventTextParser";
import { shouldKeepDetectedCandidate, storeScrapeLog } from "../services/scrapers/detectionPolicy";
import { parseInstagramBatch, parseManualInstagramImport } from "../services/scrapers/manualInstagramImport";
import { saveCandidate } from "../services/sync/sharedRepository";
import type { ParsedEventCandidate } from "../types/models";
import { displayDate } from "../utils/dateUtils";

const fixtureBatch = [
  `https://www.instagram.com/p/demo1/
${parserFixtures[0]}`,
  `https://www.instagram.com/reel/demo2/
${parserFixtures[1]}`,
  `https://www.instagram.com/p/demo3/
${parserFixtures[2]}`
].join("\n\n");

function CandidatePreview({ candidate }: { candidate: ParsedEventCandidate }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{candidate.eventName || "Possible Event"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {displayDate(candidate.startDate)} · {[candidate.venueName, candidate.city, candidate.state].filter(Boolean).join(" · ") || "Location unknown"}
          </p>
          <p className="mt-1 text-xs text-slate-500">{candidate.sourceUrl || "No Instagram URL detected"}</p>
        </div>
        <StatusChip value={candidate.confidence} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <StatusChip value={candidate.registrationStatus} />
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Score {candidate.detectionScore}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{candidate.classification.replace(/_/g, " ")}</span>
      </div>
      <details className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-bold text-ink">Why</summary>
        <div className="mt-2 space-y-2">
          <p><strong>Reasons:</strong> {candidate.reasons.join("; ") || "No positive reasons recorded."}</p>
          <p><strong>Warnings:</strong> {candidate.warnings.join("; ") || "None"}</p>
          <p><strong>Missing:</strong> {candidate.missingFields.join(", ") || "None"}</p>
        </div>
      </details>
    </article>
  );
}

export function ImportPostPage() {
  const [mode, setMode] = useState<"batch" | "single">("batch");
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState(parserFixtures[0]);
  const [batchText, setBatchText] = useState(fixtureBatch);
  const navigate = useNavigate();

  const candidates = useMemo(() => {
    if (mode === "single") return [parseManualInstagramImport(url, caption)];
    return parseInstagramBatch(batchText);
  }, [batchText, caption, mode, url]);

  const eligibleCount = candidates.filter((candidate) => candidate.classification !== "not_event").length;

  async function pasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (mode === "single") setCaption(text);
      else setBatchText(text);
    } catch {
      alert("Clipboard access was blocked. Paste into the text box instead.");
    }
  }

  async function saveAllEligible() {
    let saved = 0;
    let logged = 0;
    for (const candidate of candidates) {
      if (await shouldKeepDetectedCandidate(candidate)) {
        await saveCandidate(candidate);
        saved += 1;
      } else {
        await storeScrapeLog(candidate);
        logged += 1;
      }
    }
    alert(`${saved} saved to Review. ${logged} stored in scrape logs.`);
    if (saved > 0) navigate("/review");
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-black text-ink">Fast Instagram Import</h1>
        <p className="text-sm text-slate-500">Paste a batch of copied post links and captions. The app detects events locally.</p>
      </header>

      <section className="grid grid-cols-2 gap-2 rounded-lg bg-white p-2 shadow-soft">
        <button onClick={() => setMode("batch")} className={`min-h-11 rounded-lg text-sm font-bold ${mode === "batch" ? "bg-ink text-white" : "bg-slate-100 text-ink"}`}>Batch</button>
        <button onClick={() => setMode("single")} className={`min-h-11 rounded-lg text-sm font-bold ${mode === "single" ? "bg-ink text-white" : "bg-slate-100 text-ink"}`}>Single</button>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-soft">
        {mode === "batch" ? (
          <div className="space-y-3">
            <textarea
              value={batchText}
              onChange={(event) => setBatchText(event.target.value)}
              placeholder="Paste Instagram URL + caption blocks. Multiple posts are OK."
              className="min-h-64 w-full rounded-lg border border-slate-200 px-3 py-3"
            />
            <p className="text-xs text-slate-500">Fast path: copy several Instagram links/captions into one note, then paste here. Separate caption-only posts with a line containing ---.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Instagram post URL" className="w-full rounded-lg border border-slate-200 px-3 py-3" />
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Paste caption text" className="min-h-40 w-full rounded-lg border border-slate-200 px-3 py-3" />
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={pasteClipboard} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm font-bold text-ink"><ClipboardPaste size={17} /> Paste</button>
          <button onClick={() => setBatchText(fixtureBatch)} className="min-h-11 rounded-lg bg-slate-100 text-sm font-bold text-ink">Demo Batch</button>
        </div>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-coral">Detected</p>
            <h2 className="text-lg font-black text-ink">{candidates.length} posts · {eligibleCount} possible events</h2>
          </div>
          <button onClick={saveAllEligible} disabled={candidates.length === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-bold text-white disabled:opacity-40">
            <Save size={17} /> Save
          </button>
        </div>
      </section>

      <div className="space-y-3">
        {candidates.map((candidate) => <CandidatePreview key={candidate.id} candidate={candidate} />)}
      </div>

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <Instagram size={15} /> This speeds up manual Instagram intake without automated scraping, login automation, or bypassing Instagram protections.
      </p>
    </div>
  );
}
