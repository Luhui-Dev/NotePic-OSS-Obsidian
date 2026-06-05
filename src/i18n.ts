// Tiny i18n helper. Obsidian persists the chosen interface language in
// localStorage under the key "language" — values are codes like "en", "zh",
// "zh-TW", "fr", etc. We only ship Chinese and English; anything starting
// with "zh" maps to Chinese, everything else falls back to English.

type Lang = "en" | "zh";

let cached: Lang | null = null;

function detectLang(): Lang {
  if (cached) return cached;
  try {
    const v = window?.localStorage?.getItem("language");
    if (v && v.toLowerCase().startsWith("zh")) return (cached = "zh");
  } catch {
    /* not in a renderer (unit tests) — fall through */
  }
  return (cached = "en");
}

/** For tests: forget the cached locale so the next t() call re-reads. */
export function _resetLangCache(): void {
  cached = null;
}

const en = {
  cmd: {
    uploadAll: "Upload all images in current note (in place)",
    openManager: "Open image manager for current note",
  },
  menu: {
    uploadAll: "NotePic OSS: Upload all images (in place)",
    openManager: "NotePic OSS: Open image manager",
  },
  notice: {
    noImages: "NotePic OSS: no images in this note",
    pipelineError: (m: string) => `NotePic OSS: pipeline error — ${m}`,
    configMissing: (m: string) => `NotePic OSS: ${m}. Open settings to configure.`,
    connectionOk: "NotePic OSS: connection OK ✅",
    connectionFailed: (m: string) =>
      `NotePic OSS: connection failed — ${m}. If this looks like CORS, add a rule allowing PUT/HEAD/DELETE from the app:// origin.`,
  },
  validation: {
    accessKeyId: "Access Key ID is required",
    accessKeySecret: "Access Key Secret is required",
    endpoint: "Endpoint is required",
    bucket: "Bucket is required",
  },
  settings: {
    section_credentials: "OSS credentials",
    section_upload: "Upload behaviour",
    section_connection: "Connection test",
    section_safety: "Safety",
    required_hint: "are required.",
    required_hint_prefix: "Fields marked with",
    accessKeyId_name: "Access Key ID",
    accessKeyId_desc:
      "Aliyun RAM sub-account access key id. Stored locally in the plugin's data.json.",
    accessKeySecret_name: "Access Key Secret",
    accessKeySecret_desc: "Aliyun RAM sub-account access key secret.",
    endpoint_name: "Endpoint",
    endpoint_desc: "Region endpoint, e.g. https://oss-cn-hangzhou.aliyuncs.com",
    bucket_name: "Bucket",
    bucket_desc: "OSS bucket name",
    prefix_name: "Prefix",
    prefix_desc: "Object key prefix inside the bucket, e.g. \"markdown\". Leave blank for none.",
    customDomain_name: "Custom domain / CDN",
    customDomain_desc:
      "Optional. Used to build the public URL instead of the bucket endpoint.",
    compress_name: "Compress images",
    compress_desc:
      "Recompress JPEG / WebP via Canvas and PNG via UPNG.js before uploading.",
    quality_name: "Quality",
    quality_desc: "JPEG / WebP quality (1–100). 85 ≈ visually lossless for photos.",
    processRemote_name: "Also upload remote images",
    processRemote_desc:
      "Off by default: only images already in your vault are uploaded.",
    concurrency_name: "Upload concurrency",
    concurrency_desc: "Number of images uploaded in parallel.",
    test_name: "Test connection",
    test_desc:
      "PUTs, HEADs, then DELETEs a tiny probe object. Validates credentials and the bucket's CORS configuration.",
    test_button: "Run test",
    test_running: "Testing…",
    safety_ram:
      "Use a dedicated RAM sub-account with only oss:PutObject / oss:GetObject / oss:HeadObject / oss:DeleteObject on the target bucket.",
    safety_storage:
      "Credentials are stored in plaintext at .obsidian/plugins/notepic-oss/data.json. " +
      "If your vault is in a public Git repo, add that path to your vault's .gitignore.",
    safety_cors_prefix:
      "CORS rule on the bucket (Aliyun OSS console): Allowed origins ",
    safety_cors_origin_and: " and ",
    safety_cors_methods: ", allowed methods ",
    safety_cors_headers: ", allowed headers ",
    safety_cors_suffix: ".",
  },
  progress: {
    title: "NotePic OSS: uploading",
    preparing: "Preparing…",
    empty: "No images to upload.",
    progressOf: (done: number, total: number, current?: string) =>
      `${done} / ${total}${current ? ` — ${current}` : ""}`,
    done: (found: number, uploaded: number, skipped: number, failed: number, drifted: number) =>
      `Done. found=${found} uploaded=${uploaded} skipped=${skipped} failed=${failed}` +
      (drifted > 0 ? `, drifted=${drifted}` : ""),
  },
  panel: {
    title: "Image Manager",
    titleWithFile: (name: string, n: number) => `${name} · ${n} images`,
    refresh: "Refresh",
    emptyNoFile: "Open a note to manage its images.",
    emptyUnsupported: "This file type isn't supported (md / mdx / markdown / html).",
    emptyNoImages: "No images found in this note.",
    localPrefix: "Local · vault",
    targetArrow: "→",
    ossBadge: "OSS",
    uploadRow: "Upload this image",
    uploadingRow: "Uploading…",
    filter_all: "All",
    filter_local: "Local only",
    filter_pending: "Not yet on OSS",
    filter_missing: "Missing",
    toggleVisible: "Select all",
    noMatch: "No images match this filter.",
    selected: (n: number) => `${n} selected`,
    uploadN: (n: number) => `Upload ${n}`,
    upload: "Upload",
    kind_wikilink: "![[wikilink]]",
    kind_md: "![]()",
    kind_html: "<img>",
    kind_ref: "[ref]:",
    badge_local: "local",
    badge_oss: "OSS",
    badge_remote: "cloud",
    badge_missing: "missing",
    badge_skip: "skip",
  },
  failure: {
    title: (n: number) => `Upload failed for ${n} image(s)`,
    noReason: "(no reason given)",
    copy: "Copy failures",
    copied: "Copied ✓",
    close: "Close",
  },
  reason: {
    notFound: (raw: string) => `not found: ${raw}`,
    alreadyOss: "already on OSS",
    remoteSkip: "remote (toggle to upload)",
    cancelled: "cancelled",
    empty: "empty url",
    dataUri: "data: uri",
    anchor: "anchor link",
    mailto: "mailto: link",
    obsidianUrl: "obsidian internal url",
    absFsPath: "absolute filesystem path",
  },
};

