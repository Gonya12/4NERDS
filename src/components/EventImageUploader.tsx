import { ImagePlus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { imageFromClipboard, storeEventImage } from "../services/images/eventImageService";

export function EventImageUploader({
  eventId,
  imageUrl,
  onChange
}: {
  eventId: string;
  imageUrl?: string;
  onChange: (image: { imageUrl?: string; imagePath?: string }) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function handleFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage("Uploading...");
    try {
      const stored = await storeEventImage(file, eventId);
      await onChange({ imageUrl: stored.imageUrl, imagePath: stored.imagePath });
      setMessage(stored.warning || "Image saved.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Image upload failed.";
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-muted space-y-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-black text-ink dark:text-white">Event Image</h2>
        {busy ? <span className="text-xs font-bold text-coral">Uploading...</span> : null}
      </div>
      <div
        tabIndex={0}
        onPaste={(event) => {
          const file = imageFromClipboard(event);
          if (file) {
            event.preventDefault();
            void handleFile(file);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void handleFile(event.dataTransfer.files[0]);
        }}
        className="flex min-h-48 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-white/80 text-center text-sm text-slate-500 outline-none transition duration-240 hover:border-orange-300 hover:bg-orange-50/40 focus:border-coral focus:ring-2 focus:ring-coral/20 dark:border-slate-700 dark:bg-night-850 dark:text-slate-400 dark:hover:border-orange-500/50 dark:hover:bg-orange-950/10"
        onClick={() => inputRef.current?.click()}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="Event preview" className="h-full max-h-72 w-full bg-night-950/5 object-contain p-2 dark:bg-night-950/50" />
        ) : (
          <div className="space-y-2 p-6">
            <ImagePlus className="mx-auto text-coral" size={34} />
            <p className="font-bold text-ink dark:text-white">Paste an image, drop it here, or choose a file.</p>
            <p className="text-xs">PNG, JPG, JPEG, or WebP. Images are resized before upload.</p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => inputRef.current?.click()} className="btn-primary">
          <Upload size={16} /> {imageUrl ? "Replace image" : "Choose Image"}
        </button>
        <button type="button" onClick={() => onChange({ imageUrl: undefined, imagePath: undefined })} disabled={!imageUrl} className="btn-danger">
          <Trash2 size={16} /> Remove
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void handleFile(event.target.files?.[0])} />
      {message ? <p className={`rounded-xl p-3 text-xs font-bold ${message.includes("failed") || message.includes("Please") || message.includes("Could not") ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200" : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}>{message}</p> : null}
    </section>
  );
}
