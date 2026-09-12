<script setup lang="ts">
/**
 * 子选项卡（分段控件）—— 全站统一样式 + 平移动画。
 *
 * 视觉（M3 Expressive segmented buttons）：
 * 每段是**独立胶囊**（间隙 8px，无共享轨道底色）——未选中用 secondary-container
 * 实心、选中用 primary 实心（on-primary 文字/图标）；每段可带 Material Symbols
 * 图标。颜色全部取自动态取色令牌，随种子色/皮肤联动。
 *
 * 动画（沿用原实现，未改动效果）：
 * - 指示器是一个绝对定位的胶囊，按目标按钮实测的 offsetLeft/offsetWidth
 *   用 transform 平移过去（不是给每个按钮改背景），切 tab 时是"滑动"而非"闪现"。
 * - 内容用方向感知的 Transition 平移：向右切时旧内容左移淡出、新内容从右滑入，
 *   反向相反。两个面板用 grid-area 叠在同一格，动画期间容器高度不塌陷。
 *
 * 层级（关键）：轨道 isolation:isolate 建立层叠上下文后，
 *   各段底色(z-auto) < 指示器(z:1) < 文字与图标(z:2)。
 * 这样指示器滑动时能从其它段底色的**上方**划过，且所有文字始终可读。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: string;
  tabs: { value: string; label: string; icon?: string }[];
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
      <span class="seg-label">
        <span v-if="tab.icon" class="material-symbols-outlined seg-icon">{{ tab.icon }}</span>
        <span class="seg-text">{{ tab.label }}</span>
      </span>
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
  isolation: isolate;
  display: inline-flex;
  gap: 8px;
  padding: 0;
  margin-bottom: 14px;
}
.online-tabs-indicator {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  height: 100%;
  border-radius: var(--lm-shape-button);
  background: var(--md-sys-color-primary);
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
  border: none;
  background: var(--md-sys-color-secondary-container);
  padding: 10px 20px;
  border-radius: var(--lm-shape-button);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: var(--md-sys-typescale-label-large-weight);
  color: var(--md-sys-color-on-secondary-container);
  transition:
    background var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast),
    color var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast);
}
.online-tabs .seg:hover {
  background: color-mix(
    in srgb,
    var(--md-sys-color-on-secondary-container) 8%,
    var(--md-sys-color-secondary-container)
  );
}
/* 选中段交给滑动指示器上色，自身底色透明，避免两层圆角边缘重叠 */
.online-tabs .seg.active {
  background: transparent;
  color: var(--md-sys-color-on-primary);
}
.online-tabs .seg-label {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.online-tabs .seg-icon {
  font-size: 18px;
  line-height: 1;
}
.online-tabs .seg-icon.filled,
.online-tabs .seg.active .seg-icon {
  font-variation-settings: "FILL" 1;
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
