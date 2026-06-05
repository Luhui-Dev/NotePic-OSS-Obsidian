import { describe, expect, it } from "vitest";
import { rewriteRef } from "../src/core/rewriter";
import type { ImageRef } from "../src/core/scanner";

const NEW = "https://cdn.example.com/md/deadbeef.jpg";

function mdRef(extra: Partial<ImageRef> = {}): ImageRef {
  return {
    kind: "md", from: 0, to: 0,
    originalText: "![cover](./cover.png)",
    rawUrl: "./cover.png", alt: "cover",
    ...extra,
  };
}

describe("rewriter", () => {
  it("rewrites a basic markdown image", () => {
    expect(rewriteRef(mdRef(), NEW)).toBe(`![cover](${NEW})`);
  });

  it("preserves the markdown title with original quote style", () => {
    const r = mdRef({ title: "the title", titleQuote: "'" });
    expect(rewriteRef(r, NEW)).toBe(`![cover](${NEW} 'the title')`);
  });

  it("rewrites reference-style definitions preserving indent + label + rest", () => {
    const r: ImageRef = {
      kind: "ref", from: 0, to: 0,
      originalText: "  [img]: ./pic.png  \"title\"",
      rawUrl: "./pic.png",
      refLabel: "img",
      refIndent: "  ",
      refRest: "  \"title\"",
    };
    expect(rewriteRef(r, NEW)).toBe(`  [img]: ${NEW}  \"title\"`);
  });

  it("rewrites <img> tags by substituting just src", () => {
    const r: ImageRef = {
      kind: "html", from: 0, to: 0,
      originalText: '<img class="hero" src="./a.png" alt="A" />',
      rawUrl: "./a.png",
    };
    expect(rewriteRef(r, NEW)).toBe(
      `<img class="hero" src="${NEW}" alt="A" />`,
    );
  });

  it("wikilink without size emits standard ![]()", () => {
    const r: ImageRef = {
      kind: "wikilink", from: 0, to: 0,
      originalText: "![[a.png]]", rawUrl: "a.png",
      wikiAlt: "", wikiSize: undefined,
    };
    expect(rewriteRef(r, NEW)).toBe(`![](${NEW})`);
  });

  it("wikilink with width|height emits <img width height />", () => {
    const r: ImageRef = {
      kind: "wikilink", from: 0, to: 0,
      originalText: "![[a.png|400x200]]", rawUrl: "a.png",
      wikiAlt: "", wikiSize: "400x200",
    };
    expect(rewriteRef(r, NEW)).toBe(
      `<img src="${NEW}" alt="" width="400" height="200" />`,
    );
  });

  it("wikilink with width-only emits <img width />", () => {
    const r: ImageRef = {
      kind: "wikilink", from: 0, to: 0,
      originalText: "![[a.png|400]]", rawUrl: "a.png",
      wikiAlt: "cover", wikiSize: "400",
    };
    expect(rewriteRef(r, NEW)).toBe(
      `<img src="${NEW}" alt="cover" width="400" />`,
    );
  });

  it("escapes HTML-sensitive characters in alt", () => {
    const r: ImageRef = {
      kind: "wikilink", from: 0, to: 0,
      originalText: '![[a.png|<bad>&"alt|400]]',
      rawUrl: "a.png", wikiAlt: '<bad>&"alt', wikiSize: "400",
    };
    expect(rewriteRef(r, NEW)).toBe(
      `<img src="${NEW}" alt="&lt;bad&gt;&amp;&quot;alt" width="400" />`,
    );
  });
});
