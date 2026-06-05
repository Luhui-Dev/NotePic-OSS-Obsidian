// Orchestrates: scan → resolve → (read bytes + compress + upload) → collect.
// The result is a list of "successful replacements" + a list of failures.
// Editor writeback is done by the caller (UI layer) using the offsets in
// ImageRef.from/to, so the pipeline doesn't depend on any editor instance.

import { App, TFile } from "obsidian";
import type { ImageRef } from "./scanner";
import { scan } from "./scanner";
import { Resolver, ResolveResult } from "./resolver";
import { Uploader } from "./uploader";
import { compressImage } from "./compressor";
import { rewriteRef } from "./rewriter";
import { extractExt } from "./regex";
import { pLimit } from "../util/concurrency";
import { t } from "../i18n";

export interface ScannedItem {
  ref: ImageRef;
  resolved: ResolveResult;
  // Filled in lazily by the UI when it wants to know the on-disk size.
  fileSize?: number;
}

export interface PipelineOptions {
  compress: boolean;
  quality: number;          // 1..100
  processRemote: boolean;
  obsidian: boolean;
  concurrency: number;      // default 3
  signal?: AbortSignal;
}

export interface ItemResult {
  ref: ImageRef;
  status: "uploaded" | "skipped" | "failed";
  newUrl?: string;
  reason?: string;
  originalSize?: number;
  uploadedSize?: number;
}

export interface PipelineResult {
  results: ItemResult[];
  stats: { found: number; uploaded: number; skipped: number; failed: number };
}

/** Scan a note and classify every ImageRef so the UI can show a picker. */
export function scanNote(
  app: App,
  file: TFile,
  content: string,
  opts: { obsidian: boolean },
): ScannedItem[] {
  const refs = scan(content, { obsidian: opts.obsidian, html: isHtml(file) });
  const resolver = new Resolver(app, file.path);
  return refs.map((ref) => ({ ref, resolved: resolver.resolve(ref) }));
}

function isHtml(file: TFile): boolean {
  const e = file.extension.toLowerCase();
  return e === "html" || e === "htm";
}

async function readBytes(app: App, target: TFile): Promise<Uint8Array> {
  const buf = await app.vault.readBinary(target);
  return new Uint8Array(buf);
}

async function fetchRemoteBytes(url: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; ext: string }> {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const ab = await resp.arrayBuffer();
  // Try Content-Type first, fall back to URL ext.
  const ct = resp.headers.get("Content-Type") || "";
  let ext = "";
  if (ct.includes("png")) ext = ".png";
  else if (ct.includes("jpeg") || ct.includes("jpg")) ext = ".jpg";
  else if (ct.includes("webp")) ext = ".webp";
  else if (ct.includes("gif")) ext = ".gif";
  if (!ext) ext = extractExt(new URL(url).pathname) || ".jpg";
  return { bytes: new Uint8Array(ab), ext };
}

/** Upload a selected subset of scanned items. Returns per-item results. */
export async function uploadSelected(
  app: App,
  uploader: Uploader,
  selected: ScannedItem[],
  opts: PipelineOptions,
  onProgress?: (done: number, total: number, current?: string) => void,
): Promise<PipelineResult> {
  const stats = { found: 0, uploaded: 0, skipped: 0, failed: 0 };
  const results: ItemResult[] = [];

  // Pre-classify trivial outcomes before consuming a worker slot.
  const T = t();
  const work: ScannedItem[] = [];
  for (const item of selected) {
    const r = item.resolved;
    if (r.status === "skip") {
      results.push({ ref: item.ref, status: "skipped", reason: T.reason[r.reason] });
      stats.skipped++;
      continue;
    }
    if (r.status === "missing") {
      results.push({ ref: item.ref, status: "failed", reason: T.reason.notFound(r.raw) });
      stats.failed++;
      continue;
    }
    if (r.status === "remote") {
      if (uploader.isOwnUrl(r.url)) {
        results.push({ ref: item.ref, status: "skipped", reason: T.reason.alreadyOss });
        stats.skipped++;
        continue;
      }
      if (!opts.processRemote) {
        results.push({ ref: item.ref, status: "skipped", reason: T.reason.remoteSkip });
        stats.skipped++;
        continue;
      }
    }
    work.push(item);
    stats.found++;
  }

  let done = 0;
  const total = work.length;
  onProgress?.(0, total);
  const limit = pLimit(Math.max(1, opts.concurrency || 3));

  await Promise.all(work.map((item) => limit(async () => {
    if (opts.signal?.aborted) {
      results.push({ ref: item.ref, status: "failed", reason: T.reason.cancelled });
      stats.failed++;
      done++;
      onProgress?.(done, total);
      return;
    }
    const r = item.resolved;
    try {
      let bytes: Uint8Array;
      let ext: string;
      if (r.status === "local") {
        bytes = await readBytes(app, r.file);
        ext = "." + r.file.extension.toLowerCase();
      } else if (r.status === "remote") {
        const fetched = await fetchRemoteBytes(r.url, opts.signal);
        bytes = fetched.bytes;
        ext = fetched.ext;
      } else {
        throw new Error("unreachable");
      }
      const originalSize = bytes.length;
      let outBytes = bytes;
      let outExt = ext;
      if (opts.compress) {
        try {
          const c = await compressImage(bytes, ext, opts.quality);
          outBytes = c.bytes;
          outExt = c.ext;
        } catch {
          // compression is best-effort; fall through with original bytes
        }
      }
      if (opts.signal?.aborted) {
        results.push({ ref: item.ref, status: "failed", reason: "cancelled" });
        stats.failed++;
        return;
      }
      const newUrl = await uploader.upload(outBytes, outExt);
      results.push({
        ref: item.ref,
        status: "uploaded",
        newUrl,
        originalSize,
        uploadedSize: outBytes.length,
      });
      stats.uploaded++;
    } catch (e: unknown) {
      results.push({
        ref: item.ref,
        status: "failed",
        reason: e instanceof Error ? e.message : String(e),
      });
      stats.failed++;
    } finally {
      done++;
      onProgress?.(done, total, item.ref.rawUrl);
    }
  })));

  return { results, stats };
}

/**
 * Apply the upload results to the document text. Returns the new content +
 * the count of replacements that were actually applied. Items whose
 * originalText no longer matches the source at [from, to] are skipped
 * (concurrent-edit protection).
 */
export function applyResults(
  source: string,
  results: ItemResult[],
): { content: string; appliedCount: number; driftedCount: number } {
  // Sort uploaded results by offset descending so we splice without
  // recomputing offsets.
  const applicable = results
    .filter((r) => r.status === "uploaded" && r.newUrl)
    .sort((a, b) => b.ref.from - a.ref.from);

  let content = source;
  let applied = 0;
  let drifted = 0;
  for (const r of applicable) {
    const slice = content.slice(r.ref.from, r.ref.to);
    if (slice !== r.ref.originalText) { drifted++; continue; }
    const replacement = rewriteRef(r.ref, r.newUrl!);
    content = content.slice(0, r.ref.from) + replacement + content.slice(r.ref.to);
    applied++;
  }
  return { content, appliedCount: applied, driftedCount: drifted };
}
