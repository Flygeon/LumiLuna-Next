<script setup lang="ts">
/**
 * ElasticSlider：弹性进度/音量滑块（移植自参考项目 elastic-slider）。
 *
 * - 拖动中只发出 `value-change`（UI 预览），松手发出 `value-commit`（适合 seek）
 * - 拖动越出轨道两端时，轨道做 scaleY 橡皮筋压扁回弹（不向容器外溢出）
 * - 键盘方向键可调（role=slider）
 */
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    /** 受控值；不传则为非受控（内部维护） */
    value?: number;
    defaultValue?: number;
    startingValue?: number;
    maxValue?: number;
    isStepped?: boolean;
    stepSize?: number;
    leftIcon?: string;
    rightIcon?: string;
    showValue?: boolean;
    formatValue?: (value: number) => string;
    fluid?: boolean;
    compact?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
  }>(),
  {
    defaultValue: 50,
    startingValue: 0,
    maxValue: 100,
    isStepped: false,
    stepSize: 1,
    leftIcon: "",
    rightIcon: "",
    showValue: false,
    fluid: false,
    compact: false,
    disabled: false,
    ariaLabel: "滑块",
  },
);

const emit = defineEmits<{
  (e: "value-change", value: number): void;
  (e: "value-commit", value: number): void;
}>();

const MAX_SQUISH = 0.22;

const trackRef = ref<HTMLDivElement | null>(null);
const dragging = ref(false);
const dragValue = ref(props.defaultValue);
const internalValue = ref(props.defaultValue);
const squish = ref(0);
const hovered = ref(false);

const baseValue = computed(() => props.value ?? internalValue.value);
const displayValue = computed(() =>
  dragging.value ? dragValue.value : baseValue.value,
);

const fillPct = computed(() => {
  if (props.maxValue <= props.startingValue) return 0;
  const pct =
    ((displayValue.value - props.startingValue) /
      (props.maxValue - props.startingValue)) *
    100;
  return Math.max(0, Math.min(100, pct));
});

const defaultValueFormatter = (v: number) => String(Math.round(v));
const formatter = computed(() => props.formatValue ?? defaultValueFormatter);

function clamp(v: number) {
  return Math.max(props.startingValue, Math.min(props.maxValue, v));
}

function maybeStep(v: number) {
  if (!props.isStepped || props.stepSize <= 0) return v;
  return (
    Math.round((v - props.startingValue) / props.stepSize) * props.stepSize +
    props.startingValue
  );
}

function valueFromClientX(clientX: number): number {
  const el = trackRef.value;
  if (!el) return baseValue.value;
  const { left, width } = el.getBoundingClientRect();
  if (width <= 0) return baseValue.value;
  const raw =
    props.startingValue +
    ((clientX - left) / width) * (props.maxValue - props.startingValue);
  return clamp(maybeStep(raw));
}

/** 越界拉力 → 0..1，sigmoid 衰减 */
function updatePullFromClientX(clientX: number) {
  const el = trackRef.value;
  if (!el) {
    squish.value = 0;
    return;
  }
  const { left, right, width } = el.getBoundingClientRect();
  if (width <= 0) {
    squish.value = 0;
    return;
  }
  let overflowRaw = 0;
  if (clientX < left) overflowRaw = left - clientX;
  else if (clientX > right) overflowRaw = clientX - right;
  const entry = overflowRaw / Math.max(width * 0.35, 1);
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  squish.value = Math.max(0, Math.min(1, sigmoid));
}

function setDragValue(clientX: number) {
  const next = valueFromClientX(clientX);
  dragValue.value = next;
  updatePullFromClientX(clientX);
  emit("value-change", next);
}

function commitDragValue() {
  if (!dragging.value) return;
  dragging.value = false;
  squish.value = 0;
  internalValue.value = dragValue.value;
  emit("value-commit", dragValue.value);
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled || !trackRef.value) return;
  event.preventDefault();
  trackRef.value.setPointerCapture?.(event.pointerId);
  dragging.value = true;
  setDragValue(event.clientX);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return;
  setDragValue(event.clientX);
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return;
  commitDragValue();
}

function onPointerCancel() {
  dragging.value = false;
  squish.value = 0;
}

function onKeyDown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const step = props.isStepped
    ? props.stepSize
    : (props.maxValue - props.startingValue) / 100;
  let next: number;
  if (event.key === "ArrowLeft") {
    next = clamp(maybeStep(baseValue.value - step));
  } else {
    next = clamp(maybeStep(baseValue.value + step));
  }
  if (props.value === undefined) internalValue.value = next;
  emit("value-change", next);
  emit("value-commit", next);
}

const trackScaleY = computed(() => 1 - Math.min(MAX_SQUISH, squish.value));
</script>

<template>
  <div
    class="elastic-slider"
    :class="{
      fluid,
      compact,
      disabled,
      dragging,
      hovered,
    }"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <span
      v-if="leftIcon"
      class="icon material-symbols-outlined"
    >{{ leftIcon }}</span>

    <div class="track-wrap">
      <div
        ref="trackRef"
        class="track"
        role="slider"
        tabindex="0"
        :aria-label="ariaLabel"
        :aria-valuemin="startingValue"
        :aria-valuemax="maxValue"
        :aria-valuenow="displayValue"
        :aria-disabled="disabled"
        @pointerdown="onPointerDown"
        @keydown="onKeyDown"
        @mouseenter="hovered = true"
        @mouseleave="hovered = false"
      >
        <div class="track-bg" :style="{ transform: `scaleY(${trackScaleY})` }">
          <div class="fill" :style="{ width: fillPct + '%' }" />
          <div
            class="knob"
            :class="{ visible: dragging || hovered }"
            :style="{ left: fillPct + '%' }"
          />
        </div>
      </div>
    </div>

    <span
      v-if="rightIcon"
      class="icon material-symbols-outlined"
    >{{ rightIcon }}</span>

    <p v-if="showValue" class="value" aria-hidden>{{ formatter(displayValue) }}</p>
  </div>
</template>

<style scoped>
.elastic-slider {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.elastic-slider.fluid {
  width: 100%;
}
.elastic-slider.fluid .track-wrap {
  flex: 1;
}
.elastic-slider .icon {
  font-size: 18px;
  color: var(--md-sys-color-on-surface-variant);
  flex: none;
}
.elastic-slider.compact .icon {
  font-size: 15px;
}

.track-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.track {
  position: relative;
  width: 100%;
  height: 16px;
  cursor: pointer;
  touch-action: none;
  outline: none;
  display: flex;
  align-items: center;
}
.track-bg {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 2px;
  background: var(--md-sys-color-surface-container-highest);
  transform-origin: center;
  transition: transform 80ms ease-out;
}
.compact .track-bg {
  height: 3px;
}
.elastic-slider:not(.compact) .track:hover .track-bg,
.elastic-slider.dragging .track-bg {
  height: 6px;
  border-radius: 3px;
}
.fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--md-sys-color-primary);
}
.elastic-slider.dragging .fill {
  background: var(--md-sys-color-primary);
}
.knob {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--md-sys-color-primary);
  transform: translate(-50%, -50%) scale(0);
  transition: transform 120ms ease;
}
.compact .knob {
  width: 8px;
  height: 8px;
}
.knob.visible {
  transform: translate(-50%, -50%) scale(1);
}
.value {
  min-width: 34px;
  text-align: right;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0;
}
</style>