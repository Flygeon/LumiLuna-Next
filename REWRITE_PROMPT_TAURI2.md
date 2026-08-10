# 提示词：用 Tauri 2 重构 LumiLuna —— 本地全媒体库应用

> 目标技术栈：**Tauri 2（Windows 主力）+ Tauri 2 Android（次要）**
> 本文在原 Flutter / EUI-NEO / Electron 重构提示词基础上改写，功能与体验保持一致，技术栈整体迁移到 **Tauri 2 + Web 前端** 架构。
> 核心思路：**一套 Web 前端代码（HTML/CSS/TS）**作为渲染层，在 Tauri 2 的 **Windows 桌面壳**与 **Tauri Android 移动壳**之间复用；原生能力（文件扫描、元数据、播放、缩略图、数据库）收敛到 **Rust 侧（Tauri 命令 / 插件 / 原生模块）**。前端保持 **Material Design 3（M3）** 视觉，音乐播放器 **尽量 1:1 复刻 Apple Music**。

---

## 〇、为什么选 Tauri 2（相对 Electron 的关键优势）

- **体积小、内存低**：Tauri 2 桌面壳约 3–10MB（复用系统 WebView2），对比 Electron 打包体积与内存占用明显更省。
- **原生能力在 Rust**：文件扫描、SQLite、元数据、播放、缩略图、文件监听全部走 Rust（安全、高性能、跨平台），并通过 Tauri Command / Plugin 暴露给前端，天然契合本项目"高性能 Rust 扫描引擎"的既有设计。
- **一栈双端**：Tauri 2 官方支持 **Windows / Linux / macOS 桌面 + Android / iOS 移动**。移动端是 **WebView 承载同一套前端 + Rust 核心逻辑复用（NDK/JNI）**，与"主力 Windows、其次 Android"的目标完全匹配。
- **安全基线**：默认 `dangerousRemoteDomainIpcAccess` 受限、`withGlobalTauri` 可选、IPC 需显式授权（`capabilities`），比 Electron 的 preload 模型更严格。

---

## 一、项目定位

重构一个名为 **LumiLuna（光影 · 媒体库）** 的**本地优先（Local-first）全媒体管理应用**。它不依赖任何云端相册或流媒体服务，通过扫描用户指定的本地目录建立媒体索引，在一个统一、简洁的界面中浏览、整理和播放**图片、视频、音乐、电子书（EPUB/PDF）**四类内容。目标是成为个人本地方案里"多合一"的媒体中心，主战场为 **Windows 桌面**，其次考虑 **Android 移动端**。

## 二、核心设计原则

1. **本地优先、隐私至上**：所有媒体数据源都是本地文件系统，媒体文件绝不复制到应用目录、绝不上传云端；应用只建立"索引"。
2. **统一播放体验**：音视频共享同一播放器内核，图片用独立查看器，书籍用独立阅读器，跨类型体验一致。
3. **一套前端、双端复用**：Web 渲染层（UI/状态/业务）在 Windows 桌面与 Android 之间最大程度复用；平台差异（文件选择、权限、动态取色、触控手势、默认目录）收敛到"能力适配层（Rust + 前端封装）"。
4. **Material Design 3 设计系统**：重构后必须**继续保持 Material 3（M3）风格**——用统一的 M3 设计令牌（色板、形状、字阶、动效时长）与 M3 组件库承载全部 UI，双端共用同一套 M3 主题。
5. **规模化性能**：支持 1 万+ 文件的媒体库，冷启动快速（命中索引缓存），长时使用内存不增长；渲染层用虚拟列表保证流畅。
6. **增量与自动更新索引**：文件系统变化能自动反映到媒体库，无需手动全量重扫。

---

## 三、Tauri 2 技术底座（重构要点）

### 1. 整体架构：Tauri 核心 / Rust 后端 / Web 渲染 三层

- **Tauri 核心 / Rust 后端**：负责窗口管理、系统托盘、文件系统扫描与监听、SQLite 数据库、元数据提取、播放后端、缩略图、自动更新、菜单与快捷键、原生对话框/拖拽。所有重活（扫描、哈希、元数据、缩略图）用 **Rust async（tokio）+ rayon 并行** 执行。
- **前端（Web 渲染）**：承载全部 UI 与交互，通过 Tauri 的 `invoke`（请求/响应）与 `listen`/`emit`（事件推送）调用 Rust 命令，不直接触碰原生资源。
- **能力授权**：用 **capabilities 文件**（`capabilities/default.json`）声明前端可调用的命令与权限（文件系统、窗口、托盘、剪贴板等），最小权限暴露，遵循 Tauri 安全模型。

### 2. 界面组织（前端技术选型）

- 推荐 **TypeScript + Vite** 作为构建工具，配合 **Vue 3 或 React** 作为组件框架（二选一，保持一套代码双端复用）。
- **UI 视觉必须遵循 Material Design 3（M3）**：禁止改用其它设计语言（Ant Design 的企业风、Element Plus 的中后台风、原生扁平风等）。组件基础一律基于 **M3 设计令牌与 Material Web Components（`@material/web`）/ 其 React/Vue 封装**，控件（按钮、开关、滑块、复选框、卡片、对话框、Bottom Sheet、Navigation、Tab、菜单、Slider、SegmentedButton、Chip、FAB 等）都应是 M3 的 tonal/surface 语义外观。
  - 若个别组件确需自定义（虚拟网格、歌词播放器、阅读器），也须按 M3 的形状/颜色/字阶/动效规范定制，保证观感统一。
- 建立**全局 M3 设计令牌层**：色板（`primary/secondary/tertiary/error` + 对应 `on-*`、`surface/container/surface-container-low…`）、`shape`（圆角 8/12/16/28 等 M3 shape scale）、`type-scale`（display/headline/title/body/label 五组字阶，Material 3 Type Scale）、`elevation`（1/2/3 级阴影）——全部用 CSS 变量承载，一次定义全局复用。
- **明暗双主题 + 动态取色**：亮/暗两套 M3 `color-scheme`（surface/primary 等 Token 全量映射到 CSS 变量）；Android 侧由系统墙纸经 Material You 动态取色，把算法算出的 `primary/tertiary` 写回 CSS 变量；桌面端提供自定义主题色并同样映射到 M3 令牌。
- 组件外观统一由令牌驱动（组件本身不用魔法色值），保证双端一致且可换肤。
- 网格视图用**虚拟列表**（如 `@tanstack/react-virtual` / `vue-virtual-scroller` / `react-window`）支撑 1 万+ 缩略图流畅滚动。
- Tab 系统（图片/视频/音乐/书籍/文件夹）用路由 + 页面状态，切换动画用 M3 motion 时长/缓动（`motion-duration-short/medium/long` + `motion-easing-standard/emphasized`）。

