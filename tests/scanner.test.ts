import { describe, expect, it } from "vitest";
import { scan } from "../src/core/scanner";

const opt = { obsidian: true };

describe("scanner", () => {
  it("finds plain markdown images", () => {
    const refs = scan("hello ![cover](./cover.png) world", opt);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "md", rawUrl: "./cover.png", alt: "cover",
    });
  });

  it("preserves title in markdown images", () => {
    const refs = scan('![a](./x.png "the title")', opt);
    expect(refs[0]).toMatchObject({ kind: "md", title: "the title", titleQuote: '"' });
  });

  it("recognises Obsidian wikilinks with size pipe", () => {
    const src = "![[Pasted image 20250514.png|400x200]]";
    const refs = scan(src, opt);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "wikilink",
      rawUrl: "Pasted image 20250514.png",
      wikiSize: "400x200",
      wikiAlt: "",
    });
  });

  it("ignores wikilinks to non-image targets", () => {
    expect(scan("![[some-note]]", opt)).toHaveLength(0);
  });

  it("treats both pipe orderings the same (size first vs alt first)", () => {
    const a = scan("![[x.png|alt|400]]", opt);
    const b = scan("![[x.png|400|alt]]", opt);
    expect(a[0].wikiSize).toBe("400");
    expect(a[0].wikiAlt).toBe("alt");
    expect(b[0].wikiSize).toBe("400");
    expect(b[0].wikiAlt).toBe("alt");
  });

  it("skips images inside fenced code blocks", () => {
    const src = "```\n![alt](./not.png)\n```\nbut ![alt](./yes.png) here";
    const refs = scan(src, opt);
    expect(refs).toHaveLength(1);
    expect(refs[0].rawUrl).toBe("./yes.png");
  });

  it("skips images inside inline code", () => {
    const src = "use `![alt](./inside.png)` but ![alt](./outside.png) too";
    const refs = scan(src, opt);
    expect(refs.map((r) => r.rawUrl)).toEqual(["./outside.png"]);
  });

  it("finds <img> tags including JSX self-closing", () => {
    const refs = scan('<img src="./a.png" /><img src="./b.png">', opt);
    expect(refs.map((r) => r.rawUrl)).toEqual(["./a.png", "./b.png"]);
  });

  it("ignores <img src={expr}> (JSX expression)", () => {
    const refs = scan("<img src={foo} />", opt);
    expect(refs).toHaveLength(0);
  });

  it("finds reference-style image defs only for image extensions", () => {
    const src = "[img]: ./pic.png\n[doc]: ./paper.pdf";
    const refs = scan(src, opt);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "ref", rawUrl: "./pic.png", refLabel: "img" });
  });

  it("handles markdown images with angle-bracketed URL", () => {
    const refs = scan("![spaces](<./has spaces.png>)", opt);
    expect(refs).toHaveLength(1);
    expect(refs[0].rawUrl).toBe("./has spaces.png");
  });

  it("returns refs in source order", () => {
    const src = "![[a.png]] ![b](./b.png) <img src='c.webp'>";
    const refs = scan(src, opt);
    expect(refs.map((r) => r.rawUrl)).toEqual(["a.png", "./b.png", "c.webp"]);
  });

  it("can disable wikilinks", () => {
    const refs = scan("![[a.png]]", { obsidian: false });
    expect(refs).toHaveLength(0);
  });

  it("recognises Chinese filenames inside wikilinks", () => {
    const refs = scan("![[草稿/封面图 v2.png]]", opt);
    expect(refs).toHaveLength(1);
    expect(refs[0].rawUrl).toBe("草稿/封面图 v2.png");
  });
});
