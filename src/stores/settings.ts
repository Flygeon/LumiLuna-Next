import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { LazyStore } from "@tauri-apps/plugin-store";

export type ThemeMode = "system" | "light" | "dark";

const store = new LazyStore("settings.json");

const DEFAULTS = {
  theme: "system" as ThemeMode,
  lang: "zh" as "zh" | "en",
  lyricFontSize: 30,
  lyricLineHeight: 2.5,
  bgBlur: true,
  lyricBlur: true,
  scanDirs: [] as string[],
  gridColumns: 6,
  /** 最小文件体积过滤（MB）；0 表示不过滤 */
  minFileSizeMb: 0,
  /** 用户手动指定的 ffmpeg 目录；空串表示自动探测 PATH */
  ffmpegDir: "",
};

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemeMode>(DEFAULTS.theme);
  const lang = ref<"zh" | "en">(DEFAULTS.lang);
  const lyricFontSize = ref(DEFAULTS.lyricFontSize);
  const lyricLineHeight = ref(DEFAULTS.lyricLineHeight);
  const bgBlur = ref(DEFAULTS.bgBlur);
  const lyricBlur = ref(DEFAULTS.lyricBlur);
  const scanDirs = ref<string[]>([...DEFAULTS.scanDirs]);
  const gridColumns = ref(DEFAULTS.gridColumns);
  const minFileSizeMb = ref(DEFAULTS.minFileSizeMb);
  const ffmpegDir = ref(DEFAULTS.ffmpegDir);
  const loaded = ref(false);

  // 单一注册表：新增设置项只需在此加一行，load/save 自动覆盖
  const fields = {
    theme,
    lang,
    lyricFontSize,
    lyricLineHeight,
    bgBlur,
    lyricBlur,
    scanDirs,
    gridColumns,
    minFileSizeMb,
    ffmpegDir,
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
