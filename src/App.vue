<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { usePlayerStore } from "@/stores/player";
import { useLibraryStore } from "@/stores/library";
import MiniPlayer from "@/components/MiniPlayer.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import TextPrompt from "@/components/TextPrompt.vue";
import { useWindowTitlebar } from "@/composables/useWindowTitlebar";
import { translate } from "@shared/i18n";

const { isTauri, isMaximized, onDragStart, minimize, toggleMaximize, closeWindow } =
  useWindowTitlebar();

const settings = useSettingsStore();
const player = usePlayerStore();
const library = useLibraryStore();
const router = useRouter();
const route = useRoute();

const navItems = [
  { key: "images", path: "/images", icon: "image", type: "image" },
  { key: "videos", path: "/videos", icon: "movie", type: "video" },
  { key: "music", path: "/music", icon: "music_note", type: "audio" },
  { key: "books", path: "/books", icon: "menu_book", type: "book" },
  { key: "folders", path: "/folders", icon: "folder", type: null },
  { key: "webdav", path: "/webdav", icon: "cloud", type: null },
];
const bottomItems = [
  { key: "favorites", path: "/favorites", icon: "favorite" },
  { key: "history", path: "/history", icon: "history" },
  { key: "trash", path: "/trash", icon: "delete" },
  { key: "settings", path: "/settings", icon: "settings" },
];

function t(key: string) {
  return translate(settings.lang, key);
}

const isPlayerPage = computed(() => route.path === "/music/player");
const currentTab = computed(() => route.path.split("/")[1] || "images");

function isActive(path: string) {
  return route.path === path;
}

function countOf(type: string | null): number {
  return type ? (library.counts[type] ?? 0) : 0;
}

const themeIcon = computed(() =>
  settings.theme === "dark"
    ? "dark_mode"
    : settings.theme === "light"
      ? "light_mode"
      : "brightness_auto",
);

/** 三态循环：跟随系统 → 浅色 → 深色 */
function cycleTheme() {
  const order = ["system", "light", "dark"] as const;
  const next = order[(order.indexOf(settings.theme) + 1) % order.length];
  settings.applyTheme(next);
}

onMounted(async () => {
  await settings.load();
  settings.applyTheme(settings.theme);
  void library.refreshCounts();
});

// ---- 滚动位置记忆 ----
// keep-alive 缓存组件时，离开路由后 main-content 内容高度塌缩，浏览器会把
// scrollTop 钳制回顶部，返回时位置已丢失。这里在切换前记录、返回后恢复。
const scrollMemory = new Map<string, number>();
const mainEl = ref<HTMLElement | null>(null);
let scrollRestoreTimer: number | null = null;
router.beforeEach((_to, from) => {
  if (mainEl.value) {
    scrollMemory.set(from.path, mainEl.value.scrollTop);
  }
});
router.afterEach((to) => {
  const saved = scrollMemory.get(to.path);
  if (saved === undefined) return;
  // 等路由过渡（180ms）+ 内容重插入完成后再恢复
  if (scrollRestoreTimer) clearTimeout(scrollRestoreTimer);
  scrollRestoreTimer = window.setTimeout(() => {
    if (mainEl.value) mainEl.value.scrollTop = saved;
  }, 260);
});
</script>

