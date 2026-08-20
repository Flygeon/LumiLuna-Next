<script setup lang="ts">
/**
 * 媒体网格：图片/视频/音乐/书籍四个列表页共用。
 *
 * 大图库性能策略（三层）：
 * 1. 虚拟滚动——只渲染可视区 ±2 行的卡片，DOM 节点数恒定，
 *    不随库容量增长（此前上万张图会创建上万个节点，直接卡死）。
 * 2. 缩略图按可视区批量请求，滚动过快时丢弃过期批次。
 * 3. 缩略图是 asset:// 路径而非 base64，内存由 webview 回收。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { capabilities, isMobile } from "@/capabilities";
import { openContextMenu, type MenuAnchor } from "@/composables/useContextMenu";
import {
  TYPE_ICONS,
  formatDuration,
  formatResolution,
  formatSize,
} from "@/utils/format";
import { translate } from "@shared/i18n";
import type { MediaEntry } from "@shared/types";

const props = withDefaults(
  defineProps<{
    items: MediaEntry[];
    /** 卡片纵横比：1 方形（图片/音乐）、16/9 视频、3/4 书籍 */
    aspect?: string;
    /** 卡片最小宽度，决定每行列数 */
    minWidth?: number;
    /** 副标题字段来源 */
    subtitle?: "artist" | "resolution" | "size" | "none";
    loading?: boolean;
    skeletonCount?: number;
  }>(),
  {
    aspect: "1",
    minWidth: 180,
    subtitle: "none",
    loading: false,
    skeletonCount: 12,
  },
);

const emit = defineEmits<{
  (e: "open", item: MediaEntry, index: number): void;
  (e: "favorite", item: MediaEntry): void;
}>();

const library = useLibraryStore();
const settings = useSettingsStore();

function t(key: string) {
  return translate(settings.lang, key);
}

/** 右键卡片：定位到文件位置 */
function onContextMenu(e: MenuAnchor, item: MediaEntry) {
  openContextMenu(
    e,
    [{ id: "reveal", label: t("context.revealInExplorer"), icon: "folder_open" }],
    (id) => {
      if (id === "reveal") void capabilities.revealInExplorer(item.path);
    },
  );
}

const GAP_X = 16;
const GAP_Y = 20;
/** 卡片文字区高度，用于估算行高 */
const META_H = 44;
/** 可视区上下各多渲染的行数，滚动时不留白 */
const OVERSCAN = 2;

const viewport = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const width = ref(0);
const scrollTop = ref(0);
const viewportH = ref(800);

/** 移动端有效卡片最小宽：手机屏宽（常见 360dp）下，桌面的 180/260 会算出
 *  单列，浏览体验很差。上限收到 150 让图片/书籍稳定 2 列、视频 2 列。
 *  桌面不受影响（直接用调用方传入值）。 */
const MOBILE_MIN_WIDTH_CAP = 150;
const effMinWidth = computed(() =>
  isMobile ? Math.min(props.minWidth, MOBILE_MIN_WIDTH_CAP) : props.minWidth,
);

const columns = computed(() =>
  Math.max(1, Math.floor((width.value + GAP_X) / (effMinWidth.value + GAP_X))),
);
const cellW = computed(
  () => (width.value - GAP_X * (columns.value - 1)) / columns.value,
);/** 由 aspect（"16/9" 或 "1"）推算缩略图高度 */
const ratio = computed(() => {
  const [w, h] = props.aspect.split("/").map(Number);
  return h ? w / h : (w || 1);
});
const rowH = computed(() => cellW.value / ratio.value + META_H + GAP_Y);
const rowCount = computed(() => Math.ceil(props.items.length / columns.value));
const totalH = computed(() => rowCount.value * rowH.value);

const firstRow = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / rowH.value) - OVERSCAN),
);
const lastRow = computed(() =>
  Math.min(
    rowCount.value,
    Math.ceil((scrollTop.value + viewportH.value) / rowH.value) + OVERSCAN,
  ),
);

