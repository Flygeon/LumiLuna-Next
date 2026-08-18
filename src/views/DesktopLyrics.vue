<script setup lang="ts">
/**
 * 桌面歌词窗口页面。
 *
 * 独立透明置顶窗口（label: desktop-lyrics）加载本路由；
 * 通过 Tauri Event 接收歌词状态，悬浮时展开迷你控制条。
 * 歌词切换动画可由设置选择（fade / slide / scale / glow）。
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
import { useSettingsStore } from "@/stores/settings";
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
const hover = ref(false);

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
  if (next.value?.text && next.value.text !== mainText.value)
    return `下一句 · ${next.value.text}`;
  return "";
});

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
  void emitDesktopLyricsControl("toggle");
}
function prevSong() {
  void emitDesktopLyricsControl("prev");
}
function nextSong() {
  void emitDesktopLyricsControl("next");
}
function closeLyrics() {
  void emitDesktopLyricsControl("close");
  if (isTauri) void WebviewWindow.getCurrent().close();
}

onMounted(async () => {
  if (!isTauri) return;
  if (!(await isDesktopLyricsWindow())) return;

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
  if (boundsTimer !== null) window.clearTimeout(boundsTimer);
  unlistenState?.();
  unlistenMoved?.();
  unlistenResized?.();
});
</script>

<template>
  <div
    class="desktop-lyrics"
    :class="{ hovered: hover, locked: settings.desktopLyricsLocked }"
    :style="{
      fontSize: settings.desktopLyricsFontSize + 'px',
      opacity: settings.desktopLyricsOpacity / 100,
    }"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <div class="lyrics-main">
      <Transition :name="'dl-' + settings.desktopLyricsAnimation" mode="out-in">
        <p :key="currentIndex" class="line current">
          {{ mainText }}
        </p>
      </Transition>
      <p v-if="subText" class="line next">{{ subText }}</p>
    </div>

    <Transition name="dl-bar">
      <div v-if="hover" class="control-bar">
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
.desktop-lyrics:not(.locked) {
  -webkit-app-region: drag;
}
.desktop-lyrics .control-bar {
  -webkit-app-region: no-drag;
}

.lyrics-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  max-width: 100%;
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
</style>
