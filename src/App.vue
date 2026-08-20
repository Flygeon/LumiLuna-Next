<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { usePlayerStore } from "@/stores/player";
import { useAudioEffectsStore } from "@/stores/audioEffects";
import { useLibraryStore } from "@/stores/library";
import { isTauri, isDesktop, isMobile } from "@/capabilities";
import MiniPlayer from "@/components/MiniPlayer.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import TextPrompt from "@/components/TextPrompt.vue";
import WindowTitleBar from "@/components/WindowTitleBar.vue";
import { useDesktopChrome } from "@/composables/useDesktopChrome";
import { translate } from "@shared/i18n";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DL_BOUNDS_EVENT,
  DL_CONTROL_EVENT,
  DL_READY_EVENT,
  closeDesktopLyricsWindow,
  emitDesktopLyricsState,
  openDesktopLyricsWindow,
  type DesktopLyricsState,
} from "@/utils/desktopLyrics";
import type { DesktopLyricsBounds } from "@/stores/settings";

const settings = useSettingsStore();
const player = usePlayerStore();
// 托盘命令 + 关闭最小化到托盘 + 应用内热键
useDesktopChrome();
// ---- 桌面歌词控制器 ----
let dlUnlisteners: UnlistenFn[] = [];

function pushDesktopLyricsState() {
  if (!settings.desktopLyricsEnabled) return;
  const stateData: DesktopLyricsState = {
    lines: player.lyrics.map((l) => ({
      time: l.time,
      text: l.text,
      translation: l.translation,
      romaji: l.romaji,
    })),
    currentTime: player.currentTime,
    playing: player.playing,
    title: player.song?.title ?? "",
    artist: player.song?.artist ?? "",
  };
  void emitDesktopLyricsState(stateData);
}

watch(
  () => settings.desktopLyricsEnabled,
  async (on) => {
    if (on) {
      await openDesktopLyricsWindow(settings.desktopLyricsBounds);
      // 等子窗口就绪事件回推一次状态（也做一次兜底延迟发送）
      window.setTimeout(() => pushDesktopLyricsState(), 400);
    } else {
      await closeDesktopLyricsWindow();
    }
  },
);

onMounted(async () => {
  if (isTauri) {
    try {
      dlUnlisteners.push(
        await listen<null>(DL_READY_EVENT, () => pushDesktopLyricsState()),
        await listen<{ action: "toggle" | "next" | "prev" | "close" }>(
          DL_CONTROL_EVENT,
          (e) => {
            switch (e.payload.action) {
              case "toggle":
                player.togglePlay();
                break;
              case "next":
                void player.next();
                break;
              case "prev":
                void player.previous();
                break;
              case "close":
                settings.desktopLyricsEnabled = false;
                break;
            }
          },
        ),
        await listen<DesktopLyricsBounds>(DL_BOUNDS_EVENT, (e) => {
          settings.desktopLyricsBounds = e.payload;
        }),
      );
    } catch {
      /* 非 Tauri 或权限不足时静默 */
    }
  }
});

onBeforeUnmount(() => {
  dlUnlisteners.forEach((un) => un());
  dlUnlisteners = [];
});
const library = useLibraryStore();
const audioEffects = useAudioEffectsStore();
const router = useRouter();
const route = useRoute();

const navItems = computed(() => [
  { key: "images", path: "/images", icon: "image", type: "image" },
  { key: "videos", path: "/videos", icon: "movie", type: "video" },
  { key: "music", path: "/music", icon: "music_note", type: "audio" },
  { key: "books", path: "/books", icon: "menu_book", type: "book" },
  { key: "treasure", path: "/treasure", icon: "inventory_2", type: null },
]);
const bottomItems = [
  { key: "favorites", path: "/favorites", icon: "favorite" },
  { key: "history", path: "/history", icon: "history" },
  { key: "trash", path: "/trash", icon: "delete" },
  { key: "settings", path: "/settings", icon: "settings" },
];

/** 移动端底部导航：仅五个主入口（屏宽有限，M3 Navigation Bar 建议 3-5 项）。
 *  收藏 / 历史 / 回收站 / 百宝箱 收进「设置」页的「更多」分区。 */
const mobileNavItems = computed(() => [
  { key: "images", path: "/images", icon: "image", type: "image" },
  { key: "videos", path: "/videos", icon: "movie", type: "video" },
  { key: "music", path: "/music", icon: "music_note", type: "audio" },
  { key: "books", path: "/books", icon: "menu_book", type: "book" },
  { key: "settings", path: "/settings", icon: "settings", type: null },
]);

function t(key: string) {
  return translate(settings.lang, key);
}

const isPlayerPage = computed(() => route.path === "/music/player");
const isDesktopLyricsPage = computed(() => route.path === "/desktop-lyrics");

