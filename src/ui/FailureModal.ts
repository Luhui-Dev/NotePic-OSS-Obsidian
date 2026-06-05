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
    contentEl.createEl("h3", { text: F.title(this.failures.length) });

    const list = contentEl.createDiv({ cls: "mdoss-failure-list" });
    for (const f of this.failures) {
      const row = list.createDiv({ cls: "mdoss-failure-row" });
      row.createEl("div", { text: f.ref.rawUrl, attr: { style: "font-weight:600;" } });
      row.createEl("div", { text: f.reason || F.noReason });
    }

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(F.copy).onClick(async () => {
          const text = this.failures
            .map((f) => `${f.ref.rawUrl}\t${f.reason ?? ""}`)
            .join("\n");
          await navigator.clipboard.writeText(text);
          b.setButtonText(F.copied);
          setTimeout(() => b.setButtonText(F.copy), 1500);
        }),
      )
      .addButton((b) => b.setButtonText(F.close).setCta().onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
