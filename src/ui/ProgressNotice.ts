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
    this.container = this.notice.noticeEl;
    this.container.empty();
    this.container.createEl("div", { text: title, attr: { style: "font-weight:600;margin-bottom:4px;" } });
    this.label = this.container.createEl("div", {
      text: t().progress.preparing,
      attr: { style: "font-size:12px;opacity:.8;margin-bottom:4px;" },
    });
    const wrap = this.container.createEl("div", { attr: { style: "width:240px;height:6px;background:var(--background-modifier-border);border-radius:3px;overflow:hidden;" } });
    this.bar = wrap.createEl("div", { attr: { style: "height:100%;width:0%;background:var(--interactive-accent);transition:width .2s;" } });
  }

  update(done: number, total: number, current?: string): void {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    this.bar.style.width = `${pct}%`;
    this.label.setText(
      total > 0
        ? t().progress.progressOf(done, total, current ? truncate(current, 40) : undefined)
        : t().progress.empty,
    );
  }

  finish(summary: string): void {
    this.label.setText(summary);
    this.bar.style.width = "100%";
    // Auto-hide after a few seconds so the user sees the final number.
    setTimeout(() => this.notice.hide(), 4000);
  }

  hide(): void {
    this.notice.hide();
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
