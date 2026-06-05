import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type NotePicOssPlugin from "./main";
import { Uploader } from "./core/uploader";
import { t } from "./i18n";

export interface NotePicOssSettings {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  bucket: string;
  prefix: string;
  customDomain: string;

  compress: boolean;
  quality: number;
  processRemote: boolean;
  concurrency: number;
}

export const DEFAULT_SETTINGS: NotePicOssSettings = {
  accessKeyId: "",
  accessKeySecret: "",
  endpoint: "",
  bucket: "",
  prefix: "",
  customDomain: "",
  compress: true,
  quality: 85,
  processRemote: false,
  concurrency: 3,
};

export function buildUploaderConfig(s: NotePicOssSettings) {
  return {
    accessKeyId: s.accessKeyId.trim(),
    accessKeySecret: s.accessKeySecret.trim(),
    endpoint: s.endpoint.trim(),
    bucket: s.bucket.trim(),
    prefix: s.prefix.trim().replace(/^\/+|\/+$/g, ""),
    customDomain: s.customDomain.trim().replace(/^\/+|\/+$/g, ""),
  };
}

export function validateConfig(s: NotePicOssSettings): string | null {
  const V = t().validation;
  if (!s.accessKeyId.trim()) return V.accessKeyId;
  if (!s.accessKeySecret.trim()) return V.accessKeySecret;
  if (!s.endpoint.trim()) return V.endpoint;
  if (!s.bucket.trim()) return V.bucket;
  return null;
}

export class NotePicOssSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: NotePicOssPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const S = t().settings;
    const N = t().notice;
    containerEl.empty();

    containerEl.createEl("h2", { text: S.section_credentials });

    // Hint: "标 * 为必填项。" / "Fields marked with * are required."
    const hint = containerEl.createEl("div", { cls: "mdoss-required-hint" });

    const markRequired = (setting: Setting) => {
      setting.nameEl.createEl("span", { text: "*", cls: "mdoss-required" });
      return setting;
    };

    const passwordSetting = (
      name: string,
      desc: string,
      key: "accessKeyId" | "accessKeySecret",
    ) => {
      const s = new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((tx) => {
          tx.inputEl.type = "password";
          tx.setPlaceholder(name)
            .setValue(this.plugin.settings[key])
            .onChange(async (v) => {
              this.plugin.settings[key] = v;
              await this.plugin.saveSettings();
            });
        });
      markRequired(s);
    };

    passwordSetting(S.accessKeyId_name, S.accessKeyId_desc, "accessKeyId");
    passwordSetting(
      S.accessKeySecret_name,
      S.accessKeySecret_desc,
      "accessKeySecret",
    );

    markRequired(
      new Setting(containerEl)
        .setName(S.endpoint_name)
        .setDesc(S.endpoint_desc)
        .addText((tx) =>
          tx
            .setPlaceholder("https://oss-cn-hangzhou.aliyuncs.com")
            .setValue(this.plugin.settings.endpoint)
            .onChange(async (v) => {
              this.plugin.settings.endpoint = v;
              await this.plugin.saveSettings();
            }),
        ),
    );

    markRequired(
      new Setting(containerEl)
        .setName(S.bucket_name)
        .setDesc(S.bucket_desc)
        .addText((tx) =>
          tx
            .setPlaceholder("my-bucket")
            .setValue(this.plugin.settings.bucket)
            .onChange(async (v) => {
              this.plugin.settings.bucket = v;
              await this.plugin.saveSettings();
            }),
        ),
    );

    new Setting(containerEl)
      .setName(S.prefix_name)
      .setDesc(S.prefix_desc)
      .addText((tx) =>
        tx
          .setPlaceholder("markdown")
          .setValue(this.plugin.settings.prefix)
          .onChange(async (v) => {
            this.plugin.settings.prefix = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(S.customDomain_name)
      .setDesc(S.customDomain_desc)
      .addText((tx) =>
        tx
          .setPlaceholder("cdn.example.com")
          .setValue(this.plugin.settings.customDomain)
          .onChange(async (v) => {
            this.plugin.settings.customDomain = v;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h2", { text: S.section_upload });

    new Setting(containerEl)
      .setName(S.compress_name)
      .setDesc(S.compress_desc)
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.compress).onChange(async (v) => {
          this.plugin.settings.compress = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(S.quality_name)
      .setDesc(S.quality_desc)
      .addSlider((sl) =>
        sl
          .setLimits(1, 100, 1)
          .setValue(this.plugin.settings.quality)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.quality = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(S.processRemote_name)
      .setDesc(S.processRemote_desc)
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.processRemote).onChange(async (v) => {
          this.plugin.settings.processRemote = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(S.concurrency_name)
      .setDesc(S.concurrency_desc)
      .addSlider((sl) =>
        sl
          .setLimits(1, 8, 1)
          .setValue(this.plugin.settings.concurrency)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.concurrency = v;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h2", { text: S.section_connection });

    new Setting(containerEl)
      .setName(S.test_name)
      .setDesc(S.test_desc)
      .addButton((b) =>
        b.setButtonText(S.test_button).onClick(async () => {
          const err = validateConfig(this.plugin.settings);
          if (err) {
            new Notice(`NotePic OSS: ${err}`);
            return;
          }
          b.setDisabled(true).setButtonText(S.test_running);
          try {
            const u = new Uploader(buildUploaderConfig(this.plugin.settings));
            await u.probe();
            new Notice(N.connectionOk);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(N.connectionFailed(msg), 12000);
          } finally {
            b.setDisabled(false).setButtonText(S.test_button);
          }
        }),
      );

    containerEl.createEl("h2", { text: S.section_safety });

    const safetyEl = containerEl.createEl("div", {
      cls: "setting-item-description",
    });
    safetyEl.createEl("p", { text: S.safety_ram });
    safetyEl.createEl("p", { text: S.safety_storage });
    const cors = safetyEl.createEl("p");
    cors.appendText(S.safety_cors_prefix);
    cors.createEl("code", { text: "app://obsidian.md" });
    cors.appendText(S.safety_cors_origin_and);
    cors.createEl("code", { text: "*" });
    cors.appendText(S.safety_cors_methods);
    cors.createEl("code", { text: "PUT, GET, HEAD, DELETE" });
    cors.appendText(S.safety_cors_headers);
    cors.createEl("code", { text: "*" });
    cors.appendText(S.safety_cors_suffix);
  }
}