<template>
  <div class="app-shell" :class="{ 'has-player': player.song && !isPlayerPage }">
    <!-- 左侧导航 Rail -->
    <nav v-if="!isPlayerPage" class="nav-rail lm-glass" @mousedown="onDragStart">
      <div class="brand">
        <span class="material-symbols-outlined brand-mark">blur_on</span>
        <span class="brand-name">{{ t("app.name") }}</span>
      </div>

      <div class="nav-group">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
          @click="router.push(item.path)"
        >
          <span class="indicator">
            <span
              class="material-symbols-outlined"
              :class="{ filled: isActive(item.path) }"
            >{{ item.icon }}</span>
            <span
              v-if="countOf(item.type)"
              class="badge tabular-nums"
            >{{ countOf(item.type) > 999 ? "999+" : countOf(item.type) }}</span>
          </span>
          <span class="label">{{ t("nav." + item.key) }}</span>
        </button>
      </div>

      <div class="nav-group bottom">
        <button
          v-for="item in bottomItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
          @click="router.push(item.path)"
        >
          <span class="indicator">
            <span
              class="material-symbols-outlined"
              :class="{ filled: isActive(item.path) }"
            >{{ item.icon }}</span>
          </span>
          <span class="label">{{ t("nav." + item.key) }}</span>
        </button>
      </div>
    </nav>

    <!-- 内容区 -->
    <div class="content">
      <header v-if="!isPlayerPage" class="topbar lm-glass" @mousedown="onDragStart">
        <h1 class="title">{{ t("nav." + currentTab) }}</h1>
        <div class="spacer"></div>
        <button
          class="lm-icon-btn"
          :title="t('settings.theme')"
          @click="cycleTheme"
        >
          <span class="material-symbols-outlined">{{ themeIcon }}</span>
        </button>
        <template v-if="isTauri">
          <button
            class="lm-icon-btn win-control"
            title="最小化"
            @click="minimize"
          >
            <span class="material-symbols-outlined">remove</span>
          </button>
          <button
            class="lm-icon-btn win-control"
            :title="isMaximized ? '还原' : '最大化'"
            @click="toggleMaximize"
          >
            <span class="material-symbols-outlined">
              {{ isMaximized ? "filter_none" : "crop_square" }}
            </span>
          </button>
          <button
            class="lm-icon-btn win-control close"
            title="关闭"
            @click="closeWindow"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </template>
      </header>

      <main ref="mainEl" class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <keep-alive :exclude="['PlayerView']">
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </main>
    </div>

    <MiniPlayer v-if="player.song && !isPlayerPage" />

    <!-- 全局 M3 右键菜单与文本输入框（Teleport 到 body） -->
    <ContextMenu />
    <TextPrompt />

    <!-- 全局回退提示（播放器 store 触发，播放页/列表页均可见） -->
    <transition name="lyric-toast">
      <div v-if="player.lyricNotice" class="lyric-toast">
        <span class="material-symbols-outlined">info</span>
        {{ player.lyricNotice }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--md-sys-color-background);
}

/* ---- 导航 Rail ---- */
.nav-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: var(--lm-nav-width);
  flex: none;
  padding: 14px 8px 12px;
  border-right: 1px solid var(--lm-hairline);
  z-index: 10;
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-bottom: 14px;
  color: var(--md-sys-color-primary);
}
.brand-mark {
  font-size: 26px;
  font-variation-settings: 'FILL' 1, 'wght' 500;
}
.brand-name {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.nav-group.bottom {
  margin-top: auto;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 0 7px;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  cursor: pointer;
  border-radius: var(--md-sys-shape-corner-medium);
}
.nav-item:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: -2px;
}

/* M3 药丸形状选中指示器 */
.indicator {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 32px;
  border-radius: 16px;
  transition:
    background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
    transform 200ms var(--md-sys-motion-spring);
}
.nav-item:hover .indicator {
  background: var(--md-sys-color-surface-container-high);
}
.nav-item.active .indicator {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.nav-item:active .indicator {
  transform: scale(0.9);
}
.indicator .material-symbols-outlined {
  font-size: 22px;
}

.badge {
  position: absolute;
  top: -3px;
  right: 4px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
}
.nav-item.active .label {
  color: var(--md-sys-color-on-surface);
  font-weight: 600;
}

/* ---- 内容区 ---- */
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--lm-topbar-height);
  flex: none;
  padding: 0 var(--lm-content-pad);
  border-bottom: 1px solid var(--lm-hairline);
  z-index: 5;
}
.title {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
  color: var(--md-sys-color-on-surface);
}
.spacer {
  flex: 1;
}
.win-control .material-symbols-outlined {
  font-size: 18px;
}
.win-control.close:hover {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--lm-content-pad);
  /* 迷你播放条不遮挡末行内容 */
  padding-bottom: var(--lm-content-pad);
}
.has-player .main-content {
  padding-bottom: calc(var(--lm-miniplayer-height) + var(--lm-content-pad));
}

/* 路由切换：淡入上浮 */
.page-enter-active,
.page-leave-active {
  transition:
    opacity 180ms var(--md-sys-motion-easing-standard),
    transform 180ms var(--md-sys-motion-easing-emphasized-decelerate);
}
.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 全局回退提示 toast */
.lyric-toast {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(560px, 80vw);
  padding: 11px 18px;
  border-radius: 999px;
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  box-shadow: var(--md-elevation-3);
  font-size: var(--md-sys-typescale-body-small-size);
}
.lyric-toast .material-symbols-outlined {
  font-size: 17px;
  opacity: 0.85;
}
.lyric-toast-enter-active,
.lyric-toast-leave-active {
  transition: all 240ms var(--md-sys-motion-easing-emphasized-decelerate);
}
.lyric-toast-enter-from,
.lyric-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>