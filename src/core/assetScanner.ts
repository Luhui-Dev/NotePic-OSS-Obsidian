import { App, TFile } from "obsidian";
import { scanNote } from "./pipeline";
import { IMAGE_EXTS } from "./regex";

export type ImageAssetStatus = "referenced" | "unreferenced";

export interface ImageAssetReference {
  sourcePath: string;
  rawUrl: string;
  kind: string;
}

export interface ImageAsset {
  file: TFile;
  path: string;
  name: string;
  folder: string;
  extension: string;
  size: number;
  status: ImageAssetStatus;
  references: ImageAssetReference[];
}

const NOTE_EXTS = new Set(["md", "mdx", "markdown", "html", "htm"]);
const CANVAS_EXT = "canvas";

function isImageFile(file: TFile): boolean {
  return IMAGE_EXTS.has("." + file.extension.toLowerCase());
}

function isScannableNote(file: TFile): boolean {
  return NOTE_EXTS.has(file.extension.toLowerCase());
}

function isCanvasFile(file: TFile): boolean {
  return file.extension.toLowerCase() === CANVAS_EXT;
}

function folderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export async function scanVaultImageAssets(app: App): Promise<ImageAsset[]> {
  const files = app.vault.getFiles();
  const images = files.filter(isImageFile);
  const imagePaths = new Set(images.map((f) => f.path));
  const refsByPath = new Map<string, ImageAssetReference[]>();

  const addReference = (target: string, reference: ImageAssetReference): void => {
    if (!imagePaths.has(target)) return;
    const refs = refsByPath.get(target) ?? [];
    refs.push(reference);
    refsByPath.set(target, refs);
  };

  for (const note of files.filter(isScannableNote)) {
    const content = await app.vault.cachedRead(note);
    const items = scanNote(app, note, content, { obsidian: true });
    for (const item of items) {
      if (item.resolved.status !== "local") continue;
      const target = item.resolved.file.path;
      addReference(target, {
        sourcePath: note.path,
        rawUrl: item.ref.rawUrl,
        kind: item.ref.kind,
      });
    }
  }

  for (const canvas of files.filter(isCanvasFile)) {
    const content = await app.vault.cachedRead(canvas);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }

    if (!isCanvasData(parsed)) continue;
    for (const node of parsed.nodes) {
      if (!isCanvasFileNode(node)) continue;
      addReference(node.file, {
        sourcePath: canvas.path,
        rawUrl: node.file,
        kind: "canvas-file",
      });
    }
  }

  return images
    .map((file) => {
      const references = refsByPath.get(file.path) ?? [];
      const status: ImageAssetStatus = references.length > 0 ? "referenced" : "unreferenced";
      return {
        file,
        path: file.path,
        name: file.name,
        folder: folderOf(file.path),
        extension: file.extension.toLowerCase(),
        size: file.stat?.size ?? 0,
        status,
        references,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

interface CanvasData {
  nodes: unknown[];
}

interface CanvasFileNode {
  type: "file";
  file: string;
}

function isCanvasData(value: unknown): value is CanvasData {
  return typeof value === "object"
    && value !== null
    && "nodes" in value
    && Array.isArray(value.nodes);
}

function isCanvasFileNode(value: unknown): value is CanvasFileNode {
  return typeof value === "object"
    && value !== null
    && "type" in value
    && value.type === "file"
    && "file" in value
    && typeof value.file === "string";
}
