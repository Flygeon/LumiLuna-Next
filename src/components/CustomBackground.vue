<script setup lang="ts">
/**
 * 应用级自定义背景渲染层。
 *
 * 由 App.vue 在内容层下方挂载（fixed / inset:0 / z-index:0 / pointer-events:none）。
 * 按 settings.bgType 渲染：
 * - default：不渲染（display:none，保持现有皮肤/纯色背景）
 * - solid  ：纯色 background-color（不做模糊）
 * - image  ：本地图片 cover 居中 + 可选 blur
 * - video  ：本地视频循环静音播放 + 可选 blur
 * - fluid  ：以当前播放封面（缺省 /default.svg）做简化版 canvas 缓推动画 + 可选 blur
 *
 * image/video/fluid 统一叠加一层暗色遮罩 rgba(0,0,0, bgOverlay/100)。
 * 本地绝对路径在 Tauri 下用 convertFileSrc 转成 webview 可加载 URL；
 * 非 Tauri 环境（isTauri=false）降级为直接使用路径。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "@/capabilities";
import { useSettingsStore } from "@/stores/settings";
import { usePlayerStore } from "@/stores/player";

const settings = useSettingsStore();
const player = usePlayerStore();

const bgType = computed(() => settings.bgType);

/** 本地绝对路径 -> webview URL（非 Tauri 直接用原路径） */
function toSrc(absPath: string): string {
  if (!absPath) return "";
  return isTauri ? convertFileSrc(absPath) : absPath;
}

const imageUrl = computed(() => toSrc(settings.bgImagePath));
const videoUrl = computed(() => toSrc(settings.bgVideoPath));

/** 模糊仅作用于 image/video/fluid；solid 不模糊 */
const useBlur = computed(
  () => bgType.value === "image" || bgType.value === "video" || bgType.value === "fluid",
);
const blurFilter = computed(() => (useBlur.value ? `blur(${settings.bgBlur}px)` : "none"));
/** 遮罩统一作用于所有非 default 模式 */
const showOverlay = computed(() => bgType.value !== "default");
const overlayStyle = computed(() => `rgba(0, 0, 0, ${settings.bgOverlay / 100})`);

// ---- fluid 简化版 canvas 动画（封面缓慢缩放缓推，类似 Ken Burns）----
const canvasRef = ref<HTMLCanvasElement | null>(null);
const coverSrc = computed(() => player.song?.cover || "/default.svg");

let rafId: number | null = null;
let coverImg: HTMLImageElement | null = null;
let loadedSrc = "";
let resizeHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function resizeCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  // 与 FluidBackground 一致：DPR 封顶 2，已被重度模糊，更高 DPR 不可见
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function renderFrame(now: number) {
  const canvas = canvasRef.value;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  if (coverImg) {
    // 缓慢在 1.0 ~ 1.12 之间呼吸缩放
    const zoom = 1 + 0.12 * (0.5 + 0.5 * Math.sin(now / 5000));
    const iw = coverImg.width;
    const ih = coverImg.height;
    const scale = Math.max(w / iw, h / ih) * zoom;
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(coverImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  rafId = requestAnimationFrame(renderFrame);
}

function loadCover() {
  const src = coverSrc.value;
  if (!src || src === loadedSrc) return;
  loadedSrc = src;
  const im = new Image();
  im.onload = () => {
    coverImg = im;
  };
  im.src = src;
}

/** 停掉动画并释放监听，避免重复 start 叠加泄漏 */
function teardown() {
  stopLoop();
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

function startFluid() {
  teardown();
  resizeCanvas();
  loadCover();
  rafId = requestAnimationFrame(renderFrame);

  resizeHandler = () => resizeCanvas();
  window.addEventListener("resize", resizeHandler);

  visibilityHandler = () => {
    if (document.hidden) stopLoop();
    else startFluid();
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

async function applyFluidMode() {
  if (bgType.value === "fluid") {
    await nextTick();
    startFluid();
  } else {
    teardown();
  }
}

watch(bgType, () => void applyFluidMode());
watch(coverSrc, () => {
  if (bgType.value === "fluid") {
    loadedSrc = "";
    loadCover();
  }
});

onMounted(() => {
  if (bgType.value === "fluid") void applyFluidMode();
});
onBeforeUnmount(teardown);
</script>

<template>
  <div class="custom-bg" :class="{ off: bgType === 'default' }" aria-hidden="true">
    <!-- 纯色 -->
    <div
      v-if="bgType === 'solid'"
      class="layer solid"
      :style="{ backgroundColor: settings.bgColor }"
    ></div>

    <!-- 本地图片 -->
    <div
      v-else-if="bgType === 'image'"
      class="layer media image"
      :style="{
        backgroundImage: imageUrl ? `url('${imageUrl}')` : 'none',
        filter: blurFilter,
      }"
    ></div>

    <!-- 本地视频 -->
    <video
      v-else-if="bgType === 'video'"
      class="layer media bg-video"
      :src="videoUrl"
      autoplay
      loop
      muted
      playsinline
      :style="{ filter: blurFilter }"
    ></video>

    <!-- 流体封面动画 -->
    <canvas
      v-else-if="bgType === 'fluid'"
      ref="canvasRef"
      class="layer media bg-fluid"
      :style="{ filter: blurFilter }"
    ></canvas>

    <!-- 统一暗色遮罩 -->
    <div v-if="showOverlay" class="overlay" :style="{ background: overlayStyle }"></div>
  </div>
</template>

<style scoped>
.custom-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.custom-bg.off {
  display: none;
}
.layer {
  position: absolute;
  inset: 0;
}
/* 媒体层略微放大，避免 blur 在边缘露出透明边（同 FluidBackground 的 scale(1.5) 思路） */
.layer.media {
  transform: scale(1.08);
}
.layer.solid {
  background-color: #1a5c9e;
}
.layer.image {
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
.layer.bg-video,
.layer.bg-fluid {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.overlay {
  position: absolute;
  inset: 0;
}
</style>
