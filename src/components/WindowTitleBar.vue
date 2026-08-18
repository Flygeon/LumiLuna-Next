<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useWindowDrag } from "@/composables/useWindowDrag";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { isTauri } from "@/capabilities";
import WindowControls from "@/components/WindowControls.vue";
import type { ThemeMode } from "@/stores/settings";

const settings = useSettingsStore();
const { isMaximized, minimize, toggleMaximize, close, startDrag } =
  useWindowDrag();

const GITHUB_REPO = "https://github.com/Flygeon/LumiLuna-Next";

// 外观菜单
const showThemeMenu = ref(false);
const menuEl = ref<HTMLElement | null>(null);

function toggleThemeMenu() {
  showThemeMenu.value = !showThemeMenu.value;
}

function selectTheme(mode: ThemeMode) {
  settings.applyTheme(mode);
  showThemeMenu.value = false;
}

function onDocumentPointerDown(e: PointerEvent) {
  if (
    showThemeMenu.value &&
    menuEl.value &&
    !menuEl.value.contains(e.target as Node)
  ) {
    showThemeMenu.value = false;
  }
}

function onDocumentKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && showThemeMenu.value) {
    showThemeMenu.value = false;
  }
}

function openGitHub() {
  void capabilities.openUrl(GITHUB_REPO);
}

// 主题图标
const themeIconMap: Record<string, string> = {
  system: "brightness_auto",
  light: "light_mode",
  dark: "dark_mode",
};

// 挂载文档监听（点击外部关闭菜单）
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown);
}

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  document.removeEventListener("keydown", onDocumentKeyDown);
});
</script>

<template>
  <header v-if="isTauri" class="window-title-bar lm-glass">
    <!-- 品牌 + 可拖拽区 -->
    <div
      class="tb-drag"
      @pointerdown="startDrag"
    >
      <span class="material-symbols-outlined tb-brand-icon">blur_on</span>
      <span class="tb-brand-name">LumiLuna</span>
    </div>

    <!-- 右侧操作区 -->
    <div class="tb-actions">
      <!-- 外观菜单 -->
      <div ref="menuEl" class="tb-theme-wrap">
        <button
          class="tb-icon-btn"
          title="外观"
          aria-label="外观"
          @click="toggleThemeMenu"
        >
          <span class="material-symbols-outlined">palette</span>
        </button>
        <Transition name="tb-menu">
          <div v-if="showThemeMenu" class="tb-theme-menu lm-glass">
            <button
              v-for="mode in (['system', 'light', 'dark'] as ThemeMode[])"
              :key="mode"
              class="tb-theme-option"
              :class="{ active: settings.theme === mode }"
              @click="selectTheme(mode)"
            >
              <span class="material-symbols-outlined">{{ themeIconMap[mode] }}</span>
              <span>{{
                mode === "system"
                  ? "跟随系统"
                  : mode === "light"
                    ? "浅色"
                    : "深色"
              }}</span>
              <span v-if="settings.theme === mode" class="material-symbols-outlined tb-check">check</span>
            </button>
          </div>
        </Transition>
      </div>

      <!-- GitHub 链接 -->
      <button
        class="tb-icon-btn"
        title="GitHub"
        aria-label="在浏览器打开 GitHub 仓库"
        @click="openGitHub"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
          class="tb-github-icon"
        >
          <path d="M12 2C6.477 2 2 6.584 2 12.253c0 4.526 2.865 8.363 6.839 9.718.5.093.682-.222.682-.493 0-.243-.009-.888-.014-1.743-2.782.618-3.369-1.372-3.369-1.372-.455-1.18-1.11-1.494-1.11-1.494-.908-.635.069-.622.069-.622 1.004.072 1.532 1.057 1.532 1.057.892 1.564 2.341 1.112 2.91.85.091-.662.35-1.112.636-1.367-2.22-.259-4.555-1.138-4.555-5.066 0-1.119.39-2.033 1.03-2.75-.104-.26-.447-1.302.098-2.713 0 0 .84-.275 2.75 1.05A9.35 9.35 0 0 1 12 7.098c.85.004 1.705.117 2.504.343 1.909-1.325 2.747-1.05 2.747-1.05.547 1.411.204 2.453.1 2.713.64.717 1.028 1.631 1.028 2.75 0 3.939-2.339 4.804-4.566 5.058.36.317.679.942.679 1.9 0 1.371-.012 2.477-.012 2.814 0 .274.18.591.688.491C19.138 20.613 22 16.777 22 12.253 22 6.584 17.523 2 12 2Z" />
        </svg>
      </button>

      <!-- 窗口控制按钮 -->
      <WindowControls
        :is-maximized="isMaximized"
        :minimize="minimize"
        :toggle-maximize="toggleMaximize"
        :close="close"
      />
    </div>
  </header>
</template>

<style scoped>
.window-title-bar {
  display: flex;
  align-items: center;
  height: var(--lm-titlebar-height);
  flex: none;
  padding: 0 4px 0 12px;
  border-bottom: 1px solid var(--lm-hairline);
  z-index: 20;
  user-select: none;
  -webkit-user-select: none;
}

.tb-drag {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  height: 100%;
  cursor: default;
}

.tb-brand-icon {
  font-size: 20px;
  font-variation-settings: 'FILL' 1, 'wght' 500;
  color: var(--md-sys-color-primary);
  flex: none;
}

.tb-brand-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--md-sys-color-on-surface);
  white-space: nowrap;
}

.tb-actions {
  display: flex;
  align-items: center;
  gap: 0;
  flex: none;
}

/* 图标按钮 */
.tb-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;
  outline: none;
}
.tb-icon-btn:hover {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
}
.tb-icon-btn:active {
  transform: scale(0.92);
}
.tb-icon-btn .material-symbols-outlined {
  font-size: 20px;
}

.tb-github-icon {
  width: 16px;
  height: 16px;
}

/* 主题菜单 */
.tb-theme-wrap {
  position: relative;
}

.tb-theme-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  min-width: 160px;
  padding: 6px;
  border-radius: var(--md-sys-shape-corner-medium);
  border: 1px solid var(--lm-hairline);
  box-shadow: var(--md-elevation-3);
  z-index: 100;
}

.tb-theme-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}
.tb-theme-option:hover {
  background: var(--md-sys-color-surface-container-high);
}
.tb-theme-option.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.tb-theme-option .material-symbols-outlined {
  font-size: 18px;
}
.tb-check {
  margin-left: auto;
  font-size: 16px;
}

/* 菜单动画 */
.tb-menu-enter-active,
.tb-menu-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}
.tb-menu-enter-from,
.tb-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>