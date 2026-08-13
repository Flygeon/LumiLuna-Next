import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { MusicServer, OnlinePlaylistEntry } from "@shared/types";

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

const store = new LazyStore("settings.json");

const DEFAULTS = {
  theme: "system" as ThemeMode,
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
  /** 逐字歌词（Apple Music 式逐字填充 + 唱完上浮） */
  wordLyrics: true,
  /** 自动识别前奏/间奏：隐藏作词/作曲/编曲为三点，长间奏插入三点 */
  detectInstrumental: true,
  /** 播放器背景：动态模糊 / 仅图片模糊 / 关闭 */
  playerBg: "animated" as PlayerBgMode,
  lyricBlur: true,
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
};

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemeMode>(DEFAULTS.theme);
  const lang = ref<"zh" | "en">(DEFAULTS.lang);
  const lyricFontSize = ref(DEFAULTS.lyricFontSize);
  const lyricLineHeight = ref(DEFAULTS.lyricLineHeight);
  const lyricLineGap = ref(DEFAULTS.lyricLineGap);
  const lyricFont = ref<LyricFontKey>(DEFAULTS.lyricFont);
  const lyricTranslationSize = ref(DEFAULTS.lyricTranslationSize);
  const lyricTranslationGap = ref(DEFAULTS.lyricTranslationGap);
  const wordLyrics = ref(DEFAULTS.wordLyrics);
  const detectInstrumental = ref(DEFAULTS.detectInstrumental);
  const playerBg = ref<PlayerBgMode>(DEFAULTS.playerBg);
  const lyricBlur = ref(DEFAULTS.lyricBlur);
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
  const loaded = ref(false);

  // 单一注册表：新增设置项只需在此加一行，load/save 自动覆盖
  const fields = {
    theme,
    lang,
    lyricFontSize,
    lyricLineHeight,
    lyricLineGap,
    lyricFont,
    lyricTranslationSize,
    lyricTranslationGap,
    wordLyrics,
    detectInstrumental,
    playerBg,
    lyricBlur,
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
    const dark =
      theme.value === "dark" ||
      (theme.value === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
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

  watch(
    Object.values(fields),
    () => {
      if (loaded.value) void save();
    },
    { deep: true },
  );

  return {
    ...fields,
    loaded,
    load,
    save,
    applyTheme,
  };
});