/** 当前需要渲染的条目及其全局索引 */
const visible = computed(() => {
  const start = firstRow.value * columns.value;
  const end = Math.min(props.items.length, lastRow.value * columns.value);
  const out: { item: MediaEntry; index: number }[] = [];
  for (let i = start; i < end; i++) {
    out.push({ item: props.items[i], index: i });
  }
  return out;
});

const offsetY = computed(() => firstRow.value * rowH.value);

// ---- 缩略图按可视区拉取 ----
let thumbTimer: number | null = null;
function scheduleThumbs() {
  if (thumbTimer !== null) return;
  // 合并高频滚动产生的请求
  thumbTimer = window.setTimeout(() => {
    thumbTimer = null;
    const ids = visible.value.map((v) => v.item.id);
    if (ids.length) void library.loadThumbnails(ids);
  }, 120);
}

watch(visible, scheduleThumbs, { immediate: true });

function onScroll() {
  const el = viewport.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
}

let ro: ResizeObserver | null = null;

function measure() {
  const el = scroller.value;
  const vp = viewport.value;
  if (el) width.value = el.clientWidth;
  if (vp) viewportH.value = vp.clientHeight;
}

function detach() {
  viewport.value?.removeEventListener("scroll", onScroll);
  ro?.disconnect();
  ro = null;
  viewport.value = null;
}

/**
 * 绑定滚动容器。必须在 scroller 真正出现后调用——首屏 loading 为 true 时
 * 渲染的是骨架屏分支，此时 scroller 为 null，若只在 onMounted 里绑定
 * 会永远拿不到滚动事件（虚拟窗口卡在第一屏）。
 */
function attach() {
  if (!scroller.value || viewport.value) return;
  viewport.value = scroller.value.closest(".main-content");
  if (!viewport.value) return;
  viewport.value.addEventListener("scroll", onScroll, { passive: true });
  ro = new ResizeObserver(measure);
  ro.observe(scroller.value);
  ro.observe(viewport.value);
  measure();
  scrollTop.value = viewport.value.scrollTop;
}

watch(scroller, attach, { flush: "post" });
onMounted(attach);
onBeforeUnmount(() => {
  detach();
  if (thumbTimer !== null) clearTimeout(thumbTimer);
});

// 换类型/重新搜索后回到顶部，否则会停在旧的滚动位置看到空白
watch(
  () => props.items,
  () => {
    if (viewport.value) viewport.value.scrollTop = 0;
    scrollTop.value = 0;
    measure();
  },
);

function cellStyle(index: number) {
  const col = index % columns.value;
  const row = Math.floor(index / columns.value) - firstRow.value;
  return {
    position: "absolute" as const,
    left: `${col * (cellW.value + GAP_X)}px`,
    top: `${row * rowH.value}px`,
    width: `${cellW.value}px`,
  };
}

function thumbOf(item: MediaEntry): string | undefined {
  return library.getThumb(item.id);
}

function subtitleOf(item: MediaEntry): string {
  switch (props.subtitle) {
    case "artist":
      return item.artist || "未知艺术家";
    case "resolution":
      return formatResolution(item.width, item.height) || formatSize(item.size);
    case "size":
      return formatSize(item.size);
    default:
      return "";
  }
}
</script>

