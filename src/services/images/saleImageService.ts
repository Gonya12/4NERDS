import { isSupabaseConfigured, supabase } from "../../utils/supabase";

const bucketName = "sale-images";
const supportedTypes = ["image/png", "image/jpeg", "image/webp"];

export function isSupportedSaleImage(file: File) {
  return supportedTypes.includes(file.type);
}

export function imageFromClipboard(event: React.ClipboardEvent | ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  return imageItem?.getAsFile() || undefined;
}

function extensionFor(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

export async function compressSaleImage(file: File) {
  if (!isSupportedSaleImage(file)) throw new Error("Please use a PNG, JPG, JPEG, or WebP image.");
  if (file.name.startsWith("compressed-")) return file;
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image."));
      img.src = imageUrl;
    });
    const maxLongEdge = 1800;
    const scale = Math.min(1, maxLongEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not compress image.")), "image/jpeg", 0.8);
    });
    return new File([blob], `compressed-${file.name || "financial-image"}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function uploadSaleImage(file: File, saleId: string) {
  return uploadFinancialImage(file, "sales", saleId);
}

export async function uploadFinancialImage(file: File, folder: "sales" | "purchases" | "expenses", recordId: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase Storage is not configured.");
  const compressed = await compressSaleImage(file);
  const imagePath = `${folder}/${recordId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(bucketName).upload(imagePath, compressed, {
    cacheControl: "31536000",
    upsert: true,
    contentType: compressed.type
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(bucketName).getPublicUrl(imagePath);
  return { imageUrl: data.publicUrl, imagePath };
}
