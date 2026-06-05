// Given an ImageRef and a new URL, return the text that should replace
// originalText. Pure function — no IO, no Obsidian API.

import type { ImageRef } from "./scanner";
import { HTML_SRC_RE } from "./regex";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function rewriteRef(ref: ImageRef, newUrl: string): string {
  switch (ref.kind) {
    case "md": {
      const alt = ref.alt ?? "";
      if (ref.title != null) {
        const q = ref.titleQuote || '"';
        return `![${alt}](${newUrl} ${q}${ref.title}${q})`;
      }
      return `![${alt}](${newUrl})`;
    }
    case "html": {
      const orig = ref.originalText;
      // Replace just the first src="..."/src='...' value; leave other attrs alone.
      const replaced = orig.replace(HTML_SRC_RE, (_match, _g1) => `src="${newUrl}"`);
      return replaced;
    }
    case "ref": {
      // Reconstruct: <indent>[label]: <url><rest>
      return `${ref.refIndent ?? ""}[${ref.refLabel ?? ""}]: ${newUrl}${ref.refRest ?? ""}`;
    }
    case "wikilink": {
      const alt = ref.wikiAlt ?? "";
      const size = ref.wikiSize;
      if (size) {
        let dims = "";
        if (size.includes("x")) {
          const [w, h] = size.split("x");
          dims = ` width="${w}" height="${h}"`;
        } else {
          dims = ` width="${size}"`;
        }
        return `<img src="${newUrl}" alt="${escapeHtml(alt)}"${dims} />`;
      }
      return `![${alt}](${newUrl})`;
    }
  }
}
