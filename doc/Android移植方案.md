# LumiLuna Next · Android 移植方案

> 版本：v1（2026-08-20）
> 适用代码基线：`lumiluna` 1.1.0（Tauri 2 + Vue 3 + MD3）
> 目标平台：Android 7.0 (API 24) 及以上，系统 WebView 驱动
> 状态：规划稿。尚未执行 `tauri android init`，`src-tauri/gen/` 为空，属**全新移植（greenfield）**。

---

## 目录

1. [结论速览（TL;DR）](#1-结论速览tldr)
2. [现状架构盘点](#2-现状架构盘点)
3. [兼容性矩阵](#3-兼容性矩阵)
4. [关键阻断项与对策](#4-关键阻断项与对策)
5. [需要新增的原生插件](#5-需要新增的原生插件)
6. [分阶段路线图](#6-分阶段路线图)
7. [构建与工具链](#7-构建与工具链)
8. [权限、清单与合规](#8-权限清单与合规)
9. [测试策略](#9-测试策略)
10. [风险登记表](#10-风险登记表)
11. [附录 A：代码改动清单](#附录-a代码改动清单速查)

---

## 1. 结论速览（TL;DR）

**可行，但不是"一键出包"。** Tauri 2 官方支持 Android，本项目的**在线与阅读类功能**几乎可以平移；真正的工作量集中在四处**桌面中心化设计**上：

| 维度 | 判断 |
|---|---|
| 整体可行性 | ✅ 可行。核心难点是"本地库扫描"和"桌面歌词"两大桌面特性，而非技术栈本身。 |
| 直接可用 | SQLite 索引、在线音乐（网易云/meting）、在线小说（Wenku8 抓取）、WebDAV、EPUB/PDF 阅读、收藏/历史/统计、Web Audio 均衡器 |
| 需适配 | 网络层 TLS（native-tls→rustls）、后台播放、响应式布局与触摸交互、平台判定 |
| 需重写或砍掉 | 本地文件扫描模型、ffmpeg、桌面歌词双窗口、系统托盘、窗口控制/自定义标题栏、SMTC |

**推荐策略：分阶段"在线优先 + 阅读优先"的 MVP，再逐步补齐本地媒体与原生增强。**

理由：平移成本最低的恰是 Android 的强项（流媒体、阅读、远程库），而成本最高的恰是纯桌面特性（任意目录扫描、悬浮窗、托盘）。先用 4 个阶段把可用面铺开，把 ffmpeg/悬浮窗这类高成本项后置或降级，避免一开始就啃最硬的骨头。

**最需要提前拍板的两个架构决策：**

- **后台播放**：当前播放依赖 WebView 里的 HTML5 `<audio>` + Web Audio EQ（`convertFileSrc()`）。WebView 在应用退到后台/息屏时会**挂起媒体**。要做真正的后台播放，需把音频解码/播放下沉到原生 Media3/ExoPlayer（较大改造，且会失去基于 `createMediaElementSource` 的 Web Audio 均衡器，需改用原生 `Equalizer`）。MVP 可先接受"仅前台播放"。详见 [§4.5](#45-后台播放与-smtc--android-mediasession)。
- **本地媒体访问模型**：Android 10+ 的分区存储（scoped storage）不允许 `walkdir` 任意绝对路径。必须改走 **MediaStore**（音/视/图，免特殊权限）+ **SAF**（书籍等任意目录）。这会牵动扫描、缩略图、元数据与前端 `convertFileSrc` 全链路。详见 [§4.1](#41-本地文件系统与扫描模型)。

---

## 2. 现状架构盘点

### 2.1 技术栈

- **前端**：Vue 3 `<script setup>` + Pinia + vue-router（`createWebHashHistory`，对移动端友好，无需服务端路由）+ Material Design 3（`@material/web`、`@material/material-color-utilities` 运行时生成配色令牌）。
- **后端**：Rust（Tauri 2）。`rusqlite`（bundled SQLite）本地索引库落盘 `app_data_dir()/library.db`。
- **IPC 桥**：所有原生调用集中在 `src/capabilities/index.ts` 的 `safeInvoke()`（非 Tauri 环境回退 `mockInvoke`）。
- **Tauri 插件**：dialog、fs、store、opener、global-shortcut、http。
- **媒体处理**：纯 Rust `lofty`（音频标签）、`image`（缩略图 Lanczos 缩放）、`kamadak-exif`、`zip`（EPUB 封面）；**video 与少数音频格式回退到外部 ffmpeg/ffprobe**。
- **网络**：`reqwest`（blocking，`native-tls`）+ `scraper`/`regex`（小说抓取）+ 纯 Rust 网易云 weapi/eapi/xeapi 加密栈（aes/rsa/x25519/aes-gcm/hmac/sha2/flate2）。
- **本地代理**：`tiny_http` 绑 `127.0.0.1:0`，为 WebDAV 媒体和 SMTC 封面提供带 Range 的流式服务。

### 2.2 功能/路由清单（`src/router.ts`，hash 路由）

| 路径 | 视图 | 移植定位 |
|---|---|---|
| `/images` | ImagesView | 本地媒体（需 MediaStore） |
| `/videos` | VideosView | 本地媒体（需 MediaStore + 缩略图重做） |
| `/music` | MusicView | 本地 + 在线（在线可先行） |
| `/music/player` | PlayerView | 全屏播放器，含自定义拖拽标题栏（需去桌面化） |
| `/books` | BooksView | 阅读（EPUB/PDF，需 SAF 取书） |
| `/folders` | FoldersView | 双栏 master-detail（需改抽屉/下钻） |
| `/webdav` | WebDavView | 远程库 ✅ 可平移 |
| `/treasure`、`/treasure/market` | TreasureView / PresetMarket | 预设市场 |
| `/favorites`、`/history`、`/trash` | 收藏/历史/回收站 | SQLite ✅ |
| `/stats`、`/novel-stats` | 统计 | SQLite ✅（栅格需响应式） |
| `/settings` | SettingsView | 去掉桌面项（托盘、置顶等） |
| `/desktop-lyrics` | DesktopLyrics | **独立窗口渲染，Android 无对应** |

App 外壳（`App.vue`）：常驻 **88px 左侧导航栏** + 48px 自定义标题栏 + MiniPlayer 底栏 —— 三者均为桌面布局假设。

---

## 3. 兼容性矩阵

图例：✅ 直接可用 ｜ ⚠️ 需适配 ｜ ❌ 阻断（需重写/降级/移除）

| 能力 | 桌面实现 | Android 处置 | 级别 |
|---|---|---|---|
| SQLite 索引库 | `rusqlite` bundled，`app_data_dir()/library.db`（`lib.rs:218-228`） | 内置 SQLite 随 NDK 编译；`app_data_dir` 映射到 `/data/data/<pkg>/files` | ✅ |
| 设置持久化 | `plugin-store` LazyStore | 插件支持移动端 | ✅ |
| 收藏/历史/回收站/进度/统计 | 纯 SQLite（`book.rs`/`stats.rs`/`song.rs`） | 纯 DB，平移 | ✅ |
| 音频元数据解析 | `lofty`（`metadata.rs`） | 纯 Rust | ✅ |
| 图片尺寸/EXIF/EPUB 封面 | `image`/`kamadak-exif`/`zip` | 纯 Rust | ✅ |
| 图片/音频/EPUB 缩略图 | `image` 解码 + 磁盘缓存 `app_cache_dir()/thumbs`（`thumbnail.rs`） | 纯 Rust 分支可用 | ✅ |
| 网易云登录/歌单/云盘 | 纯 Rust weapi/eapi/xeapi（`netease.rs`） | 加密栈纯 Rust；仅 TLS 后端需换 | ⚠️(TLS) |
| 在线小说抓取 | `reqwest`+`scraper`（`novel.rs`） | 逻辑可平移；同步阻塞建议改 `spawn_blocking` | ⚠️(TLS) |
| WebDAV + 本地代理 | `reqwest` PROPFIND + `tiny_http`（`webdav.rs`） | localhost 代理可用；需允许明文回环 + TLS 后端 | ⚠️ |
| 在线音乐流播放 | HTML5 Audio 播 http(s) URL | WebView 可播；明文域名需网络安全配置 | ⚠️ |
| EPUB/PDF 阅读 | epub.js / pdf.js（WebView 内） | WebView 内可用 | ✅ |
| Web Audio 均衡器 | `createMediaElementSource`（`audioEffects.ts`） | WebView 支持；若改原生播放则失效 | ⚠️ |
| 逐字歌词 FFT 分析 | Web Worker + WebAudio decode + IndexedDB | 可用但耗 CPU/电量，移动端应设为可选 | ⚠️ |
| 网络 TLS | `reqwest` `native-tls`（`Cargo.toml:43`） | Android 上 native-tls=OpenSSL，需交叉编译；**建议改 `rustls-tls`** | ❌→改造 |
| **本地库扫描** | `walkdir` 任意绝对目录（`scan.rs:122-190`），id=`xxh3(绝对路径)` | 分区存储禁止；**改 MediaStore/SAF**，牵动全链路 | ❌ |
| **ffmpeg/ffprobe** | 外部非捆绑二进制经 `std::process::Command`（`ffmpeg.rs:48/189/277`） | Android 禁止执行 PATH 二进制；video 缩略图/探测失效 | ❌ |
| video 缩略图 | ffmpeg 抽帧（`thumbnail.rs:206`） | 改 `MediaMetadataRetriever`/`ThumbnailUtils`（原生插件） | ❌→重做 |
| **桌面歌词悬浮窗** | 第二个透明置顶 `WebviewWindow`（`desktopLyrics.ts:68`） | 移动端无多窗口；改 `SYSTEM_ALERT_WINDOW` 原生悬浮窗或砍掉 | ❌ |
| **系统托盘** | `TrayIconBuilder`（`tray.rs`），`lib.rs:125` 无条件调用 | Android 无托盘；`#[cfg(desktop)]` 门控 | ❌→移除 |
| **global-shortcut 插件** | `lib.rs:113` 注册（前端实际未用） | 桌面专属；插件与依赖需 `cfg(desktop)` 门控 | ❌→门控 |
| **SMTC 系统媒体控件** | Windows 专属（`smtc.rs`，已 `cfg(windows)`） | 无操作；Android 需 MediaSession + 通知（原生插件） | ❌→替代 |
| 窗口控制（min/max/close） | `useWindowDrag.ts` `getCurrentWindow()` | 移动端无窗口控制 | ❌→移除 |
| 自定义标题栏/拖拽区 | `WindowTitleBar.vue`、`-webkit-app-region`、`startDrag` | 桌面 chrome；移动端隐藏，改用系统状态栏 + 安全区 | ❌→隐藏 |
| 关闭到托盘 | `useDesktopChrome.ts` `onCloseRequested`→hide | 语义不同；改返回键/后台策略 | ❌→改造 |
| 文件夹选择器 | `plugin-dialog` `open({directory:true})` | Android 无目录选择器（SAF 不同）；扫描模型随之改 | ⚠️ |
| 任意路径写文件 | `plugin-fs` `writeFile(绝对路径)` | 分区存储受限；改 SAF/下载目录 | ⚠️ |
| 读取本地 EPUB/音频字节 | `readFile(item.path)`（`BookReader.vue`/`wordAnalysis.ts`） | 绝对路径读受限；改 content URI | ⚠️ |
| `convertFileSrc` 资产协议 | 磁盘路径→`asset://`（多处） | 协议存在但 Windows 绝对路径不解析；随本地媒体改造一并处理 | ⚠️ |
| opener「在文件管理器中显示」 | `revealItemInDir`（`index.ts`） | 桌面概念；移动端 no-op（`openUrl` 仍可用） | ⚠️ |
| **平台判定** | `isTauri = "__TAURI_INTERNALS__" in window`（`index.ts:56`） | **仅区分 Tauri/网页，无 OS 分支**；Android 上为 true，导致 SMTC/托盘/多窗口/窗口拖拽全部误触发 | ❌→修正 |

---

## 4. 关键阻断项与对策

### 4.1 本地文件系统与扫描模型

**问题**：`scan.rs:122-190` 用 `walkdir` 遍历 `config.dirs` 里的任意**绝对路径**；文件身份是 `xxh3(绝对路径)`（`scan.rs:53-55`），存为 SQLite `path TEXT UNIQUE`（`commands/mod.rs`）。跳过目录名还是 Windows 风格（`$RECYCLE.BIN` 等，`scan.rs:42-51`）。下游 `thumbnail.rs`/`metadata.rs`/`song.rs` 及前端 13 处 `convertFileSrc` 全部假设"真实可读绝对路径"。Android 10+ 分区存储只给 SAF/`content://` URI，不可自由遍历。

**对策（分层）**：

1. **音/视/图 → MediaStore（首选，免敏感权限）**：新增原生插件（[§5.1](#51-mediastore-枚举插件)）用 `MediaStore.Audio/Video/Images` 枚举系统媒体库，返回 `content://` URI + 基础元数据 + `mtime/size`。
   - 文件身份改为 **`content` URI 或 MediaStore `_id`**，取代 `xxh3(绝对路径)`。DB `path` 列语义改为"URI"。
   - `convertFileSrc` 输入改为 content URI；`asset` 协议在 Android 上需能解析（或由本地 `tiny_http` 代理把 content URI 转成回环 URL，复用现有 WebDAV 代理套路）。
2. **书籍/任意目录 → SAF 目录树**：用户授权一个目录树（`ACTION_OPEN_DOCUMENT_TREE`），持久化 URI 权限；`BooksView`/阅读器改经 SAF 读字节。
3. **元数据/缩略图适配**：`metadata.rs`/`thumbnail.rs` 改为接受 URI/字节流（而非 `std::fs::File::open(绝对路径)`）；纯 Rust 图片/音频分支保留，video 分支见 [§4.2](#42-ffmpeg-外部进程)。
4. 保留桌面路径分支（`#[cfg(desktop)]`），移动端走 URI 分支，避免回归桌面版。

> **务必避免** `MANAGE_EXTERNAL_STORAGE`（全盘访问）：Google Play 对播放器类应用几乎不批，且违背分区存储方向。用 MediaStore + SAF 覆盖 95% 场景。

### 4.2 ffmpeg 外部进程

**问题**：`ffmpeg.rs` 解析用户设定目录或 `PATH` 里的 ffmpeg/ffprobe 并 `std::process::Command` 调用（`:48/189/277`），用于 **video 抽帧缩略图**（`thumbnail.rs:206`）与 **video/wma/ape 容器探测**（`metadata.rs:46/231`）。Android 沙箱不允许执行用户提供/PATH 的二进制。当前缺失时优雅降级为 `None`（不崩溃），但功能死掉。

**对策**：

- **video 缩略图 + 时长/分辨率**：改用 Android 原生 `MediaMetadataRetriever`（帧 + 时长/宽高）与 `ThumbnailUtils`，封装进 [§5.1](#51-mediastore-枚举插件) 或独立插件。
- **wma/ape 等 lofty 不支持的音频**：交给 MediaStore/`MediaMetadataRetriever` 的元数据；WebView 能否播放取决于系统 WebView 编解码（多数不支持 ape）。可接受"能索引、可能不能播"。
- **移动端隐藏 ffmpeg 设置项**（`SettingsView` 的 ffmpeg 目录/下载 UI），`ffmpeg_*` 命令在 Android 直接返回"不适用"。
- **不建议**在 MVP 引入 `ffmpeg-kit`/`mobile-ffmpeg` AAR（体积大、维护重）；仅当确有转码需求时再作为 Phase 3 可选项。

### 4.3 桌面歌词双窗口

**问题**：`desktopLyrics.ts:68` 创建第二个 **透明、无边框、置顶、跳过任务栏** 的 `WebviewWindow`（`#/desktop-lyrics`），主/子窗口靠 Tauri 事件通信（`App.vue:51-96` 控制开关、推送歌词、回写窗口 bounds）；子窗口用 `setAlwaysOnTop`/`setIgnoreCursorEvents`（穿透）。Tauri 移动端**不支持多窗口/透明/置顶**，整套机制无对应。

**对策**：

- **MVP**：移动端隐藏"桌面歌词"入口；应用内已有的全屏歌词页（`LyricsView`）保留即可。
- **Phase 3（可选）**：以原生 `SYSTEM_ALERT_WINDOW`（悬浮窗权限）实现"系统级悬浮歌词"，用一个原生插件承载浮层视图，复用现有歌词状态事件。这是一次**全新的原生实现**，与桌面双窗口无法共用代码。
- 复用点：`desktopLyrics.ts` 里的**歌词状态数据结构与事件协议**可保留，仅替换"渲染载体"。

### 4.4 桌面 chrome：托盘 / 全局快捷键 / 窗口控制 / 标题栏

**问题**：

- `lib.rs:125` 无条件 `tray::setup`；`Cargo.toml:18` 含桌面专属 `tray-icon` feature。
- `lib.rs:113` 注册 `global-shortcut` 插件（`Cargo.toml:23` 依赖）——该插件桌面专属，在 Android 编译/运行会出问题。
- `useWindowDrag.ts`/`WindowTitleBar.vue`/`PlayerView.vue` 的自定义标题栏、`minimize/toggleMaximize/close`、窗口拖拽。
- `useDesktopChrome.ts:95` 的 `onCloseRequested`→`hide/exit_app`（关闭到托盘）。

**对策**：

- Rust 侧用 `#[cfg(desktop)]` 门控 tray 与 global-shortcut 的**依赖**（挪到 `[target.'cfg(desktop)'.dependencies]`）、**插件注册**（`lib.rs:113`）与**调用**（`lib.rs:125`）。见[附录 A](#附录-a代码改动清单速查)。
- 前端用新的 `isAndroid` 判定隐藏自定义标题栏、窗口按钮、拖拽热区、"关闭到托盘"设置项；导航栏改移动端布局（[§4.9](#49-响应式布局与触摸交互)）。
- DOM 键盘热键（`useDesktopChrome.ts:50-88` 的 Space/Ctrl+←/→/F12）在移动端无害，可保留或跳过。

### 4.5 后台播放与 SMTC → Android MediaSession

**问题**：

- 播放走 WebView HTML5 `<audio>`（`player.ts:234` `new Audio()` + `convertFileSrc`）。WebView 在后台/息屏会挂起媒体——对音乐播放器是硬伤。
- 系统媒体控件当前是 Windows SMTC（`smtc.rs`，`cfg(windows)` no-op），封面经 `tiny_http` 127.0.0.1 服务。Android 需要 MediaSession + 前台服务 + 通知/锁屏控制，项目里没有对应实现。

**对策（两条路线，需拍板）**：

- **路线 A（MVP，低成本）**：保留 WebView 播放，加一个**前台服务**（`FOREGROUND_SERVICE_MEDIA_PLAYBACK`）+ `WAKE_LOCK` 尽量维持进程存活。局限：不同厂商 ROM 对 WebView 后台媒体节流不一，后台稳定性无保证；先满足"前台可用"。
- **路线 B（正解，高成本）**：把实际音频播放下沉到原生 **Media3/ExoPlayer**（原生插件 [§5.2](#52-mediasession--前台播放服务插件)），前端播放器 store 改为"驱动原生播放 + 接收进度回调"。收益：真正的后台播放、锁屏/通知控制、耳机线控、音频焦点。**代价**：失去基于 `createMediaElementSource` 的 Web Audio 均衡器（`audioEffects.ts`），需改用原生 `Equalizer`/`DynamicsProcessing`；逐字歌词的 `audioEl.currentTime` 驱动需改成订阅原生播放进度。
- 无论哪条路线，`smtc:command`/`app:player-command` 事件通道可复用为"原生媒体控制→前端"的统一事件。

### 4.6 网络层 TLS 与明文流量

- **TLS 后端**：`reqwest` 用 `native-tls`（`Cargo.toml:43`）。Android 上 native-tls 走 OpenSSL，需交叉编译/vendored；且 `netease.rs:162-174` 目前按 Windows schannel 行为（`http1_only()`）调校。**建议全局或分目标切到 `rustls-tls`**，去掉 OpenSSL 的 NDK 构建负担；切换后需回归网易云/WebDAV/小说三条链路。
- **明文 HTTP**：`default.json` http 白名单含多个 `http://`（酷狗歌词等）；WebDAV/SMTC 代理绑 `127.0.0.1`。Android 9+ 默认禁明文，需 `network_security_config.xml` 显式放行这些域名 + 回环地址，并在清单声明。
- **同步阻塞网络**：`novel.rs`/`webdav.rs` 是同步命令，在调用线程阻塞 I/O。Tauri 命令跑在异步运行时线程池而非 UI 线程，ANR 风险低于纯主线程；但仍建议像 `netease.rs` 那样包 `spawn_blocking`，提升健壮性。

### 4.7 Wenku8 第二窗口登录

**问题**：`novel_auth.rs:495-555` 用 `WebviewWindowBuilder` 打开 Wenku8 登录页（External URL），再用 `w.cookies()` 抓 cookie；前端 `wenku8Login.ts:29/62` 靠 `getByLabel` 轮询。移动端无第二窗口。

**对策**：改为**应用内 WebView 流程**——用 Android Custom Tabs 或一个受控的内嵌 WebView 承载登录页，登录后经 `CookieManager` 取 cookie 回传；或改用表单直登（`wenku8_login_submit` 已存在）尽量绕开可视化登录。作为 Phase 2 处理（在线小说本身可先只读公开内容）。

### 4.8 平台判定：`isTauri` 单一开关

**问题（高优先）**：全局唯一环境判定 `isTauri = "__TAURI_INTERNALS__" in window`（`index.ts:56`，且在 `qqMusic.ts`/`kgMusic.ts` 重复）。它**只区分 Tauri 与纯网页，无 OS 分支**。Android 上 `isTauri` 为 true，于是 SMTC 调用、托盘事件监听、桌面歌词开窗、窗口拖拽/标题栏**全部激活并失败/报错**。

**对策**：引入 `isAndroid`/`isMobile`（`@tauri-apps/plugin-os` 的 `platform()`，或退化用 `navigator.userAgent` 含 `Android`），在 IPC 桥与各 store 用它门控所有桌面专属分支。**这是 bring-up 阶段的第一优先项**，否则应用一启动就报错。

### 4.9 响应式布局与触摸交互

现状几乎没有响应式（全仓仅 4 个文件含 `@media`：`StatsView`/`FoldersView`/`theme.css`/`MiniPlayer`）。需处理：

- **导航**：`App.vue` 常驻 88px 左侧 `nav-rail`（`--lm-nav-width`）改为**底部导航栏**（移动端）；48px 假标题栏 + 24px 内容内边距在手机上要收敛，并处理**状态栏/刘海安全区**（`env(safe-area-inset-*)`）。
- **双栏 master-detail**：`FoldersView.vue:144`（`260px minmax(0,1fr)`）改**下钻/抽屉**式。
- **强制双列书页**：`BookReader.vue:524/1431` `column-count:2` 在手机宽度不可读，移动端改**单列**。
- **固定三列统计栅格**：`StatsView.vue:710/792` `repeat(3,1fr)` 加断点降列。
- **悬停态**：`MediaGrid.vue:379`、`TrackList.vue:243` 的收藏/操作按钮 `opacity:0` 仅 hover 显示 —— 触屏无 hover，改为**常显/长按**。
- **右键菜单**：`MusicView`/`TrackList`/`MediaGrid` 的 `@contextmenu` 改**长按**触发 `ContextMenu`。
- **鼠标事件**：`PlayerView.vue:191/193` 进度条 `@mousemove/@mouseleave`、`ContextMenu.vue:122` `@mouseenter` 改 Pointer/Touch 事件。
- 媒体/曲目栅格多为 `minmax(150–240px,1fr)` 的 `auto-fill/auto-fit`，本身会回流，问题最小。

---

## 5. 需要新增的原生插件

Tauri 2 移动端原生插件用 Kotlin/Swift + `@InvokeArg`/`@Command` 编写，经统一 IPC 暴露给前端。本项目预计需要：

### 5.1 MediaStore 枚举插件
- 职责：枚举 `MediaStore.Audio/Video/Images`，返回 `content://` URI + 元数据（标题/艺人/时长/宽高/mtime/size）；提供 video/图片缩略图（`MediaMetadataRetriever`/`ThumbnailUtils`）与 SAF 目录树（书籍）。
- 替代：`scan.rs`（移动端分支）、`ffmpeg.rs` 的 video 能力、文件夹选择器。
- 优先级：**Phase 2 核心**。

### 5.2 MediaSession + 前台播放服务插件
- 职责：前台服务承载 Media3/ExoPlayer（或至少维持 WebView 前台）、`MediaSession` 通知/锁屏控制、音频焦点、耳机线控；把媒体按键事件回传前端（复用 `smtc:command` 通道语义）。
- 替代：SMTC；解决 WebView 后台挂起。
- 优先级：路线 B 的 **Phase 3**（若走路线 A，仅需最小前台服务）。

### 5.3 悬浮歌词插件（可选）
- 职责：`SYSTEM_ALERT_WINDOW` 系统悬浮窗渲染歌词，订阅现有歌词状态事件。
- 替代：桌面歌词双窗口。
- 优先级：**Phase 3，可选**。

### 5.4 SAF/存储辅助（可并入 5.1）
- 职责：`ACTION_OPEN_DOCUMENT_TREE` 授权与持久化、content URI 读写、下载目录写入（替代 `plugin-fs` 任意路径写）。

---

## 6. 分阶段路线图

> 工期为**粗估**（单人 dev·周），用于排期参考，非承诺。

### Phase 0 — 编译打通与安全启动（bring-up）｜~1–2 周
- `tauri android init` 生成 `gen/android`；配置 SDK/NDK/targets。
- `#[cfg(desktop)]` 门控 tray、global-shortcut（依赖 + 注册 + 调用）；确认 smtc 已 `cfg(windows)`。
- `reqwest` 切 `rustls-tls`，回归三条网络链路。
- **修 `isTauri`**：加 `isAndroid`/`isMobile`，门控 SMTC/托盘监听/桌面歌词开窗/窗口拖拽/标题栏。
- 前端隐藏桌面 chrome（标题栏、窗口按钮、"关闭到托盘"、ffmpeg 设置、桌面歌词入口）。
- `network_security_config.xml`（明文域名 + 回环）；基础清单权限。
- **验收**：真机/模拟器能安装、启动、在各页导航不报错；在线小说/WebDAV 至少能发起请求。

### Phase 1 — 在线与阅读 MVP｜~3–4 周
- 响应式改造：底部导航、安全区、单列书页、双栏页下钻、悬停→常显/长按、右键→长按、鼠标→指针事件。
- 打通并验证：**在线音乐（网易云 QR/短信登录、meting）**、**WebDAV 远程库播放**、**EPUB/PDF 阅读（SAF 取书）**、收藏/历史/统计。
- 后台播放走**路线 A**（前台服务，前台可用）。
- **验收**：手机上可作为"在线音乐 + 阅读 + 远程库"应用日常使用。

### Phase 2 — 本地媒体（MediaStore/SAF）｜~4–6 周
- 落地 [§5.1](#51-mediastore-枚举插件) 插件；`scan.rs`/`metadata.rs`/`thumbnail.rs` 加 URI 分支；文件身份改 URI/`_id`；`convertFileSrc`→content URI（或 tiny_http 代理）。
- video 缩略图/时长走 `MediaMetadataRetriever`。
- Wenku8 登录改应用内 WebView（[§4.7](#47-wenku8-第二窗口登录)）。
- **验收**：ImagesView/VideosView/本地 MusicView 能索引并播放系统媒体库内容。

### Phase 3 — 原生增强（可选）｜~4–8 周
- 后台播放**路线 B**（Media3/ExoPlayer + MediaSession + 通知/锁屏），评估是否放弃 Web Audio EQ。
- 悬浮歌词（`SYSTEM_ALERT_WINDOW`）。
- 桌面小组件、播放通知美化、电量/性能调优（`FluidBackground` 四象限旋转 canvas + 重模糊、逐字 FFT 分析在移动端设为可选/降级）。

---

## 7. 构建与工具链

- **依赖**：Android Studio、Android SDK（Platform + Build-Tools）、**NDK r25+**、JDK 17。
- **Rust targets**：`aarch64-linux-android`（主）、`armv7-linux-androideabi`、`x86_64-linux-android`（模拟器）、`i686-linux-android`。
- **命令**：`tauri android init` → `tauri android dev`（热重载）/ `tauri android build`（APK/AAB）。首启需要一次 `npm run build` 产物到 `../dist`（`tauri.conf.json:10`）。
- **最低系统**：Tauri 2 移动端要求 **Android 7.0 (API 24)**；渲染依赖**系统 WebView**（Android System WebView / Chrome），编解码与特性随其版本浮动——需在低版本 WebView 上回归。
- **`tauri.conf.json`**：新增 `bundle` 的 Android 段/签名；`bundle.targets` 从 `all` 细化；确认 `assetProtocol.scope` 在移动端的解析策略。
- **产物体积**：`release` 已开 `lto`/`opt-level="s"`/`strip`；rusqlite bundled + 加密栈会增大 `.so`，注意每 ABI 体积，优先 arm64 + App Bundle 拆分。

---

## 8. 权限、清单与合规

**AndroidManifest 预期权限**：

- `INTERNET`（必需）。
- 本地媒体：`READ_MEDIA_AUDIO` / `READ_MEDIA_VIDEO` / `READ_MEDIA_IMAGES`（Android 13+）；`READ_EXTERNAL_STORAGE`（≤ Android 12）。
- 后台播放：`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`（Android 14+）、`WAKE_LOCK`、`POST_NOTIFICATIONS`（Android 13+）。
- 悬浮歌词（可选）：`SYSTEM_ALERT_WINDOW`。
- **明确不要** `MANAGE_EXTERNAL_STORAGE`（Play 审核门槛高、方向错误）。

**网络安全**：`network_security_config.xml` 放行 `default.json` 中的明文域名（酷狗等）与 `127.0.0.1`（WebDAV/封面代理）。

**合规**：Play 商店对存储权限、前台服务类型、媒体来源均有政策；用 MediaStore + SAF 走"分区存储"合规路径。第三方内容源（Wenku8/网易云/酷狗等）的抓取与版权风险按现有桌面版策略延续，不在本方案扩大。

---

## 9. 测试策略

- **矩阵**：arm64 真机（主）+ x86_64 模拟器；覆盖 Android 8 / 11 / 13 / 14（存储权限模型在 10/13 有断裂）；至少一台低版本 System WebView 设备验证编解码与 Web Audio。
- **回归重点**：TLS 切换后的网易云/WebDAV/小说三链路；`isAndroid` 门控后确认无桌面 IPC 误触发；音频编解码覆盖（mp3/aac/flac/ogg/wav ✅，ape/alac 预期不支持）；后台/息屏播放行为；SAF 权限持久化；安全区/刘海布局。
- **性能**：`FluidBackground` 与逐字 FFT 在中低端机的帧率/发热/耗电；必要时移动端降级或默认关闭。

---

## 10. 风险登记表

| 风险 | 影响 | 缓解 |
|---|---|---|
| WebView 后台挂起媒体 | 音乐无法后台播放（核心体验） | 前台服务（A）/ 原生 Media3（B）；提前拍板 |
| 分区存储改造牵连面大 | 本地库全链路返工 | 桌面路径分支保留 `cfg(desktop)`；移动端 URI 分支独立；MediaStore 优先 |
| 走原生播放则失去 Web Audio EQ | 均衡器/逐字歌词时间轴受影响 | 改原生 Equalizer + 订阅原生进度；或 MVP 维持 WebView 播放 |
| 系统 WebView 版本碎片化 | 编解码/CSS/Web Audio 行为不一 | 设最低 WebView 预期、低版本回归、功能降级 |
| native-tls→rustls 行为差异 | 网易云 http1/风控链路异常 | 三链路专项回归；保留可切换特性开关 |
| Wenku8 双窗口登录无对应 | 在线小说登录态 | 应用内 WebView/CookieManager 或表单直登 |
| ffmpeg 缺失 | video 缩略图/少数音频探测 | MediaMetadataRetriever 替代；ape 等接受不可播 |
| 明文流量被拦 | 酷狗歌词/回环代理失败 | network_security_config 放行 |
| 产物体积/多 ABI | 安装包偏大 | arm64 优先 + App Bundle ABI 拆分 |

---

## 附录 A：代码改动清单（速查）

**Rust（`src-tauri/`）**

- `Cargo.toml`
  - `tauri-plugin-global-shortcut`（L23）→ 移入 `[target.'cfg(desktop)'.dependencies]`。
  - `tauri` 的 `tray-icon` feature（L18）：仅桌面需要；配合调用点门控（或按 target 分特性）。
  - `reqwest`（L43）：`native-tls` → `rustls-tls`（或分目标特性）。
- `src/lib.rs`
  - L113 `tauri_plugin_global_shortcut` 注册 → `#[cfg(desktop)]` 门控。
  - L125 `tray::setup(...)` → `#[cfg(desktop)]` 门控。
  - L123 `commands::smtc::setup` 已在 Windows no-op，确认移动端无副作用。
  - L218-228 DB 落 `app_data_dir()`：Android 可用，无需改。
- `commands/scan.rs`、`commands/thumbnail.rs`、`commands/metadata.rs`：新增"URI/字节流"分支（移动端），桌面路径分支 `cfg(desktop)` 保留。
- `commands/ffmpeg.rs`：移动端使命令返回"不适用"，UI 隐藏。
- `novel.rs`/`webdav.rs`：网络命令包 `spawn_blocking`（健壮性）。
- `novel_auth.rs`：第二窗口登录改应用内流程（Phase 2）。

**前端（`src/`）**

- `capabilities/index.ts:56`：新增 `isAndroid`/`isMobile`（`plugin-os` 或 UA），并在 SMTC（`:261/264/268`）、托盘监听（`:273`）等处门控；`qqMusic.ts:17`/`kgMusic.ts:17` 的重复判定同步。
- `App.vue:51-96`：`desktopLyricsEnabled` 开窗逻辑在移动端跳过；导航栏改底部导航（移动端）。
- `utils/desktopLyrics.ts` / `views/DesktopLyrics.vue`：移动端不创建窗口；数据/事件协议保留给后续悬浮窗复用。
- `composables/useWindowDrag.ts`、`components/WindowTitleBar.vue`、`composables/useDesktopChrome.ts`、`PlayerView.vue`（拖拽/标题栏/关闭到托盘）：移动端隐藏/禁用。
- `stores/player.ts`：若走原生播放（路线 B），改为驱动原生 + 订阅进度；否则接入前台服务。
- 布局：`FoldersView`（双栏）、`BookReader`（双列书页）、`StatsView`（三列栅格）、`MediaGrid`/`TrackList`（悬停态）、`MusicView`/`ContextMenu`（右键/鼠标事件）响应式与触摸改造。
- `SettingsView.vue`：移动端隐藏 ffmpeg、桌面歌词、关闭到托盘、置顶等桌面项。

**配置**

- `tauri.conf.json`：Android bundle/签名段；`bundle.targets` 细化；`assetProtocol` 移动端策略。
- 新增 `network_security_config.xml`；AndroidManifest 权限（见 [§8](#8-权限清单与合规)）。
