<script setup lang="ts">
/**
 * 流体动态背景（参考《音乐播放器参考》index.js 的 Slice / animate）。
 * 三种模式（settings.playerBg）：
 * - animated：4 象限旋转 canvas + screen 混合 + blur/saturate/brightness（默认）
 * - image：仅静态模糊封面图，不起动画循环（省 GPU）
 * - off：纯色背景
 *
 * 性能优化（尽量不改视觉效果）：
 * - 画布像素密度封顶 dpr=2：canvas 已是 blur(30px)+scale(1.5)，更高 DPR 不可见，可大幅降填充率
 * - 四张切片预渲染到离屏 canvas，逐帧只做旋转 blit，省去对大图反复缩放
 * - 移除参考实现里没有的 .dark-overlay backdrop-filter（逐帧整屏重采样，最耗 GPU）
 * - 窗口隐藏时暂停动画循环
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

const player = usePlayerStore();
const settings = useSettingsStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);

interface Slice {
  index: number;
  angle: number;
  velocity: number;
}
let slices: Slice[] = [];
let animationId: number | null = null;
let img: HTMLImageElement | null = null;
/** 预渲染的 4 张切片，逐帧只做旋转 blit */
let tiles: HTMLCanvasElement[] = [];
let tileSize = 0;
let loopCtx: CanvasRenderingContext2D | null = null;
let resizeHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

const mode = computed(() => settings.playerBg);
/** 静态模式下用作 CSS 背景的封面 */
const coverBg = computed(
  () => `url("${player.song?.coverBase64 || "/default.svg"}")`,
);

function stopLoop() {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

/** 停掉循环并释放监听，确保重复 start 不叠加泄漏 */
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
  loopCtx = null;
  tiles = [];
}

/** 把封面四分之一预渲染成一张 tileSize×tileSize 的切片 */
function makeTile(sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(tileSize));
  c.height = Math.max(1, Math.round(tileSize));
  const tctx = c.getContext("2d");
  if (tctx) tctx.drawImage(img!, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function buildTiles() {
  if (!img) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  tileSize = Math.max(w, h) * 0.6;
  const sw = img.width / 2;
  const sh = img.height / 2;
  tiles = [0, 1, 2, 3].map((i) =>
    makeTile((i % 2) * sw, Math.floor(i / 2) * sh, sw, sh),
  );
}

function startLoop() {
  const canvas = canvasRef.value;
  if (!canvas || !img) return;
  teardown();
  loopCtx = canvas.getContext("2d");
  if (!loopCtx) return;

  // 像素密度封顶 2：canvas 已被 blur(30px)+scale(1.5) 重度模糊，更高 DPR 不可见
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    loopCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildTiles();
  };
  resize();
  resizeHandler = resize;
  window.addEventListener("resize", resize);

  visibilityHandler = () => {
    if (document.hidden) stopLoop();
    else startLoop();
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  if (slices.length === 0) {
    slices = [0, 1, 2, 3].map((i) => ({
      index: i,
      angle: Math.random() * Math.PI * 2,
      velocity: (Math.random() - 0.5) * 0.005 * 2 * Math.PI,
    }));
  }

  const animate = () => {
    const c = canvasRef.value;
    const cctx = loopCtx;
    if (!c || !cctx) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    cctx.clearRect(0, 0, w, h);
    cctx.globalCompositeOperation = "screen";
    for (let k = 0; k < slices.length; k++) {
      const s = slices[k];
      s.angle += s.velocity;
      const cx = s.index % 2 === 0 ? w * 0.25 : w * 0.75;
      const cy = s.index < 2 ? h * 0.25 : h * 0.75;
      cctx.save();
      cctx.translate(cx, cy);
      cctx.rotate(s.angle);
      cctx.drawImage(tiles[s.index], -tileSize / 2, -tileSize / 2);
      cctx.restore();
    }
    animationId = requestAnimationFrame(animate);
  };
  animationId = requestAnimationFrame(animate);
}

function loadCover() {
  const src = player.song?.coverBase64 || "/default.svg";
  const im = new Image();
  im.onload = () => {
    img = im;
    if (mode.value === "animated" && canvasRef.value) startLoop();
  };
  im.src = src;
}

async function applyMode() {
  teardown();
  if (mode.value !== "animated") return;
  await nextTick();
  loadCover();
}

watch(mode, applyMode);
watch(
  () => player.song?.coverBase64,
  () => {
    if (mode.value === "animated") loadCover();
  },
);

onMounted(async () => {
  if (mode.value === "animated") await applyMode();
});

onBeforeUnmount(teardown);
</script>

<template>
  <div class="fluid-wrapper">
    <canvas
      v-if="mode === 'animated'"
      ref="canvasRef"
      class="fluid-canvas"
    ></canvas>
    <div
      v-else-if="mode === 'image'"
      class="fluid-static"
      :style="{ backgroundImage: coverBg }"
    ></div>
    <div v-if="mode !== 'off'" class="dark-overlay"></div>
  </div>
</template>

<style scoped>
.fluid-wrapper {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  background-color: #0F0F11;
}
.fluid-canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform: scale(1.5);
  filter: blur(30px) saturate(2.5) brightness(0.5);
  pointer-events: none;
  will-change: transform;
}
.fluid-static {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  transform: scale(1.5);
  filter: blur(30px) saturate(2.5) brightness(0.5);
  pointer-events: none;
}
.dark-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 15, 17, 0.58);
  /* 参考实现未使用 backdrop-filter；逐帧整屏重采样是最大的 GPU 开销，故移除，观感几乎不变 */
}
</style>
