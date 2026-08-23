<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { useSkinsStore } from "@/stores/skins";
import { usePlayerStore } from "@/stores/player";
import { useAudioEffectsStore } from "@/stores/audioEffects";
import { useLibraryStore } from "@/stores/library";
import { isTauri } from "@/capabilities";
import MiniPlayer from "@/components/MiniPlayer.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import TextPrompt from "@/components/TextPrompt.vue";
import WindowTitleBar from "@/components/WindowTitleBar.vue";
import { useDesktopChrome } from "@/composables/useDesktopChrome";
import { activeSkinDoc, skinBgActive, skinSafeMode } from "@/utils/skinRuntime";
import { translate } from "@shared/i18n";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
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
const skins = useSkinsStore();
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
  // 皮肤加载（含 --safe-mode 检测、内置皮肤播种、激活皮肤解析）须在主题解析前完成
  await skins.load();
  settings.applyTheme(settings.theme);
  void audioEffects.init();
  void library.refreshCounts();
});

// ---- 皮肤拖拽导入（全窗口任意位置，支持 v1 .json 与 v2 .zip）----
const skinDropOver = ref(false);
let unDragDrop: UnlistenFn | null = null;
function isSkinFile(x: string): boolean {
  const l = x.toLowerCase();
  return l.endsWith(".json") || l.endsWith(".zip");
}
onMounted(async () => {
  if (!isTauri) return;
  try {
    unDragDrop = await getCurrentWebview().onDragDropEvent((e: Event<DragDropEvent>) => {
      const p = e.payload;
      if (p.type === "enter") {
        skinDropOver.value = p.paths.some(isSkinFile);
      } else if (p.type === "leave") {
        skinDropOver.value = false;
      } else if (p.type === "drop") {
        skinDropOver.value = false;
        const file = p.paths.find(isSkinFile);
        if (file) void skins.importFromFile(file);
        else skins.notice = t("settings.skinDropUnsupported");
      }
    });
  } catch {
    /* 拖拽事件不可用时静默（非桌面环境） */
  }
});
onBeforeUnmount(() => {
  unDragDrop?.();
  unDragDrop = null;
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
    data-lm-region="shell"
    :class="{
      'has-player': player.song && !isPlayerPage,
      'desktop-lyrics-page': isDesktopLyricsPage,
    }"
  >
    <!-- 皮肤背景图层（v2：变量由 skinLoader 写入；播放器页/桌面歌词页不渲染） -->
    <div
      v-if="skinBgActive && !isPlayerPage && !isDesktopLyricsPage"
      class="lm-skin-bg"
      aria-hidden="true"
    ></div>

    <!-- Windows 自定义标题栏（仅 Tauri 桌面版，播放页与桌面歌词页隐藏） -->
    <WindowTitleBar v-if="isTauri && !isPlayerPage && !isDesktopLyricsPage" />

    <!-- 主体：左侧导航 + 内容区 -->
    <div class="app-body">
      <!-- 左侧导航 Rail -->
      <nav
        v-if="!isPlayerPage && !isDesktopLyricsPage"
        class="nav-rail lm-glass"
        data-lm-region="nav"
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
      <div class="content" data-lm-region="content">
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

    <!-- 皮肤系统全局通知（导入/更新/回退等） -->
    <transition name="lyric-toast">
      <div v-if="skins.notice" class="lyric-toast skin-toast">
        <span class="material-symbols-outlined">palette</span>
        {{ skins.notice }}
      </div>
    </transition>

    <!-- 皮肤拖拽导入遮罩 -->
    <transition name="skin-fade">
      <div v-if="skinDropOver" class="skin-drop-overlay">
        <div class="skin-drop-card">
          <span class="material-symbols-outlined">palette</span>
          <span>{{ t("settings.skinDrop") }}</span>
        </div>
      </div>
    </transition>

    <!-- 皮肤远程引用导入确认（方案书 §2 D5） -->
    <transition name="skin-fade">
      <div
        v-if="skins.pendingRemote"
        class="skin-modal-scrim"
        @click.self="skins.cancelRemoteImport()"
      >
        <div class="skin-modal">
          <h3>{{ t("settings.skinRemoteTitle") }}</h3>
          <p class="skin-modal-hint">{{ t("settings.skinRemoteHint") }}</p>
          <ul class="skin-refs">
            <li v-for="r in skins.pendingRemote.refs" :key="r" :title="r">{{ r }}</li>
          </ul>
          <div class="skin-modal-actions">
            <button class="lm-btn lm-btn--text" @click="skins.cancelRemoteImport()">
              {{ t("settings.skinCancel") }}
            </button>
            <button class="lm-btn lm-btn--filled" @click="skins.confirmRemoteImport()">
              {{ t("settings.skinStillImport") }}
            </button>
          </div>
        </div>
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

/* ---- 皮肤背景图层（v2）：z-index 0 铺底，内容层在其上 ---- */
.lm-skin-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  background-image: var(--lm-skin-bg-image, none);
  background-size: var(--lm-skin-bg-size, cover);
  background-position: var(--lm-skin-bg-position, center);
  background-repeat: no-repeat;
  pointer-events: none;
}
.lm-skin-bg::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--lm-skin-bg-overlay, transparent);
}
/* 背景激活时内容层抬到背景之上 */
.app-shell:has(> .lm-skin-bg) .app-body {
  position: relative;
  z-index: 1;
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

/* ---- 皮肤系统全局层 ---- */

/* 皮肤通知：与回退提示错开（顶部居中，避开标题栏） */
.skin-toast {
  top: calc(var(--lm-titlebar-height) + 8px);
  bottom: auto;
}

.skin-fade-enter-active,
.skin-fade-leave-active {
  transition: opacity 160ms var(--md-sys-motion-easing-standard);
}
.skin-fade-enter-from,
.skin-fade-leave-to {
  opacity: 0;
}

.skin-drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--md-sys-color-scrim) 60%, transparent);
  pointer-events: none;
}
.skin-drop-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 30px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  border: 2px dashed var(--md-sys-color-primary);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-primary);
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.skin-drop-card .material-symbols-outlined {
  font-size: 26px;
}

.skin-modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 310;
  display: grid;
  place-items: center;
  background: var(--md-sys-color-scrim);
}
.skin-modal {
  width: min(480px, 86vw);
  padding: 22px 24px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-high);
  box-shadow: var(--md-elevation-3);
}
.skin-modal h3 {
  margin-bottom: 8px;
  font-size: var(--md-sys-typescale-title-medium-size);
}
.skin-modal-hint {
  margin-bottom: 10px;
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}
.skin-refs {
  max-height: 140px;
  margin-bottom: 14px;
  padding: 8px 12px;
  overflow-y: auto;
  list-style: none;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-surface-container);
  font-size: var(--md-sys-typescale-body-small-size);
  font-family: monospace;
  word-break: break-all;
}
.skin-refs li {
  padding: 2px 0;
  color: var(--md-sys-color-on-surface-variant);
}
.skin-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>