### 3. 状态管理

- 用 Pinia（Vue）/ Redux Toolkit 或 Zustand（React）统一管理跨页面共享状态（媒体索引、设置、播放器、歌词）。
- 播放器进度、歌词滚动等高频率更新走独立响应式通道，避免整树重渲染；用 `requestAnimationFrame` 驱动。
- Rust 侧的扫描/监听/进度结果通过 Tauri 事件（`emit`/`listen`）推送到前端，驱动状态更新。

### 4. 原生能力（Rust / 插件）

| 能力 | 方案（Tauri 2 / Rust 生态） |
|---|---|
| 递归扫描、文件哈希 | Rust `walkdir` + `xxhash-rust`（保留原 xxh3 语义） |
| 音频标签解析 | Rust `lofty`（等价原 lofty，支持 MP3/FLAC/M4A/OGG 等） |
| 图片 EXIF | Rust `kamadak-exif`（拍摄时间/相机/GPS/ISO/焦距/光圈） |
| 视频规格与缩略图 | `ffprobe` / `ffmpeg`（`ffmpeg-sidecar` 或 `ffmpeg-next`）+ `image` crate 生成缩略图 |
| 图片缩略图 | Rust `image` crate（缩放到 ~300px）+ 磁盘缓存 |
| 数据库 | Rust **`rusqlite` / `sqlx`（SQLite）**，保持 Drift/SQLite 的表结构与查询语义 |
| 文件监听 | Rust `notify` crate（跨平台，等价原 watcher） |
| 拖拽导入 | Tauri `drag-drop` 事件 + 路径回传 |
| 自动更新 | Tauri 官方 `tauri-plugin-updater`（Windows NSIS / MSI） |
| 托盘/全局快捷键 | Tauri `TrayIcon` + `tauri-plugin-global-shortcut` |
| 对话框/文件选择 | `tauri-plugin-dialog`（目录/文件选择） |

> 依赖：`tauri`（v2）、`tauri-plugin-*`（dialog / fs / sql / global-shortcut / updater / clipboard / opener / autostart 等）、`walkdir`、`xxhash-rust`、`lofty`、`kamadak-exif`、`image`、`rusqlite`、`notify`、`serde`/`serde_json`、`tokio`、`rayon`。

### 5. 播放

- **音视频共享单一播放器**：推荐 **Rust 侧 `libmpv` / `mdk`（FFmpeg）** 作为统一内核（等价原 media_kit/libmpv 语义），Rust 侧维护单一播放器状态机，输出解码帧到前端渲染。
  - 备选（前端实现）：HTML5 `<video>/<audio>` 作为渲染层（WebM/MP4/HLS 等），对 Windows 不内置解码的格式（MKV/FLAC 等）由 Rust 侧 `libmpv`/FFmpeg 解码后通过自定义协议/流转发。
- **音视频切换复用同一播放上下文**，歌词订阅同一播放进度（保留"单一共享播放器"架构语义）。

### 6. 异步与并发

- 扫描、哈希、元数据、缩略图等重活在 **Rust `tokio` async + `rayon` 并行** 中执行，不阻塞前端 UI。
- 大媒体库扫描拆分为多个并发任务，支持取消（Tauri Command 传 cancellation token 或返回 job id）。
- 前端侧用 **Web Worker** 承载歌词解析、排序、缩略图懒加载等 CPU 任务。

### 7. 平台能力适配（双端收敛）

- 建立统一 **`Capabilities` 前端接口**：`scanDir`、`watchDir`、`openFileDialog`、`metadata`、`thumbnail`、`play`、`db`、`settings`、`updateCheck`，统一封装为 `invoke("plugin:xxx|command")` 调用。
- **Windows 端**：接口实现走 Tauri 命令 → Rust 原生。
- **Android 端**：Tauri 2 Android 壳复用同一 Rust 核心（NDK/JNI）+ 同一前端；平台差异（默认目录、文件选择、权限、动态取色、触控手势）在适配层内收敛。
- 平台差异（默认目录、文件选择器、权限申请、动态取色、触控手势）在适配层内收敛。

---

## 四、功能需求（必须完整复刻）

### 1. 媒体扫描与索引 —— 组件级细化

> 扫描引擎是高性能核心，全部在 **Rust `tokio` + `rayon`** 中实现，通过 Tauri Command 暴露。设计目标：**1 万+ 文件冷启动 < 数秒**、增量更新、可取消、进度可观测。

#### 1.1 扫描管线（Scan Pipeline）

```
┌─ Rust 侧（src-tauri/commands/scan.rs）──────────────┐
│  scan_start(config) → JobId          // 启动异步扫描任务（tokio::spawn）      │
│  scan_cancel(JobId)                  // 取消：Drop 携带 CancellationToken     │
│  scan_status(JobId) → {stage, done, total, percent} // 进度查询（Tauri emit 推送） │
│  事件 scan:progress  → {type: 'file'|'dir', path, status}  // 每文件/每目录上报    │
└─────────────────────────────────────────────────────┘
前端：扫目录选择 → invoke(scan_start) → listen('scan:progress') 更新进度条/日志；可点取消。
```

#### 1.2 阶段划分（Stage Machine）

1. **目录枚举**（`walkdir`）：递归遍历，规则——深度上限 8、跳过隐藏目录、扩展名不区分大小写（预置白名单 `.jpg/.jpeg/.png/.gif/.webp/.heic/.mp4/.mov/.mkv/.avi/.flv/.mp3/.flac/.m4a/.ogg/.wav/.epub/.pdf`）。
2. **类型识别**：按扩展名分类到图片/视频/音频/书籍四类，`walkdir` 回调中并行收集文件路径列表（`rayon` par_iter）。
3. **哈希**：`xxhash-rust`（xxh3）对文件内容或头部采样哈希，作为唯一 ID；与 `files` 表比对，**已存在且 mtime/size 未变则跳过**（增量核心）。
4. **元数据提取**（`rayon` 并行）：
   - 音频：`lofty` 读标题/艺术家/专辑/封面/时长/码率；失败降级为空。
   - 图片：`kamadak-exif` 读拍摄时间/相机型号/ISO/焦距/光圈/GPS 经纬度；图片缩略图 `image` crate 解码缩放到 ~300px。
   - 视频：`ffprobe`（`ffmpeg-sidecar`/`ffmpeg-next`）读分辨率/编码/FPS/时长；用 `ffmpeg` 抽 1 帧做缩略图。
   - 书籍：`epub`/`pdfium-render` 读标题/作者/封面/章节数/页数（用于书架与进度）。
