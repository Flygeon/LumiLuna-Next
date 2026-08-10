# LumiLuna（光影 · 媒体库）

**本地优先（Local-first）全媒体管理应用** —— 基于 **Tauri 2 + Vue 3 + TypeScript + Material Design 3** 重构。

在一套 Web 前端 + Rust 原生后端的架构下，浏览、整理与播放**图片、视频、音乐、电子书（EPUB/PDF）**四类内容。音乐播放器**尽量 1:1 复刻 Apple Music**（流体动态背景 + 滚动歌词 + 封面驱动取色），并严格遵循 **Material Design 3** 设计系统。

> 参考文件优先原则：本实现以 `音乐播放器参考/`（类 Apple Music 歌词播放器）为蓝本，所有魔法数字、缓动曲线、模糊/饱和/亮度值均按其 `index.css` / `index.js` 原样保留。

---

## ✨ 功能特性

### 媒体扫描与索引（Rust 高性能核心）
- 递归扫描（`walkdir`）、类型识别、xxh3 哈希（`xxhash-rust`）
- 元数据提取：音频（`lofty`）、图片 EXIF（`kamadak-exif`）、缩略图（`image`）
- SQLite 存储（`rusqlite`），增量更新 + 取消 + 进度推送（`tokio` + Tauri 事件）
- 文件监听增量更新（`notify`）

### 音乐播放器（类 Apple Music）
- **流体动态背景**：4 象限自转 + `screen` 混合 + `blur(30px) saturate(2.5) brightness(0.5)` + `scale(1.5)`，20s 慢速漂移
- **滚动歌词**：`LYRIC_OFFSET = 视口高/3`、当前行放大 1.25×、距离模糊、上下渐隐遮罩、点击跳转、原文/翻译切换
- **封面驱动取色**：4 象限均值采样 + 欧氏距离去重，映射到 M3 token
- 进度条 hover 变粗 + thumb、播放/暂停主按钮 68px、倍速 0.5–2.0x、循环/随机 Segment
- 宽窗口两栏 / 窄窗口分页响应式

### 其它
- 图片 / 视频 / 书籍 / 文件夹 Tab 页
- 明暗双主题 + M3 全局令牌换肤（桌面自定义主题色）
- 中 / 英双语 i18n
- 收藏 / 历史 / 回收站 / 设置
- Windows NSIS 安装包 + zip、Android APK、Linux AppImage

---

## 🏗️ 技术栈

| 领域 | 技术 |
|---|---|
| 桌面壳 | **Tauri 2**（Windows 主力）|
| 移动壳 | **Tauri 2 Android**（复用同一 Rust 核心 + 前端）|
| 前端 | **Vue 3 + Vite + TypeScript**（Material Design 3）|
| 状态管理 | **Pinia** |
| 组件库 | **@material/web**（M3 组件）+ 自定义 M3 组件 |
| 数据库 | **rusqlite**（SQLite）|
| 原生能力 | walkdir、xxhash-rust、lofty、kamadak-exif、image、notify |
| 动态取色 | @material/material-color-utilities |
| 国际化 | 自研轻量 i18n（vue-i18n 可替换）|

---

## 📦 构建 / 安装 / 运行

### 1. 本地开发
```bash
npm install
npm run tauri dev
```
> 需要 Rust 工具链与系统依赖（Linux 需 `libwebkit2gtk-4.1` 等，见 `.github/workflows/build.yml`）。

### 2. 前端仅预览
```bash
npm install
npm run dev     # Vite dev server (localhost:1420)，走 capabilities mock 数据
```

### 3. 打包构建
```bash
# Windows NSIS 安装包 + 免安装 zip
cd src-tauri && cargo tauri build --bundles nsis,zip

# Android APK
rustup target add aarch64-linux-android
cargo tauri android build --apk
```

### 4. CI/CD 自动构建（推荐）
推送代码到 GitHub 后自动构建：

- **`main` push**：自动构建 Windows NSIS 安装包 + Linux AppImage，产物上传到 Actions Artifacts
- **Tag 推送**（如 `v1.0.0`）：自动构建并创建 GitHub Release，可直接下载安装
- **PR**：自动构建校验（省资源）

无需本地安装 MSVC / Build Tools，GitHub runner 自带完整工具链。

---

## 📁 目录结构
```
src/                    # Web 前端源码
  capabilities/         # 统一原生能力接口（invoke 封装）
  stores/               # Pinia 状态（library/player/settings）
  tokens/               # M3 设计令牌（theme.css）
  components/           # FluidBackground / LyricsView / MiniPlayer
  views/                # 各 Tab 页 / Now Playing
src-tauri/              # Rust 后端
  src/commands/         # 扫描/元数据/歌曲/缩略图 Command
  capabilities/         # Tauri 权限（最小授权）
  tauri.conf.json       # 应用配置
shared/                 # 双端共享类型 / i18n / LRC 解析
.github/workflows/      # GitHub Actions 自动构建
```

---

## 🔒 安全与架构约定
- 一切原生能力经 `invoke` + `listen/emit` 走 Rust Command，前端不直接触碰磁盘/数据库
- `capabilities/default.json` 最小权限授权，不做 `*` 通配
- 重活（扫描/哈希/元数据/缩略图）全部在 Rust `tokio`/`rayon` 中执行
- 播放器动效魔法数字原样保留（见第四章第 5 节）

---

## 📄 版权
- 应用本体开源可自由使用
- 音乐播放器参考代码（`音乐播放器参考/`）按原作者开源许可使用，仅作参考；`TestAudio` 等目录版权归原作者，未授权不得商用转载
- 内置字体为开源思源黑体 / SF Pro 等演示字体

MIT License
