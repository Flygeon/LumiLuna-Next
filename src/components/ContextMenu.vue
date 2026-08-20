/**
 * 全局右键菜单（Material Design 3）。
 * - 位置直接由菜单状态 menu.x/menu.y 派生（reactive → computed），
 *   不依赖「watch + nextTick + 改 ref」的二次更新——那套在真实 WebView 里
 *   会失效导致菜单错位到左上角。
 * - 贴边自动翻转用 onUpdated 测量 + margin 位移，best-effort，失败停在光标处。
 * - 点击菜单外 / Esc / 滚动 / 缩放 关闭；不用 window contextmenu 监听，
 *   避免「刚打开又被同一事件关掉」的竞态（mousedown 已覆盖空白处右键关闭）。
 */
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from "vue";
import {
  closeContextMenu,
  useContextMenu,
} from "@/composables/useContextMenu";

const menu = useContextMenu();
const menuRef = ref<HTMLDivElement | null>(null);
const activeIndex = ref(-1);
/** 贴边翻转位移（margin 实现，避免与入场 scale 动画的 transform 冲突） */
const flip = ref({ x: 0, y: 0 });
/** 打开时刻，用于「刚打开不立即关闭」的宽限判定 */
let openedAt = 0;
const OPEN_GRACE_MS = 300;

const menuStyle = computed(() => ({
  left: menu.x + "px",
  top: menu.y + "px",
  marginLeft: flip.value.x + "px",
  marginTop: flip.value.y + "px",
}));

function measureFlip() {
  const el = menuRef.value;
  if (!el || !menu.visible) return;
  const r = el.getBoundingClientRect();
  const m = 8;
  let x = 0;
  let y = 0;
  if (r.right > window.innerWidth - m) x = window.innerWidth - r.right - m;
  if (r.bottom > window.innerHeight - m) y = window.innerHeight - r.bottom - m;
  if (r.left < m) x = Math.max(x, m - r.left);
  if (r.top < m) y = Math.max(y, m - r.top);
  if (x !== flip.value.x || y !== flip.value.y) flip.value = { x, y };
}

watch(
  () => menu.visible,
  (v) => {
    activeIndex.value = -1;
    if (!v) flip.value = { x: 0, y: 0 };
    else openedAt = performance.now();
  },
);
onUpdated(measureFlip);

function select(id: string) {
  const cb = menu.onSelect;
  closeContextMenu();
  cb?.(id);
}

function onKeydown(e: KeyboardEvent) {
  if (!menu.visible) return;
  if (e.key === "Escape") {
    closeContextMenu();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = menu.items.length;
    if (!n) return;
    const dir = e.key === "ArrowDown" ? 1 : -1;
    let next = activeIndex.value + dir;
    for (let i = 0; i < n; i++) {
      const idx = ((next % n) + n) % n;
      if (!menu.items[idx]?.disabled) {
        next = idx;
        break;
      }
      next += dir;
    }
    activeIndex.value = next;
  }
  if (e.key === "Enter" && activeIndex.value >= 0) {
    const item = menu.items[activeIndex.value];
    if (item && !item.disabled) select(item.id);
  }
}

function onGlobalMousedown(e: MouseEvent) {
  if (!menu.visible) return;
  // 刚打开的极短时间内不关：移动端长按 500ms 触发菜单，抬手时 WebView 可能
  // 补发一组兼容 mouse 事件，那次 mousedown 会把刚弹出的菜单立刻关掉。
  if (performance.now() - openedAt < OPEN_GRACE_MS) return;
  const el = menuRef.value;
  // 菜单内部点击不关（item 的 click 处理）；菜单外（含空白处右键）都关闭
  if (!el || !el.contains(e.target as Node)) closeContextMenu();
}

/** 触屏关闭：不等抬手后的兼容 mouse 事件，按下即判定，响应更干脆 */
function onGlobalTouchStart(e: TouchEvent) {
  if (!menu.visible) return;
  if (performance.now() - openedAt < OPEN_GRACE_MS) return;
  const el = menuRef.value;
  const target = e.target as Node | null;
  if (!el || !target || !el.contains(target)) closeContextMenu();
}

onMounted(() => {
  window.addEventListener("mousedown", onGlobalMousedown);
  window.addEventListener("touchstart", onGlobalTouchStart, { passive: true });
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", closeContextMenu);
  window.addEventListener("scroll", closeContextMenu, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onGlobalMousedown);
  window.removeEventListener("touchstart", onGlobalTouchStart);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", closeContextMenu);
  window.removeEventListener("scroll", closeContextMenu, true);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="menu.visible" ref="menuRef" class="ctx-menu" :style="menuStyle">
      <button
        v-for="(item, i) in menu.items"
        :key="item.id"
        class="ctx-item"
        :class="{
          danger: item.danger,
          disabled: item.disabled,
          active: i === activeIndex,
        }"
        :disabled="item.disabled"
        @click="select(item.id)"
        @mouseenter="activeIndex = i"
      >
        <span v-if="item.icon" class="material-symbols-outlined ctx-icon">
          {{ item.icon }}
        </span>
        <span class="ctx-label">{{ item.label }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 188px;
  padding: 8px;
  background: var(--md-sys-color-surface-container);
  border-radius: var(--md-sys-shape-corner-extra-large);
  box-shadow: var(--md-elevation-2), inset 0 0 0 1px var(--lm-hairline);
  transform-origin: top left;
  animation: ctx-pop 150ms var(--md-sys-motion-easing-emphasized-decelerate);
}
@keyframes ctx-pop {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  text-align: left;
  cursor: pointer;
  transition: background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.ctx-item:hover,
.ctx-item.active {
  background: var(--md-sys-color-surface-container-high);
}
.ctx-icon {
  font-size: 20px;
  color: var(--md-sys-color-on-surface-variant);
  flex: none;
}
.ctx-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ctx-item.danger,
.ctx-item.danger .ctx-icon {
  color: var(--md-sys-color-error);
}
.ctx-item.disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}

/* 移动端：菜单由长按触发，条目按 M3 触摸目标放到 48px；宽度也放宽一点，
   免得中文条目频繁省略号。
   :global 是因为 .is-mobile 挂在 <html> 上，且本组件 Teleport 到 body。 */
:global(html.is-mobile .ctx-menu) {
  min-width: 208px;
}
:global(html.is-mobile .ctx-menu .ctx-item) {
  height: 48px;
}
</style>
