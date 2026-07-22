import { X } from "lucide-react";
import { useEffect, useState } from "react";

export function EventImageFrame({
  imageUrl,
  initials,
  className = "aspect-[4/5] max-h-[620px]",
  preview = true
}: {
  imageUrl?: string;
  initials?: string;
  className?: string;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        disabled={!imageUrl || !preview}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (imageUrl && preview) setOpen(true);
        }}
        aria-label={imageUrl && preview ? "Open event image preview" : undefined}
        className={`relative block w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-night-950 via-night-800 to-brand-600 text-left shadow-inner transition duration-240 ease-premium enabled:hover:brightness-105 enabled:active:scale-[0.995] disabled:cursor-default ${className}`}
      >
        {imageUrl ? (
          <>
            <img src={imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/35 via-transparent to-slate-950/15" />
            <img src={imageUrl} alt="" loading="lazy" decoding="async" className="relative z-10 h-full w-full object-contain p-2" />
          </>
        ) : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-night-800 via-slate-800 to-brand-600 text-4xl font-black text-white/95">
            <span className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
            <span className="relative">{initials || "4N"}</span>
          </div>
        )}
      </button>
      {open && imageUrl ? (
        <div role="dialog" aria-modal="true" aria-label="Event image preview" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/95 p-3 backdrop-blur-sm">
          <button onClick={() => setOpen(false)} className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white backdrop-blur" aria-label="Close image preview">
            <X size={22} />
          </button>
          <img src={imageUrl} alt="Event flyer" decoding="async" className="max-h-[92dvh] max-w-full rounded-xl object-contain shadow-2xl" />
        </div>
      ) : null}
    </>
  );
}
