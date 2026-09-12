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
import { ref, watch, nextTick, onMounted, onActivated } from "vue";

const props = defineProps<{
  modelValue: string;
  tabs: { value: string; label: string; icon?: string }[];
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const dir = ref<"next" | "prev">("next");
const indexOf = (value: string) => props.tabs.findIndex((t) => t.value === value);
const groupRef = ref<HTMLElement | null>(null);

interface M3eGroup extends HTMLElement {
  updateComplete?: Promise<unknown>;
}

function select(value: string) {
  if (value === props.modelValue) return;
  dir.value = indexOf(value) >= indexOf(props.modelValue) ? "next" : "prev";
  emit("update:modelValue", value);
}

/** 等待下一帧 */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * 强制 m3e-button-group 重算连通圆角（--connected/--first/--last）。
 *
 * 连通态由库在 connectedCallback / slotchange 时「异步」计算：updateButtons 对每个
 * 子按钮 await waitForUpgrade + waitForUpdate 后才写入自定义态。WebView2/Tauri 下自定义
 * 元素升级较慢，首次重算时子按钮尚未真正升级 → custom state 静默失效，且此后不再触发
 * slotchange → 连通永久丢失（全部退化为独立圆角，即「每个都是单独的胶囊」）。
 *
 * 触发时机必须覆盖全部路径：
 *  - onMounted：首次挂载；
 *  - onActivated：keep-alive 重新激活 —— 页面被缓存后再次进入不会重新挂载，onMounted
 *    不再触发；且 DOM 移入/移出缓存容器会让自定义元素 disconnect/reconnect，重连时的
 *    slotchange 又会撞上升级竞态，所以这里是「切页面回来丢样式」的关键触发点；
 *  - watch(modelValue)：切换子选项卡；
 *  - watch(tabs)：按钮列表变化（在线开关切换、数据加载完成）。
 * 每次都在「确认 shadowRoot 与内部 <slot> 就绪」后，多时机重派发 slotchange。
 */
async function syncConnected() {
  const group = groupRef.value as M3eGroup | null;
  if (!group) return;
  if (!customElements.get("m3e-button-group")) {
    await customElements.whenDefined("m3e-button-group").catch(() => undefined);
  }
  // 连通前提（极端情况下曾被重置为 standard 时纠正回来）
  if (group.getAttribute("variant") !== "connected") group.setAttribute("variant", "connected");
  // 等 shadowRoot 与内部 <slot> 就绪：逐帧轮询而非直接放弃，避免升级竞态下漏掉
  for (let i = 0; i < 60 && !group.shadowRoot?.querySelector("slot"); i++) {
    await nextFrame();
  }
  const fire = () => {
    const slot = group.shadowRoot?.querySelector("slot");
    if (slot) slot.dispatchEvent(new Event("slotchange"));
  };
  // 多时机重派发，覆盖升级竞态
  fire();
  requestAnimationFrame(fire);
  requestAnimationFrame(() => requestAnimationFrame(fire));
  window.setTimeout(fire, 120);
  window.setTimeout(fire, 350);
  window.setTimeout(fire, 700);
}

onMounted(() => void syncConnected());
onActivated(() => void syncConnected());
watch(
  () => props.modelValue,
  (nv, ov) => {
    dir.value = indexOf(nv) >= indexOf(ov) ? "next" : "prev";
    // 切换后强制重算连通圆角（防御重挂载/升级竞态）
    void nextTick(syncConnected);
  },
);
watch(
  () => props.tabs.map((t) => t.value).join("|"),
  () => void nextTick(syncConnected),
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

/* hover 轻微缩放弹簧（M3 Expressive）。用户要求保留原有的 transform 动画 */
.online-tabs :deep(m3e-button) {
  transition: transform 220ms var(--md-sys-motion-spring-spatial);
}
.online-tabs :deep(m3e-button:hover) {
  transform: scale(1.02);
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
  .tabs-prev-leave-active,
  .online-tabs :deep(m3e-button) {
    transition: none;
  }
}
</style>
