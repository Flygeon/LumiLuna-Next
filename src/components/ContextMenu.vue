/**
 * 全局右键菜单（Material Design 3）。
 * - 固定在光标处，贴边自动翻转，避免溢出视口。
 * - 点击菜单外 / 右键 / Esc / 滚动 / 缩放 关闭。
 * - 支持 ↑↓ 键盘导航、Enter 选中。
 * 用 Teleport 挂到 body，避免被滚动容器的 overflow 裁剪。
 */
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  closeContextMenu,
  useContextMenu,
} from "@/composables/useContextMenu";

const menu = useContextMenu();
const menuRef = ref<HTMLDivElement | null>(null);
const pos = ref({ left: 0, top: 0 });
const activeIndex = ref(-1);

watch(
  () => menu.visible,
  async (v) => {
    if (!v) return;
    activeIndex.value = -1;
    await nextTick();
    const el = menuRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    pos.value = { left, top };
  },
);

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
    // 跳过禁用的项
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
  // 点击菜单外（含左/右键）都关闭；菜单内部由 item 的 click 处理
  if (
    menu.visible &&
    menuRef.value &&
    !menuRef.value.contains(e.target as Node)
  ) {
    closeContextMenu();
  }
}

onMounted(() => {
  window.addEventListener("mousedown", onGlobalMousedown);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("contextmenu", () => {
    // 在没有触发 openContextMenu 的空白处右键时，关掉已开菜单
    if (menu.visible) closeContextMenu();
  });
  window.addEventListener("resize", closeContextMenu);
  window.addEventListener("scroll", closeContextMenu, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onGlobalMousedown);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("contextmenu", closeContextMenu);
  window.removeEventListener("resize", closeContextMenu);
  window.removeEventListener("scroll", closeContextMenu, true);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="menu.visible" ref="menuRef" class="ctx-menu" :style="pos">
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
</style>
