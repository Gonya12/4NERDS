import { ExternalLink, LoaderCircle, Minus, Plus, Scan, X } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  imageUrl?: string;
  title: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
};

export function ImageLightbox({ imageUrl, title, onClose, onPrevious, onNext }: Props) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!imageUrl) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onPrevious?.();
      if (event.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [imageUrl, onClose, onPrevious, onNext]);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    setZoom(1);
  }, [imageUrl]);

  if (!imageUrl) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} image preview`}
      onClick={onClose}
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-slate-950/95 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur-sm sm:p-4"
    >
      <div onClick={(event) => event.stopPropagation()} className="grid h-[calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-[95vw] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-slate-900 shadow-2xl sm:h-[94dvh] sm:w-[94vw]">
        <header className="z-10 flex items-center gap-2 border-b border-white/10 bg-slate-900 p-2 text-white sm:p-3">
          <h2 className="min-w-0 flex-1 truncate px-2 text-sm font-black sm:text-base">{title}</h2>
          <a href={imageUrl} target="_blank" rel="noreferrer" className="hidden min-h-10 items-center gap-1 rounded-xl bg-white/10 px-3 text-xs font-bold sm:inline-flex"><ExternalLink size={16} /> Open Original</a>
          <button type="button" onClick={onClose} aria-label="Close image preview" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-950"><X size={20} /></button>
        </header>

        <div
          onWheel={(event) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            setZoom((value) => Math.min(4, Math.max(1, value + (event.deltaY < 0 ? 0.2 : -0.2))));
          }}
          onDoubleClick={() => setZoom((value) => value === 1 ? 2 : 1)}
          className={`relative flex min-h-0 items-center justify-center bg-black/50 p-2 sm:p-3 ${zoom === 1 ? "overflow-hidden" : "overflow-auto"}`}
        >
          {loading && !failed ? <div className="absolute inset-0 flex items-center justify-center text-white"><LoaderCircle className="animate-spin" size={32} /><span className="ml-2 font-bold">Loading image…</span></div> : null}
          {failed ? <p className="rounded-xl bg-rose-950/80 p-4 font-bold text-rose-100">Image could not be loaded.</p> : (
            <img
              src={imageUrl}
              alt={title}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setFailed(true); }}
              className={zoom === 1 ? "h-full w-full select-none object-contain" : "h-auto max-w-none select-none object-contain transition-[width] duration-150"}
              style={zoom === 1 ? undefined : { width: `${zoom * 100}%` }}
            />
          )}
        </div>

        <footer className="z-10 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-slate-900 p-2 text-white sm:p-3">
          {onPrevious ? <button type="button" onClick={onPrevious} className="min-h-10 rounded-xl bg-white/10 px-3 text-xs font-bold">Previous</button> : null}
          <button type="button" disabled={zoom === 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))} aria-label="Zoom out" className="flex size-10 items-center justify-center rounded-xl bg-white/10 disabled:opacity-40"><Minus size={18} /></button>
          <button type="button" onClick={() => setZoom(1)} className={`flex min-h-10 items-center gap-1 rounded-xl px-3 text-xs font-bold ${zoom === 1 ? "bg-white text-slate-950" : "bg-white/10"}`}><Scan size={16} /> Fit</button>
          <button type="button" onClick={() => setZoom((value) => Math.min(4, value + 0.25))} aria-label="Zoom in" className="flex size-10 items-center justify-center rounded-xl bg-white/10"><Plus size={18} /></button>
          {onNext ? <button type="button" onClick={onNext} className="min-h-10 rounded-xl bg-white/10 px-3 text-xs font-bold">Next</button> : null}
        </footer>
      </div>
    </div>
  );
}
