/// <reference lib="webworker" />

type Point = { x: number; y: number };
type DetectRequest = { id: number; type: "detect"; buffer: ArrayBuffer; mimeType: string };
type CropRequest = { id: number; type: "crop"; buffer: ArrayBuffer; mimeType: string; corners: Point[]; maxLongEdge: number };
type RequestMessage = DetectRequest | CropRequest;

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))];
}

function median(values: number[]) {
  return percentile(values, 0.5);
}

function lineFit(points: Point[], vertical: boolean) {
  if (points.length < 8) return null;
  const inputs = points.map((point) => vertical ? point.y : point.x);
  const outputs = points.map((point) => vertical ? point.x : point.y);
  const inputMean = inputs.reduce((sum, value) => sum + value, 0) / inputs.length;
  const outputMean = outputs.reduce((sum, value) => sum + value, 0) / outputs.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < inputs.length; index++) {
    numerator += (inputs[index] - inputMean) * (outputs[index] - outputMean);
    denominator += (inputs[index] - inputMean) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  return { slope, intercept: outputMean - slope * inputMean };
}

function intersect(vertical: { slope: number; intercept: number }, horizontal: { slope: number; intercept: number }) {
  const divisor = 1 - vertical.slope * horizontal.slope;
  if (Math.abs(divisor) < 0.001) return null;
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / divisor;
  return { x, y: horizontal.slope * x + horizontal.intercept };
}

function polygonArea(points: Point[]) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(area) / 2;
}

function distance(left: Point, right: Point) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function defaultCorners(width: number, height: number) {
  const marginX = width * 0.08;
  const marginY = height * 0.06;
  return [
    { x: marginX, y: marginY },
    { x: width - marginX, y: marginY },
    { x: width - marginX, y: height - marginY },
    { x: marginX, y: height - marginY },
  ];
}

async function bitmapFrom(buffer: ArrayBuffer, mimeType: string) {
  const blob = new Blob([buffer], { type: mimeType || "image/jpeg" });
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

async function detect(buffer: ArrayBuffer, mimeType: string) {
  const bitmap = await bitmapFrom(buffer, mimeType);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 360 / longest);
    const width = Math.max(48, Math.round(bitmap.width * scale));
    const height = Math.max(48, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image processing is unavailable.");
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const gray = new Float32Array(width * height);
    for (let index = 0; index < gray.length; index++) {
      const offset = index * 4;
      gray[index] = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
    }
    const gradients = new Float32Array(width * height);
    const samples: number[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        const gx = -gray[index - width - 1] + gray[index - width + 1]
          - 2 * gray[index - 1] + 2 * gray[index + 1]
          - gray[index + width - 1] + gray[index + width + 1];
        const gy = -gray[index - width - 1] - 2 * gray[index - width] - gray[index - width + 1]
          + gray[index + width - 1] + 2 * gray[index + width] + gray[index + width + 1];
        const magnitude = Math.hypot(gx, gy);
        gradients[index] = magnitude;
        if ((x + y) % 5 === 0) samples.push(magnitude);
      }
    }
    const threshold = Math.max(42, percentile(samples, 0.84));
    const left: Point[] = [];
    const right: Point[] = [];
    const top: Point[] = [];
    const bottom: Point[] = [];
    const scanVertical = (start: number, end: number, y: number) => {
      let bestX = start;
      let best = 0;
      for (let x = start; x < end; x++) {
        const value = gradients[y * width + x];
        if (value > best) { best = value; bestX = x; }
      }
      return best >= threshold ? { x: bestX, y } : null;
    };
    const scanHorizontal = (start: number, end: number, x: number) => {
      let bestY = start;
      let best = 0;
      for (let y = start; y < end; y++) {
        const value = gradients[y * width + x];
        if (value > best) { best = value; bestY = y; }
      }
      return best >= threshold ? { x, y: bestY } : null;
    };
    for (let y = Math.round(height * 0.04); y < height * 0.96; y += 2) {
      const leftPoint = scanVertical(Math.round(width * 0.02), Math.round(width * 0.49), y);
      const rightPoint = scanVertical(Math.round(width * 0.51), Math.round(width * 0.98), y);
      if (leftPoint) left.push(leftPoint);
      if (rightPoint) right.push(rightPoint);
    }
    for (let x = Math.round(width * 0.04); x < width * 0.96; x += 2) {
      const topPoint = scanHorizontal(Math.round(height * 0.02), Math.round(height * 0.49), x);
      const bottomPoint = scanHorizontal(Math.round(height * 0.51), Math.round(height * 0.98), x);
      if (topPoint) top.push(topPoint);
      if (bottomPoint) bottom.push(bottomPoint);
    }
    const filtered = (points: Point[], axis: "x" | "y", tolerance: number) => {
      const center = median(points.map((point) => point[axis]));
      return points.filter((point) => Math.abs(point[axis] - center) <= tolerance);
    };
    const leftLine = lineFit(filtered(left, "x", width * 0.16), true);
    const rightLine = lineFit(filtered(right, "x", width * 0.16), true);
    const topLine = lineFit(filtered(top, "y", height * 0.16), false);
    const bottomLine = lineFit(filtered(bottom, "y", height * 0.16), false);
    let corners = leftLine && rightLine && topLine && bottomLine
      ? [intersect(leftLine, topLine), intersect(rightLine, topLine), intersect(rightLine, bottomLine), intersect(leftLine, bottomLine)]
      : [];
    if (corners.some((point) => !point || point.x < -width * 0.08 || point.x > width * 1.08 || point.y < -height * 0.08 || point.y > height * 1.08)) corners = [];
    const validCorners = corners.filter((point): point is Point => Boolean(point));
    const areaRatio = validCorners.length === 4 ? polygonArea(validCorners) / (width * height) : 0;
    const measuredWidth = validCorners.length === 4 ? (distance(validCorners[0], validCorners[1]) + distance(validCorners[3], validCorners[2])) / 2 : 0;
    const measuredHeight = validCorners.length === 4 ? (distance(validCorners[0], validCorners[3]) + distance(validCorners[1], validCorners[2])) / 2 : 0;
    const aspect = Math.min(measuredWidth, measuredHeight) / Math.max(measuredWidth, measuredHeight, 1);
    const support = Math.min(1, (left.length + right.length) / Math.max(1, height * 0.7))
      * Math.min(1, (top.length + bottom.length) / Math.max(1, width * 0.7));
    let confidence = Math.max(0, Math.min(1, support * (areaRatio >= 0.16 ? 1 : areaRatio / 0.16) * (aspect >= 0.5 && aspect <= 0.86 ? 1 : 0.45)));
    if (validCorners.length !== 4 || areaRatio < 0.1) {
      corners = defaultCorners(width, height);
      confidence = 0;
    }
    let ordered = corners as Point[];
    let rotated = false;
    if (measuredWidth > measuredHeight && confidence >= 0.35) {
      ordered = [ordered[3], ordered[0], ordered[1], ordered[2]];
      rotated = true;
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      confidence,
      rotated,
      corners: ordered.map((point) => ({ x: point.x / width, y: point.y / height })),
    };
  } finally {
    bitmap.close();
  }
}

