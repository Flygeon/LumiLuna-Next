<script setup lang="ts">
/**
 * 媒体网格：图片/视频/音乐/书籍四个列表页共用。
 * 缩略图按可视区懒加载（IntersectionObserver），避免一次性解码整库。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useLibraryStore } from "@/stores/library";
import {
  TYPE_ICONS,
  formatDuration,
  formatResolution,
  formatSize,
} from "@/utils/format";
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
    /** 骨架屏占位数量 */
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
const root = ref<HTMLElement | null>(null);
const visibleIds = ref<Set<string>>(new Set());
let observer: IntersectionObserver | null = null;
// 批量收集可视 id，避免每个格子单独发一次 IPC
let pending: string[] = [];
let flushTimer: number | null = null;

function flush() {
  flushTimer = null;
  const batch = pending;
  pending = [];
  if (batch.length) void library.loadThumbnails(batch);
}

function observeCell(el: Element | null, id: string) {
  if (!el || !observer) return;
  (el as HTMLElement).dataset.fileId = id;
  observer.observe(el);
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.fileId;
        if (!id || visibleIds.value.has(id)) continue;
        visibleIds.value.add(id);
        pending.push(id);
        observer?.unobserve(entry.target);
      }
      if (pending.length && flushTimer === null) {
        flushTimer = window.setTimeout(flush, 60);
      }
    },
    // 提前一屏预取，滚动时不留白
    { root: null, rootMargin: "400px 0px", threshold: 0.01 },
  );
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  if (flushTimer !== null) clearTimeout(flushTimer);
});

// 列表整体替换后（切换类型/重新扫描）重置观察状态
watch(
  () => props.items,
  () => {
    visibleIds.value = new Set();
    pending = [];
  },
);

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.minWidth}px, 1fr))`,
}));

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
  <div ref="root" class="media-grid" :style="gridStyle">
    <template v-if="loading">
      <div v-for="n in skeletonCount" :key="'sk' + n" class="cell">
        <div class="thumb lm-skeleton" :style="{ aspectRatio: aspect }"></div>
        <div class="meta">
          <div class="lm-skeleton line"></div>
          <div class="lm-skeleton line short"></div>
        </div>
      </div>
    </template>

    <template v-else>
      <article
        v-for="(item, i) in items"
        :key="item.id"
        :ref="(el) => observeCell(el as Element, item.id)"
        class="cell"
        :style="{ animationDelay: `${Math.min(i, 24) * 25}ms` }"
        tabindex="0"
        @click="emit('open', item, i)"
        @keydown.enter="emit('open', item, i)"
        @keydown.space.prevent="emit('open', item, i)"
      >
        <div class="thumb" :style="{ aspectRatio: aspect }">
          <img
            v-if="thumbOf(item)"
            :src="thumbOf(item)"
            :alt="item.name"
            loading="lazy"
            decoding="async"
          />
          <span v-else class="placeholder material-symbols-outlined">
            {{ TYPE_ICONS[item.type] ?? "draft" }}
          </span>

          <!-- 时长角标 -->
          <span v-if="item.durationMs" class="badge tabular-nums">
            {{ formatDuration(item.durationMs) }}
          </span>

          <!-- 悬停操作层 -->
          <div class="overlay">
            <button
              class="fav"
              :class="{ on: item.favorite }"
              :title="item.favorite ? '取消收藏' : '收藏'"
              @click.stop="emit('favorite', item)"
            >
              <span
                class="material-symbols-outlined"
                :class="{ filled: item.favorite }"
              >favorite</span>
            </button>
          </div>
        </div>

        <div class="meta">
          <div class="title" :title="item.name">
            {{ item.title || item.name }}
          </div>
          <div v-if="subtitle !== 'none'" class="subtitle">
            {{ subtitleOf(item) }}
          </div>
        </div>
      </article>
    </template>
  </div>
</template>

<style scoped>
.media-grid {
  display: grid;
  gap: 20px 16px;
  padding-bottom: 24px;
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  border-radius: var(--md-sys-shape-corner-large);
  outline: none;
  animation: lm-rise 380ms var(--md-sys-motion-easing-emphasized-decelerate) both;
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
  /* 内描边替代硬边框，浅色封面不至于糊进背景 */
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  transition:
    transform 260ms var(--md-sys-motion-spring-soft),
    box-shadow 260ms var(--md-sys-motion-easing-standard);
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
  letter-spacing: 0.2px;
  backdrop-filter: blur(4px);
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 6px;
  opacity: 0;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.35) 0%,
    transparent 40%
  );
  transition: opacity var(--md-sys-motion-duration-short);
}
.cell:hover .overlay,
.cell:focus-within .overlay {
  opacity: 1;
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
  backdrop-filter: blur(6px);
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
  opacity: 1;
}
/* 已收藏的项即便未悬停也要露出标记 */
.cell .fav.on {
  opacity: 1;
}
.cell:not(:hover) .overlay:has(.fav.on) {
  opacity: 1;
  background: none;
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
