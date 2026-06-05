// Scan a markdown document for every image reference. Returns ImageRef[]
// with absolute byte offsets into the original text, so the pipeline can later
// build an editor.transaction without rescanning.

import {
  HTML_IMG_RE,
  HTML_SKIP_RE,
  HTML_SRC_RE,
  IMAGE_EXTS,
  MD_CODE_RE,
  MD_IMAGE_RE,
  OBSIDIAN_IMAGE_RE,
  OBSIDIAN_SIZE_RE,
  REF_DEF_RE,
  extractExt,
} from "./regex";

export type RefKind = "md" | "html" | "ref" | "wikilink";

export interface ImageRef {
  kind: RefKind;
  // The full text region in the source document that we will replace.
  from: number;
  to: number;
  // What was actually written in the source (used for sanity-check on writeback).
  originalText: string;
  // The raw URL/linkpath value extracted from the syntax. NOT URL-decoded.
  rawUrl: string;
  // Optional context — used by the rewriter to reconstruct the new text.
  alt?: string;
  title?: string;
  titleQuote?: "'" | '"';
  refLabel?: string;
  refIndent?: string;
  refRest?: string;
  // Wikilink-only:
  wikiSize?: string; // "400" or "400x200"
  wikiAlt?: string;
}

interface SkipSpan { start: number; end: number; }

function buildSkipSpans(content: string, skipRe: RegExp): SkipSpan[] {
  const spans: SkipSpan[] = [];
  const re = new RegExp(skipRe.source, skipRe.flags.includes("g") ? skipRe.flags : skipRe.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return spans;
}

function isInsideSpan(spans: SkipSpan[], pos: number): boolean {
  // spans are non-overlapping & sorted by construction
  let lo = 0, hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = spans[mid];
    if (pos < s.start) hi = mid - 1;
    else if (pos >= s.end) lo = mid + 1;
    else return true;
  }
  return false;
}

function findAll(content: string, re: RegExp, skip: SkipSpan[]): ImageRef[] {
  // Caller owns the regex; clone with global flag to walk all matches.
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const r = new RegExp(re.source, flags);
  const out: ImageRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(content)) !== null) {
    if (m[0].length === 0) { r.lastIndex++; continue; }
    if (isInsideSpan(skip, m.index)) continue;
    out.push(matchToRef(m));
  }
  return out;
}

function matchToRef(m: RegExpExecArray): ImageRef {
  // We disambiguate by which regex produced the match via the groups present.
  const g = m.groups || {};
  if ("target" in g) {
    // Obsidian wikilink
    const target = (g.target || "").trim();
    const params = g.params;
    let size: string | undefined;
    const altParts: string[] = [];
    if (params != null) {
      for (const seg of params.split("|")) {
        const s = seg.trim();
        if (s && OBSIDIAN_SIZE_RE.test(s)) size = s;
        else if (s) altParts.push(s);
      }
    }
    return {
      kind: "wikilink",
      from: m.index,
      to: m.index + m[0].length,
      originalText: m[0],
      rawUrl: target,
      wikiSize: size,
      wikiAlt: altParts.join(" "),
    };
  }
  // Markdown image
  return {
    kind: "md",
    from: m.index,
    to: m.index + m[0].length,
    originalText: m[0],
    rawUrl: g.url_a || g.url_b || "",
    alt: g.alt ?? "",
    title: g.title,
    titleQuote: (g.quote as "'" | '"' | undefined) ?? undefined,
  };
}

function findHtmlImgs(content: string, skip: SkipSpan[]): ImageRef[] {
  const r = new RegExp(HTML_IMG_RE.source, "gi");
  const out: ImageRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(content)) !== null) {
    if (m[0].length === 0) { r.lastIndex++; continue; }
    if (isInsideSpan(skip, m.index)) continue;
    const attrs = m[1];
    const srcMatch = HTML_SRC_RE.exec(attrs);
    if (!srcMatch) continue;
    // Region we will replace is the entire <img ...> tag; rewriter substitutes src=.
    out.push({
      kind: "html",
      from: m.index,
      to: m.index + m[0].length,
      originalText: m[0],
      rawUrl: srcMatch[1],
    });
  }
  return out;
}