<template>
  <!-- 骨架屏：加载中用普通网格，数量固定不需要虚拟化 -->
  <div
    v-if="loading"
    class="skeleton-grid"
    :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }"
  >
    <div v-for="n in skeletonCount" :key="n" class="cell">
      <div class="thumb lm-skeleton" :style="{ aspectRatio: aspect }"></div>
      <div class="meta">
        <div class="lm-skeleton line"></div>
        <div class="lm-skeleton line short"></div>
      </div>
    </div>
  </div>

  <div v-else ref="scroller" class="virtual-root" :style="{ height: totalH + 'px' }">
    <div class="layer" :style="{ transform: `translateY(${offsetY}px)` }">
      <article
        v-for="v in visible"
        :key="v.item.id"
        class="cell"
        :style="cellStyle(v.index)"
        tabindex="0"
        @click="emit('open', v.item, v.index)"
        @contextmenu="onContextMenu($event, v.item)"
        v-long-press="(pos: MenuAnchor) => onContextMenu(pos, v.item)"
        @keydown.enter="emit('open', v.item, v.index)"
        @keydown.space.prevent="emit('open', v.item, v.index)"
      >
        <div class="thumb" :style="{ aspectRatio: aspect }">
          <img
            v-if="thumbOf(v.item)"
            :src="thumbOf(v.item)"
            :alt="v.item.name"
            loading="lazy"
            decoding="async"
          />
          <span v-else class="placeholder material-symbols-outlined">
            {{ TYPE_ICONS[v.item.type] ?? "draft" }}
          </span>

          <span v-if="v.item.durationMs" class="badge tabular-nums">
            {{ formatDuration(v.item.durationMs) }}
          </span>

          <div class="overlay" :class="{ pinned: v.item.favorite }">
            <button
              class="fav"
              :class="{ on: v.item.favorite }"
              :title="v.item.favorite ? '取消收藏' : '收藏'"
              @click.stop="emit('favorite', v.item)"
            >
              <span
                class="material-symbols-outlined"
                :class="{ filled: v.item.favorite }"
              >favorite</span>
            </button>
          </div>
        </div>

        <div class="meta">
          <div class="title" :title="v.item.name">
            {{ v.item.title || v.item.name }}
          </div>
          <div v-if="subtitle !== 'none'" class="subtitle">
            {{ subtitleOf(v.item) }}
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.virtual-root {
  position: relative;
  width: 100%;
}
.layer {
  position: absolute;
  inset: 0;
  will-change: transform;
}

.skeleton-grid {
  display: grid;
  gap: 20px 16px;
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  border-radius: var(--md-sys-shape-corner-large);
  outline: none;
}
.cell:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 4px;
}

.thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  transition:
    transform 220ms var(--md-sys-motion-spring-soft),
    box-shadow 220ms var(--md-sys-motion-easing-standard);
}
.cell:hover .thumb {
  transform: translateY(-4px) scale(1.015);
  box-shadow: var(--md-elevation-3), inset 0 0 0 1px var(--lm-hairline);
}
.cell:active .thumb {
  transform: translateY(-1px) scale(0.995);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.placeholder {
  font-size: 44px;
  color: var(--md-sys-color-outline);
  opacity: 0.7;
  font-variation-settings: 'FILL' 0, 'wght' 300;
}

.badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 7px;
  border-radius: var(--md-sys-shape-corner-small);
  background: rgba(0, 0, 0, 0.68);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 6px;
  opacity: 0;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.35) 0%, transparent 40%);
  transition: opacity var(--md-sys-motion-duration-short);
}
.cell:hover .overlay,
.cell:focus-within .overlay {
  opacity: 1;
}
/* 触屏没有 hover：收藏按钮若只在 hover 时显形，移动端永远点不到，故常驻。
   :global 是因为 .is-mobile 挂在 <html> 上，不在本组件 scope 内。 */
:global(html.is-mobile .virtual-root .overlay) {
  opacity: 1;
}
/* 已收藏的项常驻显示心形 */
.overlay.pinned {
  opacity: 1;
  background: none;
}

.fav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  cursor: pointer;
  transition: transform 140ms var(--md-sys-motion-spring), background 160ms;
}
.fav:hover {
  background: rgba(0, 0, 0, 0.6);
  transform: scale(1.1);
}
.fav .material-symbols-outlined {
  font-size: 19px;
}
.fav.on {
  color: #ff6b81;
}

.meta {
  padding: 0 2px;
  min-width: 0;
}
.title {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  color: var(--md-sys-color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subtitle {
  margin-top: 2px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta .line {
  height: 12px;
  border-radius: 6px;
  margin-top: 6px;
}
.meta .line.short {
  width: 55%;
}
</style>
