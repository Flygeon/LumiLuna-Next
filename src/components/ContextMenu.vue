/** * 全局右键菜单（Material Design 3）。 * - 位置直接由菜单状态 menu.x/menu.y 派生（reactive →
computed）， * 不依赖「watch + nextTick + 改 ref」的二次更新——那套在真实 WebView 里 *
会失效导致菜单错位到左上角。 * - 贴边自动翻转用 onUpdated 测量 + margin
位移，best-effort，失败停在光标处。 * - 点击菜单外 / Esc / 滚动 / 缩放 关闭；不用 window contextmenu
监听， * 避免「刚打开又被同一事件关掉」的竞态（mousedown 已覆盖空白处右键关闭）。 */
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from "vue";
import { closeContextMenu, useContextMenu } from "@/composables/useContextMenu";

const menu = useContextMenu();
const menuRef = ref<HTMLDivElement | null>(null);
const activeIndex = ref(-1);
/** 贴边翻转位移（margin 实现，避免与入场 scale 动画的 transform 冲突） */
const flip = ref({ x: 0, y: 0 });

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
  const el = menuRef.value;
  // 菜单内部点击不关（item 的 click 处理）；菜单外（含空白处右键）都关闭
  if (!el || !el.contains(e.target as Node)) closeContextMenu();
}

onMounted(() => {
  window.addEventListener("mousedown", onGlobalMousedown);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", closeContextMenu);
  window.addEventListener("scroll", closeContextMenu, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onGlobalMousedown);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", closeContextMenu);
  window.removeEventListener("scroll", closeContextMenu, true);
});
</script>

<template>
  <Teleport to="body">
    <m3e-list
      v-if="menu.visible"
      ref="menuRef"
      class="ctx-menu"
      variant="standard"
      :style="menuStyle"
    >
      <m3e-list-item
        v-for="(item, i) in menu.items"
        :key="item.id"
        class="ctx-item"
        :class="{
          danger: item.danger,
          active: i === activeIndex,
          disabled: item.disabled,
        }"
        @click="!item.disabled && select(item.id)"
        @mouseenter="activeIndex = i"
      >
        <span v-if="item.icon" slot="leading" class="material-symbols-outlined ctx-icon">
          {{ item.icon }}
        </span>
        <span class="ctx-label">{{ item.label }}</span>
      </m3e-list-item>
    </m3e-list>
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
  box-shadow:
    var(--md-elevation-2),
    inset 0 0 0 1px var(--lm-hairline);
  transform-origin: top left;
  animation: ctx-pop 220ms var(--md-sys-motion-spring-spatial);
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

/* 菜单项：M3E 连通项样式覆写，对齐原右键菜单观感 */
.ctx-item {
  --m3e-list-item-leading-space: 16px;
  --m3e-list-item-trailing-space: 16px;
  height: 40px;
}
.ctx-icon {
  font-size: 20px;
  color: var(--md-sys-color-on-surface-variant);
}
.ctx-label {
  color: var(--md-sys-color-on-surface);
}
.ctx-item.active {
  --m3e-list-item-container-color: var(--md-sys-color-surface-container-high);
}
.ctx-item.danger .ctx-label,
.ctx-item.danger .ctx-icon {
  color: var(--md-sys-color-error);
}
.ctx-item.disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
