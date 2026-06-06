# NotePic OSS Obsidian

> Upload images referenced in the current Obsidian note to Aliyun OSS, then rewrite links in place.

[![License](https://img.shields.io/github/license/Luhui-Dev/NotePic-OSS-Obsidian)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.8.7%2B-7c3aed)](https://obsidian.md/)
[![Release](https://img.shields.io/github/v/release/Luhui-Dev/NotePic-OSS-Obsidian)](https://github.com/Luhui-Dev/NotePic-OSS-Obsidian/releases)
[![Community Plugin](https://img.shields.io/badge/Obsidian%20Community%20Plugin-NotePic%20OSS-7c3aed)](https://community.obsidian.md/plugins/notepic-oss)

**Made by [@LuhuiDev](https://luhuidev.com) · Part of [LuhuiDev Toolkit](https://luhuidev.com)**

NotePic OSS Obsidian 是 NotePic OSS 的 Obsidian 插件实现。它会扫描当前笔记中的图片引用，在 Obsidian 内完成压缩、去重、上传到阿里云 OSS，并把链接原地替换为公网 URL。

如果你需要批量处理文章、接入 CI 或站点构建流程，请看姊妹项目 [NotePic-OSS-CLI](https://github.com/Luhui-Dev/NotePic-OSS-CLI)。

## 快速开始

NotePic OSS 已发布到 Obsidian 社区插件目录。

1. 打开 **Settings → Community plugins → Browse**。
2. 搜索 `NotePic OSS`，或打开 [官方插件页](https://community.obsidian.md/plugins/notepic-oss)。
3. 安装并启用 NotePic OSS。
4. 打开 **Settings → NotePic OSS**，填写 OSS 配置并运行连接测试。

如果需要手动安装，可以从 [GitHub Releases](https://github.com/Luhui-Dev/NotePic-OSS-Obsidian/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放到 `<你的 Vault>/.obsidian/plugins/notepic-oss/`，再在第三方插件设置中重新加载并启用插件。

## 特性

- 识别 `![[wiki 链接.png]]`、`![alt](./image.png)`、`<img src="...">`、`[label]: ./image.png`。
- 提供两个入口：上传当前笔记全部图片，或打开右侧图片管理面板选择性上传。
- 图片面板支持缩略图、体积、状态徽章、过滤和多选上传。
- JPEG / WebP 使用 Canvas 压缩，PNG 使用 UPNG.js；GIF / SVG / 动画图保持原样。
- 使用 SHA-256 内容哈希生成对象名，并通过 `headObject` 避免重复上传。
- 上传期间如果笔记内容发生漂移，受影响引用会跳过，避免覆盖正在编辑的位置。
- 根据 Obsidian 界面语言自动显示中文或英文。

## 配置

打开 **设置 → NotePic OSS**，填写以下字段：

| 字段                      | 必填 | 说明                                                       |
| ------------------------- | ---- | ---------------------------------------------------------- |
| Access Key ID             | 是   | 阿里云 RAM 子账号 AccessKey ID                             |
| Access Key Secret         | 是   | 阿里云 RAM 子账号 AccessKey Secret                         |
| Endpoint                  | 是   | 区域 Endpoint，例如 `https://oss-cn-hangzhou.aliyuncs.com` |
| Bucket                    | 是   | OSS Bucket 名称                                            |
| Prefix                    | 否   | Bucket 内对象前缀，例如 `markdown`                         |
| Custom domain / CDN       | 否   | 用于生成最终 URL 的自定义域名                              |
| Compress images           | 否   | 是否在上传前压缩图片                                       |
| Quality                   | 否   | JPEG / WebP 质量，范围 1-100，默认 85                      |
| Also upload remote images | 否   | 默认关闭，只处理 Vault 内本地图片                          |
| Upload concurrency        | 否   | 并发上传数，默认 3                                         |

连接测试会向 Bucket 上传、HEAD、删除一个 1 字节探针对象，用来验证凭据、权限和 CORS。

## Bucket CORS

插件运行在 Obsidian 的 Electron / WebView 环境中，浏览器端直传 OSS 需要配置 CORS。

在阿里云 OSS 控制台打开目标 Bucket 的 **安全设置 → 跨域设置**，添加规则：

| 项              | 值                                              |
| --------------- | ----------------------------------------------- |
| Allowed Origins | `app://obsidian.md`，开发或排障时也可临时用 `*` |
| Allowed Methods | `PUT, GET, HEAD, DELETE`                        |
| Allowed Headers | `*`                                             |
| Expose Headers  | `ETag`                                          |

如果连接测试提示跨域错误，优先检查 Origins 和 Methods。

## 使用

在支持的文件中打开命令面板，运行：

```text
NotePic OSS: 上传当前笔记中的所有图片到 OSS（覆盖式）
NotePic OSS: 打开当前笔记的图片管理面板
```

支持的文件类型：

```text
.md .mdx .markdown .html .htm
```

两个命令也会出现在编辑器右键菜单中。左侧 Ribbon 图标会打开右侧图片管理面板。插件不预设快捷键，需要时可在 **设置 → 快捷键** 自行绑定。

## 图片状态

图片管理面板会把当前笔记中的图片分成几类：

| 状态    | 含义                                                |
| ------- | --------------------------------------------------- |
| local   | Vault 内本地图片，可上传                            |
| OSS     | 已经在当前 Bucket 或自定义域名下，会跳过            |
| cloud   | 远程图片；默认跳过，开启远程上传后可搬运            |
| missing | 本地文件无法解析或不存在                            |
| skip    | `data:`、锚点、邮件链接、非图片 wikilink 等无需处理 |

## 安全建议

- 使用专属 RAM 子账号，不要使用阿里云主账号 AccessKey。
- 建议权限限制到目标 Bucket 的 `oss:PutObject`、`oss:GetObject`、`oss:HeadObject`、`oss:DeleteObject`。
- 插件配置会明文保存在 `<Vault>/.obsidian/plugins/notepic-oss/data.json`。
- 如果 Vault 是公开 Git 仓库，请把 `.obsidian/plugins/*/data.json` 加入 Vault 的 `.gitignore`。

## License

MIT
