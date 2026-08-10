# LumiLuna 完整版 UI/UX 设计系统与开发规范 v1.2 (终炼详尽版)

**项目名称**：LumiLuna（光影 · 媒体库）  
**项目定位**：本地优先（Local-first）全媒体管理应用  
**技术栈**：Tauri 2 + Vue 3 + TypeScript + Material Design 3 (M3 Expressive)  
**核心参考**：音乐播放器 1:1 复刻 Apple Music 设计语言与视觉感官  

---

## 0. 核心设计哲学

### 0.1 顶层设计原则（源自 Apple HIG + M3 Expressive）

| 原则说明 | 详细设计要求 | 落地实现与代码体现 |
| :--- | :--- | :--- |
| **严禁 Emoji 图标** | 界面、组件、操作提示及文档中**严禁使用任何 Unicode Emoji**。所有图标统一采用矢量图标系统。 | 采用 `Material Symbols Rounded` 图标库，通过 `font-variation-settings` 动态控制填充态与字重。 |
| **内容即英雄 (Content First)** | 界面元素绝不喧宾夺主，主视觉由用户媒体文件（专辑封面、视频缩略图、照片）主导。 | 主内容区采用 Subtle 中性色 Surface 背景，去除冗余边框；顶部与侧边栏透明度设为 80%–85% 配合高斯模糊。 |
| **简洁至上 (Simplicity)** | 界面不存在无功利目的的装饰；核心功能链路的操作层级与路径必须小于等于 3 步。 | 极简工具栏设计；右键菜单/底部 Sheet 聚合高频操作；搜索与筛选支持一键重置。 |
| **平台原生感 (Native Integration)** | 在各操作系统上展现贴合该平台习惯的外观与行为，避免统一成“异构网页”。 | 采用分层原生策略：Windows 采用 Mica/Acrylic + Fluent Titlebar；macOS 采用液态玻璃 (Liquid Glass) 与胶囊按钮；Android 保持纯正 M3。 |
| **可访问性优先 (Accessibility)** | 无障碍设计贯穿全流程，包容不同视力、听力与交互能力的使用者。 | 正文颜色对比度 ≥ 4.5:1；移动端触控点击热区 ≥ 48dp；所有组件完整支持键盘 Tab 与 方向键焦点导航。 |
| **沉浸与克制 (Immersion)** | 媒体播放时营造无边界沉浸感，常规管理界面保持清晰理性的结构感。 | 全屏音乐播放器独立使用暗色主题（深色背景 `#0F0F11`），不受系统外观（Light/Dark Mode）影响；其余界面自适应系统主题。 |

### 0.2 矢量图标与 Emoji 零容忍规范

为保持应用高端、专业且跨平台统一的工业质感，项目全面禁止直接内嵌 Unicode Emoji。

