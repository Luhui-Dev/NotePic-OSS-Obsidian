// Minimal stand-in for the `obsidian` module used by unit tests.
// The real plugin is loaded inside Obsidian, where the module is provided by
// the host; here we just need enough surface area for `import` to resolve and
// for `instanceof TFile` checks to be testable.

export class TFile {
  path = "";
  extension = "";
  basename = "";
  name = "";
}
export class TFolder {}
export class TAbstractFile {}

export class App {
  vault = {
    getAbstractFileByPath: (_p: string) => null as unknown,
    adapter: { stat: async () => null },
    read: async (_f: TFile) => "",
    readBinary: async (_f: TFile) => new ArrayBuffer(0),
    process: async (_f: TFile, _fn: (s: string) => string) => undefined,
    getResourcePath: (_f: TFile) => "",
  };
  metadataCache = {
    getFirstLinkpathDest: (_link: string, _src: string) => null as TFile | null,
  };
  workspace = {};
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

// Stubs for UI classes used by source files but not exercised by tests.
export class Plugin {}
export class PluginSettingTab {}
export class Modal {}
export class Setting { addText() { return this; } addToggle() { return this; } addSlider() { return this; } addButton() { return this; } setName(_: string) { return this; } setDesc(_: string) { return this; } }
export class Notice { constructor(_msg: string, _t?: number) {} hide() {} noticeEl: HTMLElement = (typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement)); }
export class MarkdownView {}
export class Menu {}
export type Editor = unknown;
