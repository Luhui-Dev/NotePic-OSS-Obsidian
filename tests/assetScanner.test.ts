import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { scanVaultImageAssets } from "../src/core/assetScanner";

function file(path: string, size = 0): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split("/").pop() ?? path;
  f.basename = f.name.replace(/\.[^.]+$/, "");
  f.extension = (path.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
  f.stat = { size, ctime: 0, mtime: 0 };
  return f;
}

function appWith(files: TFile[], contents: Record<string, string>): App {
  const app = new App();
  app.vault.getFiles = () => files;
  app.vault.cachedRead = async (f: TFile) => contents[f.path] ?? "";
  app.vault.getAbstractFileByPath = (p: string) => files.find((f) => f.path === p) ?? null;
  app.metadataCache.getFirstLinkpathDest = (link: string, _src: string) => {
    const byPath = files.find((f) => f.path === link);
    if (byPath) return byPath;
    return files.find((f) => f.name === link) ?? null;
  };
  return app;
}

describe("scanVaultImageAssets", () => {
  it("classifies vault images by supported local reference syntax", async () => {
    const files = [
      file("notes/a.md"),
      file("notes/b.md"),
      file("notes/c.html"),
      file("assets/wiki.png", 10),
      file("notes/md.jpg", 20),
      file("assets/html.webp", 30),
      file("assets/ref.svg", 40),
      file("assets/unused.avif", 50),
      file("assets/not-image.pdf", 60),
    ];
    const app = appWith(files, {
      "notes/a.md": [
        "![[assets/wiki.png]]",
        "![alt](md.jpg)",
        "[logo]: ../assets/ref.svg",
      ].join("\n"),
      "notes/b.md": '<img src="../assets/html.webp">',
      "notes/c.html": '<img src="../assets/html.webp">',
    });

    const assets = await scanVaultImageAssets(app);
    expect(assets.map((a) => a.path)).toEqual([
      "assets/html.webp",
      "assets/ref.svg",
      "assets/unused.avif",
      "assets/wiki.png",
      "notes/md.jpg",
    ]);
    expect(assets.find((a) => a.path === "assets/unused.avif")?.status).toBe("unreferenced");
    expect(assets.find((a) => a.path === "assets/wiki.png")?.references).toHaveLength(1);
    expect(assets.find((a) => a.path === "notes/md.jpg")?.references[0].rawUrl).toBe("md.jpg");
    expect(assets.find((a) => a.path === "assets/html.webp")?.references).toHaveLength(2);
  });
});
