<script setup lang="ts">
/**
 * 媒体详情查看器（Lightbox）。
 * 图片直接原图预览，支持滚轮缩放 / 拖拽平移 / 左右切换 / EXIF 信息面板。
 * 视频与书籍给出信息面板 + 「用系统应用打开」。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { capabilities, isTauri } from "@/capabilities";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  formatDate,
  formatDuration,
  formatResolution,
  formatSize,
} from "@/utils/format";
import type { MediaEntry, MediaMetadata } from "@shared/types";

const props = defineProps<{
  items: MediaEntry[];
  index: number;
  /** 自定义条目媒体 URL（WebDAV 等远程源用本地代理 URL）；默认本地 asset:// */
  srcOf?: (item: MediaEntry) => string;
  /** 自定义「用系统应用打开」（远程源用系统浏览器打开代理 URL）；默认本地路径 */
  openExternal?: (item: MediaEntry) => void;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:index", value: number): void;
  (e: "favorite", item: MediaEntry): void;
}>();

const current = computed(() => props.items[props.index]);
const meta = ref<MediaMetadata | null>(null);
const showInfo = ref(false);
const zoom = ref(1);
const panX = ref(0);
const panY = ref(0);
const loadingImage = ref(true);

const src = computed(() => {
  const item = current.value;
  if (!item) return "";
  if (props.srcOf) return props.srcOf(item);
  return isTauri ? convertFileSrc(item.path) : item.path;
});

/** 原图较大，加载期间先显示已有缩略图避免白屏 */
function resetView() {
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
  loadingImage.value = true;
}

watch(
  () => current.value?.id,
  async (id) => {
    resetView();
    meta.value = null;
    if (!id) return;
    try {
      meta.value = await capabilities.getMetadata(id);
    } catch {
      meta.value = null;
    }
  },
  { immediate: true },
);

function prev() {
  if (props.index > 0) emit("update:index", props.index - 1);
}
function next() {
  if (props.index < props.items.length - 1) emit("update:index", props.index + 1);
}

function onWheel(e: WheelEvent) {
  if (current.value?.type !== "image") return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const nextZoom = Math.min(8, Math.max(1, zoom.value * factor));
  if (nextZoom === 1) {
    panX.value = 0;
    panY.value = 0;
  }
  zoom.value = nextZoom;
}

let dragging = false;
let startX = 0;
let startY = 0;
/** 按下时的原始坐标，用于未缩放状态下判定滑动切图 */
let downX = 0;
let downY = 0;
/** 滑动切换下一张/上一张的最小水平位移 */
const SWIPE_MIN_PX = 60;

function onPointerDown(e: PointerEvent) {
  downX = e.clientX;
  downY = e.clientY;
  if (zoom.value <= 1) return;
  dragging = true;
  startX = e.clientX - panX.value;
  startY = e.clientY - panY.value;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return;
  panX.value = e.clientX - startX;
  panY.value = e.clientY - startY;
}
function onPointerUp(e?: PointerEvent) {
  // 未缩放时的横向滑动 = 切换上/下一个。触屏没有键盘方向键，
  // 悬浮箭头虽在但滑动才是相册的默认预期；缩放后该手势归平移，故只在
  // zoom<=1 时生效。stage 已设 touch-action:none，不会与页面滚动冲突。
  if (e && e.type === "pointerup" && !dragging && zoom.value <= 1 && e.pointerType !== "mouse") {
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    }
  }
  dragging = false;
}

function toggleZoom() {
  if (zoom.value > 1) {
    resetView();
    loadingImage.value = false;
  } else {
    zoom.value = 2.5;
  }
}

