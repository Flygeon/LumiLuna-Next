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
import { useSettingsStore } from "@/stores/settings";
import { loadPdfjs, toArrayBuffer } from "@/utils/pdf";
import type { MediaEntry } from "@shared/types";

const props = defineProps<{ item: MediaEntry }>();
const emit = defineEmits<{ (e: "close"): void }>();

const settings = useSettingsStore();

const host = ref<HTMLDivElement | null>(null);
/** 单页/双页模式下的画布容器；滚动模式下承载所有页 */
const pdfPane = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const error = ref("");

const page = ref(1);
const totalPages = ref(0);
const zoom = ref(1.2);

const kind = computed(() =>
  props.item.ext.toLowerCase() === "pdf" ? "pdf" : "epub",
);
const mode = computed(() => settings.pdfReadMode);
/** 双页模式一次前进两页 */
const step = computed(() => (mode.value === "dual" ? 2 : 1));

// 这些库的实例不需要响应式深追踪
const book = shallowRef<any>(null);
const rendition = shallowRef<any>(null);
const pdfDoc = shallowRef<any>(null);
const pdfLoadingTask = shallowRef<any>(null);
let renderTasks: any[] = [];

async function loadBytes(): Promise<ArrayBuffer> {
  if (!isTauri) throw new Error("仅在应用内可读取本地文件");
  const bytes = await readFile(props.item.path);
  return toArrayBuffer(bytes);
}

// ---- PDF ----

async function openPdf() {
  const pdfjs = await loadPdfjs();
  const data = await loadBytes();
  // destroy() 挂在 loadingTask 上，PDFDocumentProxy 没有该方法
  pdfLoadingTask.value = pdfjs.getDocument({ data });
  pdfDoc.value = await pdfLoadingTask.value.promise;
  totalPages.value = pdfDoc.value.numPages;
  page.value = 1;
  await renderPdf();
}

function cancelRenders() {
  renderTasks.forEach((t) => t?.cancel?.());
  renderTasks = [];
}

/** 把第 n 页画到一个新建的 canvas 上 */
async function renderPageTo(n: number, container: HTMLElement) {
  const doc = pdfDoc.value;
  if (!doc || n < 1 || n > doc.numPages) return;

  const pdfPage = await doc.getPage(n);
  const viewport = pdfPage.getViewport({ scale: zoom.value });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 按设备像素比渲染，高分屏下不糊
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  container.appendChild(canvas);

  const task = pdfPage.render({ canvasContext: ctx, viewport });
  renderTasks.push(task);
  try {
    await task.promise;
  } catch (e: any) {
    if (e?.name !== "RenderingCancelledException") throw e;
  }
}

/** 依据阅读模式渲染当前视图 */
async function renderPdf() {
  const pane = pdfPane.value;
  const doc = pdfDoc.value;
  if (!pane || !doc) return;

  cancelRenders();
  pane.innerHTML = "";

  if (mode.value === "scroll") {
    // 连续滚动：一次性铺开所有页，逐页顺序绘制
    for (let n = 1; n <= doc.numPages; n++) {
      await renderPageTo(n, pane);
    }
    return;
  }

  await renderPageTo(page.value, pane);
  if (mode.value === "dual" && page.value + 1 <= doc.numPages) {
    await renderPageTo(page.value + 1, pane);
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
    // 滚动模式下整篇连续，翻页交给滚动条
    if (mode.value === "scroll") return;
    if (page.value + step.value <= totalPages.value) {
      page.value += step.value;
      await renderPdf();
    }
  } else {
    await rendition.value?.next();
  }
}

async function prevPage() {
  if (kind.value === "pdf") {
    if (mode.value === "scroll") return;
    if (page.value > 1) {
      page.value = Math.max(1, page.value - step.value);
      await renderPdf();
    }
  } else {
    await rendition.value?.prev();
  }
}

async function setZoom(delta: number) {
  zoom.value = Math.min(4, Math.max(0.5, zoom.value + delta));
  if (kind.value === "pdf") {
    await renderPdf();
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
  cancelRenders();
  rendition.value?.destroy();
  book.value?.destroy();
  void pdfLoadingTask.value?.destroy();
});

// 切换阅读模式或缩放后重绘
watch([mode, zoom], () => {
  if (kind.value === "pdf" && pdfDoc.value) void renderPdf();
});

function openExternally() {
  void capabilities.openFile(props.item.path);
}

const PDF_MODES = [
  { key: "single" as const, icon: "description", label: "单页" },
  { key: "dual" as const, icon: "auto_stories", label: "双页" },
  { key: "scroll" as const, icon: "view_day", label: "滚动" },
];
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
          {{
            kind === "pdf"
              ? mode === "scroll"
                ? `共 ${totalPages} 页`
                : mode === "dual" && page + 1 <= totalPages
                  ? `${page}-${page + 1} / ${totalPages}`
                  : `${page} / ${totalPages}`
              : `第 ${page} 节`
          }}
        </span>
      </div>
      <div class="tools">
        <!-- PDF 阅读模式切换 -->
        <div v-if="kind === 'pdf'" class="modes">
          <button
            v-for="m in PDF_MODES"
            :key="m.key"
            class="mode-btn"
            :class="{ active: mode === m.key }"
            :title="m.label"
            @click="settings.pdfReadMode = m.key"
          >
            <span class="material-symbols-outlined">{{ m.icon }}</span>
          </button>
        </div>
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

      <!-- PDF：单页/双页居中，滚动模式纵向排列 -->
      <div
        v-if="kind === 'pdf'"
        class="pdf-scroll"
        :class="`mode-${mode}`"
        :style="{ visibility: loading || error ? 'hidden' : 'visible' }"
      >
        <div ref="pdfPane" class="pdf-pane" :class="`mode-${mode}`"></div>
      </div>

      <!--
        EPUB 容器必须始终保持真实尺寸：epub.js 在 renderTo 时读取宿主的
        宽高来分栏，如果此刻是 display:none（v-show 隐藏），拿到的是 0×0，
        渲染出的 iframe 尺寸为空，表现为「打开了但一片空白」。
        因此这里用 visibility 占位，加载态由上层浮层遮盖。
      -->
      <div
        v-if="kind === 'epub'"
        ref="host"
        class="epub-host"
        :style="{ visibility: loading || error ? 'hidden' : 'visible' }"
      ></div>

      <button
        v-if="!loading && !error && mode !== 'scroll'"
        class="nav prev"
        title="上一页 (←)"
        @click="prevPage"
      >
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <button
        v-if="!loading && !error && mode !== 'scroll'"
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
/* 单页/双页：内容居中且不参与纵向滚动堆叠 */
.pdf-pane {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  height: fit-content;
}
.pdf-pane.mode-scroll {
  flex-direction: column;
  align-items: center;
  gap: 20px;
}
.pdf-pane :deep(canvas) {
  background: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  display: block;
}

.modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  margin-right: 4px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.08);
}
.mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  transition: all 160ms ease;
}
.mode-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}
.mode-btn.active {
  background: rgba(255, 255, 255, 0.9);
  color: #17171a;
}
.mode-btn .material-symbols-outlined {
  font-size: 18px;
}

.epub-host {
  height: 100%;
  width: 100%;
  padding: 0 56px;
}

.state {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  opacity: 0.85;
  text-align: center;
  padding: 24px;
  background: #17171a;
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
