export function EventImageFrame({
  imageUrl,
  initials,
  className = "aspect-[16/9]"
}: {
  imageUrl?: string;
  initials?: string;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-800 to-coral ${className}`}>
      {imageUrl ? (
        <>
          <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-xl" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/35 via-transparent to-slate-950/10" />
          <img src={imageUrl} alt="" className="relative z-10 h-full w-full object-contain p-2" />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-coral via-amber-400 to-emerald-400 text-4xl font-black text-white/90">
          {initials || "4N"}
        </div>
      )}
    </div>
  );
}
