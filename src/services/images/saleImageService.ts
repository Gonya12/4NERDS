import { isSupabaseConfigured, supabase } from "../../utils/supabase";
import type { TransactionImageAttachment, TransactionImageType } from "../../types/models";
import { buildTransactionImagePayload } from "../database/databasePayloads";
import { normalizeImageOrientation } from "./imageOrientation";

const bucketName = "sale-images";
const supportedTypes = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

export function isSupportedSaleImage(file: File) {
  return supportedTypes.includes(file.type.toLowerCase())
    || file.type.toLowerCase().startsWith("image/")
    || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
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

export async function fileToDataUrl(file: File) {
  const normalized = await normalizeImageOrientation(file);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(normalized);
  });
}

async function resizeImage(file: File, options: { maxLongEdge: number; quality: number; prefix: string }) {
  if (!isSupportedSaleImage(file)) throw new Error("Please use a JPG, JPEG, PNG, WebP, HEIC, or HEIF image.");
  const normalized = await normalizeImageOrientation(file);
  const imageUrl = URL.createObjectURL(normalized);
  let bitmap: ImageBitmap | undefined;
  try {
    let source: CanvasImageSource;
    let sourceWidth: number;
    let sourceHeight: number;
    if ("createImageBitmap" in window) {
      try {
        bitmap = await createImageBitmap(normalized, { imageOrientation: "none" });
      } catch {
        bitmap = undefined;
      }
    }
    if (bitmap) {
      source = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
    } else {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("This browser could not decode the image. Try exporting it as JPG or PNG."));
        img.src = imageUrl;
      });
      source = image;
      sourceWidth = image.naturalWidth || image.width;
      sourceHeight = image.naturalHeight || image.height;
    }
    const scale = Math.min(1, options.maxLongEdge / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare image.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not compress image.")), "image/jpeg", options.quality);
    });
    return new File([blob], `${options.prefix}-${normalized.name || "financial-image"}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap?.close();
    URL.revokeObjectURL(imageUrl);
  }
}

export async function compressSaleImage(file: File) {
  const normalized = await normalizeImageOrientation(file);
  if (normalized.name.startsWith("compressed-")) return normalized;
  return resizeImage(normalized, { maxLongEdge: 1800, quality: 0.84, prefix: "compressed" });
}

export async function prepareCardRecognitionImage(file: File) {
  if (!isSupportedSaleImage(file)) throw new Error("Please use a JPG, JPEG, PNG, or WebP card image.");
  const normalized = await normalizeImageOrientation(file);
  // The crop worker already corrects perspective at high JPEG quality. Avoid a
  // second lossy encode that can erase tiny collector numbers.
  if (normalized.type === "image/jpeg" && normalized.name.startsWith("cropped-") && normalized.size <= 6 * 1024 * 1024) return normalized;
  if (normalized.name.startsWith("recognition-")) return normalized;
  return resizeImage(normalized, { maxLongEdge: 2000, quality: 0.92, prefix: "recognition" });
}

export async function uploadSaleImage(file: File, saleId: string) {
  return uploadFinancialImage(file, "sales", saleId);
}

export type ImageUploadStage =
  | "preparing"
  | "compressing"
  | "uploading"
  | "storage_uploaded"
  | "saving_metadata"
  | "complete"
  | "failed";

export async function uploadFinancialImage(file: File, folder: "sales" | "purchases" | "expenses", recordId: string, onProgress?: (stage: ImageUploadStage) => void) {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase Storage is not configured.");
  onProgress?.("preparing");
  onProgress?.("compressing");
  const compressed = await compressSaleImage(file);
  const imagePath = `${folder}/${recordId}/${Date.now()}.jpg`;
  onProgress?.("uploading");
  const { error } = await supabase.storage.from(bucketName).upload(imagePath, compressed, {
    cacheControl: "31536000",
    upsert: true,
    contentType: compressed.type
  });
  if (error) throw new Error(error.message);
  onProgress?.("saving_metadata");
  const { data } = supabase.storage.from(bucketName).getPublicUrl(imagePath);
  onProgress?.("complete");
  return { imageUrl: data.publicUrl, imagePath };
}

export class TransactionImageMetadataError extends Error {
  attachment: TransactionImageAttachment;

  constructor(message: string, attachment: TransactionImageAttachment) {
    super(message);
    this.name = "TransactionImageMetadataError";
    this.attachment = attachment;
  }
}

export function isTransactionImageMetadataError(error: unknown): error is TransactionImageMetadataError {
  return error instanceof TransactionImageMetadataError;
}

const itemImageTypes = new Set<TransactionImageType>(["item", "front", "back", "crop"]);

async function storageObjectExists(imagePath: string) {
  if (!supabase) return false;
  const separator = imagePath.lastIndexOf("/");
  const folder = separator >= 0 ? imagePath.slice(0, separator) : "";
  const fileName = separator >= 0 ? imagePath.slice(separator + 1) : imagePath;
  const listed = await supabase.storage.from("transaction-images").list(folder, {
    limit: 2,
    search: fileName
  });
  // An inconclusive lookup must never trigger a duplicate physical upload.
  if (listed.error) return true;
  return Boolean(listed.data?.some((object) => object.name === fileName));
}

async function upsertTransactionImageMetadata(attachment: TransactionImageAttachment) {
  if (!supabase) return;
  const payload = buildTransactionImagePayload(attachment, attachment.id, attachment.transactionId);
  const metadata = await supabase
    .from("transaction_images")
    .upsert(payload, { onConflict: "id" });
  if (metadata.error) {
    const pending = {
      ...attachment,
      metadataStatus: "pending" as const,
      metadataError: metadata.error.message
    };
    throw new TransactionImageMetadataError(
      `Image uploaded; record still needs to be saved. ${metadata.error.message}`,
      pending
    );
  }
}

export async function saveTransactionImage(
  file: File | undefined,
  transactionId: string,
  itemId?: string,
  imageType: TransactionImageType = "general",
  onProgress?: (stage: ImageUploadStage) => void,
  stableImageId: string = crypto.randomUUID(),
  resumeAttachment?: TransactionImageAttachment
) {
  onProgress?.("preparing");
  if (!transactionId) throw new Error("Save the transaction draft before adding an image.");
  if (itemImageTypes.has(imageType) && !itemId) {
    throw new Error("Save the transaction item before adding an item-specific image.");
  }
  if (!isSupabaseConfigured || !supabase) {
    if (!file) throw new Error("The original image must be selected again.");
    const imageUrl = await fileToDataUrl(file);
    onProgress?.("complete");
    return {
      id: stableImageId,
      transactionId,
      transactionItemId: itemId,
      imageType,
      imageUrl,
      imagePath: undefined,
      sortOrder: resumeAttachment?.sortOrder || 0,
      metadataStatus: "complete" as const
    };
  }

  let attachment = resumeAttachment?.imagePath && resumeAttachment.imageUrl
    ? {
      ...resumeAttachment,
      id: stableImageId,
      transactionId,
      transactionItemId: itemId,
      imageType
    }
    : undefined;
  const uploadedObjectStillExists = attachment?.imagePath
    ? await storageObjectExists(attachment.imagePath)
    : false;

  if (!attachment || !uploadedObjectStillExists) {
    if (!file) {
      throw new Error("The uploaded Storage object no longer exists. Choose the image again to upload it.");
    }
    onProgress?.("compressing");
    const compressed = await compressSaleImage(file);
    const imagePath = attachment?.imagePath
      || `${transactionId}/${itemId || "shared"}/${imageType}-${stableImageId}.jpg`;
    onProgress?.("uploading");
    const { error } = await supabase.storage.from("transaction-images").upload(imagePath, compressed, {
      cacheControl: "31536000",
      upsert: false,
      contentType: compressed.type
    });
    if (error && !(await storageObjectExists(imagePath))) throw new Error(error.message);
    const { data } = supabase.storage.from("transaction-images").getPublicUrl(imagePath);
    attachment = {
      id: stableImageId,
      transactionId,
      transactionItemId: itemId,
      imageType,
      imageUrl: data.publicUrl,
      imagePath,
      sortOrder: resumeAttachment?.sortOrder || 0,
      metadataStatus: "pending"
    };
  };

  onProgress?.("storage_uploaded");
  onProgress?.("saving_metadata");
  await upsertTransactionImageMetadata(attachment);
  onProgress?.("complete");
  return {
    ...attachment,
    metadataStatus: "complete" as const,
    metadataError: undefined
  };
}
