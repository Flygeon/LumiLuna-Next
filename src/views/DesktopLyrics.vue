<script setup lang="ts">
/**
 * 桌面歌词窗口页面。
 *
 * 独立透明置顶窗口（label: desktop-lyrics）加载本路由；
 * 通过 Tauri Event 接收歌词状态。
 * 控制栏：点击歌词展开，5 秒无操作自动隐藏；
 * 设置可选择始终显示。
 */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSettingsStore, type DesktopLyricsAnimation } from "@/stores/settings";
import { isTauri } from "@/capabilities";
import {
  DL_STATE_EVENT,
  emitDesktopLyricsBounds,
  emitDesktopLyricsControl,
  emitDesktopLyricsReady,
  isDesktopLyricsWindow,
  type DesktopLyricsState,
} from "@/utils/desktopLyrics";

const settings = useSettingsStore();
const state = ref<DesktopLyricsState | null>(null);
const toolbarOpen = ref(settings.desktopLyricsToolbar === "always");
const ctx = ref<{ x: number; y: number } | null>(null);
let autoHideTimer: number | null = null;

const currentIndex = computed(() => {
  const lines = state.value?.lines ?? [];
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((state.value?.currentTime ?? 0) >= lines[i].time) idx = i;
    else break;
  }
  return idx;
});

const current = computed(() =>
  currentIndex.value >= 0 ? state.value?.lines[currentIndex.value] : undefined,
);
const next = computed(() =>
  currentIndex.value >= 0 ? state.value?.lines[currentIndex.value + 1] : undefined,
);

const mainText = computed(() => {
  if (current.value?.text) return current.value.text;
  if (state.value?.title) return state.value.title;
  return "暂无歌词";
});
const subText = computed(() => {
  if (!settings.desktopLyricsShowNext) return "";
  if (next.value?.text && next.value.text !== mainText.value)
    return `下一句 · ${next.value.text}`;
  return "";
});

/** 控制栏是否可见（always 模式 / click 模式且已展开） */
const toolbarVisible = computed(
  () => settings.desktopLyricsToolbar === "always" || toolbarOpen.value,
);

/** 点击歌词区域切换控制栏 */
function toggleToolbar() {
  if (settings.desktopLyricsToolbar !== "click") return;
  toolbarOpen.value = !toolbarOpen.value;
  if (toolbarOpen.value) startAutoHide();
  else cancelAutoHide();
}

/** 操作控制栏时重置自动隐藏计时 */
function resetAutoHide() {
  if (settings.desktopLyricsToolbar !== "click") return;
  if (!toolbarOpen.value) return;
  startAutoHide();
}

function startAutoHide() {
  cancelAutoHide();
  autoHideTimer = window.setTimeout(() => {
    toolbarOpen.value = false;
    autoHideTimer = null;
  }, 5000);
}

function cancelAutoHide() {
  if (autoHideTimer !== null) {
    window.clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
}

// ---- 窗口控制 ----

let unlistenState: UnlistenFn | null = null;
let unlistenMoved: UnlistenFn | null = null;
let unlistenResized: UnlistenFn | null = null;
let boundsTimer: number | null = null;

function scheduleReportBounds() {
  if (boundsTimer !== null) return;
  boundsTimer = window.setTimeout(() => {
    boundsTimer = null;
    void reportBounds();
  }, 300);
}

async function reportBounds() {
  if (!isTauri) return;
  try {
    const win = WebviewWindow.getCurrent();
    const pos = await win.outerPosition();
    const size = await win.outerSize();
    const scale = window.devicePixelRatio || 1;
    await emitDesktopLyricsBounds({
      x: Math.round(pos.x / scale),
      y: Math.round(pos.y / scale),
      width: Math.round(size.width / scale),
      height: Math.round(size.height / scale),
    });
  } catch {
    /* ignore */
  }
}

function togglePlay() {
  resetAutoHide();
  void emitDesktopLyricsControl("toggle");
}
function onDblClick() {
  if (settings.desktopLyricsDoubleClick !== "toggle") return;
  resetAutoHide();
  void emitDesktopLyricsControl("toggle");
}
function prevSong() {
  resetAutoHide();
  void emitDesktopLyricsControl("prev");
}
function nextSong() {
  resetAutoHide();
  void emitDesktopLyricsControl("next");
}
function closeLyrics() {
  void emitDesktopLyricsControl("close");
  if (isTauri) void WebviewWindow.getCurrent().close();
}

// ---- 右键菜单 ----

function onBlur() {
  cancelAutoHide();
  toolbarOpen.value = false;
  ctx.value = null;
}
function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  ctx.value = { x: e.clientX, y: e.clientY };
}
function closeCtx() {
  ctx.value = null;
}
function pickAnimation(anim: DesktopLyricsAnimation) {
  settings.desktopLyricsAnimation = anim;
  ctx.value = null;
}
function toggleShowNext() {
  settings.desktopLyricsShowNext = !settings.desktopLyricsShowNext;
  ctx.value = null;
}

