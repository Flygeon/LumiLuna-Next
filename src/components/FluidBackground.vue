<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount } from "vue";
import { usePlayerStore } from "@/stores/player";

/**
 * 流体动态背景（1:1 参考《音乐播放器参考》index.js 的 Slice / animate）。
 * 4 象限旋转 + screen 混合 + blur(30px) saturate(2.5) brightness(0.5) + scale(1.5)。
 */
const player = usePlayerStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);

interface Slice {
  index: number;
  angle: number;
  velocity: number;
  scale: number;
}
let slices: Slice[] = [];
let animationId: number | null = null;
let img: HTMLImageElement | null = null;

function startAnimation() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.scale(dpr, dpr);
  };
  resize();
  window.addEventListener("resize", resize);

  const currentImg = img;
  if (!currentImg) return;

  slices = [0, 1, 2, 3].map((i) => ({
    index: i,
    angle: Math.random() * Math.PI * 2,
    velocity: (Math.random() - 0.5) * 0.005 * 2 * Math.PI,
    scale: 1,
  }));

  if (animationId) cancelAnimationFrame(animationId);
  function animate() {
    const c = canvasRef.value;
    if (!c || !currentImg) return;
    const cctx = c.getContext("2d");
    if (!cctx) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    cctx.clearRect(0, 0, c.width, c.height);
    cctx.globalCompositeOperation = "screen";
    slices.forEach((s) => {
      s.angle += s.velocity;
      const cx = s.index % 2 === 0 ? w * 0.25 : w * 0.75;
      const cy = s.index < 2 ? h * 0.25 : h * 0.75;
      cctx.save();
      cctx.translate(cx, cy);
      cctx.rotate(s.angle);
      cctx.scale(s.scale, s.scale);
      const sw = currentImg.width / 2;
      const sh = currentImg.height / 2;
      const sx = (s.index % 2) * sw;
      const sy = Math.floor(s.index / 2) * sh;
      const drawSize = Math.max(w, h) * 0.6;
      cctx.drawImage(currentImg, sx, sy, sw, sh, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      cctx.restore();
    });
    animationId = requestAnimationFrame(animate);
  }
  animate();
}

function loadCover() {
  const cover = player.song?.coverBase64;
  if (!cover) return;
  const im = new Image();
  im.onload = () => {
    img = im;
    if (canvasRef.value) startAnimation();
  };
  im.src = cover;
}

onMounted(() => {
  if (player.song?.coverBase64) loadCover();
  else if (canvasRef.value) {
    img = new Image();
    img.src = "/default.svg";
    img.onload = () => startAnimation();
  }
});

watch(
  () => player.song?.coverBase64,
  () => loadCover(),
);

onBeforeUnmount(() => {
  if (animationId) cancelAnimationFrame(animationId);
  window.removeEventListener("resize", startAnimation);
});
</script>

<template>
  <div class="fluid-wrapper">
    <canvas ref="canvasRef" class="fluid-canvas"></canvas>
    <div class="dark-overlay"></div>
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
.dark-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 15, 17, 0.55);
  backdrop-filter: blur(10px);
}
</style>
