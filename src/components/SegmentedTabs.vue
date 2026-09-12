<script setup lang="ts">
/**
 * 子选项卡 —— M3 Expressive 连通按钮组（Connected Button Group）。
 *
 * 使用 @m3e/web 原生 m3e-button-group(m3e-button) 实现，圆角缝隙由组件令牌控制，
 * 不手写圆角 CSS。选中项 Filled(primary)、未选中 Tonal(secondaryContainer)，
 * 颜色全走动态取色令牌（--md-sys-color-*），随种子色 / 皮肤联动。
 *
 * 尺寸对齐改造前的原分段控件（约 36dp：按钮内边距 8dp、文字 label-large），
 * 不沿用 56dp 的 medium 默认值。图标 18dp、图标-文字间距 8dp。
 *
 * 内容方向感知滑动过渡沿用原实现（向右切旧内容左移淡出、新内容从右滑入，反向相反）。
 */
import { ref, watch, nextTick } from "vue";

const props = defineProps<{
  modelValue: string;
  tabs: { value: string; label: string; icon?: string }[];
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const dir = ref<"next" | "prev">("next");
const indexOf = (value: string) => props.tabs.findIndex((t) => t.value === value);
const groupRef = ref<HTMLElement | null>(null);

function select(value: string) {
  if (value === props.modelValue) return;
  dir.value = indexOf(value) >= indexOf(props.modelValue) ? "next" : "prev";
  emit("update:modelValue", value);
}

watch(
  () => props.modelValue,
  (nv, ov) => {
    dir.value = indexOf(nv) >= indexOf(ov) ? "next" : "prev";
    // 防御：Tauri/WebView2 下自定义元素升级时序偶发导致连通圆角状态未重算，
    // 在切换后强制重派发 slotchange，让 m3e-button-group 重新应用 --first/--last/--connected。
    void nextTick().then(() => {
      const slot = groupRef.value?.shadowRoot?.querySelector("slot");
      if (slot) slot.dispatchEvent(new Event("slotchange"));
    });
  },
);
</script>

<template>
  <div class="seg-wrap">
    <m3e-button-group ref="groupRef" class="online-tabs" variant="connected" size="medium">
      <m3e-button
        v-for="tab in tabs"
        :key="tab.value"
        class="seg"
        :class="{ active: tab.value === modelValue }"
        shape="round"
        size="medium"
        :variant="tab.value === modelValue ? 'filled' : 'tonal'"
        type="button"
        @click="select(tab.value)"
      >
        <span v-if="tab.icon" slot="icon" class="material-symbols-outlined seg-icon">{{
          tab.icon
        }}</span>
        <span class="seg-text">{{ tab.label }}</span>
      </m3e-button>
    </m3e-button-group>

    <div class="tabs-panels">
      <Transition :name="`tabs-${dir}`">
        <div :key="modelValue" class="tabs-panel">
          <slot />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.online-tabs {
  /* 连通按钮组令牌：间距 3dp、内侧圆角 8dp、按钮高约 36dp（对齐原分段控件）、图标 18dp、图标-文字 8dp */
  --m3e-connected-button-group-spacing: 3px;
  --m3e-connected-button-group-medium-inner-shape: 8px;
  --m3e-connected-button-group-medium-inner-pressed-shape: 8px;
  --m3e-button-medium-container-height: 36px;
  --m3e-button-medium-label-text-font-size: var(--md-sys-typescale-label-large-size);
  --m3e-button-medium-label-text-font-weight: 500;
  --m3e-button-medium-label-text-line-height: var(--md-sys-typescale-label-large-line-height);
  --m3e-button-icon-size: 18px;
  --m3e-button-icon-label-space: 8px;
  display: inline-flex;
  margin-bottom: 14px;
}
.seg-icon {
  font-size: 18px;
  line-height: 1;
}
.seg.active .seg-icon {
  font-variation-settings: "FILL" 1;
}

/* 内容方向感知滑动过渡（沿用原实现） */
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
  .tabs-next-enter-active,
  .tabs-next-leave-active,
  .tabs-prev-enter-active,
  .tabs-prev-leave-active {
    transition: none;
  }
}
</style>
