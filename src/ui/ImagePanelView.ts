// Persistent right-side panel that lists every image reference in the active
// markdown note. Replaces the older modal-based ImageListModal — same data
// flow, but lives in a workspace leaf so it can be pinned, reopened, and
// tracked against the active file.

import { ItemView, MarkdownView, TFile, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type NotePicOssPlugin from "../main";
import { scanNote, type ScannedItem } from "../core/pipeline";
import { Uploader } from "../core/uploader";
import { buildUploaderConfig } from "../settings";
import { collectSizes, fmtSize } from "../util/sizes";
import { t } from "../i18n";

export const VIEW_TYPE_NOTEPIC_OSS_PANEL = "notepic-oss-panel";

type Filter = "all" | "local" | "pending" | "missing";

const SUPPORTED_EXTS = new Set(["md", "mdx", "markdown", "html", "htm"]);

function isSupported(file: TFile | null): file is TFile {
  if (!file) return false;
  return SUPPORTED_EXTS.has(file.extension.toLowerCase());
}

export class ImagePanelView extends ItemView {
  private currentFile: TFile | null = null;
  private items: ScannedItem[] = [];
  private sizes = new Map<ScannedItem, number>();
  // checked / busyItems are keyed by a *stable* signature (see itemKey) so
  // selection state survives a rescan triggered by metadataCache.
  private checked = new Set<string>();
  private busyItems = new Set<string>();
  private filter: Filter = "all";
  private scanToken = 0;
  // Signature of the last rendered item list — when an incoming rescan has
  // the same signature we skip the DOM rebuild entirely. Avoids flicker when
  // the user is typing prose in a non-image region of the note.
  private lastSignature: string | null = null;
  // We rebuild a fresh Uploader for `isOwnUrl` checks each render. Validation
  // errors don't matter here — incomplete creds just make isOwnUrl return false
  // for everything, which is fine for display purposes.
  private displayUploader: Uploader | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: NotePicOssPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_NOTEPIC_OSS_PANEL; }
  getDisplayText(): string { return t().panel.title; }
  getIcon(): string { return "image-up"; }

  async onOpen(): Promise<void> {
    // Watch active note changes; rescan on switch.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        void this.onActiveFileChange(file);
      }),
    );
    // Live refresh: Obsidian fires metadataCache "changed" after the document
    // has been parsed (it's internally throttled, so this is keystroke-safe).
    // We only react when the change is for the file we're currently showing.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.currentFile || file.path !== this.currentFile.path) return;
        void this.rescan({ resetSelection: false });
      }),
    );
    // Pick up the file that's already open when the panel mounts.
    const active = this.app.workspace.getActiveFile();
    await this.onActiveFileChange(active ?? null);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Public: called by the plugin after an external upload completed for our file. */
  async refresh(): Promise<void> {
    await this.rescan({ resetSelection: false });
  }

  // ---- file tracking ------------------------------------------------------

  private async onActiveFileChange(file: TFile | null): Promise<void> {
    if (file === this.currentFile) return;
    this.currentFile = file;
    this.checked.clear();
    this.busyItems.clear();
    this.lastSignature = null;
    await this.rescan({ resetSelection: true });
  }

  private async rescan(opts: { resetSelection: boolean }): Promise<void> {
    const token = ++this.scanToken;
    this.displayUploader = this.buildDisplayUploader();

    if (!isSupported(this.currentFile)) {
      this.items = [];
      this.sizes = new Map();
      this.lastSignature = null;
      this.render();
      return;
    }

    const file = this.currentFile;
    // Prefer the live editor buffer if the file is currently open.
    const content = await this.readContent(file);
    if (token !== this.scanToken) return;

    const items = scanNote(this.app, file, content, { obsidian: true });
    assignItemKeys(items);
    // Short-circuit: if neither the set of refs nor their resolved status has
    // changed, the displayed list would be byte-identical. Skip the disk
    // stat() round-trip and the DOM rebuild — major win when the user is
    // typing in a region of the note that has no images.
    const signature = computeSignature(items);
    if (signature === this.lastSignature && !opts.resetSelection) {
      return;
    }

    const sizes = await collectSizes(this.app, items);
    if (token !== this.scanToken) return;

    this.items = items;
    this.sizes = sizes;
    this.lastSignature = signature;

    const validKeys = new Set(items.map(itemKey));

    if (opts.resetSelection) {
      // First scan after a file switch — default-check every local item,
      // matching the historical modal UX.
      this.checked.clear();
      for (const it of items) {
        if (it.resolved.status === "local") this.checked.add(itemKey(it));
      }
    } else {
      // Live refresh — preserve the user's manual selection, but drop keys
      // that no longer correspond to any current item.
      for (const k of Array.from(this.checked)) {
        if (!validKeys.has(k)) this.checked.delete(k);
      }
    }
    // Always prune busyItems against current keys (uploads that completed
    // for items now removed from the doc shouldn't keep their spinner).
    for (const k of Array.from(this.busyItems)) {
      if (!validKeys.has(k)) this.busyItems.delete(k);
    }

    this.render();
  }

  private async readContent(file: TFile): Promise<string> {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file?.path === file.path) {
        return v.editor.getValue();
      }
    }
    return this.app.vault.cachedRead(file);
  }

  private buildDisplayUploader(): Uploader | null {
    const s = this.plugin.settings;
    if (!s.accessKeyId || !s.accessKeySecret || !s.endpoint || !s.bucket) {
      return null;
    }
    try {
      return new Uploader(buildUploaderConfig(s));
    } catch {
      return null;
    }
  }

  // ---- rendering ----------------------------------------------------------

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mdoss-panel");

    this.renderHeader(contentEl);

    if (!this.currentFile) {
      this.renderEmpty(contentEl, t().panel.emptyNoFile);
      return;
    }
    if (!isSupported(this.currentFile)) {
      this.renderEmpty(contentEl, t().panel.emptyUnsupported);
      return;
    }
    if (this.items.length === 0) {
      this.renderEmpty(contentEl, t().panel.emptyNoImages);
      return;
    }

    this.renderChips(contentEl);
    const listEl = contentEl.createDiv({ cls: "mdoss-list mdoss-panel-list" });
    this.renderList(listEl);
    this.renderFooter(contentEl);
  }

  private renderHeader(parent: HTMLElement): void {
    const T = t().panel;
    const header = parent.createDiv({ cls: "mdoss-panel-header" });
    const title = header.createDiv({ cls: "mdoss-panel-title" });
    if (this.currentFile && isSupported(this.currentFile)) {
      title.setText(T.titleWithFile(this.currentFile.basename, this.items.length));
    } else {
      title.setText(T.title);
    }

    const actions = header.createDiv({ cls: "mdoss-panel-actions" });
    const refresh = actions.createEl("button", { cls: "clickable-icon mdoss-panel-icon-btn" });
    setIcon(refresh, "refresh-cw");
    setTooltip(refresh, T.refresh);
    refresh.onclick = () => void this.rescan({ resetSelection: false });
  }

  private renderEmpty(parent: HTMLElement, text: string): void {
    parent.createDiv({ cls: "mdoss-panel-empty", text });
  }

  private renderChips(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: "mdoss-modal-header" });
    const M = t().panel;
    const chips: Array<[Filter, string]> = [
      ["all", M.filter_all],
      ["local", M.filter_local],
      ["pending", M.filter_pending],
      ["missing", M.filter_missing],
    ];
    for (const [key, label] of chips) {
      const chip = header.createEl("span", { cls: "mdoss-filter-chip", text: label });
      if (key === this.filter) chip.addClass("is-active");
      chip.onclick = () => {
        this.filter = key;
        this.render();
      };
    }
    const selectAll = header.createEl("a", {
      cls: "mdoss-select-all",
      text: M.toggleVisible,
      href: "#",
    });
    selectAll.onclick = (e) => {
      e.preventDefault();
      const visible = this.visibleItems();
      const allChecked = visible.every((it) => this.checked.has(itemKey(it)));
      for (const it of visible) {
        if (!this.canSelect(it)) continue;
        const k = itemKey(it);
        if (allChecked) this.checked.delete(k);
        else this.checked.add(k);
      }
      this.render();
    };
  }

  private renderList(parent: HTMLElement): void {
    const visible = this.visibleItems();
    if (visible.length === 0) {
      parent.createDiv({
        cls: "mdoss-panel-no-match",
        text: t().panel.noMatch,
      });
      return;
    }
    for (const item of visible) this.renderRow(parent, item);
  }

  private renderRow(parent: HTMLElement, item: ScannedItem): void {
    const row = parent.createDiv({ cls: "mdoss-row mdoss-panel-row" });
    const key = itemKey(item);
    const isBusy = this.busyItems.has(key);
    if (!this.canSelect(item)) row.setAttr("data-disabled", "true");

    // Checkbox
    const cb = row.createEl("input", { type: "checkbox" });
    cb.checked = this.checked.has(key);
    cb.disabled = !this.canSelect(item) || isBusy;
    cb.onchange = () => {
      if (cb.checked) this.checked.add(key);
      else this.checked.delete(key);
      this.updateFooter();
    };

    // Thumbnail
    if (item.resolved.status === "local") {
      const img = row.createEl("img", { cls: "mdoss-thumb mdoss-panel-thumb" });
      img.src = this.app.vault.getResourcePath(item.resolved.file);
      img.loading = "lazy";
    } else {
      const ph = row.createDiv({ cls: "mdoss-thumb-placeholder mdoss-panel-thumb" });
      ph.setText(item.resolved.status === "remote" ? "🌐" : "—");
    }

    // Name + meta
    const meta = row.createDiv({ cls: "mdoss-meta" });
    meta.createDiv({ cls: "mdoss-name", text: item.ref.rawUrl });

    const sub = meta.createDiv({ cls: "mdoss-sub" });
    // Domain line: distinguishes Local→target vs remote host. We deliberately
    // do NOT add an extra OSS pill — the domain string itself already tells
    // the user the file lives on their bucket.
    const domain = describeDomain(item, this.plugin.settings, this.displayUploader);
    sub.createSpan({ cls: "mdoss-panel-domain", text: domain.text });

    const meta2 = meta.createDiv({ cls: "mdoss-sub" });
    meta2.createSpan({ text: kindLabel(item) });
    const size = this.sizes.get(item);
    if (size != null) meta2.createSpan({ text: fmtSize(size) });
    if (item.ref.kind === "wikilink" && item.ref.wikiSize) {
      meta2.createSpan({ text: item.ref.wikiSize });
    }

    // Status badge — one of: 本地 / 云端 / OSS / 缺失 (plus skip for rare cases).
    row.createSpan({
      cls: `mdoss-badge ${badgeClass(item, this.displayUploader)}`,
      text: badgeLabel(item, this.displayUploader),
    });

    // Per-row upload action (only for items that are still pending an upload)
    const actionCell = row.createDiv({ cls: "mdoss-panel-row-action" });
    if (this.canSelect(item) && !isOwnRemote(item, this.displayUploader)) {
      const btn = actionCell.createEl("button", { cls: "clickable-icon mdoss-panel-icon-btn" });
      setIcon(btn, isBusy ? "loader" : "upload");
      setTooltip(btn, isBusy ? t().panel.uploadingRow : t().panel.uploadRow);
      btn.disabled = isBusy;
      btn.onclick = () => void this.uploadSingle(item);
    }
  }

  private renderFooter(parent: HTMLElement): void {
    const footer = parent.createDiv({ cls: "mdoss-footer mdoss-panel-footer" });
    const counter = footer.createSpan({ cls: "mdoss-panel-counter", text: "" });
    const go = footer.createEl("button", { text: "" });
    go.addClass("mod-cta");
    go.onclick = () => void this.uploadSelectedItems();
    (this as unknown as { _counter: HTMLElement; _go: HTMLButtonElement })._counter = counter;
    (this as unknown as { _counter: HTMLElement; _go: HTMLButtonElement })._go = go;
    this.updateFooter();
  }

  private updateFooter(): void {
    const ref = this as unknown as { _counter?: HTMLElement; _go?: HTMLButtonElement };
    if (!ref._counter || !ref._go) return;
    const T = t().panel;
    const n = this.checked.size;
    ref._counter.setText(T.selected(n));
    ref._go.setText(n > 0 ? T.uploadN(n) : T.upload);
    ref._go.disabled = n === 0;
  }

  // ---- actions ------------------------------------------------------------

  private async uploadSingle(item: ScannedItem): Promise<void> {
    if (!this.currentFile) return;
    const k = itemKey(item);
    if (this.busyItems.has(k)) return;
    this.busyItems.add(k);
    this.render();
    try {
      await this.plugin.runUpload(this.currentFile, [item]);
    } finally {
      this.busyItems.delete(k);
      await this.rescan({ resetSelection: false });
    }
  }

  private async uploadSelectedItems(): Promise<void> {
    if (!this.currentFile) return;
    const selected = this.items.filter((it) => this.checked.has(itemKey(it)));
    if (selected.length === 0) return;
    const keys = selected.map(itemKey);
    for (const k of keys) this.busyItems.add(k);
    this.render();
    try {
      await this.plugin.runUpload(this.currentFile, selected);
    } finally {
      for (const k of keys) this.busyItems.delete(k);
      await this.rescan({ resetSelection: false });
    }
  }

  // ---- filtering ----------------------------------------------------------

  private visibleItems(): ScannedItem[] {
    switch (this.filter) {
      case "all": return this.items;
      case "local": return this.items.filter((it) => it.resolved.status === "local");
      case "pending":
        return this.items.filter((it) => {
          if (it.resolved.status === "local") return true;
          if (it.resolved.status === "remote") {
            return !isOwnRemote(it, this.displayUploader);
          }
          return false;
        });
      case "missing": return this.items.filter((it) => it.resolved.status === "missing");
    }
  }

  private canSelect(item: ScannedItem): boolean {
    return item.resolved.status === "local" || item.resolved.status === "remote";
  }
}