function onKey(e: KeyboardEvent) {
  switch (e.key) {
    case "Escape":
      emit("close");
      break;
    case "ArrowLeft":
      prev();
      break;
    case "ArrowRight":
      next();
      break;
    case "i":
    case "I":
      showInfo.value = !showInfo.value;
      break;
    case "f":
    case "F":
      if (current.value) emit("favorite", current.value);
      break;
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

function openExternally() {
  const item = current.value;
  if (!item) return;
  if (props.openExternal) {
    props.openExternal(item);
    return;
  }
  void capabilities.openFile(item.path);
}

/** 信息面板条目，空值自动过滤 */
const infoRows = computed(() => {
  const m = meta.value;
  const item = current.value;
  if (!item) return [];
  const rows: [string, string][] = [
    ["文件名", item.name],
    ["路径", item.path],
    ["大小", formatSize(item.size)],
    ["修改时间", formatDate(item.mtime)],
    ["分辨率", formatResolution(m?.width ?? item.width, m?.height ?? item.height)],
    ["格式", m?.codec ?? item.ext.toUpperCase()],
    ["时长", formatDuration(m?.durationMs ?? item.durationMs)],
    ["拍摄时间", formatDate(m?.takenAt ?? item.takenAt)],
    ["相机", m?.camera ?? ""],
    ["镜头", m?.lens ?? ""],
    ["光圈", m?.fNumber ? `f/${m.fNumber}` : ""],
    ["快门", m?.exposure ?? ""],
    ["ISO", m?.iso ? String(m.iso) : ""],
    ["焦距", m?.focalLength ? `${m.focalLength}mm` : ""],
    ["帧率", m?.fps ? `${m.fps.toFixed(2)} fps` : ""],
    ["艺术家", m?.artist ?? ""],
    ["专辑", m?.album ?? ""],
    ["作者", m?.author ?? ""],
    [
      "位置",
      m?.gpsLat && m?.gpsLng
        ? `${m.gpsLat.toFixed(5)}, ${m.gpsLng.toFixed(5)}`
        : "",
    ],
  ];
  return rows.filter(([, v]) => v);
});
</script>

<template>
  <div class="viewer" @click.self="emit('close')">
    <!-- 顶栏 -->
    <header class="bar top">
      <button class="vbtn" title="关闭 (Esc)" @click="emit('close')">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div class="titles">
        <span class="name">{{ current?.title || current?.name }}</span>
        <span class="counter tabular-nums">{{ index + 1 }} / {{ items.length }}</span>
      </div>
      <div class="tools">
        <button
          class="vbtn"
          :class="{ on: current?.favorite }"
          title="收藏 (F)"
          @click="current && emit('favorite', current)"
        >
          <span
            class="material-symbols-outlined"
            :class="{ filled: current?.favorite }"
          >favorite</span>
        </button>
        <button class="vbtn" title="信息 (I)" @click="showInfo = !showInfo">
          <span class="material-symbols-outlined">info</span>
        </button>
        <button class="vbtn" title="用系统应用打开" @click="openExternally">
          <span class="material-symbols-outlined">open_in_new</span>
        </button>
      </div>
    </header>

    <!-- 左右切换 -->
    <button v-if="index > 0" class="nav prev" title="上一个 (←)" @click.stop="prev">
      <span class="material-symbols-outlined">chevron_left</span>
    </button>
    <button
      v-if="index < items.length - 1"
      class="nav next"
      title="下一个 (→)"
      @click.stop="next"
    >
      <span class="material-symbols-outlined">chevron_right</span>
    </button>

    <!-- 主体 -->
    <div
      class="stage"
      @click.self="emit('close')"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img
        v-if="current?.type === 'image'"
        :src="src"
        :alt="current.name"
        class="media"
        :class="{ zoomed: zoom > 1, loading: loadingImage }"
        :style="{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          cursor: zoom > 1 ? 'grab' : 'zoom-in',
        }"
        draggable="false"
        @load="loadingImage = false"
        @error="loadingImage = false"
        @click.stop="toggleZoom"
      />

      <video
        v-else-if="current?.type === 'video'"
        :src="src"
        class="media"
        controls
        autoplay
        @click.stop
      ></video>

      <div v-else class="fallback" @click.stop>
        <span class="material-symbols-outlined">menu_book</span>
        <p>{{ current?.name }}</p>
        <button class="lm-btn lm-btn--filled" @click="openExternally">
          用系统应用打开
        </button>
      </div>

      <div v-if="loadingImage && current?.type === 'image'" class="spinner"></div>
    </div>

    <!-- 信息面板 -->
    <transition name="slide">
      <aside v-if="showInfo" class="info" @click.stop>
        <h4>详细信息</h4>
        <dl>
          <template v-for="[label, value] in infoRows" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
      </aside>
    </transition>
  </div>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(20px);
  color: #fff;
  display: flex;
  flex-direction: column;
  animation: fade 180ms ease;
}
@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  z-index: 3;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6), transparent);
}
.titles {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.name {
  font-size: 15px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.counter {
  font-size: 12px;
  opacity: 0.6;
  flex: none;
}
.tools {
  display: flex;
  gap: 4px;
}

.vbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  cursor: pointer;
  transition: background 160ms, transform 140ms var(--md-sys-motion-spring);
}
.vbtn:hover {
  background: rgba(255, 255, 255, 0.14);
}
.vbtn:active {
  transform: scale(0.92);
}
.vbtn.on {
  color: #ff6b81;
}

.stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  touch-action: none;
}
.media {
  max-width: 94%;
  max-height: 94%;
  object-fit: contain;
  user-select: none;
  transition: transform 180ms var(--md-sys-motion-easing-standard);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  border-radius: 4px;
}
.media.zoomed {
  transition: none;
  cursor: grab;
}
.media.loading {
  opacity: 0;
}

