import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { downloadSelected, pickDownloadFolder } from "../src/core/downloader";
import type { ScannedItem } from "../src/core/pipeline";
import { _resetLangCache } from "../src/i18n";

const host = vi.hoisted(() => ({ getLanguage: vi.fn(), requestUrl: vi.fn() }));
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("obsidian")>(),
  ...host,
}));

function item(resolved: ScannedItem["resolved"]): ScannedItem {
  return {
    ref: { kind: "md", from: 0, to: 10, originalText: "![](x.png)", rawUrl: "x.png", alt: "" },
    resolved,
  };
}

const locales = [
  {
    lang: "en",
    desktop: "This action is available only in the Obsidian desktop app.",
    picker: "Could not open the system folder picker.",
    title: "Choose a folder to save images",
    button: "Save here",
    unavailable: "Image is no longer available.",
    http: "Request failed (HTTP 403)",
  },
  {
    lang: "zh-CN",
    desktop: "此操作仅支持 Obsidian 桌面端。",
    picker: "无法打开系统文件夹选择器。",
    title: "选择图片保存文件夹",
    button: "保存到此处",
    unavailable: "图片已不可用。",
    http: "请求失败（HTTP 403）",
  },
];

describe.each(locales)("download messages ($lang)", (locale) => {
  beforeEach(() => {
    host.getLanguage.mockReturnValue(locale.lang);
    _resetLangCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    _resetLangCache();
  });

  it("reports desktop-only errors in the host language", async () => {
    vi.stubGlobal("window", {});
    await expect(pickDownloadFolder()).rejects.toThrow(locale.desktop);
    await expect(downloadSelected(new App(), [], "/images")).rejects.toThrow(locale.desktop);
  });

  it("reports an unavailable folder picker in the host language", async () => {
    vi.stubGlobal("window", { require: () => ({}) });
    await expect(pickDownloadFolder()).rejects.toThrow(locale.picker);
  });

  it("localizes the native picker without changing cancellation", async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: true, filePaths: [] });
    vi.stubGlobal("window", { require: () => ({ remote: { dialog: { showOpenDialog } } }) });
    await expect(pickDownloadFolder()).resolves.toBeNull();
    expect(showOpenDialog).toHaveBeenCalledWith({
      title: locale.title,
      buttonLabel: locale.button,
      properties: ["openDirectory", "createDirectory"],
    });
  });

  it("returns localized per-image failures and completes progress", async () => {
    const writeFile = vi.fn();
    vi.stubGlobal("window", { require: () => ({ writeFile }) });
    host.requestUrl.mockResolvedValue({ status: 403 });
    const progress = vi.fn();
    const results = await downloadSelected(new App(), [
      item({ status: "missing", raw: "x.png" }),
      item({ status: "remote", url: "https://example.com/x.png" }),
    ], "/images", progress);
    expect(results.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: "failed", reason: locale.unavailable },
      { status: "failed", reason: locale.http },
    ]);
    expect(host.requestUrl).toHaveBeenCalledWith({ url: "https://example.com/x.png", throw: false });
    expect(writeFile).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(2, 2, "x.png");
  });

  it("preserves external error details for troubleshooting", async () => {
    vi.stubGlobal("window", { require: () => ({}) });
    host.requestUrl.mockRejectedValue(new Error("Connection reset: ECONNRESET"));
    const results = await downloadSelected(new App(), [
      item({ status: "remote", url: "https://example.com/x.png" }),
    ], "/images");
    expect(results[0].reason).toBe("Connection reset: ECONNRESET");
  });
});