5. **入库**：`rusqlite` 事务批量 upsert（每批 500 条 commit），`files`、`media_metadata`、`thumbnails` 三表。
6. **缩略图磁盘缓存**：`app_cache_dir/thumbnails/{xxh3}.jpg`，带上限（如 2GB）与 LRU 清理。

#### 1.3 增量更新与缓存

- **启动策略**：先读 SQLite 索引命中缓存，前台秒开；后台按"缓存过期 24h"决定是否全量重扫；未过期时只做目录 `mtime` 级差异扫描。
- **文件监听**（`notify` crate）：对已配置目录挂 `RecursiveWatcher`，事件去抖 300ms 合并——单文件增/改只读取该文件元数据 upsert；目录删除/大批量事件回退整目录重扫。
- **已删除文件**：扫描时对比 `files` 表路径集合，缺失的标记为"已删除"移入待回收，不直接物理删除。

#### 1.4 扫描进度数据结构（rusqlite）

```sql
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,          -- xxh3(path)
  path TEXT NOT NULL,
  type TEXT NOT NULL,           -- image|video|audio|book
  size INTEGER, mtime INTEGER,
  scanned_at INTEGER, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_files_type ON files(type);
CREATE INDEX idx_files_path ON files(path);
CREATE TABLE IF NOT EXISTS media_metadata (
  file_id TEXT PRIMARY KEY,
  title TEXT, artist TEXT, album TEXT, duration_ms INTEGER,
  width INTEGER, height INTEGER, codec TEXT, fps REAL,
  taken_at INTEGER, camera TEXT, iso INTEGER, gps_lat REAL, gps_lng REAL,
  author TEXT, language TEXT, page_count INTEGER, chapter_count INTEGER
);
```

#### 1.5 扫描引擎设计令牌/约定

- **取消**：所有阶段都检查 `CancellationToken`，取消即停并保留已入库数据，下次续扫。
- **并发控制**：`rayon` 线程池默认 4（按 CPU）；元数据/缩略图提取按文件分批，避免内存峰值。
- **进度**：以"已完成文件数/总文件数"为基准，用 `Tauri emit` 推送，前端进度条不做整树重渲染。
- **异常兜底**：坏文件/无权限/损坏元数据一律 `Result::Err` 捕获并记录，不中断整体扫描，错误汇总到扫描日志面板。

### 2. 媒体浏览与搜索

- 网格视图 / 列表视图，按文件夹、相册或日期分组。
- 按文件名、标题、艺术家、专辑、文件夹路径搜索（带实时输入建议的搜索框，可 Web Worker 索引）。
- 按名称、修改时间、文件大小、时长排序。
- 下拉刷新（移动端）、重新扫描、加载失败重试。
- Windows 支持**拖拽文件导入**（Tauri `drag-drop`），自动跳过已存在媒体。
- Tab 切换带平滑动画，页面保持滚动位置与状态。

### 3. 图片

- 分页浏览、全屏查看、缩放（鼠标滚轮/双击/触控捏合）。
- 展示 EXIF 元数据（拍摄时间、相机、GPS 位置等）。

### 4. 视频

- 播放/暂停、进度控制、全屏、上一项/下一项、`0.5x`–`2.0x` 倍速。
- 自动续播播放列表。

### 5. 音乐（重点：类 Apple Music 播放器 + 动效复刻）

> 音乐播放器是体验核心，**尽量模仿 Apple Music 的视觉与交互，越像越好、细节越多越好**。整体仍嵌在 M3 框架内（配色取封面主色映射到 M3 token），但布局/动效/手势以 Apple Music 为蓝本。下面的魔法数字、缓动曲线、blur/saturate/brightness 值必须原样保留。

#### 5.1 全屏布局（宽窗口两栏 / 窄窗口分页）

- **宽窗口**（桌面）：全屏 `Stack`，最底层是流体模糊背景（见 5.5），上层 `SafeArea + Row` 两栏——左栏（flex 50）放封面 / 歌曲信息 / 进度条 / 控制按钮，右栏（flex 55）放歌词。**无 AppBar**：顶部只留一条很淡的返回 + 居中小标题（"正在播放"）覆盖层，整体沉浸。
- **窄窗口**（移动/小窗）：横向分页（左页封面+控制、右页歌词），手势左右滑动切换；保持与桌面一致的 M3 动效。播放页支持**下滑返回**。

#### 5.2 设计令牌（写死，勿改）

- 缓动曲线：`easeOutBack = cubic-bezier(0.25,0.8,0.25,1)`（封面/进度条，200–250ms）；`appleLyric = cubic-bezier(0.19,0.11,0,1)`（歌词，600ms）。
- 封面 `420×420`（宽布局取 `min(可用宽×0.42, 可用高×0.52)`）、**圆角 = 封面短边×0.14**、阴影 `0 8 32px 黑0.35` + `0 4 16px 黑0.25` 双层；hover `scale(1.05)` + 亮度 `0.85`，按下回弹 `scale(1)`；过渡 250ms easeOutBack。
- 进度条宽 `425`、高 `5`（hover 变 `10`）、圆角 `4`；轨道 `white 22%`（hover `32%`）、填充 `white`；**hover 才显示 thumb**（8px 圆点 + 外圈 14px 光晕）；支持横向拖拽 seek，拖拽预览、松手才真正 seek。
- 播放/暂停主按钮：**白色圆形 68px、icon 34**，hover 微放大 1.03；次按钮收敛到 28–30px、白 70%；图标按下 `scale(0.8)`，200ms。
- 歌词字号用户设置（默认 18–20）、`bold`、`letter-spacing 0.6`、`line-height 250%`、左右 padding `25`；`LYRICS_OFFSET = 视口高 / 3`；`LINE_GAP = 20`。
- 流体背景：`blur(30px) + saturate(2.5) + brightness(0.5)`，整体 `scale(1.5)`，20s 无限循环，角速度极慢且带正弦扰动（避免机械重复）。

#### 5.3 封面与进度条

