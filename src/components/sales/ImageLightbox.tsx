import { ExternalLink, LoaderCircle, Minus, Plus, RotateCcw, X } from "lucide-react";
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
      className="fixed inset-0 z-[90] overflow-y-auto overflow-x-hidden bg-slate-950/95 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-sm sm:p-5"
    >
      <div onClick={(event) => event.stopPropagation()} className="mx-auto flex min-h-full w-full max-w-6xl flex-col">
        <header className="sticky top-0 z-10 mb-3 flex items-center gap-2 rounded-2xl bg-slate-900/95 p-2 text-white shadow-xl">
          <h2 className="min-w-0 flex-1 truncate px-2 text-sm font-black sm:text-base">{title}</h2>
          <a href={imageUrl} target="_blank" rel="noreferrer" className="hidden min-h-10 items-center gap-1 rounded-xl bg-white/10 px-3 text-xs font-bold sm:inline-flex"><ExternalLink size={16} /> Open Original</a>
          <button type="button" onClick={onClose} aria-label="Close image preview" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-950"><X size={20} /></button>
        </header>

        <div
          onWheel={(event) => {
            if (!event.ctrlKey && Math.abs(event.deltaY) < 5) return;
            event.preventDefault();
            setZoom((value) => Math.min(4, Math.max(0.5, value + (event.deltaY < 0 ? 0.15 : -0.15))));
          }}
          className="relative flex min-h-[55dvh] flex-1 items-center justify-center overflow-auto rounded-2xl bg-black/40 p-2"
        >
          {loading && !failed ? <div className="absolute inset-0 flex items-center justify-center text-white"><LoaderCircle className="animate-spin" size={32} /><span className="ml-2 font-bold">Loading image…</span></div> : null}
          {failed ? <p className="rounded-xl bg-rose-950/80 p-4 font-bold text-rose-100">Image could not be loaded.</p> : (
            <img
              src={imageUrl}
              alt={title}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setFailed(true); }}
              className="max-h-[calc(100dvh-9rem)] max-w-full select-none object-contain transition-transform duration-150"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
            />
          )}
        </div>

        <footer className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-slate-900/95 p-2 text-white">
          {onPrevious ? <button type="button" onClick={onPrevious} className="min-h-10 rounded-xl bg-white/10 px-3 text-xs font-bold">Previous</button> : null}
          <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="Zoom out" className="flex size-10 items-center justify-center rounded-xl bg-white/10"><Minus size={18} /></button>
          <button type="button" onClick={() => setZoom(1)} className="flex min-h-10 items-center gap-1 rounded-xl bg-white/10 px-3 text-xs font-bold"><RotateCcw size={16} /> {Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => setZoom((value) => Math.min(4, value + 0.25))} aria-label="Zoom in" className="flex size-10 items-center justify-center rounded-xl bg-white/10"><Plus size={18} /></button>
          {onNext ? <button type="button" onClick={onNext} className="min-h-10 rounded-xl bg-white/10 px-3 text-xs font-bold">Next</button> : null}
        </footer>
      </div>
    </div>
  );
}
