// High-quality image compression that mirrors notepic_oss/compressor.py:
//   - JPEG / WebP via Canvas (re-encode at the configured quality)
//   - PNG via UPNG.js (quantize + deflate; closest to pngquant)
//   - GIF / SVG / BMP / ICO / TIFF / animated images passthrough
//
// All work happens in the Electron renderer using the DOM Image / OffscreenCanvas
// APIs — no native modules, no postinstall.

// upng-js ships as CommonJS without bundled types.
// We declare a minimal shape so esbuild + tsc don't complain.
// @ts-ignore
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
    const canvas = document.createElement("canvas");
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

async function encodePngViaUpng(bitmap: ImageBitmap): Promise<Uint8Array | null> {
  // Get raw RGBA via a canvas.
  let imageData: ImageData;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  }
  // UPNG.encode([rgba], w, h, cnum) — cnum=256 → quantized palette PNG ≈ pngquant.
  // cnum=0 → lossless PNG with deflate. Try quantized first; if no quality loss
  // is preferable, callers can set quality=100 to disable (see compressImage).
  try {
    const ab: ArrayBuffer = UPNG.encode([imageData.data.buffer], imageData.width, imageData.height, 256);
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
      // If user dialled quality up to 100, treat as "no PNG quantization" and
      // just trust the original bytes — encoding via UPNG at cnum=256 is lossy.
      if (quality >= 100) return { bytes, ext: ".png" };
      const enc = await encodePngViaUpng(bitmap);
      if (enc && enc.length < bytes.length) return { bytes: enc, ext: ".png" };
      return { bytes, ext: ".png" };
    }
    // Unknown but decodable: try JPEG flatten as a sensible default for photos.
    const enc = await encodeViaCanvas(bitmap, "image/jpeg", quality, true);
    if (enc && enc.length < bytes.length) return { bytes: enc, ext: ".jpg" };
    return { bytes, ext };
  } finally {
    bitmap.close?.();
  }
}