- 封面用 `<img>`（或封面源），`border-radius`（封面短边×0.14）`+ box-shadow 双层`；`MouseRegion` hover 时 `transform: scale(1.05)` + 叠一层 `brightness(.85)`，按下回弹；移动端用点击缩放近似（无 hover）。
- 进度条：轨道 `height 5→10`（hover 用 CSS transition 变粗），圆角 4，`background rgba(255,255,255,.22)`；填充条 `background #fff`，宽度 = `进度%`；拖拽 / 点击横向 seek；进度由 `timeupdate`/`requestAnimationFrame` 驱动。
- 封面主色提取：把封面绘制到 Canvas 后分 4 象限采样均值，欧氏距离 ≥ 60 去重，输出 4 个强调色 → 注入流体背景与 M3 主题强调色（`tertiary/primary`）。

#### 5.4 ★歌词播放器（核心，1:1 还原 Apple Music）

- **LRC 解析**：正则 `/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/`，时间 = `m*60+s+ms/1000`，转成 `{time, text}` 列表；编码依次尝试 `utf-8 / gbk / big5 / shift-jis`（`iconv-lite` / `TextDecoder` 兜底）。
- **滚动同步**：`LYRICS_OFFSET = window.innerHeight / 3`；当前行滚动目标 = 当前行之前所有行 `(行高+20)` 累加 + `LYRICS_OFFSET`；用 `scrollTo({top, behavior:'smooth'})` 或 CSS `transition` + `appleLyric` 600ms 缓动；`requestAnimationFrame` 订阅播放进度驱动切行。**切行只滚动到"把当前行带到锚点"，不一次跳首尾。**
- **行渲染**：当前行 `color rgba(255,255,255,1)` + **放大 1.25×**，其余 `rgba(255,255,255,.25)`（随距离衰减）；用 `transition: color 600ms appleLyric` 过渡。
- **距离模糊**：非当前行按与当前行的行差 `n` 施加 **阶梯式非线性** 模糊（距离1 微糊、距离≥3 更糊），越远越模糊。
- **上下渐隐遮罩**：歌词容器外层 `mask-image: linear-gradient(transparent 0%, black 22%, black 78%, transparent 100%)`（stops 0/22/78/100），模拟 Apple 上下淡入淡出。
- **点击跳转**：点击任意歌词行跳到对应播放位置并置顶该行。
- **原文 + 翻译切换**：优先读内联歌词（`lofty` 的歌词字段），缺失时读同名 `.lrc` 旁注；翻译旁注依次查找 `.zh.lrc`、`.translation.lrc`、`.zh-CN.lrc`、`.zh-Hans.lrc`、`.translate.lrc`；提供原文/翻译/双栏三种显示模式。当前行翻译白 65%、非当前行白 25%。
- **歌词字号调节**：设置项实时改歌词字号与行高。

#### 5.5 ★流体动态背景（核心，1:1）

- 用封面在 **Canvas / WebGL** 画 4 个旋转象限：每个象限是一个旋转单元，初始相位随机 `0~2π`，角速度 = `(random-0.5)*0.005*2π`（极慢），绘制尺寸 = `max(宽,高)*0.6`，居中到 2×2 网格中心（x = 0.25/0.75×宽，y = 0.25/0.75×高）；叠加混合 `globalCompositeOperation = 'screen'`（发光）。
- 外层滤镜：`filter: blur(30px) saturate(2.5) brightness(0.5)`，整体 `transform: scale(1.5)`（放大不露边），背景层 `pointer-events: none` 不拦截手势。
- 动画：`requestAnimationFrame` 循环驱动 4 象限慢速自转（20s 无限漂移节奏），用封面解码后的 ImageBitmap；**切歌时背景 fade 600ms + 封面 scale 1.0→1.03**。
- 主色强调：把 5.3 提取的 4 色写回 M3 `tertiary/primary` 相关 token，实现封面驱动整页色调；浅色封面额外叠 `黑 alpha 0.15–0.3` 竖向渐变兜底保证前景清晰。

#### 5.6 控制与播放

- 播放/暂停、上一首/下一首、循环、随机、倍速（`0.5x–2.0x`）、进度拖动；用 `AnimatedCrossFade`（或等价）在播放/暂停图标间切换。
- **重复/随机拆成 iOS 风格独立 Segment**（当前态高亮白）。
- 控制区一行顺序：`重复/随机` → `上一首` → `主播放` → `下一首` → `倍速`；间距 `spaceEvenly`，距封面下沿 16–20px。
- 音视频共享单一播放器状态机（Rust `libmpv`/FFmpeg），歌词订阅同一播放进度。
- 封面/歌曲信息/播放列表/队列多栏；右栏除歌词外可切换显示队列（**iOS 风格 Segment 切换**，胶囊高亮块 + fade/slide 200ms）。

### 6. 电子书阅读（EPUB / PDF）—— 组件级细化

> 电子书阅读器是独立于媒体播放的子系统，前端用 `pdf.js` + `epub.js`（或 `foliate-js`）在 Web 侧渲染，原生侧（Rust）负责**解压、解析元数据、封面与全文文本提取、进度持久化**。整体仍遵循 M3（`surface-container` 阅读区、`surface-variant` 工具栏），支持桌面（鼠标滚轮/翻页键）与移动（横向滑动翻页）双端。

#### 6.1 数据流与目录结构

```
Rust 侧（src-tauri/commands/books.rs）：
  book_open(path) -> BookMeta            // 解析：识别 EPUB/PDF，返回标题/作者/语言/封面/章节数/总页数
  book_chapter(path, index) -> ChapterHtml // EPUB：按章节 id 返回该章 HTML 原文（含内嵌图片引用）
  book_pdf_page(path, page) -> asset     // PDF：用 pdfium 渲染第 N 页为位图/矢量返回
  book_cover(path) -> bytes              // 提取封面（EPUB 取 <meta name="cover"/> 指向的图片；PDF 取首页渲染）
  book_progress(path) -> Progress        // 读写阅读进度 {bookId, location, page, percent, updatedAt}
前端侧：
  src/views/books/          // 书架页、阅读器页、书签管理
  src/components/reader/    // ReaderView / EpubView / PdfView / ChapterNav / ReaderToolbar / BookmarkPanel
  src/tokens/reader-tokens.css  // 阅读字号/主题/行距等设计令牌
```

#### 6.2 书架视图（Bookshelf）

- 网格布局：封面卡片 `3:4`、圆角 8（M3 shape-small）、书名位于封面下方（两行截断 `line-clamp:2`）、作者次行灰 60%。
- 每张卡片右上角显示**阅读进度百分比角标**（`Pulse` 缓动淡入）；hover/长按显示"继续阅读 / 书签 / 更多"。
- 空态：未导入书籍时显示 M3 插画 + "导入 EPUB/PDF" 按钮（`tauri-plugin-dialog` 多选文件）。
- 排序：按最近阅读 / 标题 / 作者 / 导入时间；支持搜索书名。

