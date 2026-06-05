// Resolve an ImageRef.rawUrl to a concrete vault TFile (for local references)
// or classify it as remote / skipped. This is the only module that talks to the
// Obsidian metadataCache + vault APIs.

import { App, TFile, normalizePath } from "obsidian";
import type { ImageRef } from "./scanner";
import { extractExt } from "./regex";

export type SkipReason =
  | "empty"
  | "dataUri"
  | "anchor"
  | "mailto"
  | "obsidianUrl"
  | "absFsPath";

export type ResolveResult =
  | { status: "local"; file: TFile }
  | { status: "remote"; url: string }
  | { status: "skip"; reason: SkipReason }
  | { status: "missing"; raw: string };

function stripFragmentAndQuery(url: string): string {
  return url.split("#", 1)[0].split("?", 1)[0];
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export class Resolver {
  constructor(private readonly app: App, private readonly sourcePath: string) {}

  resolve(ref: ImageRef): ResolveResult {
    const raw = (ref.rawUrl || "").trim();
    if (!raw) return { status: "skip", reason: "empty" };

    // Trivial skips
    if (raw.startsWith("data:")) return { status: "skip", reason: "dataUri" };
    if (raw.startsWith("#")) return { status: "skip", reason: "anchor" };
    if (raw.startsWith("mailto:")) return { status: "skip", reason: "mailto" };
    if (raw.startsWith("app://local/") || raw.startsWith("capacitor://")) {
      return { status: "skip", reason: "obsidianUrl" };
    }

    // Remote
    if (/^https?:\/\//i.test(raw)) return { status: "remote", url: raw };

    // Wikilinks: Obsidian's own linkpath resolution does the right thing
    // (it honours the user's attachment folder setting and disambiguates).
    if (ref.kind === "wikilink") {
      const cleaned = safeDecode(raw.split("#", 1)[0]);
      const file = this.app.metadataCache.getFirstLinkpathDest(cleaned, this.sourcePath);
      if (file && extractExt(file.path)) return { status: "local", file };
      return { status: "missing", raw };
    }

    // Markdown / HTML / ref-style: treat raw as a vault path.
    // Strip <angle brackets> around the URL just in case the regex preserved them.
    let p = raw;
    if (p.startsWith("<") && p.endsWith(">")) p = p.slice(1, -1);
    p = safeDecode(stripFragmentAndQuery(p));

    // Absolute filesystem paths (rare in Obsidian notes) — skip; we can't
    // upload arbitrary filesystem files via the vault adapter safely.
    if (/^([a-zA-Z]:)?[/\\]/.test(p) && !p.startsWith("/")) {
      return { status: "skip", reason: "absFsPath" };
    }
    // Leading-slash means "from vault root" in Obsidian's convention.
    if (p.startsWith("/")) p = p.slice(1);

    // Try relative-to-note first, then vault-root.
    const noteDir = this.sourcePath.includes("/")
      ? this.sourcePath.slice(0, this.sourcePath.lastIndexOf("/"))
      : "";
    const candidates: string[] = [];
    if (noteDir) candidates.push(normalizePath(`${noteDir}/${p}`));
    candidates.push(normalizePath(p));

    for (const c of candidates) {
      const f = this.app.vault.getAbstractFileByPath(c);
      if (f instanceof TFile) return { status: "local", file: f };
    }

    // Fallback: ask metadataCache to do a vault-wide filename lookup like Obsidian
    // does for wiki links. This catches the common case of `![](Pasted image X.png)`
    // written with a bare filename but the file living in the attachments folder.
    const file = this.app.metadataCache.getFirstLinkpathDest(p, this.sourcePath);
    if (file) return { status: "local", file };

    return { status: "missing", raw };
  }
}
