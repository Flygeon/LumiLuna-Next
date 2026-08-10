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
};

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemeMode>(DEFAULTS.theme);
  const lang = ref<"zh" | "en">(DEFAULTS.lang);
  const lyricFontSize = ref(DEFAULTS.lyricFontSize);
  const lyricLineHeight = ref(DEFAULTS.lyricLineHeight);
  const bgBlur = ref(DEFAULTS.bgBlur);
  const lyricBlur = ref(DEFAULTS.lyricBlur);
  const scanDirs = ref<string[]>(DEFAULTS.scanDirs);
  const gridColumns = ref(DEFAULTS.gridColumns);
  const loaded = ref(false);

  async function load() {
    try {
      const saved = await store.get<Record<string, unknown>>("settings");
      if (saved) {
        if (saved.theme !== undefined) theme.value = saved.theme as ThemeMode;
        if (saved.lang !== undefined) lang.value = saved.lang as "zh" | "en";
        if (saved.lyricFontSize !== undefined) lyricFontSize.value = saved.lyricFontSize as number;
        if (saved.lyricLineHeight !== undefined) lyricLineHeight.value = saved.lyricLineHeight as number;
        if (saved.bgBlur !== undefined) bgBlur.value = saved.bgBlur as boolean;
        if (saved.lyricBlur !== undefined) lyricBlur.value = saved.lyricBlur as boolean;
        if (saved.scanDirs !== undefined) scanDirs.value = saved.scanDirs as string[];
        if (saved.gridColumns !== undefined) gridColumns.value = saved.gridColumns as number;
      }
    } catch (e) {
      console.warn("Failed to load settings:", e);
    }
    loaded.value = true;
  }

  async function save() {
    try {
      await store.set("settings", {
        theme: theme.value,
        lang: lang.value,
        lyricFontSize: lyricFontSize.value,
        lyricLineHeight: lyricLineHeight.value,
        bgBlur: bgBlur.value,
        lyricBlur: lyricBlur.value,
        scanDirs: scanDirs.value,
        gridColumns: gridColumns.value,
      });
      await store.save();
    } catch (e) {
      console.warn("Failed to save settings:", e);
    }
  }

  function applyTheme(mode: ThemeMode) {
    theme.value = mode;
    const root = document.documentElement;
    const systemDark =
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark =
      mode === "dark" || (mode === "system" && systemDark);
    root.setAttribute("data-theme", dark ? "dark" : "light");
  }

  // Auto-save on any change
  watch(
    [theme, lang, lyricFontSize, lyricLineHeight, bgBlur, lyricBlur, scanDirs, gridColumns],
    () => { if (loaded.value) save(); },
    { deep: true }
  );

  return {
    theme,
    lang,
    lyricFontSize,
    lyricLineHeight,
    bgBlur,
    lyricBlur,
    scanDirs,
    gridColumns,
    loaded,
    load,
    save,
    applyTheme,
  };
});
