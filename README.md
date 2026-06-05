# NotePic OSS — Obsidian 插件

**Made by [@LuhuiDev](https://luhuidev.com) · Part of [LuhuiDev Toolkit](https://luhuidev.com)**

把当前笔记里引用的图片一键上传到阿里云 OSS，先压缩、再去重，最后就地重写图片链接 —— 全程不用离开 Obsidian。

本插件是 [NotePic-OSS-CLI](https://github.com/Luhui-Dev/NotePic-OSS-CLI) 的姊妹形态。两端共用同一套 OSS 命名约定（`<prefix>/<sha256[:24]>.<ext>`），所以 CLI 上传过的图在插件里会被识别为「已在 OSS」直接跳过，反之亦然。

## 特性

- 识别四种主流图片语法：`![[wiki 链接.png]]`、`![alt](./相对路径.png)`、`<img src="…">`、`[label]: ./img.png`。
- 两种上传入口：
  - **一键命令** —— 扫描当前笔记里所有图片，全部上传后就地替换链接。
  - **图片管理面板（Modal）** —— 缩略图 + 体积 + 状态徽章一览，按需多选。
- 压缩：JPEG / WebP 走 Canvas（质量 1–100 可调），PNG 走 UPNG.js（量化 + Deflate，效果接近 pngquant）。GIF / SVG / 动画图直接透传。
- 上传幂等：SHA-256 内容哈希 + `headObject` 短路，重复内容不会再上传一次。
- 并发上传（默认 3，可配），进度走 Notice，失败项弹出失败列表 Modal 并支持一键复制。
- 并发编辑保护：上传期间笔记内容若被修改，受影响的引用会跳过并以 `偏移=N` 报告，绝不覆盖你正在打字的位置。
- 界面跟随 Obsidian 的语言设置自动切换中文 / 英文。

## 安装

插件尚未提交到 Obsidian 社区插件市场。手动安装步骤：

1. 从 GitHub Releases 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放到 `<你的 Vault>/.obsidian/plugins/notepic-oss/` 目录下。
3. 重启 Obsidian（或在 **设置 → 第三方插件** 里关掉再打开本插件）。

> 如果在 **设置 → 第三方插件** 里看不到本插件，请先关闭顶部的「受限模式 / Restricted mode」横幅。

## 配置

打开 **设置 → NotePic OSS**，按如下字段填写：

| 字段 | 说明 |
|---|---|
| Access Key ID / Secret | 阿里云 **RAM 子账号** 的 AK，建议只授予目标 Bucket 的 `oss:PutObject / oss:GetObject / oss:HeadObject / oss:DeleteObject` 权限。 |
| Endpoint | 区域 Endpoint，例如 `https://oss-cn-hangzhou.aliyuncs.com` |
| Bucket | OSS Bucket 名称 |
| Prefix | Bucket 内可选的对象前缀（例如 `markdown`），留空表示直接放在根目录。 |
| 自定义域名 / CDN | 可选。设置后生成的 URL 用这个域名，而不是默认的 `<bucket>.<endpoint>`。 |
| 压缩开关 / 质量 | 是否压缩 + 质量滑块（默认 85）。 |
| 同时上传外链图片 | 默认关闭 —— 只上传 Vault 里的本地图片。 |
| 并发数 | 同时进行的上传任务数（默认 3）。 |

在「连接测试」区段点 **开始测试**，插件会向 Bucket 上传 → HEAD → 删除一个 1 字节的探针对象，用来校验凭据和 CORS 配置。如果失败信息提到跨域，参考下面的 CORS 配置。

## Bucket 的 CORS 配置

插件运行在 Electron / WebView 里，受 CORS 约束。请在 OSS 控制台为 Bucket 加一条规则（**安全设置 → 跨域设置**）：

- **来源 (Allowed Origins)**：`app://obsidian.md`，或者直接写 `*` 也可以
- **允许方法 (Allowed Methods)**：`PUT, GET, HEAD, DELETE`
- **允许请求头 (Allowed Headers)**：`*`
- **暴露请求头 (Expose Headers)**：`ETag`（可选，建议加）

## 使用

在任意 Markdown 笔记（`.md` / `.mdx`）里，按 ⌘P 打开命令面板，运行：

- **NotePic OSS：上传当前笔记中的所有图片到 OSS（覆盖式）** —— 扫描当前笔记，上传所有本地图片并替换为 OSS URL。
- **NotePic OSS：打开当前笔记的图片管理面板** —— 弹出 Modal，列出所有图片的缩略图、体积、状态徽章；可在 *全部 / 仅本地 / 尚未上传 / 缺失* 之间过滤，勾选要上传的图片后点 *上传 N 项*。

两个命令同样出现在笔记右上角的 **More options** 菜单和编辑器右键菜单里。插件不预设快捷键，需要的话请到 **设置 → 快捷键** 自行绑定。

## 安全建议

- 凭据以明文保存在 `.obsidian/plugins/notepic-oss/data.json`。如果你的 Vault 是公开的 Git 仓库，请把 `.obsidian/plugins/*/data.json` 加进 Vault 的 `.gitignore`。
- 永远使用 RAM 子账号填到这里，**不要** 用阿里云主账号的 AK。

## 与 CLI 的对应关系

| 模块 | CLI | 插件 |
|---|---|---|
| 图片识别 | `processor.py` 正则 | `src/core/scanner.ts`（同一套正则的 1:1 移植） |
| Vault 内查找图片 | `os.walk` + `.obsidian` 自动检测 | `app.metadataCache.getFirstLinkpathDest` |
| 压缩 | Pillow JPEG q85 / PNG 无损 / WebP method=6 | Canvas JPEG · WebP / UPNG.js PNG |
| OSS 上传 | `oss2` Python SDK | `ali-oss` 浏览器构建 |
| 对象 Key | `<prefix>/<sha256[:24]>.<ext>` | 同上 |
| 幂等去重 | `object_exists` 短路 | `headObject` 短路 |

命名约定一致意味着一篇笔记如果一部分被 CLI 处理过，再用插件打开，已上传过的图不会再上传一次。

## 开发

```bash
cd NotePic-OSS-Obsidian
npm install
npm run dev      # esbuild watch 模式 → main.js
npm run build    # 生产构建 + tsc --noEmit
npm test         # vitest
```

把构建产物 symlink 到你的 Vault 即可热测：

```bash
# 进到 NotePic-OSS-Obsidian/
ln -sf "$(pwd)/main.js"      "<vault>/.obsidian/plugins/notepic-oss/main.js"
ln -sf "$(pwd)/manifest.json" "<vault>/.obsidian/plugins/notepic-oss/manifest.json"
ln -sf "$(pwd)/styles.css"   "<vault>/.obsidian/plugins/notepic-oss/styles.css"
```

每次 rebuild 后回到 Obsidian 重载工作区（⌘R）即可。

## 国际化（i18n）

插件读取 Obsidian 的语言设置（`localStorage.language`）：值以 `zh` 开头时显示中文，其余一律显示英文。如要在两种语言之间切换，直接在 **Obsidian 设置 → 关于 → 语言** 改完重启即可。

## License

MIT —— 与主项目一致。
