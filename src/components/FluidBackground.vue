<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount } from "vue";
import { usePlayerStore } from "@/stores/player";

/**
 * 流体动态背景（1:1 参考《音乐播放器参考》index.js 的 Slice / animate）。
 * 4 象限旋转 + screen 混合 + blur/saturate/brightness 滤镜。
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
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  const currentImg = img;
  if (!currentImg) return;

  slices = [0, 1, 2, 3].map((i) => ({
    index: i,
    angle: Math.random() * Math.PI * 2,
    velocity: (Math.random() - 0.5) * 0.005 * 2 * Math.PI, // 极慢
    scale: 1,
  }));

  if (animationId) cancelAnimationFrame(animationId);
  function animate() {
    const c = canvasRef.value;
    if (!c || !currentImg) return;
    const cctx = c.getContext("2d");
    if (!cctx) return;
    cctx.clearRect(0, 0, c.width, c.height);
    cctx.globalCompositeOperation = "screen";
    slices.forEach((s) => {
      s.angle += s.velocity;
      const cx = s.index % 2 === 0 ? c.width * 0.25 : c.width * 0.75;
      const cy = s.index < 2 ? c.height * 0.25 : c.height * 0.75;
      cctx.save();
      cctx.translate(cx, cy);
      cctx.rotate(s.angle);
      cctx.scale(s.scale, s.scale);
      const sw = currentImg.width / 2;
      const sh = currentImg.height / 2;
      const sx = (s.index % 2) * sw;
      const sy = Math.floor(s.index / 2) * sh;
      const drawSize = Math.max(c.width, c.height) * 0.6;
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
    // 默认封面
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
});
</script>

<template>
  <canvas ref="canvasRef" class="fluid-bg"></canvas>
</template>

<style scoped>
.fluid-bg {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform: scale(1.5);
  z-index: -1;
  filter: blur(30px) saturate(2.5) brightness(0.5);
  pointer-events: none;
  background-color: #000;
}
</style>
