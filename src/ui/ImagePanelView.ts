// Persistent right-side panel that lists every image reference in the active
// markdown note. Replaces the older modal-based ImageListModal — same data
// flow, but lives in a workspace leaf so it can be pinned, reopened, and
// tracked against the active file.

import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type NotePicOssPlugin from "../main";
import { scanNote, type PipelineResult, type ScannedItem } from "../core/pipeline";
import { scanVaultImageAssets, type ImageAsset } from "../core/assetScanner";
import { Uploader } from "../core/uploader";
import { buildUploaderConfig } from "../settings";
import { collectSizes, fmtSize } from "../util/sizes";
import { t } from "../i18n";
import { downloadSelected, pickDownloadFolder } from "../core/downloader";
import { DownloadFailureModal } from "./DownloadFailureModal";

export const VIEW_TYPE_NOTEPIC_OSS_PANEL = "notepic-oss-panel";

type PanelMode = "note" | "assets";
type Filter = "all" | "local" | "pending" | "missing";
type AssetFilter = "all" | "unreferenced" | "referenced";

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
  private mode: PanelMode = "note";
  private assetFilter: AssetFilter = "unreferenced";
  private assets: ImageAsset[] = [];
  private assetChecked = new Set<string>();
  private expandedFolders = new Set<string>();
  private assetsBusy = false;
  private scanToken = 0;
  // Signature of the last rendered item list — when an incoming rescan has
  // the same signature we skip the DOM rebuild entirely. Avoids flicker when
  // the user is typing prose in a non-image region of the note.
  private lastSignature: string | null = null;
  // We rebuild a fresh Uploader for `isOwnUrl` checks each render. Validation
  // errors don't matter here — incomplete creds just make isOwnUrl return false
  // for everything, which is fine for display purposes.
  private displayUploader: Uploader | null = null;
  private downloadProgress: { done: number; total: number } | null = null;

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
        if (this.mode === "assets") return;
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
    if (this.mode === "assets") await this.rescanAssets({ resetSelection: false });
    else await this.rescan({ resetSelection: false });
  }

  async showVaultAssets(): Promise<void> {
    this.mode = "assets";
    await this.rescanAssets({ resetSelection: false });
  }

  // ---- file tracking ------------------------------------------------------

  private async onActiveFileChange(file: TFile | null): Promise<void> {
    if (file === this.currentFile) return;
    this.currentFile = file;
    this.checked.clear();
    this.busyItems.clear();
    this.lastSignature = null;
    if (this.mode === "assets") {
      this.render();
      return;
    }
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

    this.renderModeTabs(contentEl);

    if (this.mode === "assets") {
      this.renderAssets(contentEl);
      return;
    }

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
    setButtonTooltip(refresh, T.refresh);
    refresh.onclick = () => void this.refresh();
  }

  private renderModeTabs(parent: HTMLElement): void {
    const T = t().panel;
    const tabs = parent.createDiv({ cls: "mdoss-panel-tabs" });
    const options: Array<[PanelMode, string]> = [
      ["note", T.tabNote],
      ["assets", T.tabAssets],
    ];
    for (const [mode, label] of options) {
      const tab = tabs.createEl("button", { text: label });
      tab.addClass("mdoss-panel-tab");
      if (mode === this.mode) tab.addClass("is-active");
      tab.onclick = () => {
        if (this.mode === mode) return;
        this.mode = mode;
        if (mode === "assets") void this.rescanAssets({ resetSelection: false });
        else void this.rescan({ resetSelection: true });
      };
    }
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
      setButtonTooltip(btn, isBusy ? t().panel.uploadingRow : t().panel.uploadRow);
      btn.disabled = isBusy;
      btn.onclick = () => void this.uploadSingle(item);
    }
  }

  private renderFooter(parent: HTMLElement): void {
    const footer = parent.createDiv({ cls: "mdoss-footer mdoss-panel-footer" });
    const counter = footer.createSpan({ cls: "mdoss-panel-counter", text: "" });
    const deleteLocalLabel = footer.createEl("label", { cls: "mdoss-panel-delete-local" });
    const deleteLocal = deleteLocalLabel.createEl("input", { type: "checkbox" });
    deleteLocal.checked = this.plugin.settings.panelDeleteLocalAfterUpload;
    deleteLocal.onchange = () => {
      this.plugin.settings.panelDeleteLocalAfterUpload = deleteLocal.checked;
      void this.plugin.saveSettings();
    };
    deleteLocalLabel.appendText(t().panel.deleteLocalAfterUpload);
    const go = footer.createEl("button", { text: "" });
    go.addClass("mod-cta");
    go.onclick = () => void this.uploadSelectedItems();
    const download = footer.createEl("button", { text: "" });
    download.onclick = () => void this.downloadSelectedItems();
    (this as unknown as { _counter: HTMLElement; _go: HTMLButtonElement; _download: HTMLButtonElement })._counter = counter;
    (this as unknown as { _counter: HTMLElement; _go: HTMLButtonElement; _download: HTMLButtonElement })._go = go;
    (this as unknown as { _download: HTMLButtonElement })._download = download;
    this.updateFooter();
  }

  private updateFooter(): void {
    const ref = this as unknown as { _counter?: HTMLElement; _go?: HTMLButtonElement; _download?: HTMLButtonElement };
    if (!ref._counter || !ref._go || !ref._download) return;
    const T = t().panel;
    const n = this.checked.size;
    ref._counter.setText(this.downloadProgress ? T.downloading(this.downloadProgress.done, this.downloadProgress.total) : T.selected(n));
    ref._go.setText(n > 0 ? T.uploadN(n) : T.upload);
    ref._go.disabled = n === 0;
    ref._download.setText(n > 0 ? T.downloadN(n) : T.download);
    ref._download.disabled = n === 0 || this.downloadProgress !== null;
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
      const result = await this.plugin.runUpload(this.currentFile, selected);
      if (result && this.plugin.settings.panelDeleteLocalAfterUpload) {
        await this.deleteUploadedLocalFiles(selected, result);
      }
    } finally {
      for (const k of keys) this.busyItems.delete(k);
      await this.rescan({ resetSelection: false });
    }
  }

  private async downloadSelectedItems(): Promise<void> {
    const selected = this.items.filter((item) => this.checked.has(itemKey(item)) && this.canSelect(item));
    if (selected.length === 0 || this.downloadProgress) return;
    let folder: string | null;
    try {
      folder = await pickDownloadFolder();
    } catch (error) {
      new Notice(t().panel.downloadFolderError(error instanceof Error ? error.message : String(error)), 8000);
      return;
    }
    if (!folder) return;
    const keys = selected.map(itemKey);
    for (const key of keys) this.busyItems.add(key);
    this.downloadProgress = { done: 0, total: selected.length };
    this.render();
    try {
      const results = await downloadSelected(this.app, selected, folder, (done, total) => {
        this.downloadProgress = { done, total };
        this.updateFooter();
      });
      const failures = results.filter((result) => result.status === "failed");
      const downloaded = results.length - failures.length;
      new Notice(t().panel.downloadDone(downloaded, failures.length), 8000);
      if (failures.length > 0) new DownloadFailureModal(this.app, failures).open();
    } finally {
      this.downloadProgress = null;
      for (const key of keys) this.busyItems.delete(key);
      this.render();
    }
  }

  /**
   * Delete only local files whose selected references all completed their
   * upload. This is deliberately called only by the panel's batch-upload
   * action; row uploads, commands and context-menu uploads remain unchanged.
   */
  private async deleteUploadedLocalFiles(
    selected: ScannedItem[],
    result: PipelineResult,
  ): Promise<void> {
    const uploadedRefs = new Set(
      result.results
        .filter((item) => item.status === "uploaded")
        .map((item) => item.ref),
    );
    const selectedKeys = new Set(selected.map(itemKey));
    const files = new Map<string, TFile>();
    for (const item of selected) {
      if (item.resolved.status !== "local") continue;
      const file = item.resolved.file;
      const sameFileRefs = this.items.filter(
        (candidate) => candidate.resolved.status === "local"
          && candidate.resolved.file.path === file.path,
      );
      const everyReferenceWasSelectedAndUploaded = sameFileRefs.every(
        (candidate) => selectedKeys.has(itemKey(candidate)) && uploadedRefs.has(candidate.ref),
      );
      if (everyReferenceWasSelectedAndUploaded) {
        files.set(file.path, file);
      }
    }

    let failed = 0;
    for (const file of files.values()) {
      try {
        await this.app.vault.delete(file);
      } catch (e) {
        failed++;
        console.warn(`NotePic OSS: failed to delete local file ${file.path}`, e);
      }
    }
    if (failed > 0) new Notice(t().panel.deleteLocalFailed(failed), 8000);
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

  // ---- vault assets -------------------------------------------------------

  private async rescanAssets(opts: { resetSelection: boolean }): Promise<void> {
    const token = ++this.scanToken;
    this.assetsBusy = true;
    this.render();
    try {
      const assets = await scanVaultImageAssets(this.app);
      if (token !== this.scanToken) return;
      this.assets = assets;
      if (this.expandedFolders.size === 0) {
        for (const asset of assets) {
          for (const folder of folderChain(asset.folder)) this.expandedFolders.add(folder);
        }
      }
      if (opts.resetSelection) this.assetChecked.clear();
      else this.pruneAssetSelection();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(t().notice.assetScanFailed(msg), 8000);
    } finally {
      if (token === this.scanToken) {
        this.assetsBusy = false;
        this.render();
      }
    }
  }

  private renderAssets(parent: HTMLElement): void {
    const T = t().panel.assets;
    if (this.assetsBusy) {
      this.renderEmpty(parent, T.scanning);
      return;
    }
    this.renderAssetChips(parent);
    const visible = this.visibleAssets();
    const total = visible.reduce((sum, asset) => sum + asset.size, 0);
    parent.createDiv({
      cls: "mdoss-assets-summary",
      text: T.summary(visible.length, fmtSize(total)),
    });
    if (this.assets.length === 0) {
      this.renderEmpty(parent, T.empty);
      return;
    }
    if (visible.length === 0) {
      this.renderEmpty(parent, T.noMatch);
      return;
    }
    const listEl = parent.createDiv({ cls: "mdoss-list mdoss-panel-list mdoss-assets-list" });
    this.renderAssetTree(listEl, visible);
    this.renderAssetFooter(parent);
  }

  private renderAssetChips(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: "mdoss-modal-header" });
    const T = t().panel.assets;
    const chips: Array<[AssetFilter, string]> = [
      ["all", T.filterAll],
      ["unreferenced", T.filterUnreferenced],
      ["referenced", T.filterReferenced],
    ];
    for (const [key, label] of chips) {
      const chip = header.createEl("span", { cls: "mdoss-filter-chip", text: label });
      if (key === this.assetFilter) chip.addClass("is-active");
      chip.onclick = () => {
        this.assetFilter = key;
        this.pruneAssetSelection();
        this.render();
      };
    }
    const selectAll = header.createEl("a", {
      cls: "mdoss-select-all",
      text: T.toggleVisible,
      href: "#",
    });
    selectAll.onclick = (e) => {
      e.preventDefault();
      this.toggleAssets(this.visibleAssets());
      this.render();
    };
  }

  private renderAssetTree(parent: HTMLElement, assets: ImageAsset[]): void {
    const root = buildAssetTree(assets);
    for (const folder of root.folders.values()) this.renderFolder(parent, folder, 0);
    for (const asset of root.assets) this.renderAssetRow(parent, asset, 0);
  }

  private renderFolder(parent: HTMLElement, folder: AssetTreeNode, depth: number): void {
    const row = parent.createDiv({ cls: "mdoss-asset-folder" });
    row.style.setProperty("--mdoss-depth", String(depth));
    const expanded = this.expandedFolders.has(folder.path);
    const toggle = row.createEl("button", { cls: "clickable-icon mdoss-panel-icon-btn" });
    setIcon(toggle, expanded ? "chevron-down" : "chevron-right");
    setButtonTooltip(toggle, expanded ? t().panel.assets.collapse : t().panel.assets.expand);
    toggle.onclick = () => {
      if (expanded) this.expandedFolders.delete(folder.path);
      else this.expandedFolders.add(folder.path);
      this.render();
    };

    const cb = row.createEl("input", { type: "checkbox" });
    const folderAssets = collectTreeAssets(folder);
    cb.checked = folderAssets.length > 0 && folderAssets.every((a) => this.assetChecked.has(a.path));
    cb.onchange = () => {
      this.toggleAssets(folderAssets, cb.checked);
      this.render();
    };
    row.createSpan({ cls: "mdoss-asset-folder-name", text: folder.name || "/" });
    row.createSpan({
      cls: "mdoss-sub mdoss-asset-folder-meta",
      text: t().panel.assets.folderSummary(
        folderAssets.length,
        fmtSize(folderAssets.reduce((sum, asset) => sum + asset.size, 0)),
      ),
    });

    if (!expanded) return;
    for (const child of folder.folders.values()) this.renderFolder(parent, child, depth + 1);
    for (const asset of folder.assets) this.renderAssetRow(parent, asset, depth + 1);
  }

  private renderAssetRow(parent: HTMLElement, asset: ImageAsset, depth: number): void {
    const row = parent.createDiv({ cls: "mdoss-row mdoss-panel-row mdoss-asset-row" });
    row.style.setProperty("--mdoss-depth", String(depth));
    const cb = row.createEl("input", { type: "checkbox" });
    cb.checked = this.assetChecked.has(asset.path);
    cb.onchange = () => {
      if (cb.checked) this.assetChecked.add(asset.path);
      else this.assetChecked.delete(asset.path);
      this.updateAssetFooter();
    };

    const img = row.createEl("img", { cls: "mdoss-thumb mdoss-panel-thumb" });
    img.src = this.app.vault.getResourcePath(asset.file);
    img.loading = "lazy";
    img.addClass("mdoss-openable-thumb");
    setButtonTooltip(img, t().panel.assets.open);
    img.onclick = () => void this.openAsset(asset);

    const meta = row.createDiv({ cls: "mdoss-meta" });
    const name = meta.createDiv({ cls: "mdoss-name mdoss-openable-text", text: asset.name });
    name.setAttr("title", t().panel.assets.open);
    name.onclick = () => void this.openAsset(asset);
    const sub = meta.createDiv({ cls: "mdoss-sub" });
    const path = sub.createSpan({ cls: "mdoss-openable-text", text: asset.path });
    path.setAttr("title", t().panel.assets.open);
    path.onclick = () => void this.openAsset(asset);
    const sub2 = meta.createDiv({ cls: "mdoss-sub" });
    sub2.createSpan({ text: fmtSize(asset.size) });
    sub2.createSpan({
      text: asset.references.length > 0
        ? t().panel.assets.refCount(asset.references.length)
        : t().panel.assets.noRefs,
    });

    row.createSpan({
      cls: `mdoss-badge ${asset.status === "referenced" ? "is-local" : "is-missing"}`,
      text: asset.status === "referenced" ? t().panel.assets.badgeReferenced : t().panel.assets.badgeUnreferenced,
    });
  }

  private renderAssetFooter(parent: HTMLElement): void {
    const footer = parent.createDiv({ cls: "mdoss-footer mdoss-panel-footer" });
    const counter = footer.createSpan({ cls: "mdoss-panel-counter", text: "" });
    const go = footer.createEl("button", { text: "" });
    go.addClass("mod-warning");
    go.onclick = () => void this.deleteSelectedAssets();
    (this as unknown as { _assetCounter: HTMLElement; _assetGo: HTMLButtonElement })._assetCounter = counter;
    (this as unknown as { _assetCounter: HTMLElement; _assetGo: HTMLButtonElement })._assetGo = go;
    this.updateAssetFooter();
  }

  private updateAssetFooter(): void {
    const ref = this as unknown as { _assetCounter?: HTMLElement; _assetGo?: HTMLButtonElement };
    if (!ref._assetCounter || !ref._assetGo) return;
    const selected = this.selectedAssets();
    const size = selected.reduce((sum, asset) => sum + asset.size, 0);
    const T = t().panel.assets;
    ref._assetCounter.setText(T.selected(selected.length, fmtSize(size)));
    ref._assetGo.setText(selected.length > 0 ? T.deleteN(selected.length) : T.delete);
    ref._assetGo.disabled = selected.length === 0;
  }

  private visibleAssets(): ImageAsset[] {
    switch (this.assetFilter) {
      case "all": return this.assets;
      case "unreferenced": return this.assets.filter((asset) => asset.status === "unreferenced");
      case "referenced": return this.assets.filter((asset) => asset.status === "referenced");
    }
  }

  private selectedAssets(): ImageAsset[] {
    const byPath = new Map(this.assets.map((asset) => [asset.path, asset]));
    return Array.from(this.assetChecked)
      .map((path) => byPath.get(path))
      .filter((asset): asset is ImageAsset => !!asset);
  }

  private toggleAssets(assets: ImageAsset[], force?: boolean): void {
    if (force != null) {
      for (const asset of assets) {
        if (force) this.assetChecked.add(asset.path);
        else this.assetChecked.delete(asset.path);
      }
      return;
    }
    const allChecked = assets.every((asset) => this.assetChecked.has(asset.path));
    for (const asset of assets) {
      if (allChecked) this.assetChecked.delete(asset.path);
      else this.assetChecked.add(asset.path);
    }
  }

  private pruneAssetSelection(): void {
    const visiblePaths = new Set(this.visibleAssets().map((asset) => asset.path));
    for (const path of Array.from(this.assetChecked)) {
      if (!visiblePaths.has(path)) this.assetChecked.delete(path);
    }
  }

  private async deleteSelectedAssets(): Promise<void> {
    const selected = this.selectedAssets();
    if (selected.length === 0) return;
    const T = t().panel.assets;
    const total = selected.reduce((sum, asset) => sum + asset.size, 0);
    const ok = window.confirm(T.confirm(selected.length, fmtSize(total)));
    if (!ok) return;

    let deleted = 0;
    const failed: string[] = [];
    for (const asset of selected) {
      try {
        await this.app.vault.delete(asset.file);
        deleted++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failed.push(`${asset.path}: ${msg}`);
      }
    }
    new Notice(T.deleteDone(deleted, failed.length), 8000);
    if (failed.length > 0) console.warn("NotePic OSS asset deletion failures", failed);
    this.assetChecked.clear();
    await this.rescanAssets({ resetSelection: true });
  }

  private async openAsset(asset: ImageAsset): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(asset.file);
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

