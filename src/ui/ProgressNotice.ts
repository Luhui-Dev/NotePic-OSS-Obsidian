import { Notice } from "obsidian";
import { t } from "../i18n";

export class ProgressNotice {
  private notice: Notice;
  private container: HTMLElement;
  private bar: HTMLElement;
  private label: HTMLElement;

  constructor(title: string) {
    // Constructed with 0 → sticky until we hide() it.
    this.notice = new Notice("", 0);
    this.container = this.notice.messageEl;
    this.container.empty();
    this.container.createEl("div", { text: title, cls: "mdoss-progress-title" });
    this.label = this.container.createEl("div", {
      text: t().progress.preparing,
      cls: "mdoss-progress-label",
    });
    const wrap = this.container.createEl("div", { cls: "mdoss-progress-notice" });
    this.bar = wrap.createEl("div", { cls: "mdoss-progress-notice-bar" });
  }

  update(done: number, total: number, current?: string): void {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    this.bar.setCssProps({ "--mdoss-progress-width": `${pct}%` });
    this.label.setText(
      total > 0
        ? t().progress.progressOf(done, total, current ? truncate(current, 40) : undefined)
        : t().progress.empty,
    );
  }

  finish(summary: string): void {
    this.label.setText(summary);
    this.bar.setCssProps({ "--mdoss-progress-width": "100%" });
    // Auto-hide after a few seconds so the user sees the final number.
    window.setTimeout(() => this.notice.hide(), 4000);
  }

  hide(): void {
    this.notice.hide();
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