.spinner {
  position: absolute;
  width: 38px;
  height: 38px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 52px;
  height: 52px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 160ms, transform 160ms;
}
.nav:hover {
  background: rgba(255, 255, 255, 0.22);
}
.nav .material-symbols-outlined {
  font-size: 30px;
}
.prev { left: 20px; }
.next { right: 20px; }

.fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  opacity: 0.85;
}
.fallback .material-symbols-outlined {
  font-size: 80px;
  opacity: 0.5;
}

.info {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  padding: 70px 22px 22px;
  overflow-y: auto;
  background: rgba(18, 18, 20, 0.94);
  backdrop-filter: blur(24px);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 2;
}
.info h4 {
  font-size: 15px;
  margin-bottom: 16px;
  opacity: 0.9;
}
.info dl {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 10px 12px;
  font-size: 12.5px;
}
.info dt {
  opacity: 0.5;
}
.info dd {
  word-break: break-all;
  line-height: 1.5;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 240ms var(--md-sys-motion-easing-emphasized-decelerate);
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

/* ============ 移动端适配 ============
   .is-mobile 挂在 <html> 上，不在本组件 scope 内，故用 :global()。
   桌面样式未改动。 */

/* fixed inset:0 全屏浮层：顶栏会被状态栏压住，底部会被手势条遮住 */
:global(html.is-mobile) .viewer {
  padding-top: var(--lm-safe-top);
  padding-bottom: var(--lm-safe-bottom);
}
:global(html.is-mobile) .vbtn {
  width: 44px;
  height: 44px;
}
:global(html.is-mobile) .bar {
  gap: 8px;
  padding: 8px 10px;
}
/* 340px 抽屉在 360dp 屏上几乎全屏遮挡；同时它是 absolute，锚在 .viewer 的
   padding box（含安全区），需自己补顶部内边距，否则标题被状态栏压住 */
:global(html.is-mobile) .info {
  width: min(340px, 86vw);
  padding: calc(62px + var(--lm-safe-top)) 18px calc(18px + var(--lm-safe-bottom));
}
:global(html.is-mobile) .nav {
  width: 46px;
  height: 46px;
}
:global(html.is-mobile) .prev { left: 6px; }
:global(html.is-mobile) .next { right: 6px; }
</style>