function setButtonTooltip(button: HTMLElement, tooltip: string): void {
  button.setAttr("aria-label", tooltip);
  button.setAttr("title", tooltip);
}

interface AssetTreeNode {
  name: string;
  path: string;
  folders: Map<string, AssetTreeNode>;
  assets: ImageAsset[];
}

function makeNode(name: string, path: string): AssetTreeNode {
  return { name, path, folders: new Map(), assets: [] };
}

function buildAssetTree(assets: ImageAsset[]): AssetTreeNode {
  const root = makeNode("", "");
  for (const asset of assets) {
    let node = root;
    const parts = asset.folder ? asset.folder.split("/") : [];
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let child = node.folders.get(part);
      if (!child) {
        child = makeNode(part, path);
        node.folders.set(part, child);
      }
      node = child;
    }
    node.assets.push(asset);
  }
  sortTree(root);
  return root;
}

function sortTree(node: AssetTreeNode): void {
  node.assets.sort((a, b) => a.name.localeCompare(b.name));
  node.folders = new Map(Array.from(node.folders.entries()).sort(([a], [b]) => a.localeCompare(b)));
  for (const child of node.folders.values()) sortTree(child);
}

function collectTreeAssets(node: AssetTreeNode): ImageAsset[] {
  const out = [...node.assets];
  for (const child of node.folders.values()) out.push(...collectTreeAssets(child));
  return out;
}

function folderChain(folder: string): string[] {
  if (!folder) return [];
  const out: string[] = [];
  let current = "";
  for (const part of folder.split("/")) {
    current = current ? `${current}/${part}` : part;
    out.push(current);
  }
  return out;
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
