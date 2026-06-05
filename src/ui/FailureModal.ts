import { App, Modal, Setting } from "obsidian";
import type { ItemResult } from "../core/pipeline";
import { t } from "../i18n";

export class FailureModal extends Modal {
  constructor(app: App, private readonly failures: ItemResult[]) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const F = t().failure;
    contentEl.empty();
    new Setting(contentEl).setName(F.title(this.failures.length)).setHeading();

    const list = contentEl.createDiv({ cls: "mdoss-failure-list" });
    for (const f of this.failures) {
      const row = list.createDiv({ cls: "mdoss-failure-row" });
      row.createEl("div", { text: f.ref.rawUrl, cls: "mdoss-failure-url" });
      row.createEl("div", { text: f.reason || F.noReason });
    }

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(F.copy).onClick(() => {
          const text = this.failures
            .map((f) => `${f.ref.rawUrl}\t${f.reason ?? ""}`)
            .join("\n");
          navigator.clipboard.writeText(text)
            .then(() => {
              b.setButtonText(F.copied);
              window.setTimeout(() => {
                b.setButtonText(F.copy);
              }, 1500);
            })
            .catch((error: unknown) => {
              console.error("NotePic OSS: failed to copy upload failures", error);
            });
        }),
      )
      .addButton((b) => b.setButtonText(F.close).setCta().onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