#### 6.3 EPUB 阅读器（核心）

- **章节化解析**：`epub.js`/`foliate-js` 按 `spine` 顺序加载章节（章节 id → 对应 XHTML），保留原 HTML 结构以支持内嵌图片、脚注、`<ruby>` 注音。
- **翻页模式**（三种可切换）：
  - **纵向滚动**（默认，桌面）：整章连续滚动，`scroll-snap` 按屏停靠，进度 = 滚动位置/总高。
  - **横向翻页**（移动）：`PageView` 分页，每页把章节内容按可视宽高**动态分块**（基于字符测量预分块，缓存页块索引），左右滑动翻页；切章节自动衔接。
  - **双栏分页**（桌面宽屏可选）：两栏并排渲染。
- **字号/行距/字距**：读者工具栏实时调整（字号 14–32、行高 1.6–2.4、字距 0–1px），作用于阅读容器 `font-size/line-height` 并**重算分页**（横向模式需重新分块）。
- **三种阅读主题**：浅色（surface）、深色（surface-container 近黑）、护眼 sepia（`#f5e9d0` 底 + 深棕文字）；主题切换带 200ms 过渡；深色/护眼模式用 `color-scheme` 同步滚动条与选区色。
- **进度记忆与续读**：每 2s 或切章节时把 `{bookId, location(cfi), page, percent}` 写入 Rust（`rusqlite`）；重新打开时**自动回到上次位置**并高亮锚点行。
- **书签**：M3 `Menu` 添加/删除书签，书签面板按章节分组展示，点击跳转。
- **搜索**：对全书文本（Rust 预处理全文索引，`rusqlite` FTS5）做**跨章节搜索**，结果按章节列出，点击定位到匹配段落。
- **脚注/目录**：右侧抽屉展示目录树（`spine` 章节树），点击跳章；脚注点击弹 M3 `Dialog` 显示内容。
- **封面与元数据**：书架用 Rust 提取的封面；详情显示标题/作者/语言/出版信息/字数。

#### 6.4 PDF 阅读器

- `pdf.js` 渲染，`pdfium`（Rust，`pdfium-render`）做原生兜底与首页封面提取。
- **连续滚动**（默认）+ **单页模式**（分页切换，`scroll-snap`）；支持 `C-cmd/ctrl + 滚轮` 缩放（50%–300%）。
- 顶部显示页码 `当前页/总页`，可输入页码跳转；进度百分比写入 Rust 持久化。
- 文本 PDF 支持**文本选择/复制**、**搜索高亮**；扫描版 PDF（无文本层）不提供搜索。
- 阅读主题仅影响背景与对比（PDF 内容本身不可换肤）。

#### 6.5 阅读进度数据结构（rusqlite）

```sql
CREATE TABLE IF NOT EXISTS book_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,          -- 文件路径哈希
  location TEXT,                  -- EPUB CFI / PDF 页码
  page INTEGER,                   -- 当前页
  percent REAL,                   -- 0.0~1.0
  updated_at INTEGER NOT NULL     -- epoch ms
);
CREATE INDEX idx_book_progress_book ON book_progress(book_id);
CREATE VIRTUAL TABLE IF NOT EXISTS book_fts USING fts5(title, author, content);
```

#### 6.6 阅读器设计令牌（reader-tokens.css）

```css
:root{
  --reader-font-size:18px; --reader-line-height:2; --reader-letter-spacing:0;
  --reader-page-max-width:680px; --reader-padding:24px;
  --reader-theme-bg:#ffffff; --reader-theme-text:#1c1b1f; /* 浅色 */
}
[data-reader-theme="dark"]{ --reader-theme-bg:#1c1b1f; --reader-theme-text:#e6e0e9; }
[data-reader-theme="sepia"]{ --reader-theme-bg:#f5e9d0; --reader-theme-text:#5b4636; }
```

### 7. 整理与管理

- **收藏**媒体并在独立收藏页集中查看。
- **标签系统**：多级分类（支持父级分组）、颜色、媒体-标签多对多关联。
- **收藏集（Collections）**：自定义媒体集合，带描述、封面、排序。
- **播放列表（Playlists）**：独立于音乐场景的媒体播放列表。
- **播放历史**：按最近播放时间排序展示。
- **多选批量操作**：删除、移动、收藏、打标签等。
- **回收站**：独立管理流程，删除→回收站→恢复/永久删除/清空，含清单持久化。

### 8. 个性化设置

- 系统 / 浅色 / 深色主题，主题色选择（**M3 色板 token 全局换肤**；Android 支持动态取色 Material You，桌面端自定义主题色同样映射到 M3 token）。
- **Android 动态取色（Material You）适配**：
  - 通过 Tauri Android 的 `capabilities` 暴露 `android:dynamic_color`（Tauri `tauri-plugin-android-dynamic-color` 或 Rust 侧读取系统 `dynamic_colors`）：
    - 启动时 Rust 侧读取系统墙纸生成的 `accent1/accent2/accent3` 色板，序列化经 Tauri `invoke('get_dynamic_colors')` 返回。
    - 前端用 `@material/material-color-utilities`（`dynamiccolor`、`Hct`、`SchemeTonalSpot`）把系统 `accent` 种子色算出一整套 M3 色板，写回 `--md-sys-color-*` CSS 变量。
    - 跟随系统开关：监听 `scheme` 变化（`matchMedia('(dynamic-range)')` 或 Tauri 事件）实时刷新主题色。
    - 兜底：当系统未开启动态取色或 API 不可用时，回退到用户手动选择的主题色。
  - **Android 运行时权限适配**：
    - 用 `tauri-plugin-permissions`（Android）申请 `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`/`READ_MEDIA_AUDIO`（Android 13+ 分媒体类型权限）；Android ≤12 用 `READ_EXTERNAL_STORAGE`（M3 `RuntimePermissionDialog` 前置解释）。
    - 首次启动用 M3 `Dialog` + 向导页解释用途后再请求，避免被系统降级；拒绝后扫描页显示"去设置开启"引导（`tauri-plugin-opener` 打开系统设置）。
    - 动态取色种子与权限均在 `capabilities/android.json` 声明，遵循最小权限。
