# LumiLuna · 光影媒体库

<div align="center">

**全媒体管理应用** —— 在一个桌面应用里浏览、整理与播放**图片、视频、音乐、电子书（EPUB/PDF）**。

[简体中文](README_zh.md) ｜ [English](README.md)

</div>

LumiLuna 基于 **Tauri 2 + Vue 3 + TypeScript + Material Design 3** 构建：一套 Web 前端 + Rust 原生后端，所有数据都留在本地。

音乐播放器**类Apple Music样式**——流体动态背景、封面驱动取色、逐字卡拉OK 歌词；整个应用严格遵循 **Material Design 3** 设计系统。

> 参考文件优先原则：本实现以 `音乐播放器参考/`（类 Apple Music 歌词播放器）为蓝本，所有魔法数字、缓动曲线、模糊/饱和/亮度值均按其 `index.css` / `index.js` 原样保留。

## ✨ 功能特性

1. 🎨 **Material design 3设计理念**——遵循M3设计理念，莫奈动态配色。
2. 🗂️ **多类型媒体聚合**——图片、视频、音乐、电子书（EPUB/PDF），支持递归扫描 + SQLite 索引。
3. 🎵 **类 Apple Music 播放器**——流体动态背景、封面驱动取色、模拟逐字歌词
4. 🖥️ **SMTC（Windows 系统媒体控件）支持**——任务栏媒体浮层、媒体键（播放/暂停/上一首/下一首/拖动进度）、封面图。
5. 🌐 **在线音乐（实验性）**——基于开源项目 meting API 的搜索与歌单，可下载音频与封面到本地。
6. 📖 **内置 EPUB / PDF阅读器**——可展开的章节目录侧边栏，**阅读进度自动保存与恢复**（CFI 精确定位，退出应用/关闭书籍都会保存）。PDF阅读器支持单页 / 双页 / 滚动三种模式。
7. 🌍 **中 / 英双语** i18n · 🗑️ 收藏、历史、回收站。

## 🚀 快速开始

### 环境要求
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 工具链
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
| UI | **Material Design 3**（`@material/web` + 自定义组件） |
| 数据库 | **rusqlite**（SQLite，WAL） |
| 音频元数据 / 缩略图 | **lofty**、**image**、**kamadak-exif** |
| Windows 媒体控件 | **smtc-tokio** + **tiny_http**（SMTC） |
| EPUB / PDF | **epub.js**、**pdf.js** |
| 逐字时间轴分析 | Web Worker + FFT（谱通量）+ IndexedDB |
| 在线音乐 | meting API |
| 国际化 | 自研轻量 i18n |

## 📁 目录结构

```
src/               # Web 前端源码
  capabilities/    # 统一原生能力接口（invoke 封装 + 浏览器 mock）
  stores/          # Pinia 状态（library / player / settings）
  components/      # FluidBackground / LyricsView / BookReader / ContextMenu …
  views/           # 各 Tab 页 / 全屏播放器
  workers/         # 逐字分析 Web Worker
  utils/           # 歌词时间轴 / meting API / 逐字缓存与分析 / 格式化
  tokens/          # M3 设计令牌（theme.css）
src-tauri/         # Rust 后端
  src/commands/    # 扫描 / 元数据 / 歌曲 / 缩略图 / SMTC / 书籍
  capabilities/    # Tauri 权限（最小授权）
  tauri.conf.json
shared/            # 双端共享类型 / i18n
.github/workflows/ # GitHub Actions 自动构建
```

## 🤝 贡献

欢迎提交 Issue 与 Pull Request！重大改动建议先通过 Issue 讨论。

## 📄 许可证

本项目采用 **GPL-3.0-only** 许可协议，完整文本见 [LICENSE](LICENSE)。

QQ 音乐 QRC 逐字歌词模块移植自 [LDDC](https://github.com/chenmozhijin/LDDC)（© 沉默の金，GPL-3.0-only）。
