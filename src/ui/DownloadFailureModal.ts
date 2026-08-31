import { App, Modal, Setting } from "obsidian";
import type { DownloadResult } from "../core/downloader";
import { t } from "../i18n";

export class DownloadFailureModal extends Modal {
  constructor(app: App, private readonly failures: DownloadResult[]) { super(app); }

  onOpen(): void {
    const F = t().downloadFailure;
    this.contentEl.empty();
    new Setting(this.contentEl).setName(F.title(this.failures.length)).setHeading();
    const list = this.contentEl.createDiv({ cls: "mdoss-failure-list" });
    for (const failure of this.failures) {
      const row = list.createDiv({ cls: "mdoss-failure-row" });
      row.createEl("div", { text: failure.item.ref.rawUrl, cls: "mdoss-failure-url" });
      row.createEl("div", { text: failure.reason || F.noReason });
    }
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(F.copy).onClick(() => {
        const text = this.failures.map((f) => `${f.item.ref.rawUrl}\t${f.reason ?? ""}`).join("\n");
        void navigator.clipboard.writeText(text).then(() => {
          button.setButtonText(F.copied);
          window.setTimeout(() => button.setButtonText(F.copy), 1500);
        }).catch((error: unknown) => console.error("NotePic OSS: failed to copy download failures", error));
      }))
      .addButton((button) => button.setButtonText(F.close).setCta().onClick(() => this.close()));
  }

  onClose(): void { this.contentEl.empty(); }
}
