import { App, requestUrl } from "obsidian";
import type { ScannedItem } from "./pipeline";
import { t } from "../i18n";

export interface DownloadResult {
  item: ScannedItem;
  status: "downloaded" | "failed";
  path?: string;
  reason?: string;
}

interface FileWriter {
  exists(path: string): Promise<boolean>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

function filenameFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    return name || "image";
  } catch {
    return "image";
  }
}

async function uniquePath(folder: string, filename: string, writer: FileWriter): Promise<string> {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let index = 0; ; index++) {
    const candidate = `${folder}/${index === 0 ? filename : `${base} (${index})${ext}`}`;
    if (!(await writer.exists(candidate))) return candidate;
  }
}

function getFileWriter(): FileWriter {
  const desktopRequire = (window as unknown as { require?: (id: string) => unknown }).require;
  if (!desktopRequire) throw new Error(t().download.desktopOnly);
  const fs = desktopRequire("fs/promises") as {
    access(path: string): Promise<void>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
  };
  return {
    async exists(path: string): Promise<boolean> {
      try { await fs.access(path); return true; } catch { return false; }
    },
    write: (path, bytes) => fs.writeFile(path, bytes),
  };
}

async function readRemote(url: string): Promise<Uint8Array> {
  const response = await requestUrl({ url, throw: false });
  if (response.status < 200 || response.status >= 300) throw new Error(t().reason.httpError(response.status));
  return new Uint8Array(response.arrayBuffer);
}

/** Save selected local and remote note images into a user-selected disk folder. */
export async function downloadSelected(
  app: App,
  selected: ScannedItem[],
  folder: string,
  onProgress?: (done: number, total: number, current?: string) => void,
): Promise<DownloadResult[]> {
  const writer = getFileWriter();
  const results: DownloadResult[] = [];
  let done = 0;
  for (const item of selected) {
    try {
      const { resolved } = item;
      let filename: string;
      let bytes: Uint8Array;
      if (resolved.status === "local") {
        filename = resolved.file.name;
        bytes = new Uint8Array(await app.vault.readBinary(resolved.file));
      } else if (resolved.status === "remote") {
        filename = filenameFromUrl(resolved.url);
        bytes = await readRemote(resolved.url);
      } else {
        throw new Error(t().download.imageUnavailable);
      }
      const path = await uniquePath(folder, filename, writer);
      await writer.write(path, bytes);
      results.push({ item, status: "downloaded", path });
    } catch (error) {
      results.push({
        item,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      done++;
      onProgress?.(done, selected.length, item.ref.rawUrl);
    }
  }
  return results;
}

export function pickDownloadFolder(): Promise<string | null> {
  const desktopRequire = (window as unknown as { require?: (id: string) => unknown }).require;
  if (!desktopRequire) return Promise.reject(new Error(t().download.desktopOnly));
  const electron = desktopRequire("electron") as { remote?: { dialog?: ElectronDialog } };
  let dialog = electron.remote?.dialog;
  if (!dialog) {
    try {
      dialog = (desktopRequire("@electron/remote") as { dialog?: ElectronDialog }).dialog;
    } catch { /* Obsidian may expose Electron remote directly instead. */ }
  }
  if (!dialog) return Promise.reject(new Error(t().download.folderPickerUnavailable));
  return dialog.showOpenDialog({
    title: t().download.folderPickerTitle,
    buttonLabel: t().download.folderPickerButton,
    properties: ["openDirectory", "createDirectory"],
  })
    .then((result) => result.canceled ? null : (result.filePaths[0] ?? null));
}

interface ElectronDialog {
  showOpenDialog(options: { title: string; buttonLabel: string; properties: string[] }): Promise<{ canceled: boolean; filePaths: string[] }>;
}