function findRefDefs(content: string, skip: SkipSpan[]): ImageRef[] {
  const out: ImageRef[] = [];
  let cursor = 0;
  for (const line of content.split("\n")) {
    const lineStart = cursor;
    const lineEnd = cursor + line.length;
    cursor = lineEnd + 1; // +1 for the \n
    if (isInsideSpan(skip, lineStart)) continue;
    const m = REF_DEF_RE.exec(line);
    if (!m) continue;
    const url = m.groups?.url_a || m.groups?.url_b || "";
    // Only treat as image if URL looks like an image extension. (Mirrors the
    // CLI behaviour where _maybe_upload would later filter; we do it eagerly
    // to avoid uploading e.g. PDF refs.)
    if (!IMAGE_EXTS.has(extractExt(url))) continue;
    out.push({
      kind: "ref",
      from: lineStart,
      to: lineEnd,
      originalText: line,
      rawUrl: url,
      refLabel: m.groups?.label ?? "",
      refIndent: m.groups?.indent ?? "",
      refRest: m.groups?.rest ?? "",
    });
  }
  return out;
}

function findWikilinks(content: string, skip: SkipSpan[]): ImageRef[] {
  const r = new RegExp(OBSIDIAN_IMAGE_RE.source, "g");
  const out: ImageRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(content)) !== null) {
    if (m[0].length === 0) { r.lastIndex++; continue; }
    if (isInsideSpan(skip, m.index)) continue;
    const target = (m.groups?.target || "").trim();
    if (!target) continue;
    // Only image extensions; note transclusions like ![[some-note]] are left alone.
    if (!IMAGE_EXTS.has(extractExt(target))) continue;

    const params = m.groups?.params;
    let size: string | undefined;
    const altParts: string[] = [];
    if (params != null) {
      for (const seg of params.split("|")) {
        const s = seg.trim();
        if (s && OBSIDIAN_SIZE_RE.test(s)) size = s;
        else if (s) altParts.push(s);
      }
    }
    out.push({
      kind: "wikilink",
      from: m.index,
      to: m.index + m[0].length,
      originalText: m[0],
      rawUrl: target,
      wikiSize: size,
      wikiAlt: altParts.join(" "),
    });
  }
  return out;
}

function findMdImages(content: string, skip: SkipSpan[]): ImageRef[] {
  const r = new RegExp(MD_IMAGE_RE.source, "g");
  const out: ImageRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(content)) !== null) {
    if (m[0].length === 0) { r.lastIndex++; continue; }
    if (isInsideSpan(skip, m.index)) continue;
    out.push({
      kind: "md",
      from: m.index,
      to: m.index + m[0].length,
      originalText: m[0],
      rawUrl: m.groups?.url_a || m.groups?.url_b || "",
      alt: m.groups?.alt ?? "",
      title: m.groups?.title,
      titleQuote: (m.groups?.quote as "'" | '"' | undefined) ?? undefined,
    });
  }
  return out;
}

export interface ScanOptions {
  obsidian: boolean;
  // When true, treat as HTML/HTM and skip markdown/wikilink/ref passes.
  html?: boolean;
}

/** Scan a document and return all image references in source order. */
export function scan(content: string, opts: ScanOptions): ImageRef[] {
  const skip = buildSkipSpans(content, opts.html ? HTML_SKIP_RE : MD_CODE_RE);

  const refs: ImageRef[] = [];
  if (opts.html) {
    refs.push(...findHtmlImgs(content, skip));
  } else {
    refs.push(...findMdImages(content, skip));
    refs.push(...findHtmlImgs(content, skip));
    refs.push(...findRefDefs(content, skip));
    if (opts.obsidian) refs.push(...findWikilinks(content, skip));
  }

  // Sort by start offset so writeback can iterate front-to-back; we sort
  // here so that overlapping detection below is straightforward.
  refs.sort((a, b) => a.from - b.from);

  // Drop refs that overlap an earlier one (e.g. a wikilink whose region was
  // already claimed). Python's processor ran wikilink last and let the
  // earlier passes win; we replicate that ordering preference.
  const out: ImageRef[] = [];
  let lastEnd = -1;
  for (const r of refs) {
    if (r.from < lastEnd) continue;
    out.push(r);
    lastEnd = r.to;
  }
  return out;
}