- 中 / 英文 + 跟随系统语言（完整 i18n，约 500 条文案，`vue-i18n` / `react-intl`）。
- 图片/视频布局密度、分组方式、排序方式、扫描目录设置。
- 播放器背景模糊、歌词模糊、歌词字号设置。
- 阅读主题、字号、翻页模式、页面布局设置。
- 清理缓存、查看版本信息、第三方开源许可证清单。
- **自动更新检查**（`tauri-plugin-updater` 拉取 Releases；Windows NSIS/MSI）。
- 桌面快捷键：空格/媒体键播放暂停、方向键、ESC 返回、全局媒体键（`tauri-plugin-global-shortcut`）。

### 9. 文件夹实时监听

- 对已配置扫描目录挂文件系统监听（Rust `notify` crate），做**增量更新**：
  - 单文件新增/修改：只读取该文件元数据并 upsert 入库。
  - 文件夹删除或大批量事件：回退为整目录重扫。
  - 事件去抖合并，避免频繁扫描。

### 10. 稳健性与可观测性

- 全局异常兜底：前端 `window.onerror` + Rust `panic`/`Result` 兜底，未捕获异常写入 `crash_log.txt` 便于 release 排查。
- 播放失败（解码/文件缺失）显示明确错误态而非黑屏。
- 扫描/权限/坏文件异常被捕获并转为可读提示，不崩溃。

---

## 五、UI 界面布局细化（本项目重点，尽量 1:1 复刻）

> 这一章把整个应用的**页面骨架、导航层级、每屏布局、间距与响应式断点**细化到可直接照做的程度，作为前端实施的 Layout 蓝本。整体严格遵循 **Material Design 3** 的组件语义，同时保持 **类 Apple Music 播放器**的沉浸观感。

### 5A. 应用骨架（全局）

```
┌────────────────────────────────────────────────────────────┐
│ 窗口标题栏（自定义 titlebar，仅 Windows，可拖拽）            │
├───────────┬────────────────────────────────────────────────┤
│           │  顶部：面包屑 + 搜索框 + 主题切换 + 设置入口       │
│  左侧      ├────────────────────────────────────────────────┤
│  Navigation│  内容区（按当前 Tab 渲染）                       │
│  Rail      │  · 网格/列表视图（虚拟滚动）                     │
│  (M3)     │  · 图片/视频/书籍查看器                         │
│           │  · 音乐 Now Playing 页                          │
│           │  · 设置页 / 回收站页                             │
├───────────┴────────────────────────────────────────────────┤
│ 底部：迷你播放条（Mini Player，仅非播放页时显示，可上滑展开） │
└────────────────────────────────────────────────────────────┘
```

- **左侧导航（桌面）**：M3 `NavigationRail`，图标+文字标签，Tab：`图片 / 视频 / 音乐 / 书籍 / 文件夹`；底部固定入口：`收藏 / 历史 / 回收站 / 设置`。宽度 80px（仅图标）/ 折叠可扩展为 256px。
- **移动端**：无侧栏，改用底部 `NavigationBar`（M3），同 5 个 Tab。
- **顶部栏**：当前 Tab 标题 + 搜索框（实时建议）+ 主题/语言/设置快捷入口。
- **迷你播放条**：非音乐播放页底部一条 64px 横条（封面缩略 44px + 歌名/艺人 + 播放/暂停/下一首 + 进度细条），点击上滑展开全屏 Now Playing；移动端为底部 60px 条。

### 5B. 各 Tab 页布局

#### 图片页
- 顶部：分组方式（文件夹/相册/日期）+ 排序 + 布局密度切换（网格/列表）。
- 网格：虚拟滚动，缩略图卡片 `ratio 1:1`、圆角 12（M3 shape-medium）、hover 显示操作按钮（收藏/标签/更多）；点击进入全屏查看器。
- 全屏查看器：封面/图片居中，顶部返回 + 标题 + EXIF 按钮，底部缩略图横条 + 缩放控件，支持滚轮/双击/捏合缩放。

#### 视频页
- 网格：缩略图 16:9 + 时长角标 + 播放按钮（hover）。
- 全屏播放器：顶部返回/标题，底部控制条（进度 + 时间 + 倍速 + 全屏），点按切换控件显隐。

#### 音乐页
- 三种入口视图：**精选/歌单/歌曲列表/专辑网格**。专辑网格用 2–4 列（随宽度），封面圆角 12。
- 歌曲列表：M3 `List`，行高 56px，包含 封面缩略/标题/艺人·专辑/时长/收藏/更多（⋯）；列头可排序。
- 点击任意歌曲 → 进入 **Now Playing**（见 5.5 与第四章第 5 节）。

#### 书籍页
- 书架网格：封面 3:4、书名在封面下方，圆角 8；hover 显示"继续阅读"。
- 阅读器：顶部返回 + 章节标题 + 搜索/书签/设置；正文居中阅读区（最大宽 ~680px）；底部工具栏（翻页模式/字号/主题/进度）。

#### 文件夹页
- 树形/面包屑浏览本地目录，缩略图平铺；顶部可"添加扫描目录"。

### 5C. Now Playing 页布局（类 Apple Music，1:1 蓝本）

**宽窗口（桌面 ≥900px）**：见下方横向两栏。

```
┌───────────────────────────────────────────────────────────────┐
│ ⬅ 返回      （居中）正在播放        （右上）更多/队列/歌词切换    │  ← 顶部覆盖层，沉浸
├──────────────────────────────────────┬────────────────────────┤
│                                      │  [歌词/队列 iOS Segment]│
│           封面 Album Art              │ ┌────────────────────┐ │
│         (flex 50, 居中)               │ │                    │ │
│                                      │ │   歌 词 列 表        │ │
│     歌名（22–26/W700/白）             │ │   （锚点上 1/3）     │ │
│     艺人 · 专辑（14/W400/白60）       │ │   当前行放大1.25×    │ │
│  ─────────────────────────────────   │ │   上下渐隐+距离模糊  │ │
│   进度条（425px 玻璃轨道，hover thumb）│ │                    │ │
│   0:00                   3:45        │ │                    │ │
│   [重复][随机]  ⏮  ⏯  ⏭  [倍速]     │ └────────────────────┘ │
│   控制区（68px 主按钮，主次分明）      │        （flex 55）      │
├──────────────────────────────────────┴────────────────────────┤
│                    底层流体模糊背景（全屏）                     │
└───────────────────────────────────────────────────────────────┘
```