#### 1. 字体引入（国内加速 CDN）
在 `index.html` 的 `<head>` 中引入 Material Symbols Rounded：
```html
<link rel="preconnect" href="[https://fonts.googleapis.cn](https://fonts.googleapis.cn)">
<link rel="preconnect" href="[https://fonts.gstatic.cn](https://fonts.gstatic.cn)" crossorigin>
<link href="[https://fonts.googleapis.cn/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200](https://fonts.googleapis.cn/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200)" rel="stylesheet">
2. 全局 CSS 类与变量映射CSS.md-symbol {
  font-family: 'Material Symbols Rounded';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  /* M3 可变轴控制 */
  font-variation-settings:
    'FILL' 0,
    'wght' 400,
    'GRAD' 0,
    'opsz' 24;
  transition: font-variation-settings 0.2s cubic-bezier(0.2, 0, 0, 1);
}

/* 激活/选中状态切换为实心填充 */
.md-symbol.filled {
  font-variation-settings:
    'FILL' 1,
    'wght' 500,
    'GRAD' 0,
    'opsz' 24;
}
3. 常用图标角色映射表功能语义Material Symbol 名称未激活态 (Unfilled)激活/选中态 (Filled)媒体库/首页grid_viewFILL: 0, wght: 400FILL: 1, wght: 500音乐/播放器music_noteFILL: 0, wght: 400FILL: 1, wght: 500收藏/星标favoriteFILL: 0, wght: 400FILL: 1, wght: 500文件夹/目录folderFILL: 0, wght: 400FILL: 1, wght: 500搜索searchFILL: 0, wght: 400FILL: 1, wght: 600设置settingsFILL: 0, wght: 400FILL: 1, wght: 500播放控制play_arrow, pause, skip_next, skip_previousFILL: 1, wght: 400FILL: 1, wght: 600空状态指示collections_bookmark, search_off, broken_imageFILL: 0, wght: 300N/A0.3 动效哲学 (Motion Philosophy)有因有果 (Causality)：所有入场或展开动效的源头点必须精确对应用户的触控或点击坐标。父子错开 (Staggering)：列表或网格组件加载时，子项动画需保持 20ms–35ms 的延迟错开（Stagger），体现视觉深度。物理弹簧 (Spring Physics)：全面使用 M3 Expressive 弹簧参数取代传统三次贝塞尔曲线，消除机械式的匀速或假减速感。1. 设计令牌（Design Tokens）—— Layer 11.1 颜色系统（M3 语义化颜色映射）项目严格遵循 Material Design 3 语义化命名定义变量，确保支持主题实时切换与动态取色。CSS:root {
  /* ===== 亮色模式 (Light Theme) ===== */
  --md-sys-color-primary: #1A5C9E;
  --md-sys-color-on-primary: #FFFFFF;
  --md-sys-color-primary-container: #D2E4FF;
  --md-sys-color-on-primary-container: #001C3B;
  
  --md-sys-color-secondary: #535F70;
  --md-sys-color-on-secondary: #FFFFFF;
  --md-sys-color-secondary-container: #D7E3F7;
  --md-sys-color-on-secondary-container: #101C2B;
  
  --md-sys-color-surface: #FCFCFC;
  --md-sys-color-on-surface: #1A1C1E;
  --md-sys-color-surface-container-lowest: #FFFFFF;
  --md-sys-color-surface-container-low: #F6F7F9;
  --md-sys-color-surface-container: #F2F3F5;
  --md-sys-color-surface-container-high: #ECEEE0;
  --md-sys-color-surface-container-highest: #E2E4E7;
  
  --md-sys-color-on-surface-variant: #44474E;
  --md-sys-color-outline: #7A7E87;
  --md-sys-color-outline-variant: #C4C6CF;
  --md-sys-color-scrim: rgba(0, 0, 0, 0.7);
  --md-sys-color-error: #BA1A1A;
  --md-sys-color-on-error: #FFFFFF;
}

.dark-theme {
  /* ===== 暗色模式 (Dark Theme) ===== */
  --md-sys-color-primary: #8BB9F0;
  --md-sys-color-on-primary: #001C3B;
  --md-sys-color-primary-container: #002E5E;
  --md-sys-color-on-primary-container: #D2E4FF;
  
  --md-sys-color-secondary: #BBC7DB;
  --md-sys-color-on-secondary: #253140;
  --md-sys-color-secondary-container: #3B4758;
  --md-sys-color-on-secondary-container: #D7E3F7;
  
  --md-sys-color-surface: #0F0F11;
  --md-sys-color-on-surface: #E2E2E5;
  --md-sys-color-surface-container-lowest: #0A0A0C;
  --md-sys-color-surface-container-low: #131316;
  --md-sys-color-surface-container: #1A1C1E;
  --md-sys-color-surface-container-high: #24262A;
  --md-sys-color-surface-container-highest: #2E3035;
  
  --md-sys-color-on-surface-variant: #C7C9CD;
  --md-sys-color-outline: #8F939B;
  --md-sys-color-outline-variant: #44474E;
  --md-sys-color-scrim: rgba(0, 0, 0, 0.85);
  --md-sys-color-error: #FFB4AB;
  --md-sys-color-on-error: #690005;
}
系统适配逻辑：Windows 平台适配：当设置中开启“使用系统强调色”时，动态读取 Windows 主题色。亮色模式下将主色替换为 #0078D4，暗色模式下替换为 #4CC2FF，并重新生成 Container 色阶。播放器特判：全屏音乐播放器视图强行覆写变量系统为 .dark-theme，且大背景定义为 #0F0F11，不受系统自适应影响。1.2 字体排印 (Type Scale & Variable Axes)全应用采用 Google Sans Flex 可变字体（Variable Font），在缺少该字体的系统上回退至 Roboto Flex 和系统默认无衬线字体。CSSbody {
  font-family: "Google Sans Flex", "Roboto Flex", Roboto, -apple-system, 
               BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
}
Typography 规格全表Token 名称字重 (Weight)字号 (Size)行高 (Line Height)字间距 (Tracking)典型应用场景Display Large40057px64px-0.25px全屏播放器中当前播放的歌曲大标题Display Medium40045px52px0px媒体统计大数字展现、年度回顾标题Headline Large60032px40px0px模块大组标题、主视窗顶部栏大标题Headline Medium60028px36px0px“图库”、“音乐库”、“播放列表”页面标题Title Large50022px28px0px文件网格卡片文件名、弹窗顶部标题Title Medium50016px24px0.15px侧边栏导航条目、对话框正文小标题Title Small50014px20px0.1px列表卡片次级标题、分组 HeaderBody Large40016px24px0.5px元数据详情正文、长文本描述Body Medium40014px20px0.25px设置选项辅助说明文字Body Small40012px16px0.4px文件路径、创建时间、音频码率参数Label Large50014px20px0.1px主按钮文字、Chip 选中标签、Tab 文字Label Small50011px16px0.5px图像 EXIF 悬浮 Badge、视频时长 Tag可变轴（Variable Axes）高级微调规则数字等宽：时间码（如 03:45 / 04:20）、文件大小（12.4 MB）和进度百分比必须设置 font-variant-numeric: tabular-nums，防止数字变动引起布局抖动。暗色模式 Grade 轴调校：暗色模式下，白色文字在深色背景上容易产生视觉膨胀和眩光。通过 CSS 设置 Grade 轴：CSS.dark-theme {
  font-variation-settings: 'GRAD' -25;
}
该设置可在不改变布局宽度（字符像素宽度不变）的前提下微幅减细笔画，大幅提升夜间阅读舒适度。1.3 圆角与间距系统（8px 网格）间距阶梯（Spacing Scale）以 8px 为基础网格单位，衍生阶梯：4px (0.5x), 8px (1x), 12px (1.5x), 16px (2x), 24px (3x), 32px (4x), 48px (6x), 64px (8x)。圆角令牌 (Shape Tokens)Extra Small (4px)：Tooltip 提示框、进度条滑块。Small (8px)：输入框、下拉菜单项、小型 Chip 标签、按钮。Medium (12px)：媒体网格卡片、缩略图容器、扩展 FAB (Small)。Large (16px)：扩展 FAB (Medium)、多选面板。Extra Large (28px)：侧边栏选中指示器、搜索栏（药丸形）、对话框容器。Full (9999px)：圆角 Pill 按钮、圆头像。多端布局间距表间距类型桌面端 (Desktop >1024px)平板端 (Tablet 600–1024px)移动端 (Mobile <600dp)外围 Margins24px20px16px卡片网格 Gap16px12px8px列表项间距 Padding12px 16px10px 12px8px 12px弹窗内边距 Padding24px24px16px1.4 动效令牌 (M3 Expressive 弹簧参数)全面放弃传统贝塞尔曲线，采用物理弹簧模型。在前端使用 @vueuse/motion 或 JavaScript 动画引擎驱动：TypeScript// M3 Expressive 弹簧配置集合
export const springPresets = {
  // 空间移动：用于页面切换、侧边栏展开与折叠
  spatial: {
    stiffness: 500,
    damping: 30,
    mass: 1.0
  },
  // 慢速空间移动：全屏播放器拉起、Hero 转场动画
  spatialSlow: {
    stiffness: 400,
    damping: 28,
    mass: 1.2
  },
  // 微交互效果：卡片 Hover 抬升、按钮点击涟漪、Chip 状态切换
  effects: {
    stiffness: 350,
    damping: 25,
    mass: 0.8
  },
  // 退出/关闭：窗口关闭、弹窗消失、删除文件
  exit: {
    stiffness: 600,
    damping: 40,
    mass: 0.9
  },
  // 弹性反馈：星标点赞微交互、拉到边界时的弹性回弹
  bouncy: {
    stiffness: 340,
    damping: 18,
    mass: 0.7
  }
};
1.5 音乐播放器专用“魔法数字”（强约束）⚠️ 最高优先级强制规则：以下数值直接提取自 Apple Music 风格参考代码。任何重构或优化必须 100% 遵守以下数值，禁止随意修改。CSS/* 流体动态背景滤镜与变换组合 */
.player-fluid-canvas {
  filter: blur(30px) saturate(2.5) brightness(0.5);
  transform: scale(1.5);
  mix-blend-mode: screen;
  animation: fluidDrift 20s linear infinite;
}

@keyframes fluidDrift {
  0%   { transform: scale(1.5) rotate(0deg); }
  100% { transform: scale(1.5) rotate(360deg); }
}
播放器核心数学与物理常数流体背景：blur(30px)，saturate(2.5)，brightness(0.5)，初始 scale(1.5)。漂移周期：20s 慢速自转，混合模式 mix-blend-mode: screen。歌词偏移锚点：LYRIC_OFFSET = window.innerHeight / 3，即当前行固定位于视口上端 1/3 处。歌词状态：当前播放行缩放比 scale(1.25)，字重增至 600，高亮为 #FFFFFF；非当前行根据与锚点的像素距离 distance 呈线性衰减，公式：opacity = max(0.2, 1 - abs(distance) / (0.4 * window.innerHeight))歌词上下渐隐 Mask：歌词容器使用 mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)。进度条 Hover 响应：默认轨道高度 4px，Hover 时轨道扩增至 8px，且滑块（Thumb）从 opacity: 0 渐变至 opacity: 1 并在拉动时放至 12px 直径。2. 组件规范 —— Layer 2 (Components)2.1 文件卡片 (Media Card)适用于图片、视频及音频专辑网格展示。┌──────────────────────────────────────────┐
│                                          │
│           缩略图区域 (Thumbnail)           │
│               高度占比 70%                │
│         object-fit: cover                │
│                                          │
├──────────────────────────────────────────┤
│ 文件名 (Title Large, 单行截断...)         │
│ [图标] 1080P   [图标] MP4    4.2 MB       │
└──────────────────────────────────────────┘
卡片状态多端映射表状态类型桌面端 (Mouse & Keyboard)移动端 (Touch)默认 (Default)背景 --md-sys-color-surface-container，圆角 12px，无阴影，无边框同桌面端悬停 (Hover)向上平移 -2px，阴影递增至 Elevation 2，缩略图叠加 10% 遮罩并显现 Material Symbol visibility 预览按钮无悬停态（自动忽略）按下 (Pressed)施加 M3 标准水波纹 (Ripple) 从点击坐标扩散，缩放 scale(0.98)触发水波纹，反馈时缩放 scale(0.96)选中 (Selected)边框叠加 2px var(--md-sys-color-primary)，右上角展示 Material Symbol check_circle (Filled)长按进入选中模式，右上角展示对勾，顶部出现批量操作栏骨架加载 (Skeleton)展示灰色圆角占位块，伴随 1.5s 循环的线性流光 (Shimmer) 动画同桌面端2.2 扩展 FAB (Extended FAB) —— M3 Expressive 2025项目全面弃用旧版 56dp 圆形基线 FAB，采用 M3 Expressive 矩形柔化风格。┌──────────────────────────────────────────┐
│  [ Material Symbol ]   添加媒体目录       │  <- 高度 80dp / 圆角 16px
└──────────────────────────────────────────┘
规格分级表FAB 规格高度 (Height)内边距 (Padding)圆角 (Radius)内嵌 Material Symbol典型使用场景Small Extended56dp左右 16px12pxadd (wght: 500)次级页面快速新建或追加条目Medium Extended80dp左右 24px16pxflex_direction / search库主界面核心操作（如“立即全盘扫描”）Large Extended96dp左右 32px20pxfile_upload首次启动/空状态下的强引导按钮配色配置：背景采用 --md-sys-color-primary-container，图标与文字统一使用 --md-sys-color-on-primary-container。2.3 Chip 标签组件用于媒体类型过滤、EXIF 标签展示与多选 Combobox。HTML<!-- 选中状态 Chip -->
<div class="md-chip selected">
  <span class="md-symbol filled">filter_list</span>
  <span class="label">无损音频</span>
</div>
CSS.md-chip {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s var(--motion-effects);
}

.md-chip.selected {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  font-weight: 500;
}
2.4 对话框 (Dialog) 与底部动作栏 (Bottom Sheet)根据不同屏幕尺寸，同一交互模态自动响应式切换形态：桌面端 (>900px):               移动端 (<600dp):
┌─────────────────────────┐   ┌─────────────────────────┐
│     Modal Dialog        │   │                         │
│  ┌───────────────────┐  │   │─────────────────────────│
│  │   编辑文件元数据   │  │   │ ═ 拖拽手柄              │
│  │                   │  │   │ 选项条目 1              │
│  │   [取消]  [保存]  │  │   │ 选项条目 2              │
│  └───────────────────┘  │   │ [  确定  ]              │
└─────────────────────────┘   └─────────────────────────┘
桌面端：居中卡片对话框，宽度 400px–560px，背景为 surface-container-high，伴随 scrim 遮罩（透明度 0.7）。移动端：自底部滑出的 Bottom Sheet，顶部带有 32px × 4px 的圆角拖拽手柄（Handle Slider）。支持下滑手势手势取消。2.5 沉浸式搜索栏 (Search Bar)桌面端形态：药丸形状（圆角 28px），高度 48px，背景为 surface-container-high。常驻展开，左侧放置 Material Symbol search，右侧放置快捷键提示框（如 Ctrl + K）。移动端形态：默认折叠为 AppBar 上的单个 search 图标。点击后通过 Hero 转场扩展至全屏搜索层，自动聚焦输入框并弹起软键盘。2.6 自定义沉浸式滚动条全局覆盖系统默认滚动条，防止破坏磨砂玻璃的整体感：CSS/* 自定义 Webkit 滚动条 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--md-sys-color-surface-container-highest);
  border-radius: 3px;
  transition: opacity 0.3s ease;
}

/* 停止滚动 1 秒后配合 JS 淡出 */
.is-scrolling::-webkit-scrollbar-thumb {
  opacity: 0.8;
}

.is-idle::-webkit-scrollbar-thumb {
  opacity: 0;
}
3. 布局与导航架构 —— Layer 3 (Patterns)3.1 响应式断点与形态切换+-------------------------------------------------------------------------+
|                              桌面端 (>1024px)                           |
| +------------------+ +--------------------------------+ +-------------+ |
| | Navigation Drawer| |          主内容网格流           | |  详情面板   | |
| | (展开 280px)     | |          (3-5 列)            | |  (360px)    | |
| +------------------+ +--------------------------------+ +-------------+ |
+-------------------------------------------------------------------------+

+-------------------------------------------------------------------------+
|                              平板端 (600–1024px)                        |
| +------------+ +------------------------------------------------------+ |
| | Nav Rail   | |                   主内容网格流                       | |
| | (80px)     | |                   (2-3 列)                           | |
| +------------+ +------------------------------------------------------+ |
+-------------------------------------------------------------------------+

+-------------------------------------------------------------------------+
|                              移动端 (<600dp)                            |
| +---------------------------------------------------------------------+ |
| |                           单列瀑布流 / 网格                          | |
| +---------------------------------------------------------------------+ |
| | Navigation Bar (底部 80px，含安全区)                                 | |
+-------------------------------------------------------------------------+
3.2 导航双轨制（Pinia 状态强同步）为了确保从桌面窗口缩放到移动端时状态不丢失，导航状态必须完全抽象至 Pinia Store：TypeScript// stores/navigation.ts
import { defineStore } from 'pinia';

export const useNavStore = defineStore('navigation', {
  state: () => ({
    activeTab: 'library', // 'library' | 'favorites' | 'playlists' | 'search' | 'settings'
    isPlayerExpanded: false,
    sidebarCollapsed: false,
  }),
  actions: {
    setActiveTab(tab: string) {
      this.activeTab = tab;
    },
    togglePlayer(expand?: boolean) {
      this.isPlayerExpanded = expand ?? !this.isPlayerExpanded;
    }
  }
});
4. 跨平台交互行为规范4.1 输入范式自动识别与差异化处理应用启动时自动检测输入环境指针类型：JavaScriptconst isFinePointer = window.matchMedia('(pointer: fine)').matches; // 鼠标 / 触控板
交互行为桌面端 (Fine Pointer)移动端 (Coarse Pointer)查看详情双击卡片 / 单击打开预览栏单击直接进入详情页，左滑返回上下文菜单鼠标右键触发 Tauri 原生风格 Context Menu长按（Haptic 振动反馈 50ms）弹出 Bottom Action Sheet多选文件Ctrl / Cmd + 点击；或按住鼠标左键拉出蓝框框选长按首个条目进入“选择模式”，后续单击进行勾选手势操作触控板双指滑动 / 滚轮缩放拖拽列表边缘右滑返回；两指 Pinch 缩放图片/漫画快捷键响应键盘监听生效 (Esc, Space, Ctrl+F)依靠顶部/底部按钮操作4.2 桌面端全局与局部快捷键清单快捷键组合作用域对应触发动作Ctrl/Cmd + Shift + Space系统全局呼出/隐藏 LumiLuna 主窗口 (Spotlight 迷你模式)Ctrl/Cmd + Shift + F应用内焦点直接锁定主搜索框，并全选已有文本Space应用内播放 / 暂停当前选中的音频或视频Left / Right播放器 / 灯箱音视频快退/快进 5 秒；图片/漫画阅读器翻页Esc应用内依次关闭：全屏播放器 → 图片灯箱 → 模态弹窗 → 取消全选Ctrl/Cmd + A内容区全选当前网格或列表中的所有文件条目Delete / Backspace内容区弹出确认框，将选中条目从数据库索引中移除5. 音乐播放器专项规范（Apple Music 风格 1:1）5.1 流体动态背景实现技术方案背景由采样自专辑封面的 4 个主要颜色的 Canvas 粒子层组成，叠加 CSS 滤镜：HTML<div class="player-container">
  <!-- 动态流体背景层 -->
  <div class="fluid-background-wrapper">
    <canvas id="fluid-canvas" class="player-fluid-canvas"></canvas>
    <div class="dark-overlay"></div>
  </div>
  
  <!-- 上层内容结构 -->
  <div class="player-content">
    <!-- 封面与歌词 -->
  </div>
</div>
CSS.dark-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 15, 17, 0.55);
  backdrop-filter: blur(10px);
}
5.2 歌词驱动算法（TS 实现）TypeScript// LyricEngine.ts
export interface LyricLine {
  time: number; // 秒
  text: string;
  translation?: string;
}

export function calculateLyricStyles(
  lines: LyricLine[], 
  currentTime: number, 
  viewportHeight: number
) {
  const LYRIC_OFFSET = viewportHeight / 3;
  
  // 查找当前播放行索引
  let activeIndex = lines.findIndex((line, index) => {
    const nextLine = lines[index + 1];
    return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
  });
  
  if (activeIndex === -1) activeIndex = 0;

  return lines.map((line, index) => {
    const distance = index - activeIndex;
    const isCurrent = distance === 0;
    
    // 计算缩放与不透明度
    const scale = isCurrent ? 1.25 : 1.0;
    const opacity = isCurrent 
      ? 1.0 
      : Math.max(0.2, 1.0 - Math.abs(distance) * 0.25);
    const filter = isCurrent ? 'blur(0px)' : `blur(${Math.min(Math.abs(distance), 3)}px)`;

    return {
      isCurrent,
      style: {
        transform: `scale(${scale})`,
        opacity,
        filter,
        transition: 'all 0.35s cubic-bezier(0.2, 0, 0, 1)'
      }
    };
  });
}
5.3 封面驱动取色流水线 (@material/material-color-utilities)TypeScriptimport { 
  SourceColorFromImage, 
  themeFromSourceColor, 
  argbFromHex 
} from '@material/material-color-utilities';

export async function extractPaletteFromCover(imageElement: HTMLImageElement) {
  try {
    // 1. 从图片提取主色
    const sourceArgb = await SourceColorFromImage(imageElement);
    
    // 2. 生成完整 M3 动态主题色板
    const theme = themeFromSourceColor(sourceArgb);
    
    // 3. 提取暗色模式下的 Primary 与 Container 色值
    const darkTokens = theme.schemes.dark;
    
    return {
      primary: darkTokens.primary,
      onPrimary: darkTokens.onPrimary,
      primaryContainer: darkTokens.primaryContainer,
      onPrimaryContainer: darkTokens.onPrimaryContainer,
      surface: darkTokens.surface
    };
  } catch (error) {
    // 降级方案：返回默认深蓝主题 Token
    return {
      primary: argbFromHex('#8BB9F0'),
      onPrimary: argbFromHex('#001C3B'),
      primaryContainer: argbFromHex('#002E5E'),
      onPrimaryContainer: argbFromHex('#D2E4FF'),
      surface: argbFromHex('#0F0F11')
    };
  }
}
6. 跨平台分层原生策略Plaintext┌─────────────────────────────────────────────────────────────────┐
│                      LumiLuna 逻辑架构                          │
├─────────────────────────────────────────────────────────────────┤
│ [ Layer 3: 表层适配 (Surface) ]                                 │
│  ├── Windows: Mica 材质 / 窗口左侧原生菜单 + 右侧三键         │
│  ├── macOS: 液态玻璃 (Liquid Glass) / 无边框 / 顶部红绿灯       │
│  └── Android: 沉浸式状态栏 / 系统 Back 手势拦截 / 状态栏变色     │
├─────────────────────────────────────────────────────────────────┤
│ [ Layer 2: 表现层 (Expressive) ]                                │
│  ├── 控件形态差异 (macOS 胶囊按钮 vs Windows 4px 微圆角)        │
│  └── 材质降级 (低端机 Acrylic 降级为纯色不透明背景)             │
├─────────────────────────────────────────────────────────────────┤
│ [ Layer 1: 内核层 (Core Engine - 100% 统一) ]                  │
│  ├── SQLite 文件索引数据库                                      │
│  ├── 音视频解码与 FFmpeg / Lofty 元数据解析                     │
│  └── 状态管理 (Pinia) 与 播放队列控制                           │
└─────────────────────────────────────────────────────────────────┘
7. 系统反馈与异常状态7.1 空状态 (Empty States) 规格表触发场景展示矢量图标 (Material Symbol)标题文案辅助描述预设主要动作 (Primary Action)首次启动 / 无目录collections_bookmark你的光影宇宙还未诞生添加本地文件夹，开启本地媒体自动索引大号 Extended FAB：“添加媒体目录”搜索/筛选无匹配search_off未找到匹配的文件尝试更换关键字，或清除已选的类型标签普通 Pill 按钮：“一键清除筛选条件”损坏文件 / 解码失败broken_image文件损坏或格式不受支持无法解析此文件的元数据与缩略图链接按钮：“查看本地文件属性”7.2 通知与 Toast 机制Snackbar 轻量提示：浮动于界面左下角（桌面端）或底部导航栏上方 16px（移动端）。采用 surface-container-highest 磨砂背景，4 秒无操作自动淡出。Tauri 系统级 Notification：仅在应用处于后台运行且耗时任务完成时触发（例：“后台扫描完成，新增 142 个媒体文件”）。8. 设置面板控件选型与规格表配置分类关联功能项所采用的 M3 控件控件交互行为描述通用设置开机自启、深色模式跟随系统Switch 开关点击后即时生效，伴随平滑滑块动画与 Haptic 反馈视图偏好默认呈现形态（网格/列表）Segmented Button2–3 段式互斥选择器，选中段高亮放大性能控制缩略图缓存上限 (1GB–20GB)Slider 滑块带有数值 Floating Badge 指示器，支持步进吸附媒体库路径本地索引文件夹管理Input Field + Button路径文本框（只读 + 自动省略） + 右侧“浏览”按钮主题个性化自定义 Primary 强调色Color Picker 弹窗弹出 M3 预设色板网格，支持实时预览9. 可访问性 (WCAG 2.1 AA) 量化指标色彩对比度：所有正文文本与背景色的对比度必须大于等于 4.5:1；大文本（24px 及以上）对比度必须大于等于 3.0:1。键盘焦点状态：所有可交互元素在获得 Tab 键盘焦点时，必须外显 2px Solid 样式的 Primary 颜色 Focus Ring，且 outline-offset 设为 2px。触控目标区域：移动端所有图标按钮视觉大小可为 24px，但外围 Padding 扩展后物理触控点按区域必须大于等于 48 × 48 dp。无障碍动效开关：自动检测系统 prefers-reduced-motion: reduce 媒体查询，若开启，则全局禁用物理弹簧动效，降级为普通的 100ms 淡入淡出。10. 动效性能与 GPU 渲染硬规则合成器（Compositor）硬规则：所有 CSS 动画与 JS 动画，严禁改变 width, height, top, left, margin, padding 等触发布局重排（Reflow）的属性。只允许对 transform (translate/scale/rotate) 和 opacity 进行 CSS 硬件加速动画。提升 GPU 渲染图层：高频动画组件（如播放器流体 Canvas、全屏转场容器）必须强制声明 will-change: transform 或 transform: translateZ(0)。虚拟滚动强制性：文件网格与列表条目超过 100 项时，必须强制启用 vue-virtual-scroller。移动端 DOM 渲染缓冲区（Buffer）限制为前后各 5 项，防止 DOM 节点过多引发内存溢出（OOM）。11. 设计系统分层架构总览Plaintext┌─────────────────────────────────────────────────────────────────┐
│                      LumiLuna 设计系统                          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Design Tokens (设计令牌)                              │
│  ├── 颜色 (M3 语义化角色 + Windows 强调色 + 播放器独立深色)       │
│  ├── 字体排印 (Google Sans Flex，数字等宽 tabular-nums)          │
│  ├── 圆角与间距 (8px 网格 + Shape Scale)                        │
│  └── 动效令牌 (M3 Expressive 弹簧系统 + 播放器魔法数字)           │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Components (组件规范)                                 │
│  ├── 文件卡片 (Media Card 70% 缩略图 + 多端状态)                 │
│  ├── 扩展 FAB (M3 Expressive 矩形柔化 Small/Medium/Large)         │
│  ├── Chip / 对话框 / 底部动作栏 / 沉浸式搜索栏                   │
│  └── 自定义沉浸式滚动条 (按需淡入淡出)                            │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Patterns (模式与架构)                                 │
│  ├── 响应式布局 (Mobile <600dp / Tablet / Desktop >1024px)       │
│  ├── 导航双轨制 (Pinia 状态共享与同步)                           │
│  ├── 音乐播放器 (Apple Music 1:1 流体背景 + 歌词算法 + 取色)      │
│  └── 跨平台交互 (Fine/Coarse 指针自动检测 + 快捷键 + 手势)       │
├─────────────────────────────────────────────────────────────────┤
│  横切关注点：矢量图标规范 (零 Emoji) + WCAG AA + GPU 渲染压榨     │
└─────────────────────────────────────────────────────────────────┘
12. 给 AI 编程的终极集成提示词 (Prompt Master Bundle)你在向 AI 代码助手（如 Cursor, GitHub Copilot, Claude）发送开发指令时，请直接复制并粘贴以下封装好的 Prompt：Markdown请基于 Vue 3 + TypeScript + Vite + Tauri 2 构建 LumiLuna 媒体库应用。严格遵循以下设计规范与架构约束：

1. **矢量图标与零 Emoji 强约束**：
   - 界面、注释、UI 控件中**严格禁止使用任何 Unicode Emoji**。
   - 必须引入并全面使用 `Material Symbols Rounded` 矢量图标库。
   - 图标通过 `font-variation-settings` 实现状态切换（默认 `FILL: 0, wght: 400`，选中/激活态 `FILL: 1, wght: 500`）。所有可交互图标按钮必须包含 `aria-label`。

2. **字体与排版**：
   - 使用 `Google Sans Flex` 可变字体（引入国内镜像 `fonts.googleapis.cn`）。
   - 所有时间码、文件大小、百分比数字必须强制设置 `font-variant-numeric: tabular-nums` 实现等宽对齐。
   - 暗色模式下设置 `font-variation-settings: 'GRAD' -25` 减轻眩光。

3. **样式与设计令牌**：
   - 使用 CSS 变量（`--md-sys-color-*`）构建 M3 语义化颜色系统。
   - 动效禁止手写 `cubic-bezier`，必须使用 `@vueuse/motion` 提供的 M3 Expressive 弹簧配置 (`stiffness`, `damping`, `mass`)。

4. **音乐播放器专项 (Apple Music 1:1)**：
   - 全屏播放器独立使用 `#0F0F11` 深色背景，不跟随系统外观。
   - 流体背景必须严格使用 `blur(30px) saturate(2.5) brightness(0.5) scale(1.5)` 结合 `20s` 自转动画。
   - 歌词偏移锚点精确设为 `LYRIC_OFFSET = window.innerHeight / 3`，当前播放行 `scale(1.25)` 高亮，非当前行施加渐进式模糊与透明度衰减。
   - 基于 `@material/material-color-utilities` 实现封面 4 象限取色与 M3 主题映射。

5. **响应式与长列表性能**：
   - 编写 `useBreakpoint` 组合式 hook，在 `<600dp`（移动端 BottomNavigationBar）、`600-1024dp`（Navigation Rail）与 `>1024dp`（Navigation Drawer）之间平滑切换。
   - 使用 `usePointer` 自动探测 `pointer: fine` 与 `pointer: coarse` 环境，差异化绑定 `@hover/@dblclick` 与长按/手势。
   - 所有文件网格必须使用 `vue-virtual-scroller` 实现虚拟滚动，只对 `transform` 和 `opacity` 应用 GPU 硬件加速动画。

6. **跨平台策略**：
   - 检测 Tauri OS 环境：Windows 应用 Mica 材质与原生标题栏；macOS 应用液态玻璃材质与胶囊按钮；Android 启用沉浸式状态栏与系统返回键拦截。