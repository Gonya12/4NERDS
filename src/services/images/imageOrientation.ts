export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ImageOrientationInfo = {
  originalWidth?: number;
  originalHeight?: number;
  exifOrientation: ExifOrientation | null;
  decodedWidth?: number;
  decodedHeight?: number;
  normalizedWidth?: number;
  normalizedHeight?: number;
  rotationApplied: string;
  mirrored: boolean;
  decoderAppliedOrientation: boolean;
};

export type NormalizedImageResult = {
  file: File;
  info: ImageOrientationInfo;
};

type JpegMetadata = {
  orientation: ExifOrientation | null;
  width?: number;
  height?: number;
};

const normalizationCache = new WeakMap<File, Promise<NormalizedImageResult>>();

function isJpeg(file: File) {
  return /^image\/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
}

function isExifOrientation(value: number): value is ExifOrientation {
  return Number.isInteger(value) && value >= 1 && value <= 8;
}

function readExifOrientation(view: DataView, tiffOffset: number, limit: number) {
  if (tiffOffset + 8 > limit) return null;
  const byteOrder = view.getUint16(tiffOffset, false);
  const littleEndian = byteOrder === 0x4949;
  if (!littleEndian && byteOrder !== 0x4d4d) return null;
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 42) return null;
  const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
  if (ifdOffset + 2 > limit) return null;
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (entry + 12 > limit) break;
    if (view.getUint16(entry, littleEndian) !== 0x0112) continue;
    const value = view.getUint16(entry + 8, littleEndian);
    return isExifOrientation(value) ? value : null;
  }
  return null;
}

function isStartOfFrame(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

export function readJpegMetadata(buffer: ArrayBuffer): JpegMetadata {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return { orientation: null };
  let orientation: ExifOrientation | null = null;
  let width: number | undefined;
  let height: number | undefined;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    let markerOffset = offset + 1;
    while (markerOffset < view.byteLength && view.getUint8(markerOffset) === 0xff) markerOffset += 1;
    if (markerOffset >= view.byteLength) break;
    const marker = view.getUint8(markerOffset);
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerOffset + 1;
      continue;
    }
    const lengthOffset = markerOffset + 1;
    if (lengthOffset + 2 > view.byteLength) break;
    const segmentLength = view.getUint16(lengthOffset, false);
    if (segmentLength < 2) break;
    const dataOffset = lengthOffset + 2;
    const segmentEnd = lengthOffset + segmentLength;
    if (segmentEnd > view.byteLength) break;
    if (marker === 0xe1 && segmentLength >= 8
      && view.getUint32(dataOffset, false) === 0x45786966
      && view.getUint16(dataOffset + 4, false) === 0) {
      orientation ??= readExifOrientation(view, dataOffset + 6, segmentEnd);
    }
    if (isStartOfFrame(marker) && dataOffset + 5 <= segmentEnd) {
      height = view.getUint16(dataOffset + 1, false);
      width = view.getUint16(dataOffset + 3, false);
    }
    if (orientation != null && width && height) break;
    offset = segmentEnd;
  }
  return { orientation, width, height };
}

export function orientationTransform(orientation: ExifOrientation, width: number, height: number) {
  const swapped = orientation >= 5;
  const outputWidth = swapped ? height : width;
  const outputHeight = swapped ? width : height;
  const values: Record<ExifOrientation, [number, number, number, number, number, number]> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  const rotationDegrees = orientation === 3 ? 180 : orientation === 5 || orientation === 6
    ? 90 : orientation === 7 || orientation === 8 ? 270 : 0;
  return {
    matrix: values[orientation],
    outputWidth,
    outputHeight,
    rotationDegrees,
    mirrored: [2, 4, 5, 7].includes(orientation),
  };
}

function orientationDescription(orientation: ExifOrientation) {
  const labels: Record<ExifOrientation, string> = {
    1: "none",
    2: "horizontal mirror",
    3: "180°",
    4: "vertical mirror",
    5: "90° clockwise + mirror",
    6: "90° clockwise",
    7: "90° counter-clockwise + mirror",
    8: "90° counter-clockwise",
  };
  return labels[orientation];
}