function isActive(path: string) {
  return route.path === path;
}

function countOf(type: string | null): number {
  return type ? (library.counts[type] ?? 0) : 0;
}

onMounted(async () => {
  await settings.load();
  settings.applyTheme(settings.theme);
  void audioEffects.init();
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
  <div
    class="app-shell"
    :class="{
      'has-player': player.song && !isPlayerPage,
      'desktop-lyrics-page': isDesktopLyricsPage,
    }"
  >
    <!-- 自定义标题栏（仅桌面 Tauri；移动端无窗口控制，播放页与桌面歌词页隐藏） -->
    <WindowTitleBar v-if="isDesktop && !isPlayerPage && !isDesktopLyricsPage" />

    <!-- 主体：左侧导航 + 内容区 -->
    <div class="app-body">
      <!-- 左侧导航 Rail（移动端改用底部导航栏） -->
      <nav
        v-if="!isMobile && !isPlayerPage && !isDesktopLyricsPage"
        class="nav-rail lm-glass"
      >
        <div v-if="!isTauri" class="brand">
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
        <main ref="mainEl" class="main-content">
          <router-view v-slot="{ Component }">
            <transition :name="isPlayerPage ? 'player' : 'page'" mode="out-in">
              <keep-alive :exclude="['PlayerView']">
                <component :is="Component" />
              </keep-alive>
            </transition>
          </router-view>
        </main>
      </div>
    </div>

    <!-- 移动端底部导航栏（M3 Navigation Bar，决策12）：五个主入口；
         收藏/历史/回收站/百宝箱 见「设置 → 更多」 -->
    <nav
      v-if="isMobile && !isPlayerPage && !isDesktopLyricsPage"
      class="bottom-nav lm-glass"
    >
      <button
        v-for="item in mobileNavItems"
        :key="item.key"
        class="bn-item"
        :class="{ active: isActive(item.path) }"
        @click="router.push(item.path)"
      >
        <span class="bn-indicator">
          <span
            class="material-symbols-outlined"
            :class="{ filled: isActive(item.path) }"
          >{{ item.icon }}</span>
          <span
            v-if="countOf(item.type)"
            class="badge tabular-nums"
          >{{ countOf(item.type) > 999 ? "999+" : countOf(item.type) }}</span>
        </span>
        <span class="bn-label">{{ t("nav." + item.key) }}</span>
      </button>
    </nav>

    <MiniPlayer v-if="player.song && !isPlayerPage && !isDesktopLyricsPage" />

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
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--md-sys-color-background);
}
.app-shell.desktop-lyrics-page {
  background: transparent;
}
.app-shell.desktop-lyrics-page .main-content {
  padding: 0;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
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

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--lm-content-pad);
  /* 迷你播放条 + 移动端底部导航 + 手势条安全区都不遮挡末行内容。
     桌面下 --lm-bottomnav-height / --lm-safe-bottom 均为 0，公式两端通用。 */
  padding-bottom: calc(
    var(--lm-content-pad) + var(--lm-bottomnav-height) + var(--lm-safe-bottom)
  );
}
.has-player .main-content {
  padding-bottom: calc(
    var(--lm-miniplayer-height) + var(--lm-content-pad) +
      var(--lm-bottomnav-height) + var(--lm-safe-bottom)
  );
}

/* ---- 移动端底部导航栏（M3 Navigation Bar）---- */
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 60; /* 高于 MiniPlayer(50)：播放条浮在导航之上但不遮挡点击 */
  display: flex;
  align-items: stretch;
  height: calc(var(--lm-bottomnav-height) + var(--lm-safe-bottom));
  padding-bottom: var(--lm-safe-bottom);
  border-top: 1px solid var(--lm-hairline);
}
.bn-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  padding: 6px 0 8px;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  /* 触屏：去掉点击高亮与长按选中，避免误触感 */
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  cursor: pointer;
}
.bn-indicator {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 32px;
  border-radius: 16px;
  transition:
    background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
    transform 200ms var(--md-sys-motion-spring);
}
.bn-item.active .bn-indicator {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.bn-item:active .bn-indicator {
  transform: scale(0.9);
}
.bn-indicator .material-symbols-outlined {
  font-size: 22px;
}
.bn-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.bn-item.active .bn-label {
  color: var(--md-sys-color-on-surface);
  font-weight: 600;
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

/* 播放器路由：抽屉式滑入滑出 */
.player-enter-active,
.player-leave-active {
  transition:
    transform 340ms var(--md-sys-motion-easing-emphasized-decelerate),
    opacity 260ms var(--md-sys-motion-easing-standard);
}
.player-enter-from,
.player-leave-to {
  transform: translateY(100%);
  opacity: 0.6;
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