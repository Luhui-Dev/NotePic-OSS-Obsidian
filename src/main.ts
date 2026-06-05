import {
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  NotePicOssSettingTab,
  NotePicOssSettings,
  buildUploaderConfig,
  validateConfig,
} from "./settings";
import { Uploader } from "./core/uploader";
import {
  applyResults,
  PipelineResult,
  ScannedItem,
  scanNote,
  uploadSelected,
} from "./core/pipeline";
import { rewriteRef } from "./core/rewriter";
import { ProgressNotice } from "./ui/ProgressNotice";
import { FailureModal } from "./ui/FailureModal";
import { ImagePanelView, VIEW_TYPE_NOTEPIC_OSS_PANEL } from "./ui/ImagePanelView";
import { t } from "./i18n";

export default class NotePicOssPlugin extends Plugin {
  settings!: NotePicOssSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new NotePicOssSettingTab(this.app, this));

    // Register the right-side panel view + a left-rail ribbon entry to open it.
    this.registerView(
      VIEW_TYPE_NOTEPIC_OSS_PANEL,
      (leaf) => new ImagePanelView(leaf, this),
    );
    this.addRibbonIcon("image-up", "notepic-oss", () => {
      void this.activatePanel();
    });

    const T = t();

    this.addCommand({
      id: "upload-all-in-current-note",
      name: T.cmd.uploadAll,
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) return false;
        if (checking) return true;
        void this.runUploadAll(view);
        return true;
      },
    });

    this.addCommand({
      id: "open-image-manager",
      name: T.cmd.openManager,
      callback: () => {
        void this.activatePanel();
      },
    });

    // Editor context menu
    this.registerEvent(
      this.app.workspace.on(
        "editor-menu",
        (menu: Menu, _editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
          if (!(info instanceof MarkdownView)) return;
          if (!info.file || !this.isSupported(info.file)) return;
          const view = info;
          const M = t().menu;
          menu.addItem((i) =>
            i.setTitle(M.uploadAll)
              .setIcon("image-up")
              .onClick(() => void this.runUploadAll(view)),
          );
          menu.addItem((i) =>
            i.setTitle(M.openManager)
              .setIcon("images")
              .onClick(() => void this.activatePanel()),
          );
        },
      ),
    );
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<NotePicOssSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // -- public API used by ImagePanelView -------------------------------------

  /**
   * Open the image-management panel in the right sidebar, reusing any
   * existing leaf of this type. Safe to call from any entry point.
   */
  async activatePanel(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_NOTEPIC_OSS_PANEL);
    let leaf: WorkspaceLeaf | null = existing[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getRightLeaf(true);
      if (!leaf) {
        new Notice("NotePic OSS: could not allocate a right-sidebar leaf");
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE_NOTEPIC_OSS_PANEL, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /**
   * Run the upload pipeline for a chosen subset of scanned items. Writes
   * back into the editor (preserving undo) when the file is currently open,
   * otherwise into the vault on disk via vault.process.
   */
  async runUpload(
    file: TFile,
    items: ScannedItem[],
  ): Promise<PipelineResult | null> {
    if (items.length === 0) return null;
    const uploader = this.requireConfigured();
    if (!uploader) return null;

    const openView = this.findOpenMarkdownView(file);

    const progress = new ProgressNotice(t().progress.title);
    const ac = new AbortController();
    let result: PipelineResult;
    try {
      result = await uploadSelected(
        this.app,
        uploader,
        items,
        {
          compress: this.settings.compress,
          quality: this.settings.quality,
          processRemote: this.settings.processRemote,
          obsidian: true,
          concurrency: this.settings.concurrency,
          signal: ac.signal,
        },
        (done, total, current) => progress.update(done, total, current),
      );
    } catch (e) {
      progress.hide();
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(t().notice.pipelineError(msg), 8000);
      return null;
    }

    let drift = 0;
    if (openView) {
      drift = this.applyToEditor(openView, result);
    } else {
      await this.app.vault.process(file, (current: string) => {
        const applied = applyResults(current, result.results);
        drift = applied.driftedCount;
        return applied.content;
      });
    }
    this.reportSummary(progress, result, drift);
    return result;
  }

  // -- commands --------------------------------------------------------------

  private isSupported(file: TFile): boolean {
    const e = file.extension.toLowerCase();
    return e === "md" || e === "mdx" || e === "markdown" || e === "html" || e === "htm";
  }

  private requireConfigured(): Uploader | null {
    const err = validateConfig(this.settings);
    if (err) {
      new Notice(t().notice.configMissing(err), 6000);
      return null;
    }
    return new Uploader(buildUploaderConfig(this.settings));
  }

  private findOpenMarkdownView(file: TFile): MarkdownView | null {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file?.path === file.path) return v;
    }
    return null;
  }

  private async runUploadAll(view: MarkdownView): Promise<void> {
    const file = view.file;
    if (!file) return;
    const content = view.editor.getValue();
    const items = scanNote(this.app, file, content, { obsidian: true });
    if (items.length === 0) { new Notice(t().notice.noImages); return; }
    await this.runUpload(file, items);
  }

  private applyToEditor(view: MarkdownView, result: PipelineResult): number {
    const editor = view.editor;
    const liveText = editor.getValue();
    const applicable = result.results.filter((r) => r.status === "uploaded" && r.newUrl);
    // Sort ascending; editor.transaction wants ascending changes.
    applicable.sort((a, b) => a.ref.from - b.ref.from);

    const changes: { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string }[] = [];
    let drift = 0;
    for (const r of applicable) {
      const sliceLive = liveText.slice(r.ref.from, r.ref.to);
      if (sliceLive !== r.ref.originalText) { drift++; continue; }
      const replacement = rewriteRef(r.ref, r.newUrl!);
      changes.push({
        from: editor.offsetToPos(r.ref.from),
        to: editor.offsetToPos(r.ref.to),
        text: replacement,
      });
    }
    if (changes.length > 0) {
      editor.transaction({ changes });
    }
    return drift;
  }

  private reportSummary(
    progress: ProgressNotice,
    result: PipelineResult,
    drift: number,
  ): void {
    const { stats } = result;
    progress.finish(
      t().progress.done(stats.found, stats.uploaded, stats.skipped, stats.failed, drift),
    );
    const failures = result.results.filter((r) => r.status === "failed");
    if (failures.length > 0) new FailureModal(this.app, failures).open();
  }
}