- 左栏（flex 50）：封面居中（上下留白均衡），下方歌名/艺人，再下进度条 + 时间，最下控制区。
- 右栏（flex 55）：顶部 iOS 风格 `[歌词|队列]` Segment，下方内容区（歌词或队列列表），歌词按第四章 5.4 规格渲染。
- 底层流体背景（5.5）铺满全屏，`pointer-events:none`。
- 覆盖层：顶部左侧返回按钮 + 居中"正在播放"小标题 + 右侧更多，均为半透明白（顶部渐变遮罩）。

**窄窗口（移动 <900px）**：横向分页（`PageView`）。

```
Page 1（左滑→）                      Page 2（←右滑）
┌───────────────────┐                ┌───────────────────┐
│  ⬅      正在播放    │                │  ⬅     正在播放     │
│                   │                │  [歌词|队列]Segment │
│      封面 420      │                │ ┌───────────────┐ │
│   （居中偏上）      │                │ │   歌词/队列     │ │
│   歌名             │                │ │   列表         │ │
│   艺人·专辑         │                │ └───────────────┘ │
│   ──进度条──       │                │                   │
│  [重复][随机]⏮⏯⏭[倍速]│             │                   │
└───────────────────┘                └───────────────────┘
  手势：左右滑切换 / 下滑关闭播放页     背景：同一流体背景
```

### 5D. 响应式断点

| 断点 | 布局行为 |
|---|---|
| ≥1200px | 两栏播放器（封面 flex50 / 歌词 flex55）+ 侧栏；网格 6–8 列 |
| 900–1199px | 两栏播放器；网格 4–6 列 |
| 600–899px | 播放器两栏收窄（封面 flex45/歌词 flex55）或转分页；网格 3–4 列；侧栏收为 Rail |
| <600px | 播放器横向分页；网格 2–3 列；底部 NavigationBar |

### 5E. M3 令牌速查（全局 CSS 变量）

```
--md-sys-color-primary / on-primary / primary-container
--md-sys-color-secondary / tertiary / error
--md-sys-color-surface / surface-container / surface-container-low / surface-container-high
--md-sys-shape-corner-small: 8px / medium: 12px / large: 16px / extra-large: 28px
--md-sys-typescale-{display,headline,title,body,label}-{size,weight,line-height}
--md-sys-motion-duration-short: 200ms / medium: 300ms / long: 500ms
--md-sys-motion-easing-standard / emphasized / emphasized-decelerate
```

---

## 六、技术栈对照表（Flutter → Tauri 2）

| 领域 | 原 Flutter 技术 | 重构目标（Tauri 2 生态） |
|---|---|---|
| 桌面壳 | Flutter Windows | **Tauri 2**（WebView2，Windows） |
| 移动壳 | Flutter Android | **Tauri 2 Android**（复用同一 Rust 核心 + 前端） |
| UI 框架 | Flutter + Material 3 | **Vue 3 / React + Vite + TypeScript（保持 Material Design 3）** |
| 组件库 | Material 3 widgets | **Material Web Components（`@material/web`）M3 组件 + 自定义 M3 组件** |
| 状态管理 | flutter_riverpod | **Pinia / Zustand / Redux Toolkit** |
| 音视频播放 | media_kit / libmpv | **Rust libmpv / mdk（FFmpeg）+ HTML5 回退** |
| 高性能元数据 | Rust + flutter_rust_bridge | **Rust：lofty、kamadak-exif、image、ffprobe** |
| 数据库 | Drift / SQLite | **rusqlite / sqlx（SQLite）** |
| 歌词 | flutter_lyric | 自定义 LRC 解析器 |
| 书籍 | pdfx、yaepub | **pdf.js、epub.js** |
| 缩略图/封面 | 原生提取 + 磁盘缓存 | **Rust `image` crate + 磁盘缓存** |
| 国际化 | gen-l10n / ARB | **vue-i18n / react-intl** |
| 偏好设置 | shared_preferences | **tauri-plugin-store / localStorage** |
| 网络 | http/dio | **fetch / axios（Rust reqwest 兜底）** |
| 异步 | Dart isolate | **Rust tokio + rayon + 前端 Web Worker** |
| 文件监听 | watcher | **Rust `notify` crate** |
| 自动更新 | （自定义 GitHub API） | **tauri-plugin-updater** |

## 七、工程与构建

- 工程组织建议（Tauri 2 标准脚手架 `npm create tauri-app`）：
  - `src/`：Web 前端源码（`renderer/` 渲染层、`capabilities/` 能力接口、`state/`、`views/`、`components/`、`tokens/` M3 令牌）
  - `src-tauri/`：Rust 后端（`src/` 命令实现、`capabilities/default.json`、`tauri.conf.json`）
  - `src-tauri/commands/`：扫描、元数据、播放、缩略图、数据库、监听等 Command
  - `src-tauri/plugins/`：自研插件
  - `shared/`：双端共用的类型、常量、i18n 资源、算法（LRC 解析、主色提取）
  - `assets/`：图标、思源黑体、默认封面
- 前端构建：**Vite + TypeScript**；Rust 侧 `cargo build --release`。
- 依赖按需：`@tauri-apps/api`、`@material/web`（M3 组件）+ `@material/material-color-utilities`（Material You 动态取色）、`pdf.js`、`epub.js`、`@tanstack/react-virtual`/`vue-virtual-scroller`、`vue-i18n`/`react-intl`；Rust 侧 `tauri`、`tauri-plugin-*`、`lofty`、`kamadak-exif`、`image`、`rusqlite`、`notify`、`walkdir`、`xxhash-rust`、`tokio`、`rayon`。
- **直接生成可交付文件（必须）**：本提示词要求实施时**产出可运行、可安装的可交付产物**，而非仅 UI 原型或说明文档：
  - **Windows 桌面端**：`tauri build` 产出 NSIS 安装程序（`.exe`）与免安装 zip，内含 WebView2 依赖处理，双击即可安装运行。
  - **Android 移动端**：`tauri android build`（Gradle + NDK）产出签名 APK（`.apk`），可直接安装到设备；含 `tauri.conf.json` 声明的 appId、图标、权限。
  - **交付清单**：交付时需包含——① 源码仓库（完整可构建）；② Windows NSIS 安装包 + zip；③ Android APK；④ `README`（构建/安装/运行说明）；⑤ 变更说明。所有产物通过 CI 自动产出并归档。