function solve(matrix: number[][], values: number[]) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-8) throw new Error("The selected crop is not valid.");
    for (let cell = column; cell <= size; cell++) augmented[column][cell] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cell = column; cell <= size; cell++) augmented[row][cell] -= factor * augmented[column][cell];
    }
  }
  return augmented.map((row) => row[size]);
}

function homography(destination: Point[], source: Point[]) {
  const matrix: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index++) {
    const { x, y } = destination[index];
    const { x: u, y: v } = source[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  return solve(matrix, values);
}

async function crop(buffer: ArrayBuffer, mimeType: string, normalizedCorners: Point[], maxLongEdge: number) {
  const bitmap = await bitmapFrom(buffer, mimeType);
  try {
    if (normalizedCorners.length !== 4) throw new Error("Four crop corners are required.");
    const sourceCorners = normalizedCorners.map((point) => ({
      x: Math.max(0, Math.min(bitmap.width - 1, point.x * bitmap.width)),
      y: Math.max(0, Math.min(bitmap.height - 1, point.y * bitmap.height)),
    }));
    const measuredWidth = (distance(sourceCorners[0], sourceCorners[1]) + distance(sourceCorners[3], sourceCorners[2])) / 2;
    const measuredHeight = (distance(sourceCorners[0], sourceCorners[3]) + distance(sourceCorners[1], sourceCorners[2])) / 2;
    const portraitWidth = measuredWidth > measuredHeight ? measuredHeight : measuredWidth;
    const scale = Math.min(1, maxLongEdge / Math.max(1, portraitWidth * 1.4));
    const outputWidth = Math.max(320, Math.round(portraitWidth * scale));
    const outputHeight = Math.max(448, Math.round(outputWidth * 1.4));
    const sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) throw new Error("Image processing is unavailable.");
    sourceContext.drawImage(bitmap, 0, 0);
    const source = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    const destinationCorners = [
      { x: 0, y: 0 },
      { x: outputWidth - 1, y: 0 },
      { x: outputWidth - 1, y: outputHeight - 1 },
      { x: 0, y: outputHeight - 1 },
    ];
    const transform = homography(destinationCorners, sourceCorners);
    for (let y = 0; y < outputHeight; y++) {
      for (let x = 0; x < outputWidth; x++) {
        const denominator = transform[6] * x + transform[7] * y + 1;
        const sourceX = Math.max(0, Math.min(bitmap.width - 1, Math.round((transform[0] * x + transform[1] * y + transform[2]) / denominator)));
        const sourceY = Math.max(0, Math.min(bitmap.height - 1, Math.round((transform[3] * x + transform[4] * y + transform[5]) / denominator)));
        const from = (sourceY * bitmap.width + sourceX) * 4;
        const to = (y * outputWidth + x) * 4;
        output[to] = source[from];
        output[to + 1] = source[from + 1];
        output[to + 2] = source[from + 2];
        output[to + 3] = 255;
      }
    }
    const outputCanvas = new OffscreenCanvas(outputWidth, outputHeight);
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) throw new Error("Image processing is unavailable.");
    outputContext.putImageData(new ImageData(output, outputWidth, outputHeight), 0, 0);
    const blob = await outputCanvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return { buffer: await blob.arrayBuffer(), width: outputWidth, height: outputHeight };
  } finally {
    bitmap.close();
  }
}

workerScope.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const request = event.data;
  try {
    if (request.type === "detect") {
      workerScope.postMessage({ id: request.id, ok: true, result: await detect(request.buffer, request.mimeType) });
      return;
    }
    const result = await crop(request.buffer, request.mimeType, request.corners, request.maxLongEdge);
    workerScope.postMessage({ id: request.id, ok: true, result }, [result.buffer]);
  } catch (error) {
    workerScope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : "Image processing failed." });
  }
};