const zh: typeof en = {
  cmd: {
    uploadAll: "上传当前笔记中的所有图片到 OSS（覆盖式）",
    openManager: "打开当前笔记的图片管理面板",
  },
  menu: {
    uploadAll: "NotePic OSS：上传全部图片（覆盖式）",
    openManager: "NotePic OSS：打开图片管理面板",
  },
  notice: {
    noImages: "NotePic OSS：当前笔记里没有图片",
    pipelineError: (m: string) => `NotePic OSS：流程出错 — ${m}`,
    configMissing: (m: string) => `NotePic OSS：${m}。请到设置里填写。`,
    connectionOk: "NotePic OSS：连接成功 ✅",
    connectionFailed: (m: string) =>
      `NotePic OSS：连接失败 — ${m}。如果看起来像跨域问题，请到 Bucket 的 CORS 设置里允许来自 app:// 的 PUT/HEAD/DELETE。`,
  },
  validation: {
    accessKeyId: "Access Key ID 必填",
    accessKeySecret: "Access Key Secret 必填",
    endpoint: "Endpoint 必填",
    bucket: "Bucket 必填",
  },
  settings: {
    section_credentials: "OSS 凭据",
    section_upload: "上传行为",
    section_connection: "连接测试",
    section_safety: "安全说明",
    required_hint: "为必填项。",
    required_hint_prefix: "标",
    accessKeyId_name: "Access Key ID",
    accessKeyId_desc:
      "阿里云 RAM 子账号的 AccessKey ID。明文保存在本插件的 data.json 里。",
    accessKeySecret_name: "Access Key Secret",
    accessKeySecret_desc: "阿里云 RAM 子账号的 AccessKey Secret。",
    endpoint_name: "Endpoint",
    endpoint_desc: "区域 Endpoint，例如 https://oss-cn-hangzhou.aliyuncs.com",
    bucket_name: "Bucket",
    bucket_desc: "OSS Bucket 名称",
    prefix_name: "Prefix",
    prefix_desc: "Bucket 内的对象前缀，例如 \"markdown\"。留空表示直接放在根目录。",
    customDomain_name: "自定义域名 / CDN",
    customDomain_desc: "可选。设置后用此域名拼接最终 URL，而不是默认的 bucket.endpoint。",
    compress_name: "压缩图片",
    compress_desc:
      "上传前重新编码：JPEG / WebP 走 Canvas，PNG 走 UPNG.js（量化 + Deflate）。",
    quality_name: "压缩质量",
    quality_desc: "JPEG / WebP 质量（1–100）。85 对照片接近视觉无损。",
    processRemote_name: "同时上传外链图片",
    processRemote_desc: "默认关闭：只上传 Vault 内的本地图片。",
    concurrency_name: "并发数",
    concurrency_desc: "同时进行的上传任务数。",
    test_name: "连接测试",
    test_desc:
      "PUT、HEAD、再 DELETE 一个 1 字节的探针对象，用于校验凭据和 Bucket 的 CORS 配置。",
    test_button: "开始测试",
    test_running: "测试中…",
    safety_ram:
      "建议使用专门的 RAM 子账号，只授予目标 Bucket 的 oss:PutObject / oss:GetObject / oss:HeadObject / oss:DeleteObject 权限。",
    safety_storage:
      "凭据以明文保存在 .obsidian/plugins/notepic-oss/data.json。" +
      "如果你的 Vault 是公开 Git 仓库，请把这个路径加进 Vault 的 .gitignore。",
    safety_cors_prefix:
      "Bucket 的 CORS 规则（阿里云 OSS 控制台）：来源 ",
    safety_cors_origin_and: " 或 ",
    safety_cors_methods: "，方法 ",
    safety_cors_headers: "，请求头 ",
    safety_cors_suffix: "。",
  },
  progress: {
    title: "NotePic OSS：上传中",
    preparing: "准备中…",
    empty: "没有需要上传的图片。",
    progressOf: (done: number, total: number, current?: string) =>
      `${done} / ${total}${current ? ` — ${current}` : ""}`,
    done: (found: number, uploaded: number, skipped: number, failed: number, drifted: number) =>
      `完成。共 ${found} 张，上传 ${uploaded}，跳过 ${skipped}，失败 ${failed}` +
      (drifted > 0 ? `，偏移 ${drifted}` : ""),
  },
  panel: {
    title: "图片管理面板",
    titleWithFile: (name: string, n: number) => `${name} · 共 ${n} 张`,
    refresh: "刷新",
    emptyNoFile: "打开一篇笔记后即可管理其图片。",
    emptyUnsupported: "当前文件类型不支持（仅 md / mdx / markdown / html）。",
    emptyNoImages: "当前笔记里没有发现图片。",
    localPrefix: "本地 · 仓库",
    targetArrow: "→",
    ossBadge: "OSS",
    uploadRow: "上传这张图片",
    uploadingRow: "上传中…",
    filter_all: "全部",
    filter_local: "仅本地",
    filter_pending: "尚未上传",
    filter_missing: "缺失",
    toggleVisible: "全选",
    noMatch: "当前过滤条件下没有匹配的图片。",
    selected: (n: number) => `已选 ${n} 项`,
    uploadN: (n: number) => `上传 ${n} 项`,
    upload: "上传",
    kind_wikilink: "![[wiki 链接]]",
    kind_md: "![]()",
    kind_html: "<img>",
    kind_ref: "[ref]:",
    badge_local: "本地",
    badge_oss: "OSS",
    badge_remote: "云端",
    badge_missing: "缺失",
    badge_skip: "跳过",
  },
  failure: {
    title: (n: number) => `${n} 张图片上传失败`,
    noReason: "（未提供原因）",
    copy: "复制失败列表",
    copied: "已复制 ✓",
    close: "关闭",
  },
  reason: {
    notFound: (raw: string) => `未找到：${raw}`,
    alreadyOss: "已在 OSS",
    remoteSkip: "外链（开启对应选项后才会上传）",
    cancelled: "已取消",
    empty: "空 URL",
    dataUri: "data: 内联图",
    anchor: "锚点链接",
    mailto: "mailto 链接",
    obsidianUrl: "Obsidian 内部 URL",
    absFsPath: "绝对文件系统路径",
  },
};

/** Returns the current-language dictionary. Re-evaluates only on first call. */
export function t(): typeof en {
  return detectLang() === "zh" ? zh : en;
}