- **使用 CNB 云原生构建（必须）**：在仓库根目录提供 `.cnb.yml`，用 **CNB 云原生构建**自动完成双端编译与产物归档：
  - **触发**：推送到 `main`/`master` 分支或打 Tag 时自动触发；PR 时只做构建校验。
  - **Windows 构建**：在 Linux 构建机上交叉编译或用 Windows runner 跑 `tauri build`，产出 NSIS/zip。
  - **Android 构建**：`tauri android build`（`cargo` 交叉编译 + `gradle` 打包），产出 APK。
  - **产物归档**：构建产物上传到 CNB **制品库**（Artifactory），并在 PR/发布时给出下载链接。
  - 参考 `.cnb.yml` 骨架见文末附录 A。
- 应用自带思源黑体（Source Han Sans SC）字体打包。

## 八、需要保留的平台与行为约束

- 主力平台 **Windows 桌面**（键盘操作、拖拽、桌面布局、托盘、全局快捷键），**其次考虑 Android 移动端**（触控、移动布局、动态取色、权限申请）。
- 目录/缓存位置：数据库与缓存放在系统应用数据目录（Tauri `app_data_dir` / `app_cache_dir`；Android 应用私有目录）；旧缓存有迁移逻辑。
- 缩略图缓存带上限与清理策略，音频封面缓存到应用缓存目录。
- 应用自带思源黑体（Source Han Sans SC）字体打包。
- 保持「单一共享播放器」架构语义：音视频切换播放器状态统一，歌词订阅播放进度。
- 删除媒体有独立回收站流程，永久删除前需用户确认。
- 安全基线：遵循 Tauri 2 安全模型，`capabilities` 最小权限授权，IPC 命令显式声明（`#[tauri::command]` + `invoke_handler`），前端不直接触碰 Rust 内部资源。

## 九、交付验收标准

1. 四类媒体（图/视/音/书）从扫描到浏览到播放/阅读的完整闭环可用。
2. 1 万+ 文件媒体库冷启动 < 数秒，增量扫描有效，内存稳定，虚拟列表滚动流畅。
3. 歌词同步、翻译切换、逐字高亮、动态背景动效与原版一致，且**尽量 1:1 复刻 Apple Music**（见第四章第 5 节与第五章 5C）。
4. 标签、收藏集、播放列表、收藏、历史、回收站、多选批量操作全部可用。
5. 明暗主题 + 动态取色 + 中英 i18n 完整，且全端统一为 **Material Design 3** 视觉（无任何非 M3 组件混入）。
6. 文件夹变化自动增量更新，删除/新建文件实时反映。
7. 异常被兜底并写入日志，无静默黑屏。
8. Windows 桌面端与 Android 移动端体验一致，能力适配层正确收敛平台差异，响应式断点按第五章 5D 生效。
9. **交付产物达标**：Windows NSIS 安装包 + zip、Android APK 均能通过 CNB 云原生构建自动产出并归档到制品库，可直接下载安装运行（非仅原型/文档）。

---

## 附录 A：CNB 云原生构建 `.cnb.yml` 参考骨架

> 本仓库已提供 `.cnb.yml`（见仓库根目录），用 CNB 云原生构建完成双端编译与产物归档。以下为可参考的骨架结构（实施时按实际工程路径调整）：

```yaml
master:
  push:
    - name: build-lumiluna-tauri
      runner:
        cpus: 8
      docker:
        build:
          dockerfile: ./Dockerfile.build   # 预装 Node+Rust+Tauri/Android 工具链
      stages:
        - name: install
          script: |
            npm ci
            cd src-tauri && cargo build --release
        - name: build-android
          script: |
            cargo tauri android build --apk   # 产出 APK（NDK 目标已在镜像预装）
        - name: package-windows
          script: |
            npm run build
            tauri build --bundles nsis,zip   # 产出 Windows 安装包 + zip
        - name: upload-artifacts
          type: cnb:trigger                  # 或制品库上传插件
          options:
            slug: $CNB_REPO_SLUG
            event: api_trigger
            env:
              VERSION: $CNB_COMMIT_SHORT
$
  tag_push:
    - name: release-artifacts
      stages:
        - name: publish
          type: git:release
          options:
            tag: $CNB_BRANCH
            description: "LumiLuna Tauri 2 双端交付产物"
```

> 说明：
> - `master` 分支 `push` 触发双端构建并归档；`tag_push` 触发 Release 发布。
> - Android 需要 rustup 添加 NDK 目标（`aarch64-linux-android` 等）并配置 `ANDROID_NDK_HOME`，可用 `docker.build` Dockerfile 预装。
> - PR 事件建议只做 `npm ci + cargo check` 的构建校验，不产出安装包，节省资源。

---

## 附：Tauri 2 开发约定速查（开发时务必遵守）

- **M3 视觉铁律**：所有组件/页面一律走 M3 设计令牌（色板、shape、type-scale、elevation、motion），禁止在组件里写魔法色值或引入非 M3 组件库（Ant/Element Plus 等）。新增组件先从 `@material/web` 找，找不到再按 M3 规范自定义并复用令牌。
- **播放器动效数字**：类 Apple Music 播放器的缓动曲线、blur/saturate/brightness、字号/行距/偏移等魔法数字需原样保留（见第四章第 5 节），不得擅自改动，改动前需说明。
- **布局蓝本**：应用骨架、Now Playing 两栏/分页、响应式断点、各 Tab 页布局以第五章为唯一 Layout 依据，实施时先搭骨架再填细节。
- **分层清晰**：前端不直接触碰磁盘/数据库/原生能力，一切经 `invoke`（请求/响应）+ `listen`/`emit`（事件推送）走 Rust Command。
- **Rust Command 集中注册**：所有 `#[tauri::command]` 统一在 `invoke_handler` 注册；命令参数/返回用 `serde` 结构体，双端类型在 `shared/` 共享。
- **权限最小化**：修改 `capabilities/default.json` 时只开放前端真正用到的命令/权限，不做 `*` 通配。
- **状态变更集中管理**（Pinia/Zustand），高频进度类更新用 `requestAnimationFrame` 合并，避免整树重渲染。
- **重活放 Rust**：扫描、哈希、元数据、缩略图在 `tokio`/`rayon` 中执行；前端 CPU 任务用 Web Worker。
- **双端能力走统一 `Capabilities` 接口**：新增平台能力时先定义前端接口，再分别实现 Rust Command（Windows）与 Android 适配。
- **组件只承载展示与交互**，业务状态由全局 store 持有；组件 id/滚动位置需可恢复。
- **窗口/托盘/全局快捷键等系统集成**只在 Rust 侧实现，通过 Tauri 事件通知前端。
