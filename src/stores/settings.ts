import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { LazyStore } from "@tauri-apps/plugin-store";
import { capabilities } from "@/capabilities";
import { applySeedColor, clearSeedTokens } from "@/utils/dynamicTheme";
import { applySkin } from "@/utils/skinLoader";
import { activePrepared, activeSkinDoc, skinModeLock, skinSafeMode } from "@/utils/skinRuntime";
import type { MusicServer, OnlinePlaylistEntry } from "@shared/types";
import type { LyricSourcePref } from "@/utils/preciseLyrics";

export type ThemeMode = "system" | "light" | "dark";
export type PdfReadMode = "single" | "dual" | "scroll";
/** 阅读器背景主题 */
export type ReaderThemeKey = "dark" | "light" | "sepia" | "green";
/** 阅读器正文字体 */
export type ReaderFontKey = "system" | "serif" | "sans" | "kai" | "yuan";
/** 歌词字体 */
export type LyricFontKey = "system" | "sans" | "serif" | "kai" | "yuan";
/** 播放器背景模式：animated 动态模糊 / image 仅图片模糊 / off 不启用 */
export type PlayerBgMode = "animated" | "image" | "off";
/** 应用级自定义背景类型：default 不启用（沿用皮肤/纯色背景）/ solid 纯色 / image 本地图片 / video 本地视频 / fluid 流体封面动画 */
export type AppBgType = "default" | "solid" | "image" | "video" | "fluid";
/** 歌词副行显示模式：翻译 / 罗马音 */
export type LyricSubMode = "translation" | "romaji";
/** 预设分享码偏好：仅中文 / 仅原版 / 两者同时输出 */
export type ShareCodePreference = "chinese" | "original" | "both";
/** 桌面歌词切换动画方案 */
export type DesktopLyricsAnimation = "fade" | "slide" | "scale" | "glow";
/** 桌面歌词控制栏显示策略：click 点击展开(5s 自动隐藏) / always 始终显示 */
export type DesktopLyricsToolbar = "click" | "always";
/** 双击桌面歌词动作：none 无操作 / toggle 播放暂停 */
export type DesktopLyricsDoubleClick = "none" | "toggle";
/** 桌面歌词窗口位置与尺寸（逻辑坐标） */
export interface DesktopLyricsBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}
/** 本地音乐库展示模式 */
export type MusicViewMode = "grid" | "list";
/** Wenku8 节点 */
export type Wenku8Node = "cc" | "net";
/** 小说页面字符集 */
export type NovelCharset = "gbk" | "big5";

const store = new LazyStore("settings.json");