// ---- helpers --------------------------------------------------------------

/**
 * Stable per-item identifier used for selection / spinner state across rescans.
 * Each rescan produces brand-new ScannedItem object instances, so reference
 * equality can't be used.
 *
 * Key shape: `${kind}\x1f${rawUrl}\x1f${occurrence-index}` where occurrence
 * index is the 0-based count of prior items with the same (kind, rawUrl)
 * pair in source order. This survives edits *above* the image (offsets
 * shift, but occurrence index doesn't) — which is what makes the key stable
 * across the metadataCache live-refresh.
 *
 * Keys are assigned by `assignItemKeys(items)` after each scan and cached
 * on the item as a non-enumerable property.
 */
function itemKey(item: ScannedItem): string {
  return (item as unknown as { __mdossKey: string }).__mdossKey;
}

function assignItemKeys(items: ScannedItem[]): void {
  const counters = new Map<string, number>();
  for (const it of items) {
    const base = `${it.ref.kind}\x1f${it.ref.rawUrl}`;
    const n = counters.get(base) ?? 0;
    counters.set(base, n + 1);
    Object.defineProperty(it, "__mdossKey", {
      value: `${base}\x1f${n}`,
      enumerable: false,
      configurable: true,
    });
  }
}

/**
 * Cheap fingerprint of a scan result — if two scans produce the same
 * signature, the rendered list would be byte-identical, so we can skip
 * the DOM rebuild. Includes resolve status so flips like local→missing
 * still trigger a re-render.
 */
