<script setup lang="ts">
/**
 * 内置阅读器：EPUB（epub.js）与 PDF（pdf.js）。
 *
 * 此前书籍页只调用 openPath 交给系统默认程序，若系统未关联
 * .epub/.pdf 就完全没有反应，表现为「点了没用」。现在改为应用内阅读，
 * 并保留「用系统应用打开」作为兜底。
 *
 * 文件通过 Tauri fs 读成 ArrayBuffer 再喂给两个库，避免依赖
 * asset:// 的 range 请求行为差异。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { readFile } from "@tauri-apps/plugin-fs";
import { capabilities, isTauri } from "@/capabilities";
import type { MediaEntry } from "@shared/types";

const props = defineProps<{ item: MediaEntry }>();
const emit = defineEmits<{ (e: "close"): void }>();

const host = ref<HTMLDivElement | null>(null);
const pdfCanvas = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);
const error = ref("");

const page = ref(1);
const totalPages = ref(0);
const zoom = ref(1.2);

const kind = computed(() =>
  props.item.ext.toLowerCase() === "pdf" ? "pdf" : "epub",
);

// 这些库的实例不需要响应式深追踪
const book = shallowRef<any>(null);
const rendition = shallowRef<any>(null);
const pdfDoc = shallowRef<any>(null);
let renderTask: any = null;

async function loadBytes(): Promise<ArrayBuffer> {
  if (!isTauri) throw new Error("仅在应用内可读取本地文件");
  const bytes = await readFile(props.item.path);
  // 复制到独立 ArrayBuffer，pdf.js 会接管（detach）传入的缓冲区
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// ---- PDF ----

async function openPdf() {
  const pdfjs: any = await import("pdfjs-dist");
  // worker 与主包版本必须一致，用 Vite 的 ?url 引用打包产物
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await loadBytes();
  pdfDoc.value = await pdfjs.getDocument({ data }).promise;
  totalPages.value = pdfDoc.value.numPages;
  page.value = 1;
  await renderPdfPage();
}

async function renderPdfPage() {
  const doc = pdfDoc.value;
  const canvas = pdfCanvas.value;
  if (!doc || !canvas) return;

  // 取消上一次未完成的渲染，避免快速翻页时两次绘制打架
  renderTask?.cancel();

  const pdfPage = await doc.getPage(page.value);
  const viewport = pdfPage.getViewport({ scale: zoom.value });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 按设备像素比渲染，高分屏下不糊
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  renderTask = pdfPage.render({ canvasContext: ctx, viewport });
  try {
    await renderTask.promise;
  } catch (e: any) {
    if (e?.name !== "RenderingCancelledException") throw e;
  }
}

// ---- EPUB ----

async function openEpub() {
  const ePub = (await import("epubjs")).default;
  const data = await loadBytes();
  book.value = ePub(data);

  rendition.value = book.value.renderTo(host.value!, {
    width: "100%",
    height: "100%",
    spread: "auto",
    allowScriptedContent: false,
  });

  // 深色阅读背景下需要覆写内容样式，否则正文是黑字黑底
  rendition.value.themes.register("lumiluna", {
    body: {
      background: "transparent",
      color: "#e6e6e8",
      "font-size": "1.05em",
      "line-height": "1.75",
      padding: "0 8px",
    },
    a: { color: "#8bb9f0" },
    "img, image": { "max-width": "100%", height: "auto" },
  });
  rendition.value.themes.select("lumiluna");

  await rendition.value.display();

  const nav = await book.value.loaded.navigation;
  totalPages.value = nav?.toc?.length ?? 0;

  rendition.value.on("relocated", (location: any) => {
    page.value = (location?.start?.index ?? 0) + 1;
  });

  // epub.js 的 iframe 会吞掉键盘事件，需在其内部再挂一次
  rendition.value.on("keyup", onKey);
}

// ---- 通用导航 ----

async function nextPage() {
  if (kind.value === "pdf") {
    if (page.value < totalPages.value) {
      page.value++;
      await renderPdfPage();
    }
  } else {
    await rendition.value?.next();
  }
}

async function prevPage() {
  if (kind.value === "pdf") {
    if (page.value > 1) {
      page.value--;
      await renderPdfPage();
    }
  } else {
    await rendition.value?.prev();
  }
}

async function setZoom(delta: number) {
  zoom.value = Math.min(4, Math.max(0.5, zoom.value + delta));
  if (kind.value === "pdf") {
    await renderPdfPage();
  } else {
    rendition.value?.themes.fontSize(`${Math.round(zoom.value * 87)}%`);
  }
}

function onKey(e: KeyboardEvent) {
  switch (e.key) {
    case "Escape":
      emit("close");
      break;
    case "ArrowRight":
    case "PageDown":
      void nextPage();
      break;
    case "ArrowLeft":
    case "PageUp":
      void prevPage();
      break;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  try {
    if (kind.value === "pdf") await openPdf();
    else await openEpub();
  } catch (e) {
    error.value = `无法打开此文件：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  renderTask?.cancel();
  rendition.value?.destroy();
  book.value?.destroy();
  pdfDoc.value?.destroy();
});

// PDF 缩放后重绘
watch(zoom, () => {
  if (kind.value === "pdf") void renderPdfPage();
});

function openExternally() {
  void capabilities.openFile(props.item.path);
}
</script>

<template>
  <div class="reader">
    <header class="bar">
      <button class="rbtn" title="关闭 (Esc)" @click="emit('close')">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div class="title" :title="item.path">{{ item.title || item.name }}</div>
      <div class="pager" v-if="totalPages">
        <span class="tabular-nums">
          {{ kind === "pdf" ? `${page} / ${totalPages}` : `第 ${page} 节` }}
        </span>
      </div>
      <div class="tools">
        <button class="rbtn" title="缩小" @click="setZoom(-0.2)">
          <span class="material-symbols-outlined">zoom_out</span>
        </button>
        <button class="rbtn" title="放大" @click="setZoom(0.2)">
          <span class="material-symbols-outlined">zoom_in</span>
        </button>
        <button class="rbtn" title="用系统应用打开" @click="openExternally">
          <span class="material-symbols-outlined">open_in_new</span>
        </button>
      </div>
    </header>

    <div class="stage">
      <div v-if="loading" class="state">
        <div class="spinner"></div>
        <p>正在打开…</p>
      </div>

      <div v-else-if="error" class="state">
        <span class="material-symbols-outlined big">error</span>
        <p>{{ error }}</p>
        <button class="lm-btn lm-btn--filled" @click="openExternally">
          用系统应用打开
        </button>
      </div>

      <!-- PDF 画布 -->
      <div v-show="!loading && !error && kind === 'pdf'" class="pdf-scroll">
        <canvas ref="pdfCanvas"></canvas>
      </div>

      <!-- EPUB 渲染容器：必须常驻 DOM，epub.js 需要真实尺寸 -->
      <div v-show="!loading && !error && kind === 'epub'" ref="host" class="epub-host"></div>

      <button
        v-if="!loading && !error"
        class="nav prev"
        title="上一页 (←)"
        @click="prevPage"
      >
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <button
        v-if="!loading && !error"
        class="nav next"
        title="下一页 (→)"
        @click="nextPage"
      >
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.reader {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  background: #17171a;
  color: #e6e6e8;
  animation: fade 180ms ease;
}
@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.25);
}
.title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pager {
  font-size: 12px;
  opacity: 0.65;
  white-space: nowrap;
}
.tools {
  display: flex;
  gap: 2px;
}
.rbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 160ms;
}
.rbtn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.rbtn .material-symbols-outlined {
  font-size: 20px;
}

.stage {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.pdf-scroll {
  height: 100%;
  overflow: auto;
  display: flex;
  justify-content: center;
  padding: 24px;
}
.pdf-scroll canvas {
  background: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  height: fit-content;
}

.epub-host {
  height: 100%;
  width: 100%;
  padding: 0 56px;
}

.state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  opacity: 0.85;
  text-align: center;
  padding: 24px;
}
.state .big {
  font-size: 56px;
  opacity: 0.5;
}
.spinner {
  width: 34px;
  height: 34px;
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
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 160ms;
  z-index: 2;
}
.nav:hover {
  background: rgba(255, 255, 255, 0.22);
}
.prev { left: 8px; }
.next { right: 8px; }
.nav .material-symbols-outlined {
  font-size: 26px;
}
</style>
