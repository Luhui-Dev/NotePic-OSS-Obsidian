// 1:1 port of the regex constants in notepic_oss/processor.py.
// Keep these as named exports so tests can pin behaviour against the Python fixtures.

// ![alt](url)  or  ![alt](url "title")  or  ![alt](<url with spaces>)
export const MD_IMAGE_RE =
  /!\[(?<alt>[^\]]*)\]\(\s*(?:<(?<url_a>[^>]+)>|(?<url_b>[^\s)]+))(?:\s+(?<quote>["'])(?<title>.*?)\k<quote>)?\s*\)/g;

// <img ...>   — matches both HTML (<img src="x">) and JSX (<img src="x" />)
export const HTML_IMG_RE = /<img\b([^>]*)>/gi;
// Only quoted string values; JSX expressions like src={foo} are left alone.
export const HTML_SRC_RE = /src\s*=\s*["']([^"']+)["']/i;

// [label]: url   or   [label]: <url>   ...optional "title"
// Note: this one is matched per-line, not via .matchAll on the whole doc.
export const REF_DEF_RE =
  /^(?<indent>\s{0,3})\[(?<label>[^\]]+)\]:\s*(?:<(?<url_a>[^>]+)>|(?<url_b>\S+))(?<rest>.*)$/;

// Obsidian wikilink image embed:
//   ![[image.png]]
//   ![[image.png|alt]]            (or  ![[image.png|400]] / 400x200)
//   ![[image.png|alt|400x200]]    (pipe segments in either order)
export const OBSIDIAN_IMAGE_RE = /!\[\[(?<target>[^\]|]+?)(?:\|(?<params>[^\]]*))?\]\]/g;

// Size token inside an Obsidian wikilink pipe segment: "400" or "400x200".
export const OBSIDIAN_SIZE_RE = /^\d+(?:x\d+)?$/;

// Extensions we treat as images. Non-image wikilinks (e.g. ![[some-note]])
// are left untouched so note-transclusions don't get uploaded by accident.
export const IMAGE_EXTS: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".avif", ".bmp", ".tif", ".tiff", ".ico",
]);

// Fenced code blocks and inline code in Markdown.
export const MD_CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g;

// Regions in HTML where we must not rewrite anything.
export const HTML_SKIP_RE =
  /<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<pre\b[^>]*>[\s\S]*?<\/pre\s*>|<code\b[^>]*>[\s\S]*?<\/code\s*>|<!--[\s\S]*?-->/gi;

export function extractExt(pathOrUrl: string): string {
  const clean = pathOrUrl.split("#", 1)[0].split("?", 1)[0];
  const idx = clean.lastIndexOf(".");
  if (idx === -1 || idx === clean.length - 1) return "";
  const ext = clean.slice(idx).toLowerCase();
  // Reject things that don't look like an extension (e.g. ".com/foo")
  if (ext.includes("/") || ext.length > 6) return "";
  return ext;
}
