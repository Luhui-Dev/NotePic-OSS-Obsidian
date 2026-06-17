// High-quality image compression that mirrors notepic_oss/compressor.py:
//   - JPEG / WebP via Canvas (re-encode at the configured quality)
//   - PNG: quality 100 -> lossless deflate re-encode; quality < 100 -> UPNG.js
//     quantization to a 256-color palette (alpha preserved). See PROTOCOL.md
//     §4.1 — the 100-vs-<100 lossless/quantized split must match the CLI's
//     Image.quantize(..., method=FASTOCTREE) behavior exactly, even though the
//     two quantizers don't need to produce identical bytes.
//   - Unknown-but-decodable formats: fall back to PNG (via the same path as
//     above) when the decoded pixels actually carry transparency, otherwise
//     flatten to JPEG. This mirrors the CLI checking PIL's image mode
//     (RGBA/LA/P implies alpha) — see PROTOCOL.md §4.1.
//   - GIF / SVG / BMP / ICO / TIFF / animated images passthrough
//
// All work happens in the Electron renderer using the DOM Image / OffscreenCanvas
// APIs — no native modules, no postinstall.

import UPNG from "upng-js";

export interface CompressResult {
  bytes: Uint8Array;
  ext: string; // canonical lowercase, e.g. ".jpg"
}

const SKIP_EXTS = new Set([".gif", ".svg", ".bmp", ".ico", ".tif", ".tiff"]);

function normaliseExt(ext: string): string {
  let e = (ext || "").toLowerCase();
  if (!e.startsWith(".")) e = "." + e;
  if (e === ".jpeg") e = ".jpg";
  return e;
}

function mimeFor(ext: string): string {
  switch (ext) {
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".avif": return "image/avif";
    default: return "application/octet-stream";
  }
}

async function decodeBitmap(bytes: Uint8Array, ext: string): Promise<ImageBitmap | null> {
  try {
    const blob = new Blob([bytes as BlobPart], { type: mimeFor(ext) });
    // imageOrientation: 'from-image' applies the EXIF rotation flag, matching
    // ImageOps.exif_transpose() in the Python implementation.
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}

async function encodeViaCanvas(
  bitmap: ImageBitmap,
  type: "image/jpeg" | "image/webp",
  quality: number,
  flatten: boolean,
): Promise<Uint8Array | null> {
  // Use OffscreenCanvas when available (it works off the main thread and is
  // present in modern Electron). Fall back to a detached <canvas>.
  let blob: Blob | null = null;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (flatten) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, bitmap.width, bitmap.height); }
    ctx.drawImage(bitmap, 0, 0);
    blob = await canvas.convertToBlob({ type, quality: quality / 100 });
  } else {
    const canvas = activeDocument.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (flatten) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, bitmap.width, bitmap.height); }
    ctx.drawImage(bitmap, 0, 0);
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality / 100),
    );
  }
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

function getImageData(bitmap: ImageBitmap): ImageData | null {
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  } else {
    canvas = activeDocument.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  const ctx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/** True if any decoded pixel has alpha < 255 — mirrors PIL mode RGBA/LA/P detection. */
function hasTransparency(imageData: ImageData): boolean {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

/**
 * Encode raw pixels as PNG: quality 100 -> lossless (UPNG cnum=0), otherwise
 * quantized to a 256-color palette (UPNG cnum=256) — see PROTOCOL.md §4.1.
 */
function encodePngFromImageData(imageData: ImageData, quality: number): Uint8Array | null {
  const cnum = quality >= 100 ? 0 : 256;
  try {
    const ab: ArrayBuffer = UPNG.encode([imageData.data.buffer], imageData.width, imageData.height, cnum);
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

/** Compress an image. Returns the smaller of (compressed, original). */
export async function compressImage(
  bytes: Uint8Array,
  extIn: string,
  quality: number,
): Promise<CompressResult> {
  const ext = normaliseExt(extIn);
  if (SKIP_EXTS.has(ext)) return { bytes, ext };

  const bitmap = await decodeBitmap(bytes, ext);
  if (!bitmap) return { bytes, ext };

  try {
    if (ext === ".jpg") {
      const enc = await encodeViaCanvas(bitmap, "image/jpeg", quality, true);
      if (enc && enc.length < bytes.length) return { bytes: enc, ext: ".jpg" };
      return { bytes, ext: ".jpg" };
    }
    if (ext === ".webp") {
      const enc = await encodeViaCanvas(bitmap, "image/webp", quality, false);
      if (enc && enc.length < bytes.length) return { bytes: enc, ext: ".webp" };
      return { bytes, ext: ".webp" };
    }
    if (ext === ".png") {
      const imageData = getImageData(bitmap);
      if (!imageData) return { bytes, ext: ".png" };
      const enc = encodePngFromImageData(imageData, quality);
      if (enc && enc.length < bytes.length) return { bytes: enc, ext: ".png" };
      return { bytes, ext: ".png" };
    }
    // Unknown but decodable: images with transparency fall back to PNG
    // (lossless/quantized per `quality`, same as the .png branch above);
    // everything else flattens to JPEG. Mirrors the CLI's PIL-mode check.
    const imageData = getImageData(bitmap);
    if (imageData && hasTransparency(imageData)) {
      const enc = encodePngFromImageData(imageData, quality);
      if (enc && enc.length < bytes.length) return { bytes: enc, ext: ".png" };
      return { bytes, ext: ".png" };
    }
    const enc = await encodeViaCanvas(bitmap, "image/jpeg", quality, true);
    if (enc && enc.length < bytes.length) return { bytes: enc, ext: ".jpg" };
    return { bytes, ext };
  } finally {
    bitmap.close?.();
  }
}
