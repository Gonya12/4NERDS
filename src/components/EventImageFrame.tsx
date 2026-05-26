import { X } from "lucide-react";
import { useState } from "react";

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
        className={`relative block w-full overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-800 to-coral text-left disabled:cursor-default ${className}`}
      >
        {imageUrl ? (
          <>
            <img src={imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-xl" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/35 via-transparent to-slate-950/15" />
            <img src={imageUrl} alt="" loading="lazy" decoding="async" className="relative z-10 h-full w-full object-contain p-2" />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-coral via-amber-400 to-emerald-400 text-4xl font-black text-white/90">
            {initials || "4N"}
          </div>
        )}
      </button>
      {open && imageUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-3">
          <button onClick={() => setOpen(false)} className="absolute right-4 top-4 rounded-full bg-white/10 p-3 text-white backdrop-blur">
            <X size={22} />
          </button>
          <img src={imageUrl} alt="" loading="lazy" decoding="async" className="max-h-[96vh] max-w-full object-contain" />
        </div>
      ) : null}
    </>
  );
}
