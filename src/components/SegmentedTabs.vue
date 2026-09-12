<script setup lang="ts">
/**
 * 子选项卡（分段控件）—— 全站统一样式 + 平移动画。
 *
 * 背景：书籍 / 图片 / 视频 / 音乐四个页面各复制了一份 `.online-tabs`，
 * 其中音乐页那套（胶囊轨道 + secondary-container 实心选中）视觉最好，
 * 其余三套是未统一过的另一版（surface-container 轨道 + 圆角 full + 阴影）。
 * 现在统一收敛到本组件。
 *
 * 动画：
 * - 指示器是一个绝对定位的胶囊，按目标按钮实测的 offsetLeft/offsetWidth
 *   用 transform 平移过去（不是给每个按钮改背景），切 tab 时是"滑动"而非"闪现"。
 * - 内容用方向感知的 Transition 平移：向右切时旧内容左移淡出、新内容从右滑入，
 *   反向相反。两个面板用 grid-area 叠在同一格，动画期间容器高度不塌陷。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: string;
  tabs: { value: string; label: string }[];
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const trackRef = ref<HTMLElement | null>(null);
/** 指示器几何：由目标按钮实测得出 */
const indicator = ref({ x: 0, w: 0, ready: false });
/** 切换方向：决定内容从哪一侧滑入 */
const dir = ref<"next" | "prev">("next");

const indexOf = (value: string) => props.tabs.findIndex((t) => t.value === value);

async function syncIndicator() {
  await nextTick();
  const btn = trackRef.value?.querySelectorAll<HTMLElement>(".seg")[indexOf(props.modelValue)];
  if (!btn) return;
  indicator.value = { x: btn.offsetLeft, w: btn.offsetWidth, ready: true };
}

function select(value: string) {
  if (value === props.modelValue) return;
  dir.value = indexOf(value) >= indexOf(props.modelValue) ? "next" : "prev";
  emit("update:modelValue", value);
}

watch(() => props.modelValue, syncIndicator);

let ro: ResizeObserver | null = null;
onMounted(() => {
  void syncIndicator();
  ro = new ResizeObserver(() => void syncIndicator());
  if (trackRef.value) ro.observe(trackRef.value);
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div v-if="tabs.length" ref="trackRef" class="online-tabs">
    <span
      class="online-tabs-indicator"
      :class="{ ready: indicator.ready }"
      :style="{ transform: `translateX(${indicator.x}px)`, width: `${indicator.w}px` }"
    />
    <button
      v-for="tab in tabs"
      :key="tab.value"
      class="seg"
      :class="{ active: tab.value === modelValue }"
      type="button"
      @click="select(tab.value)"
    >
      {{ tab.label }}
    </button>
  </div>

  <div class="tabs-panels">
    <Transition :name="`tabs-${dir}`">
      <div :key="modelValue" class="tabs-panel">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.online-tabs {
  position: relative;
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  margin-bottom: 14px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--lm-shape-button);
}
.online-tabs-indicator {
  position: absolute;
  top: 3px;
  left: 0;
  height: calc(100% - 6px);
  border-radius: var(--lm-shape-button);
  background: var(--md-sys-color-secondary-container);
  pointer-events: none;
  transition:
    transform 320ms var(--md-sys-motion-spring-soft),
    width 320ms var(--md-sys-motion-spring-soft);
}
/* 首次渲染直接就位，别从 x=0 滑过来 */
.online-tabs-indicator:not(.ready) {
  transition: none;
}
.online-tabs .seg {
  position: relative;
  z-index: 1;
  border: none;
  background: transparent;
  padding: 8px 22px;
  border-radius: var(--lm-shape-button);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  color: var(--md-sys-color-on-surface-variant);
  transition: color var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast);
}
.online-tabs .seg:hover {
  color: var(--md-sys-color-on-surface);
}
.online-tabs .seg.active {
  color: var(--md-sys-color-on-secondary-container);
  font-weight: 500;
}

/* 两个面板叠在同一格：动画期间容器高度取较高者，不会塌陷跳动 */
.tabs-panels {
  display: grid;
}
.tabs-panel {
  grid-area: 1 / 1;
  min-width: 0;
}

.tabs-next-enter-active,
.tabs-next-leave-active,
.tabs-prev-enter-active,
.tabs-prev-leave-active {
  transition:
    transform 260ms var(--md-sys-motion-spring-spatial),
    opacity 260ms var(--md-sys-motion-spring-effects-fast);
}
.tabs-next-enter-from {
  transform: translateX(28px);
  opacity: 0;
}
.tabs-next-leave-to {
  transform: translateX(-28px);
  opacity: 0;
}
.tabs-prev-enter-from {
  transform: translateX(-28px);
  opacity: 0;
}
.tabs-prev-leave-to {
  transform: translateX(28px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .online-tabs-indicator,
  .tabs-next-enter-active,
  .tabs-next-leave-active,
  .tabs-prev-enter-active,
  .tabs-prev-leave-active {
    transition: none;
  }
}
</style>