async function decodeForNormalization(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "none" });
      return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, decoderAppliedOrientation: false, close: () => bitmap.close() };
    } catch {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, decoderAppliedOrientation: true, close: () => bitmap.close() };
      } catch {
        // The HTML image fallback below is useful for a few Android WebViews.
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.decoding = "async";
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error("This browser could not decode the selected image."));
      candidate.src = url;
    });
    return {
      source: image as CanvasImageSource,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      decoderAppliedOrientation: true,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function devLog(file: File, info: ImageOrientationInfo) {
  if (import.meta.env?.DEV) console.info("[Image orientation]", {
    filename: file.name,
    originalWidth: info.originalWidth,
    originalHeight: info.originalHeight,
    exifOrientation: info.exifOrientation,
    decodedWidth: info.decodedWidth,
    decodedHeight: info.decodedHeight,
    normalizedWidth: info.normalizedWidth,
    normalizedHeight: info.normalizedHeight,
    rotationApplied: info.rotationApplied,
    mirrored: info.mirrored,
    decoderAppliedOrientation: info.decoderAppliedOrientation,
  });
}

async function normalize(file: File): Promise<NormalizedImageResult> {
  const metadata = isJpeg(file)
    ? readJpegMetadata(await file.slice(0, 1024 * 1024).arrayBuffer())
    : { orientation: null };
  const orientation = metadata.orientation ?? 1;
  if (orientation === 1) {
    const info: ImageOrientationInfo = {
      originalWidth: metadata.width,
      originalHeight: metadata.height,
      exifOrientation: metadata.orientation,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
      normalizedWidth: metadata.width,
      normalizedHeight: metadata.height,
      rotationApplied: "none",
      mirrored: false,
      decoderAppliedOrientation: false,
    };
    const result = { file, info };
    devLog(file, info);
    return result;
  }

  const decoded = await decodeForNormalization(file);
  try {
    const dimensionsWereSwapped = orientation >= 5
      && metadata.width != null && metadata.height != null
      && metadata.width !== metadata.height
      && decoded.width === metadata.height && decoded.height === metadata.width;
    const decoderAppliedOrientation = decoded.decoderAppliedOrientation || dimensionsWereSwapped;
    const transform = orientationTransform(decoderAppliedOrientation ? 1 : orientation, decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, transform.outputWidth);
    canvas.height = Math.max(1, transform.outputHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not normalize the image orientation.");
    context.setTransform(...transform.matrix);
    context.drawImage(decoded.source, 0, 0);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("This browser could not save the upright image.")),
      "image/jpeg",
      0.96,
    ));
    const normalizedFile = new File([blob], file.name || `normalized-${Date.now()}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
    const info: ImageOrientationInfo = {
      originalWidth: metadata.width,
      originalHeight: metadata.height,
      exifOrientation: metadata.orientation,
      decodedWidth: decoded.width,
      decodedHeight: decoded.height,
      normalizedWidth: canvas.width,
      normalizedHeight: canvas.height,
      rotationApplied: `${orientationDescription(orientation)}${decoderAppliedOrientation ? " (during decode)" : ""}`,
      mirrored: orientationTransform(orientation, decoded.width, decoded.height).mirrored,
      decoderAppliedOrientation,
    };
    const result = { file: normalizedFile, info };
    normalizationCache.set(normalizedFile, Promise.resolve(result));
    devLog(file, info);
    canvas.width = 1;
    canvas.height = 1;
    return result;
  } finally {
    decoded.close();
  }
}

export function normalizeImageOrientationWithInfo(file: File) {
  const cached = normalizationCache.get(file);
  if (cached) return cached;
  const pending = normalize(file).catch((error) => {
    normalizationCache.delete(file);
    throw error;
  });
  normalizationCache.set(file, pending);
  return pending;
}

export async function normalizeImageOrientation(file: File) {
  return (await normalizeImageOrientationWithInfo(file)).file;
}