const DEFAULTS = {
  theme: "system" as ThemeMode,
  /** MD3 动态配色的种子色（十六进制）；由它实时生成整套颜色令牌 */
  seedColor: "#1A5C9E",
  /** 激活皮肤的 id；空串 = 默认皮肤（动态配色） */
  activeSkin: "",
  /** 已删除的内置皮肤 id（删除即记忆，不再播种复活） */
  hiddenBuiltinSkins: [] as string[],
  lang: "zh" as "zh" | "en",
  lyricFontSize: 30,
  lyricLineHeight: 2.5,
  /** 行间间距：相邻歌词行之间的竖直间距（px） */
  lyricLineGap: 20,
  /** 歌词字体 */
  lyricFont: "system" as LyricFontKey,
  /** 歌词翻译字号（相对主歌词字号的百分比） */
  lyricTranslationSize: 62,
  /** 歌词与翻译之间的间距（px） */
  lyricTranslationGap: 4,
  /** 歌词副行显示：翻译 / 罗马音 */
  lyricSubMode: "translation" as LyricSubMode,
  /** 逐字歌词（Apple Music 式逐字填充 + 唱完上浮） */
  wordLyrics: true,
  /** 更精确的逐字歌词：播放时按 QQ → 酷狗 → [登录网易云后 Meting] → 本地回退链取逐字歌词 */
  preciseLyrics: false,
  /** 各歌曲手动选择的歌词来源偏好（key = 归一化标题|时长ms，值 = qq/kg/meting/local） */
  lyricSourcePrefs: {} as Record<string, LyricSourcePref>,
  /** 自动识别前奏/间奏：隐藏作词/作曲/编曲为三点，长间奏插入三点 */
  detectInstrumental: true,
  /** 播放器背景：动态模糊 / 仅图片模糊 / 关闭 */
  playerBg: "animated" as PlayerBgMode,
  lyricBlur: true,
  /** 应用级自定义背景类型：default 不启用自定义背景 */
  bgType: "default" as AppBgType,
  /** solid 模式使用的纯色（十六进制） */
  bgColor: "#1A5C9E",
  /** image 模式：本地图片绝对路径（空串表示未选择） */
  bgImagePath: "",
  /** video 模式：本地视频绝对路径（空串表示未选择） */
  bgVideoPath: "",
  /** 背景模糊度（px，仅作用于 image/video/fluid） */
  bgBlur: 10,
  /** 暗色遮罩浓度（0-100，百分比） */
  bgOverlay: 50,
  scanDirs: [] as string[],
  gridColumns: 6,
  /** 最小文件体积过滤（MB）；0 表示不过滤 */
  minFileSizeMb: 0,
  /** PDF 阅读模式：single 单页 / dual 双页 / scroll 滚动 */
  pdfReadMode: "single" as PdfReadMode,
  /** 阅读器背景主题 */
  readerTheme: "dark" as ReaderThemeKey,
  /** 阅读器正文字体 */
  readerFont: "system" as ReaderFontKey,
  /** 阅读器字号（%） */
  readerFontPct: 100,
  /** 阅读器行距 */
  readerLineHeight: 1.75,
  /** 阅读器段落间距（px）；0 表示跟随原书排版 */
  readerParaSpacing: 0,
  /** 用户手动指定的 ffmpeg 目录；空串表示自动探测 PATH */
  ffmpegDir: "",
  /** 实验性：启用在线音乐（meting API 搜索/歌单） */
  enableOnlineMusic: false,
  /** 在线音乐平台 */
  musicServer: "netease" as MusicServer,
  /** 用户自添加的在线歌单 */
  onlinePlaylists: [] as OnlinePlaylistEntry[],
  /** 预设歌单的重命名覆盖（key = server:id） */
  playlistRenames: {} as Record<string, string>,
  /** WebDAV 远程媒体源：启用开关 */
  webdavEnabled: false,
  /** WebDAV 服务器根 URL（如 https://host/remote.php/dav/files/user/） */
  webdavUrl: "",
  /** WebDAV 用户名 */
  webdavUser: "",
  /** WebDAV 密码（明文存 settings.json，与现有配置项一致） */
  webdavPass: "",
  /** 实验性：网易云账号（扫码登录，我的歌单 + 云盘） */
  neteaseEnabled: false,
  /** 实验性：在线小说（Wenku8 抓取） */
  onlineNovelEnabled: false,
  /** 实验性：笔趣阁网络小说（m.bqglll.cc，JS 验证门，走隐藏 WebView） */
  bqgNovelEnabled: false,
  /** 实验性：在线番剧（Kazumi 规则采集，仅桌面端） */
  onlineAnimeEnabled: false,
  /** 实验性：在线图片（Pixiv，移植自 Pixez） */
  onlinePixivEnabled: false,
  /** Pixiv refresh token（仅在本地磁盘与设置中保存，用于恢复会话） */
  pixivRefreshToken: "",
  /** Pixiv 图片质量：squareMedium / medium / large / original */
  pixivImageQuality: "large",
  /** Wenku8 节点：cc 主用 / net 备用 */
  wenku8Node: "cc" as Wenku8Node,
  /** 小说页面字符集：简中 GBK / 繁中 Big5 */
  novelCharset: "gbk" as NovelCharset,
  /** 预设分享码偏好：both（默认，两种同时输出）/ chinese / original */
  shareCodePreference: "both" as ShareCodePreference,
  /** 桌面歌词 */
  desktopLyricsEnabled: false,
  desktopLyricsFontSize: 28,
  desktopLyricsOpacity: 90,
  desktopLyricsLocked: false,
  desktopLyricsAlwaysOnTop: true,
  desktopLyricsShowNext: false,
  desktopLyricsShowTranslation: false,
  desktopLyricsClickThrough: false,
  desktopLyricsToolbar: "click" as DesktopLyricsToolbar,
  desktopLyricsDoubleClick: "toggle" as DesktopLyricsDoubleClick,
  desktopLyricsAnimation: "fade" as DesktopLyricsAnimation,
  desktopLyricsBounds: { width: 420, height: 120 } as DesktopLyricsBounds,
  /** 关闭窗口时最小化到托盘（而非退出应用） */
  closeToTray: true,
  /** 本地音乐库展示模式：网格 / 列表 */
  musicViewMode: "grid" as MusicViewMode,
  /** 实验性：在线番剧启用 DanDanPlay 弹幕（参考项目 Kazumi 的弹幕来源） */
  danmakuEnabled: false,
  /** DanDanPlay AppId（无凭证时降级为无签名模式，频率受限） */
  dandanAppId: "",
  /** DanDanPlay AppSecret（与 AppId 配套；缺失时视为无凭证） */
  dandanAppSecret: "",
  /** 弹幕不透明度 0-100 */
  danmakuOpacity: 80,
  /** 弹幕字号（px） */
  danmakuFontSize: 22,
  /** 弹幕显示区域 0-100（占屏百分比，参考项目 area） */
  danmakuArea: 75,
  /** 弹幕时间轴偏移（毫秒） */
  danmakuTimeOffsetMs: 0,
  /** 弹幕滚动速度 1-10 */
  danmakuSpeed: 5,
  /** 弹幕防重叠 */
  danmakuAntiOverlap: true,
  /** Bangumi 官方 Access Token（在 https://next.bgm.tv/demo/access-token 获取；与 pixivRefreshToken 同款本地保存） */
  bangumiToken: "",
  /** 当前连接的 Bangumi 用户名（token 校验成功后写入，收藏接口按它查询） */
  bangumiUsername: "",
  /** 上次成功同步 Bangumi 收藏的时间戳（0 = 从未同步；首次授权后自动做一次全量同步） */
  bangumiSyncedAt: 0,
};

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemeMode>(DEFAULTS.theme);
  const seedColor = ref(DEFAULTS.seedColor);
  const activeSkin = ref(DEFAULTS.activeSkin);
  const hiddenBuiltinSkins = ref<string[]>([...DEFAULTS.hiddenBuiltinSkins]);
  const lang = ref<"zh" | "en">(DEFAULTS.lang);
  const lyricFontSize = ref(DEFAULTS.lyricFontSize);
  const lyricLineHeight = ref(DEFAULTS.lyricLineHeight);
  const lyricLineGap = ref(DEFAULTS.lyricLineGap);
  const lyricFont = ref<LyricFontKey>(DEFAULTS.lyricFont);
  const lyricTranslationSize = ref(DEFAULTS.lyricTranslationSize);
  const lyricTranslationGap = ref(DEFAULTS.lyricTranslationGap);
  const lyricSubMode = ref<LyricSubMode>(DEFAULTS.lyricSubMode);
  const wordLyrics = ref(DEFAULTS.wordLyrics);
  const preciseLyrics = ref(DEFAULTS.preciseLyrics);
  const lyricSourcePrefs = ref<Record<string, LyricSourcePref>>({ ...DEFAULTS.lyricSourcePrefs });
  const detectInstrumental = ref(DEFAULTS.detectInstrumental);
  const playerBg = ref<PlayerBgMode>(DEFAULTS.playerBg);
  const lyricBlur = ref(DEFAULTS.lyricBlur);
  const bgType = ref<AppBgType>(DEFAULTS.bgType);
  const bgColor = ref(DEFAULTS.bgColor);
  const bgImagePath = ref(DEFAULTS.bgImagePath);
  const bgVideoPath = ref(DEFAULTS.bgVideoPath);
  const bgBlur = ref(DEFAULTS.bgBlur);
  const bgOverlay = ref(DEFAULTS.bgOverlay);
  const scanDirs = ref<string[]>([...DEFAULTS.scanDirs]);
  const gridColumns = ref(DEFAULTS.gridColumns);
  const minFileSizeMb = ref(DEFAULTS.minFileSizeMb);
  const pdfReadMode = ref<PdfReadMode>(DEFAULTS.pdfReadMode);
  const readerTheme = ref<ReaderThemeKey>(DEFAULTS.readerTheme);
  const readerFont = ref<ReaderFontKey>(DEFAULTS.readerFont);
  const readerFontPct = ref(DEFAULTS.readerFontPct);
  const readerLineHeight = ref(DEFAULTS.readerLineHeight);
  const readerParaSpacing = ref(DEFAULTS.readerParaSpacing);
  const ffmpegDir = ref(DEFAULTS.ffmpegDir);
  const enableOnlineMusic = ref(DEFAULTS.enableOnlineMusic);
  const musicServer = ref<MusicServer>(DEFAULTS.musicServer);
  const onlinePlaylists = ref<OnlinePlaylistEntry[]>([...DEFAULTS.onlinePlaylists]);
  const playlistRenames = ref<Record<string, string>>({ ...DEFAULTS.playlistRenames });
  const webdavEnabled = ref(DEFAULTS.webdavEnabled);
  const webdavUrl = ref(DEFAULTS.webdavUrl);
  const webdavUser = ref(DEFAULTS.webdavUser);
  const webdavPass = ref(DEFAULTS.webdavPass);
  const neteaseEnabled = ref(DEFAULTS.neteaseEnabled);
  const onlineNovelEnabled = ref(DEFAULTS.onlineNovelEnabled);
  const bqgNovelEnabled = ref(DEFAULTS.bqgNovelEnabled);
  const onlineAnimeEnabled = ref(DEFAULTS.onlineAnimeEnabled);
  const onlinePixivEnabled = ref(DEFAULTS.onlinePixivEnabled);
  const pixivRefreshToken = ref(DEFAULTS.pixivRefreshToken);
  const pixivImageQuality = ref(DEFAULTS.pixivImageQuality);
  const wenku8Node = ref<Wenku8Node>(DEFAULTS.wenku8Node);
  const novelCharset = ref<NovelCharset>(DEFAULTS.novelCharset);
  const shareCodePreference = ref<ShareCodePreference>(DEFAULTS.shareCodePreference);
  const desktopLyricsEnabled = ref(DEFAULTS.desktopLyricsEnabled);
  const desktopLyricsFontSize = ref(DEFAULTS.desktopLyricsFontSize);
  const desktopLyricsOpacity = ref(DEFAULTS.desktopLyricsOpacity);
  const desktopLyricsLocked = ref(DEFAULTS.desktopLyricsLocked);
  const desktopLyricsAlwaysOnTop = ref(DEFAULTS.desktopLyricsAlwaysOnTop);
  const desktopLyricsShowNext = ref(DEFAULTS.desktopLyricsShowNext);
  const desktopLyricsShowTranslation = ref(DEFAULTS.desktopLyricsShowTranslation);
  const desktopLyricsClickThrough = ref(DEFAULTS.desktopLyricsClickThrough);
  const desktopLyricsToolbar = ref<DesktopLyricsToolbar>(DEFAULTS.desktopLyricsToolbar);
  const desktopLyricsDoubleClick = ref<DesktopLyricsDoubleClick>(DEFAULTS.desktopLyricsDoubleClick);
  const desktopLyricsAnimation = ref<DesktopLyricsAnimation>(DEFAULTS.desktopLyricsAnimation);
  const desktopLyricsBounds = ref<DesktopLyricsBounds>({ ...DEFAULTS.desktopLyricsBounds });
  const closeToTray = ref(DEFAULTS.closeToTray);
  const musicViewMode = ref<MusicViewMode>(DEFAULTS.musicViewMode);
  const danmakuEnabled = ref(DEFAULTS.danmakuEnabled);
  const dandanAppId = ref(DEFAULTS.dandanAppId);
  const dandanAppSecret = ref(DEFAULTS.dandanAppSecret);
  const danmakuOpacity = ref(DEFAULTS.danmakuOpacity);
  const danmakuFontSize = ref(DEFAULTS.danmakuFontSize);
  const danmakuArea = ref(DEFAULTS.danmakuArea);
  const danmakuTimeOffsetMs = ref(DEFAULTS.danmakuTimeOffsetMs);
  const danmakuSpeed = ref(DEFAULTS.danmakuSpeed);
  const danmakuAntiOverlap = ref(DEFAULTS.danmakuAntiOverlap);
  const bangumiToken = ref(DEFAULTS.bangumiToken);
  const bangumiUsername = ref(DEFAULTS.bangumiUsername);
  const bangumiSyncedAt = ref(DEFAULTS.bangumiSyncedAt);
  const loaded = ref(false);

  // 单一注册表：新增设置项只需在此加一行，load/save 自动覆盖
  const fields = {
    theme,
    seedColor,
    activeSkin,
    hiddenBuiltinSkins,
    lang,
    lyricFontSize,
    lyricLineHeight,
    lyricLineGap,
    lyricFont,
    lyricTranslationSize,
    lyricTranslationGap,
    lyricSubMode,
    wordLyrics,
    preciseLyrics,
    lyricSourcePrefs,
    detectInstrumental,
    playerBg,
    lyricBlur,
    bgType,
    bgColor,
    bgImagePath,
    bgVideoPath,
    bgBlur,
    bgOverlay,
    scanDirs,
    gridColumns,
    minFileSizeMb,
    pdfReadMode,
    readerTheme,
    readerFont,
    readerFontPct,
    readerLineHeight,
    readerParaSpacing,
    ffmpegDir,
    enableOnlineMusic,
    musicServer,
    onlinePlaylists,
    playlistRenames,
    webdavEnabled,
    webdavUrl,
    webdavUser,
    webdavPass,
    neteaseEnabled,
    onlineNovelEnabled,
    bqgNovelEnabled,
    onlineAnimeEnabled,
    onlinePixivEnabled,
    pixivRefreshToken,
    pixivImageQuality,
    wenku8Node,
    novelCharset,
    shareCodePreference,
    desktopLyricsEnabled,
    desktopLyricsFontSize,
    desktopLyricsOpacity,
    desktopLyricsLocked,
    desktopLyricsAlwaysOnTop,
    desktopLyricsShowNext,
    desktopLyricsShowTranslation,
    desktopLyricsClickThrough,
    desktopLyricsToolbar,
    desktopLyricsDoubleClick,
    desktopLyricsAnimation,
    desktopLyricsBounds,
    closeToTray,
    musicViewMode,
    danmakuEnabled,
    dandanAppId,
    dandanAppSecret,
    danmakuOpacity,
    danmakuFontSize,
    danmakuArea,
    danmakuTimeOffsetMs,
    danmakuSpeed,
    danmakuAntiOverlap,
    bangumiToken,
    bangumiUsername,
    bangumiSyncedAt,
  } as const;

  async function load() {
    try {
      const saved = await store.get<Record<string, unknown>>("settings");
      if (saved) {
        for (const [key, refObj] of Object.entries(fields)) {
          const value = saved[key];
          if (value !== undefined && value !== null) {
            (refObj as { value: unknown }).value = value;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load settings:", e);
    }
    // 兼容旧版本：meting 在线音乐已移除 QQ 音乐平台，历史值归一化到网易云
    if (musicServer.value !== "netease") {
      musicServer.value = "netease";
    }
    if (onlinePlaylists.value.some((p) => p.server !== "netease")) {
      onlinePlaylists.value = onlinePlaylists.value.filter((p) => p.server === "netease");
    }
    loaded.value = true;
  }

  async function save() {
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, refObj] of Object.entries(fields)) {
        payload[key] = (refObj as { value: unknown }).value;
      }
      await store.set("settings", payload);
      await store.save();
    } catch (e) {
      console.warn("Failed to save settings:", e);
    }
  }

  let mediaQuery: MediaQueryList | null = null;
  function resolveTheme() {
    // 单模式皮肤强制锁定解析结果（方案书 §6.4）：settings.theme 保留用户原偏好，
    // 换回双模式皮肤后自动恢复
    const lock = skinModeLock.value;
    const dark = lock
      ? lock === "dark"
      : theme.value === "dark" ||
        (theme.value === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    // 令牌写入顺序（§3 层次）：清种子残留 → 皮肤令牌/CSS → 种子色（最后写入，
    // 同为内联样式时后者覆盖前者；clearSeedTokens 必须先于 applySkin，否则会抹掉皮肤颜色）
    const skin = activeSkinDoc.value;
    const seedAllowed = !skinSafeMode.value && (!skin || skin.manifest.seedColor);
    if (!seedAllowed) clearSeedTokens();
    applySkin(skinSafeMode.value ? null : skin, dark, activePrepared.value ?? undefined);
    if (seedAllowed) applySeedColor(seedColor.value, dark);
  }

  function applyTheme(mode: ThemeMode) {
    theme.value = mode;
    resolveTheme();
    // 跟随系统时需要监听系统切换
    if (!mediaQuery) {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaQuery.addEventListener("change", () => {
        if (theme.value === "system") resolveTheme();
      });
    }
  }

  /** 切换配色种子色并立即重算令牌 */
  function applyColorScheme(hex: string) {
    seedColor.value = hex;
    resolveTheme();
  }

  watch(
    Object.values(fields),
    () => {
      if (loaded.value) void save();
    },
    { deep: true },
  );

  // WebDAV 配置推送到 Rust（凭据只在 Rust 侧；代理/列举命令读取它）
  watch(
    [webdavEnabled, webdavUrl, webdavUser, webdavPass],
    async () => {
      if (!loaded.value) return;
      try {
        await capabilities.webdavConfigure(webdavUrl.value, webdavUser.value, webdavPass.value);
      } catch (e) {
        console.warn("[WebDAV] 配置推送失败:", e);
      }
    },
    { deep: false },
  );

  // FFmpeg 路径推送到 Rust：保证 OVERRIDE_DIR 始终与 settings.ffmpegDir 同步。
  // 修复「已指定 ffmpeg 包仍报未检测到」bug——
  // 原先依赖 Settings 页 onMounted 显式调 ffmpegSetPath，首次进入「视频」页时
  // OVERRIDE_DIR 还是 None；切回视频页时 VideosView 已挂载也不会再刷一次。
  watch(
    () => ffmpegDir.value,
    async (newDir) => {
      try {
        await capabilities.ffmpegSetPath(newDir || null);
      } catch (e) {
        console.warn("[FFmpeg] 配置推送失败:", e);
      }
    },
    { immediate: true },
  );

  return {
    ...fields,
    loaded,
    load,
    save,
    applyTheme,
    applyColorScheme,
    resolveTheme,
  };
});
