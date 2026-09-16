# LumiLuna · 光影媒体库

<div align="center">

**全媒体管理应用** —— 在一个桌面应用里浏览、整理与播放 **图片、视频、音乐、电子书（EPUB/PDF）**，并内置 Pixiv、在线小说、在线番剧三大在线源。

[简体中文](README_zh.md) ｜ [English](README.md)

当前版本 **v1.2.1**

</div>

LumiLuna 基于 **Tauri 2 + Vue 3 + TypeScript + Material Design 3** 构建：一套 Web 前端 + Rust 原生后端，数据全部留在本地，无云同步、不强制账号。

音乐播放器采用 **类 Apple Music 样式** —— 流体动态背景、封面驱动取色、逐字卡拉 OK 歌词；整个应用严格遵循 **Material Design 3** 设计系统。

## ✨ 功能特性

### 🗂️ 本地媒体库

- 图片 / 视频 / 音乐 / 电子书（EPUB、PDF）四类媒体统一管理，递归扫描目录 + SQLite（WAL）索引
- 音频标签（lofty）、EXIF 取向、图片与视频缩略图缓存
- 文件夹浏览、收藏、历史记录、回收站（可恢复）
- Windows 自定义无边框标题栏 + 托盘 + 全局热键

### 🎵 音乐播放器

- **类 Apple Music 播放器**：流体动态背景、封面驱动取色、逐字卡拉 OK 歌词
- **逐字歌词**：QQ 音乐 QRC / 酷狗 KRC 官方时间轴，外加 Web Worker + FFT（谱通量）本地分析兜底
- **音效引擎**：10 段 EQ + 低音增强 + 混响 + 立体声宽度，预设可保存 / 导入导出 / 生成分享码（LLFX3 紧凑格式）
- **桌面歌词**：独立透明置顶窗口、鼠标穿透、4 种切换动画、位置记忆与锁定
- **SMTC（Windows 系统媒体控件）**：任务栏媒体浮层、媒体键（播放/暂停/切歌/拖动进度）、封面图
- **在线音乐**：网易云扫码 / 手机号登录（weapi / xeapi 全协议）、云盘与歌单；另有实验性 Meting 聚合源
- 现在就听信息流（私人 FM / 每日推荐）、评论面板、听歌时长统计

### 📖 阅读器

- 内置 **EPUB / PDF** 阅读器：章节目录侧边栏、单页 / 双页 / 滚动模式
- 阅读进度 **自动保存与恢复**（CFI 精确定位，退出应用或关闭书籍时保存）
- 背景主题（dark / light / sepia / green）、正文字体、字号、行距、段距可调
- 在线小说同样复用完整阅读设置与分页排版

### 🌐 在线内容源

- **在线图片（Pixiv）** —— 登录、推荐 / 排行榜 / 搜索、作品详情与多页大图、评论、收藏、关注与关注流、ugoira 动图；图片经 Rust 代理取回并自动携带 `Referer`。默认关闭，需在设置中开启
- **在线小说** —— 文库（Wenku8）登录与在线书架、笔趣阁（BQG）源、在线阅读与阅读统计
- **在线番剧** —— 规则采集式聚合搜索与换源、热门番组主页、Bangumi 详情与追番同步；ArtPlayer 播放 + DanDanPlay 弹幕 + HLS

### 🎨 外观与扩展

- **Material Design 3** 设计系统：Monet 动态取色、浅色 / 深色 / 跟随系统
- **皮肤系统**：外部皮肤包（ZIP 资产 + 背景图 + 图标包 + CSS 注入）导入与固化，内置多款皮肤，示例见 `example/`
- **扩展框架（Extension Host）**：扩展以独立 sidecar 运行，主项目零体积增加；首个参考扩展 **MiaoHui（妙绘）** 提供图片 / 视频索引 + OCR + ASR + 向量检索
- 音效预设市场：在线拉取社区预设，一键导入
- 🌍 中 / 英双语 i18n

## 🔗 参考项目

本项目的部分功能参考或移植自以下开源项目，感谢原作者的工作：