function computeSignature(items: ScannedItem[]): string {
  const parts: string[] = [];
  for (const it of items) {
    parts.push(`${it.ref.kind}|${it.ref.rawUrl}|${it.resolved.status}`);
  }
  return parts.join("\n");
}

function isOwnRemote(item: ScannedItem, uploader: Uploader | null): boolean {
  if (item.resolved.status !== "remote" || !uploader) return false;
  return uploader.isOwnUrl(item.resolved.url);
}

function kindLabel(it: { ref: { kind: string } }): string {
  const M = t().panel;
  switch (it.ref.kind) {
    case "wikilink": return M.kind_wikilink;
    case "md": return M.kind_md;
    case "html": return M.kind_html;
    default: return M.kind_ref;
  }
}

function badgeLabel(it: ScannedItem, uploader: Uploader | null): string {
  const M = t().panel;
  switch (it.resolved.status) {
    case "local": return M.badge_local;
    case "remote": return uploader && uploader.isOwnUrl(it.resolved.url) ? M.badge_oss : M.badge_remote;
    case "missing": return M.badge_missing;
    case "skip": return M.badge_skip;
  }
}

function badgeClass(it: ScannedItem, uploader: Uploader | null): string {
  switch (it.resolved.status) {
    case "local": return "is-local";
    case "remote": return uploader && uploader.isOwnUrl(it.resolved.url) ? "is-oss" : "is-remote";
    case "missing": return "is-missing";
    case "skip": return "is-remote";
  }
}