// ---- 生命周期 ----

onMounted(async () => {
  if (!isTauri) return;
  if (!(await isDesktopLyricsWindow())) return;

  window.addEventListener("blur", onBlur);
  try {
    unlistenState = await listen<DesktopLyricsState>(DL_STATE_EVENT, (e) => {
      state.value = e.payload;
    });
    const win = WebviewWindow.getCurrent();
    void win.setAlwaysOnTop(settings.desktopLyricsAlwaysOnTop);
    unlistenMoved = await win.onMoved(scheduleReportBounds);
    unlistenResized = await win.onResized(scheduleReportBounds);
    emitDesktopLyricsReady();
  } catch {
    /* ignore */
  }
});

watch(
  () => settings.desktopLyricsAlwaysOnTop,
  (v) => {
    if (isTauri) void WebviewWindow.getCurrent().setAlwaysOnTop(v);
  },
);

onBeforeUnmount(() => {
  cancelAutoHide();
  if (boundsTimer !== null) window.clearTimeout(boundsTimer);
  window.removeEventListener("blur", onBlur);
  unlistenState?.();
  unlistenMoved?.();
  unlistenResized?.();
});
</script>

<template>
  <div
    class="desktop-lyrics"
    :class="{
      'toolbar-visible': toolbarVisible,
      locked: settings.desktopLyricsLocked,
    }"
    :style="{
      fontSize: settings.desktopLyricsFontSize + 'px',
      opacity: settings.desktopLyricsOpacity / 100,
    }"
    @click="closeCtx"
    @contextmenu.prevent="onContextMenu"
  >
    <div
      class="drag-handle"
      :class="{ locked: settings.desktopLyricsLocked }"
    ></div>
    <div class="lyrics-main" @click.stop="toggleToolbar" @dblclick="onDblClick">
      <Transition :name="'dl-' + settings.desktopLyricsAnimation" mode="out-in">
        <p :key="currentIndex" class="line current">
          {{ mainText }}
        </p>
      </Transition>
      <p v-if="subText" class="line next">{{ subText }}</p>
    </div>

    <Transition name="dl-bar">
      <div
        v-if="toolbarVisible"
        class="control-bar"
        @click.stop
        @mousemove="resetAutoHide"
      >
        <span class="meta" :title="state?.title || ''">
          {{ state?.title || "—" }}<template v-if="state?.artist"> · {{ state.artist }}</template>
        </span>
        <span class="spacer"></span>
        <button class="ctr" title="上一首" @click="prevSong">
          <span class="material-symbols-outlined">skip_previous</span>
        </button>
        <button class="ctr play" title="播放/暂停" @click="togglePlay">
          <span class="material-symbols-outlined">
            {{ state?.playing ? "pause" : "play_arrow" }}
          </span>
        </button>
        <button class="ctr" title="下一首" @click="nextSong">
          <span class="material-symbols-outlined">skip_next</span>
        </button>
        <button class="ctr close" title="关闭桌面歌词" @click="closeLyrics">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </Transition>

    <div
      v-if="ctx"
      class="ctx-menu"
      :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
      @click.stop="closeCtx"
    >
      <button class="ctx-item" @click.stop="toggleShowNext">
        <span class="material-symbols-outlined">{{ settings.desktopLyricsShowNext ? "check_box" : "check_box_outline_blank" }}</span>
        显示下一句
      </button>
      <div class="ctx-sep"></div>
      <span class="ctx-title">切换歌词动画</span>
      <button
        v-for="a in (['fade', 'slide', 'scale', 'glow'] as DesktopLyricsAnimation[])"
        :key="a"
        class="ctx-item"
        :class="{ active: settings.desktopLyricsAnimation === a }"
        @click.stop="pickAnimation(a)"
      >
        <span class="material-symbols-outlined">
          {{ settings.desktopLyricsAnimation === a ? "radio_button_checked" : "radio_button_unchecked" }}
        </span>
        {{
          a === "fade"
            ? "淡入"
            : a === "slide"
              ? "上滑"
              : a === "scale"
                ? "缩放"
                : "模糊浮现"
        }}
      </button>
    </div>
  </div>
