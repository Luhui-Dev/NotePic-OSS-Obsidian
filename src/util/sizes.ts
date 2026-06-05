// Collect on-disk byte sizes for the local files referenced by a list of
// scanned items. Best-effort: any stat failure is silently dropped. Remote /
// missing / skip items are not probed (no network here).

import { App } from "obsidian";
import type { ScannedItem } from "../core/pipeline";

export async function collectSizes(
  app: App,
  items: ScannedItem[],
): Promise<Map<ScannedItem, number>> {
  const sizes = new Map<ScannedItem, number>();
  await Promise.all(items.map(async (it) => {
    if (it.resolved.status === "local") {
      try {
        const stat = await app.vault.adapter.stat(it.resolved.file.path);
        if (stat && typeof stat.size === "number") sizes.set(it, stat.size);
      } catch {
        /* ignore */
      }
    }
  }));
  return sizes;
}

/** Format a byte count as a human-friendly string. */
export function fmtSize(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v} ${units[i]}` : `${v.toFixed(1)} ${units[i]}`;
}
