import { describe, expect, it } from "vitest";
import { App, TFile } from "./_obsidian-stub";
import { Resolver } from "../src/core/resolver";
import type { ImageRef } from "../src/core/scanner";

function makeApp(): { app: App; files: Map<string, TFile>; linkpath: Map<string, TFile> } {
  const files = new Map<string, TFile>();
  const linkpath = new Map<string, TFile>();
  const app = new App();
  app.vault.getAbstractFileByPath = (p: string) => files.get(p) ?? null;
  app.metadataCache.getFirstLinkpathDest = (link: string, _src: string) =>
    linkpath.get(link) ?? null;
  return { app, files, linkpath };
}

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  const slash = path.lastIndexOf("/");
  f.name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = f.name.lastIndexOf(".");
  f.extension = dot >= 0 ? f.name.slice(dot + 1) : "";
  f.basename = dot >= 0 ? f.name.slice(0, dot) : f.name;
  return f;
}

function makeRef(kind: ImageRef["kind"], rawUrl: string): ImageRef {
  return { kind, from: 0, to: 0, originalText: rawUrl, rawUrl };
}

describe("Resolver", () => {
  it("returns remote for http(s) urls", () => {
    const { app } = makeApp();
    const r = new Resolver(app as never, "notes/post.md");
    const result = r.resolve(makeRef("md", "https://example.com/x.png"));
    expect(result).toEqual({ status: "remote", url: "https://example.com/x.png" });
  });

  it("returns skip for data uris and anchors", () => {
    const { app } = makeApp();
    const r = new Resolver(app as never, "notes/post.md");
    expect(r.resolve(makeRef("md", "data:image/png;base64,xx")).status).toBe("skip");
    expect(r.resolve(makeRef("md", "#anchor")).status).toBe("skip");
    expect(r.resolve(makeRef("md", "app://local/abcd.png")).status).toBe("skip");
  });

  it("resolves a relative markdown image to a file in the same dir", () => {
    const { app, files } = makeApp();
    const f = makeFile("notes/images/cover.png");
    files.set("notes/images/cover.png", f);
    const r = new Resolver(app as never, "notes/post.md");
    const result = r.resolve(makeRef("md", "images/cover.png"));
    expect(result.status).toBe("local");
    if (result.status === "local") expect(result.file).toBe(f);
  });

  it("decodes URL-encoded paths before resolving", () => {
    const { app, files } = makeApp();
    const f = makeFile("notes/中文 image.png");
    files.set("notes/中文 image.png", f);
    const r = new Resolver(app as never, "notes/post.md");
    const result = r.resolve(makeRef("md", "%E4%B8%AD%E6%96%87%20image.png"));
    expect(result.status).toBe("local");
  });

  it("strips #anchor and ?query before lookup", () => {
    const { app, files } = makeApp();
    const f = makeFile("notes/x.png");
    files.set("notes/x.png", f);
    const r = new Resolver(app as never, "notes/post.md");
    expect(r.resolve(makeRef("md", "x.png#frag")).status).toBe("local");
    expect(r.resolve(makeRef("md", "x.png?w=300")).status).toBe("local");
  });

  it("falls back to metadataCache linkpath when no relative file exists", () => {
    const { app, linkpath } = makeApp();
    const f = makeFile("_附件/Pasted image 1.png");
    linkpath.set("Pasted image 1.png", f);
    const r = new Resolver(app as never, "notes/post.md");
    const result = r.resolve(makeRef("md", "Pasted image 1.png"));
    expect(result.status).toBe("local");
  });

  it("resolves wikilinks via metadataCache.getFirstLinkpathDest", () => {
    const { app, linkpath } = makeApp();
    const f = makeFile("_附件/screenshot.png");
    linkpath.set("screenshot.png", f);
    const r = new Resolver(app as never, "notes/post.md");
    const result = r.resolve(makeRef("wikilink", "screenshot.png"));
    expect(result.status).toBe("local");
  });

  it("reports missing when nothing matches", () => {
    const { app } = makeApp();
    const r = new Resolver(app as never, "notes/post.md");
    const result = r.resolve(makeRef("wikilink", "ghost.png"));
    expect(result.status).toBe("missing");
  });
});
