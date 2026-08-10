import { defineStore } from "pinia";
import { ref } from "vue";

export type ThemeMode = "system" | "light" | "dark";

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemeMode>("system");
  const lang = ref<"zh" | "en">("zh");
  const lyricFontSize = ref(18);
  const lyricLineHeight = ref(2.5);
  const bgBlur = ref(true);
  const lyricBlur = ref(true);
  const scanDirs = ref<string[]>([]);
  const gridColumns = ref(6);

  function applyTheme(mode: ThemeMode) {
    theme.value = mode;
    const root = document.documentElement;
    const systemDark =
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark =
      mode === "dark" || (mode === "system" && systemDark);
    root.setAttribute("data-theme", dark ? "dark" : "light");
  }

  return {
    theme,
    lang,
    lyricFontSize,
    lyricLineHeight,
    bgBlur,
    lyricBlur,
    scanDirs,
    gridColumns,
    applyTheme,
  };
});