| 项目 | 用途 | 许可证 |
|---|---|---|
| [pixez-flutter](https://github.com/Notsfsssf/pixez-flutter) | Pixiv 登录、图片查看 | GPL-3.0 |
| [hikari_novel_flutter](https://github.com/15dd/hikari_novel_flutter) | 小说解析 | MIT |
| [Kazumi](https://github.com/Predidit/Kazumi) | 动漫解析 | GPL-3.0 |
| [LDDC](https://github.com/chenmozhijin/LDDC) | QQ 音乐 QRC 逐字歌词 | GPL-3.0-only |

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 1.82+
- Windows 本地构建 Tauri 需要 MSVC Build Tools

### 本地开发

```bash
npm install
npm run tauri dev
```

### 仅前端预览（浏览器 + mock 数据）

```bash
npm install
npm run dev            # Vite dev server (localhost:1420)
```

### 打包构建

```bash
npm run build          # 类型检查 + 构建前端
npx tauri build        # 打包（Windows NSIS/MSI、Linux AppImage）
```

> **CI/CD（推荐）**：推送代码到 `main` 自动构建 Windows NSIS + Linux AppImage（产物在 Actions Artifacts）；推送 `v*` Tag 自动创建 GitHub Release 可直接下载安装。无需本地安装 MSVC。

## 🏗️ 技术栈

| 领域 | 技术 |
|---|---|
| 桌面壳 | **Tauri 2**（Rust） |
| 前端 | **Vue 3 + Vite + TypeScript** |
| 状态管理 | **Pinia** |
| UI | **Material Design 3**（`@m3e/web` M3 Expressive + `@material/web` + 自定义组件） |
| 数据库 | **rusqlite**（SQLite，WAL） |
| 音频元数据 / 缩略图 | **lofty**、**image**、**kamadak-exif** |
| Windows 媒体控件 | **smtc-tokio** + **tiny_http**（SMTC） |
| 在线番剧播放 | **ArtPlayer** + **hls.js** + DanDanPlay 弹幕 |
| EPUB / PDF | **epub.js**、**pdf.js** |
| 网页解析 | **scraper**、**regex**、**roxmltree** |
| 网易云协议 | 纯 Rust weapi / eapi / xeapi 签名（AES-CBC/ECB、RSA、X25519 + AES-GCM） |
| 逐字时间轴分析 | Web Worker + FFT（谱通量）+ IndexedDB |
| 在线音乐聚合 | meting API |
| 国际化 | 自研轻量 i18n（`shared/i18n.ts`） |

## 📁 目录结构

```
src/               # Web 前端
  capabilities/    # 统一原生能力接口（invoke 封装 + 浏览器 mock）
  stores/          # Pinia 状态（library / player / settings / pixiv / anime / skins / audioEffects …）
  components/      # FluidBackground / LyricsView / BookReader / NovelReader / AnimePlayer / PixivCard …
  views/           # 各 Tab 页 / 全屏播放器 / 桌面歌词 / 扩展宿主
  workers/         # 逐字分析 Web Worker
  utils/           # 歌词时间轴 / 动漫规则与取流 / 网易云 / 皮肤 / WebDAV / 音效 …
  tokens/          # M3 设计令牌（theme.css、fonts.css）
src-tauri/         # Rust 后端
  src/commands/    # 扫描 / 元数据 / 缩略图 / 书籍 / SMTC / 皮肤 / 扩展 / FFmpeg
  src/*.rs         # pixiv / novel / anime / netease / webdav / tray / media
  capabilities/    # Tauri 权限（最小授权）
  tauri.conf.json
shared/            # 双端共享类型 / i18n
example/           # 示例皮肤
miaohui-extension/ # 参考扩展：图片视频索引 + OCR + ASR + 向量检索（MIT）
doc/               # 设计与方案文档
.github/workflows/ # GitHub Actions 自动构建
```

## 🤝 贡献

欢迎提交 Issue 与 Pull Request！重大改动建议先通过 Issue 讨论。

## 📄 许可证

本项目采用 **GPL-3.0-only** 许可协议，完整文本见 [LICENSE](LICENSE)。

参考与移植的第三方项目：

- [pixez-flutter](https://github.com/Notsfsssf/pixez-flutter) —— Pixiv 登录、图片查看（© Notsfsssf，GPL-3.0）
- [hikari_novel_flutter](https://github.com/15dd/hikari_novel_flutter) —— 小说解析（© 15dd，MIT）
- [Kazumi](https://github.com/Predidit/Kazumi) —— 动漫解析（© Predidit，GPL-3.0）
- [LDDC](https://github.com/chenmozhijin/LDDC) —— QQ 音乐 QRC 逐字歌词模块移植自该项目（© 沉默の金，GPL-3.0-only）

> 各参考项目的许可条款适用于其对应代码；本项目的自有代码仍以 GPL-3.0-only 发布。