/**
 * Build a short, user-facing string that tells the user where this image
 * lives (or will live). Mirrors Uploader.buildUrl exactly so the display
 * matches what'll actually be written on upload.
 */
export function describeDomain(
  item: ScannedItem,
  settings: { customDomain: string; endpoint: string; bucket: string },
  uploader: Uploader | null,
): { text: string; isOss: boolean } {
  const r = item.resolved;
  if (r.status === "local") {
    const targetHost = computeTargetHost(settings);
    const T = t().panel;
    const text = targetHost
      ? `${T.localPrefix} ${T.targetArrow} ${targetHost}`
      : T.localPrefix;
    return { text, isOss: false };
  }
  if (r.status === "remote") {
    let host = r.url;
    try { host = new URL(r.url).host; } catch { /* keep raw */ }
    const isOss = uploader ? uploader.isOwnUrl(r.url) : false;
    return { text: host, isOss };
  }
  return { text: "—", isOss: false };
}

function computeTargetHost(settings: {
  customDomain: string;
  endpoint: string;
  bucket: string;
}): string {
  const cd = (settings.customDomain || "").trim();
  if (cd) {
    try {
      const url = /^https?:\/\//.test(cd) ? new URL(cd) : new URL("https://" + cd);
      return url.host;
    } catch {
      return cd;
    }
  }
  const endpoint = (settings.endpoint || "").trim();
  const bucket = (settings.bucket || "").trim();
  if (!endpoint || !bucket) return "";
  const host = endpoint.replace(/^https?:\/\//, "");
  return `${bucket}.${host}`;
}
