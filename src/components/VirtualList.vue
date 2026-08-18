<script setup lang="ts" generic="T">
/**
 * 感知外层页面滚动的固定行高虚拟列表（移植自参考项目 virtual-list）。
 *
 * - 未超过 `virtualizeAfter` 时全量渲染（列表模式小列表无需虚拟化）
 * - 滚动父容器自动探测（.main-content），resize / 滚动用 rAF 节流
 * - 通过 `range-change` 把可视区间交给上层做缩略图批量加载
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    items: T[];
    itemHeight: number;
    /** 稳定 key：默认取 item.id / index */
    itemKey?: (item: T, index: number) => string | number;
    overscanPx?: number;
    virtualizeAfter?: number;
  }>(),
  {
    overscanPx: 720,
    virtualizeAfter: 80,
  },
);

const emit = defineEmits<{
  (e: "range-change", range: { start: number; end: number }): void;
}>();

interface VisibleRange {
  start: number;
  end: number;
}

const listRef = ref<HTMLDivElement | null>(null);
let frame: number | null = null;
let observer: ResizeObserver | null = null;
let scrollParent: HTMLElement | Window | null = null;

const virtualized = computed(() => props.items.length > props.virtualizeAfter);
const range = ref<VisibleRange>({
  start: 0,
  end: Math.min(props.items.length, props.virtualizeAfter),
});

defineExpose({ listRef });

function findScrollParent(element: HTMLElement): HTMLElement | Window {
  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return window;
}

function readVisibleRange(): VisibleRange {
  const list = listRef.value;
  if (!list) return { start: 0, end: props.items.length };

  const listRect = list.getBoundingClientRect();
  const viewportTop =
    scrollParent === window
      ? 0
      : (scrollParent as HTMLElement).getBoundingClientRect().top;
  const viewportBottom =
    scrollParent === window
      ? window.innerHeight
      : (scrollParent as HTMLElement).getBoundingClientRect().bottom;

  const visibleTop = Math.max(0, viewportTop - listRect.top - props.overscanPx);
  const visibleBottom = Math.min(
    props.items.length * props.itemHeight,
    viewportBottom - listRect.top + props.overscanPx,
  );
  const start = Math.min(
    Math.max(0, props.items.length - 1),
    Math.max(0, Math.floor(visibleTop / props.itemHeight)),
  );
  const end = Math.min(
    props.items.length,
    Math.max(start + 1, Math.ceil(Math.max(0, visibleBottom) / props.itemHeight)),
  );
  return { start, end };
}

function updateRange() {
  const next: VisibleRange = virtualized.value
    ? readVisibleRange()
    : { start: 0, end: props.items.length };
  const current = range.value;
  if (current.start !== next.start || current.end !== next.end) {
    range.value = next;
    emit("range-change", { ...next });
  }
}

function scheduleRangeUpdate() {
  if (frame !== null) return;
  frame = window.requestAnimationFrame(() => {
    frame = null;
    updateRange();
  });
}

function detach() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (scrollParent) {
    const target = scrollParent === window ? window : scrollParent;
    target.removeEventListener("scroll", scheduleRangeUpdate);
  }
  window.removeEventListener("resize", scheduleRangeUpdate);
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  scrollParent = null;
}

function attach() {
  const list = listRef.value;
  if (!list || !virtualized.value) return;
  scrollParent = findScrollParent(list);
  const target = scrollParent === window ? window : scrollParent;
  target.addEventListener("scroll", scheduleRangeUpdate, { passive: true });
  window.addEventListener("resize", scheduleRangeUpdate, { passive: true });
  observer = new ResizeObserver(scheduleRangeUpdate);
  observer.observe(list);
  if (scrollParent !== window) {
    observer.observe(scrollParent as HTMLElement);
  }
  updateRange();
}

watch([() => props.items, virtualized], () => {
  range.value = {
    start: 0,
    end: Math.min(props.items.length, props.virtualizeAfter),
  };
  emit("range-change", { ...range.value });
  detach();
  requestAnimationFrame(() => {
    attach();
    updateRange();
  });
});

onMounted(() => {
  attach();
  updateRange();
  // 首次也要把区间交给上层，以便列表默认加载可视缩略图
  emit("range-change", { ...range.value });
});

onBeforeUnmount(detach);

const visibleItems = computed(() =>
  virtualized.value
    ? props.items.slice(range.value.start, range.value.end)
    : props.items,
);
const startIndex = computed(() =>
  virtualized.value ? range.value.start : 0,
);
const topSpacer = computed(() => startIndex.value * props.itemHeight);
const bottomSpacer = computed(() =>
  virtualized.value
    ? Math.max(0, (props.items.length - range.value.end) * props.itemHeight)
    : 0,
);

function keyOf(item: T, index: number): string | number {
  if (props.itemKey) return props.itemKey(item, index);
  const anyItem = item as { id?: string | number };
  return anyItem?.id ?? index;
}
</script>

<template>
  <div ref="listRef" class="virtual-list">
    <div
      v-if="topSpacer > 0"
      class="spacer"
      aria-hidden="true"
      :style="{ height: topSpacer + 'px' }"
    ></div>
    <div
      v-for="(item, offset) in visibleItems"
      :key="keyOf(item, startIndex + offset)"
      class="virtual-row"
      :style="{ height: itemHeight + 'px' }"
      :data-virtual-index="startIndex + offset"
    >
      <slot :item="item" :index="startIndex + offset" />
    </div>
    <div
      v-if="bottomSpacer > 0"
      class="spacer"
      aria-hidden="true"
      :style="{ height: bottomSpacer + 'px' }"
    ></div>
  </div>
</template>

<style scoped>
.virtual-list {
  min-width: 0;
}
.virtual-row {
  overflow: hidden;
}
.spacer {
  pointer-events: none;
}
</style>