</template>

<style>
/* 透明窗口背景必须在全局作用域（非 scoped）下生效 */
body,
html {
  background: transparent !important;
  margin: 0;
}
</style>

<style scoped>
.desktop-lyrics {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  color: #fff;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.55);
  -webkit-app-region: no-drag;
  overflow: hidden;
}
.desktop-lyrics .control-bar {
  -webkit-app-region: no-drag;
}
.drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 22px;
  -webkit-app-region: drag;
  z-index: 5;
}
.drag-handle.locked {
  -webkit-app-region: no-drag;
}

.lyrics-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  transition: padding-top 180ms ease;
  position: relative;
  z-index: 1;
}
.desktop-lyrics.toolbar-visible .lyrics-main {
  padding-top: 34px;
}
.line {
  margin: 0;
  line-height: 1.3;
  text-align: center;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.line.current {
  font-weight: 700;
  background: rgba(0, 0, 0, 0.25);
  padding: 2px 16px;
  border-radius: 999px;
}
.line.next {
  font-size: 0.6em;
  opacity: 0.55;
  font-weight: 500;
}

.control-bar {
  position: absolute;
  top: 6px;
  right: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-radius: 999px;
  background: rgba(20, 20, 24, 0.72);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  z-index: 2;
}
.control-bar .meta {
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.control-bar .spacer {
  flex: 1;
}
.control-bar .ctr {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  cursor: pointer;
}
.control-bar .ctr:hover {
  background: rgba(255, 255, 255, 0.18);
}
.control-bar .ctr.play {
  background: rgba(255, 255, 255, 0.92);
  color: #000;
}
.control-bar .ctr.close:hover {
  background: rgba(255, 80, 80, 0.85);
}
.control-bar .ctr .material-symbols-outlined {
  font-size: 17px;
  font-variation-settings: 'FILL' 1;
}

/* 歌词切换动画：淡入 */
.dl-fade-enter-active,
.dl-fade-leave-active {
  transition: opacity 300ms ease;
}
.dl-fade-enter-from,
.dl-fade-leave-to {
  opacity: 0;
}

/* 歌词切换动画：上滑 */
.dl-slide-enter-active,
.dl-slide-leave-active {
  transition:
    opacity 320ms ease,
    transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
}
.dl-slide-enter-from {
  opacity: 0;
  transform: translateY(18px);
}
.dl-slide-leave-to {
  opacity: 0;
  transform: translateY(-14px);
}

/* 歌词切换动画：缩放 */
.dl-scale-enter-active,
.dl-scale-leave-active {
  transition:
    opacity 280ms ease,
    transform 280ms cubic-bezier(0.34, 1.4, 0.64, 1);
}
.dl-scale-enter-from {
  opacity: 0;
  transform: scale(0.9);
}
.dl-scale-leave-to {
  opacity: 0;
  transform: scale(1.06);
}

/* 歌词切换动画：模糊浮现 */
.dl-glow-enter-active,
.dl-glow-leave-active {
  transition:
    opacity 360ms ease,
    filter 360ms ease,
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}
.dl-glow-enter-from {
  opacity: 0;
  filter: blur(8px);
  transform: translateY(8px);
}
.dl-glow-leave-to {
  opacity: 0;
  filter: blur(10px);
}

/* 控制条出现/消失 */
.dl-bar-enter-active,
.dl-bar-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.dl-bar-enter-from,
.dl-bar-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 右键菜单 */
.ctx-menu {
  position: fixed;
  z-index: 50;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(24, 24, 30, 0.92);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 13px;
}
.ctx-menu .ctx-title {
  padding: 4px 10px 2px;
  font-size: 11px;
  opacity: 0.5;
}
.ctx-menu .ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.ctx-menu .ctx-item:hover {
  background: rgba(255, 255, 255, 0.14);
}
.ctx-menu .ctx-item.active {
  color: #7cc4ff;
}
.ctx-menu .ctx-item .material-symbols-outlined {
  font-size: 16px;
}
.ctx-menu .ctx-sep {
  height: 1px;
  margin: 4px 8px;
  background: rgba(255, 255, 255, 0.14);
}
</style>