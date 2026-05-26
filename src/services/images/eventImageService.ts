import { isSupabaseConfigured, supabase } from "../../utils/supabase";
import type { ClipboardEvent as ReactClipboardEvent } from "react";

const bucketName = "event-images";
const supportedTypes = ["image/png", "image/jpeg", "image/webp"];

export type StoredEventImage = {
  imageUrl: string;
  imagePath?: string;
  warning?: string;
};

export function isSupportedImage(file: File) {
  return supportedTypes.includes(file.type);
}

function extensionFor(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

async function resizeImage(file: File) {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image."));
      img.src = imageUrl;
    });
    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / image.width);
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare image.");
    context.drawImage(image, 0, 0, width, height);
    const outputType = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not compress image.")), outputType, 0.8);
    });
    return new File([blob], file.name || `event-image.${extensionFor(file)}`, { type: outputType });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function storeEventImage(file: File, eventId: string): Promise<StoredEventImage> {
  if (!isSupportedImage(file)) throw new Error("Please use a PNG, JPG, JPEG, or WebP image.");
  const resized = await resizeImage(file);

  if (!isSupabaseConfigured || !supabase) {
    return {
      imageUrl: await fileToDataUrl(resized),
      warning: "Local images only appear on this device unless Supabase Storage is enabled."
    };
  }

  const safeName = (resized.name || `image.${extensionFor(resized)}`).replace(/[^a-z0-9._-]/gi, "-");
  const imagePath = `events/${eventId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(bucketName).upload(imagePath, resized, {
    cacheControl: "31536000",
    upsert: true,
    contentType: resized.type
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucketName).getPublicUrl(imagePath);
  return {
    imageUrl: data.publicUrl,
    imagePath
  };
}

export function imageFromClipboard(event: ReactClipboardEvent | ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  return imageItem?.getAsFile() || undefined;
}
