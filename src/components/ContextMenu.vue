<script setup lang="ts">
/**
 * 全局右键菜单（Material Design 3）。
 * 菜单本体交给 @m3e/web 的 m3e-menu / m3e-menu-item：
 * - 位置：m3e-menu 只支持锚定到「元素」，故用一个 0×0 的固定定位锚点贴在光标坐标上，
 *   再 show(anchor)。贴边翻转 / 位移钳制由组件内置的 positionAnchor(flip + shift) 负责，
 *   不再手写 measureFlip。
 * - 打开时先同步写入锚点坐标，再强制读一次 rect 触发排版，避免真实 WebView 下
 *   「样式未提交就测量」导致菜单错位到左上角。
 * - 方向键 / Enter 的项导航由 m3e-menu 原生负责；这里只兜「点击菜单外 / Esc / 滚动 / 缩放」关闭。
 *   不用 window contextmenu 监听，避免「刚打开又被同一事件关掉」的竞态
 *   （mousedown 已覆盖空白处右键关闭）。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { closeContextMenu, useContextMenu } from "@/composables/useContextMenu";

const menu = useContextMenu();
const menuRef = ref<HTMLElement | null>(null);
const anchorRef = ref<HTMLDivElement | null>(null);

/** m3e-menu 的打开 / 关闭方法 */
interface M3eMenu extends HTMLElement {
  show(trigger: HTMLElement): Promise<void>;
  hide(restoreFocus?: boolean): void;
}

/** 打开菜单：把锚点贴到光标坐标，剩余定位交给 m3e-menu */
async function openAt() {
  const anchor = anchorRef.value;
  const el = menuRef.value as M3eMenu | null;
  if (!anchor || !el) return;
  // 同步写入坐标（不依赖 watch+nextTick 的二次渲染），再强制读 rect 触发排版，
  // 保证随后 show() 量到的是最新位置
  anchor.style.left = `${menu.x}px`;
  anchor.style.top = `${menu.y}px`;
  await nextTick();
  anchor.getBoundingClientRect();
  await el.show(anchor);
}

function closeMenu() {
  (menuRef.value as M3eMenu | null)?.hide();
}

watch(
  () => menu.visible,
  (v) => {
    if (v) void openAt();
    else closeMenu();
  },
);

function select(id: string) {
  const cb = menu.onSelect;
  closeContextMenu();
  cb?.(id);
}

function onKeydown(e: KeyboardEvent) {
  if (!menu.visible) return;
  // 方向键 / Enter 的项导航由 m3e-menu 原生负责，这里只兜 Esc
  if (e.key === "Escape") closeContextMenu();
}

function onGlobalMousedown(e: MouseEvent) {
  if (!menu.visible) return;
  // 菜单内部点击交给 item 的 click 处理；菜单外（含空白处右键）都关闭
  if (!menuRef.value?.contains(e.target as Node)) closeContextMenu();
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
    <!-- 0×0 锚点：仅用于把 m3e-menu 定位到光标坐标 -->
    <div ref="anchorRef" class="ctx-anchor"></div>

    <m3e-menu ref="menuRef" class="ctx-menu">
      <m3e-menu-item
        v-for="item in menu.items"
        :key="item.id"
        class="ctx-item"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        @click="select(item.id)"
      >
        <span v-if="item.icon" slot="icon" class="material-symbols-outlined ctx-icon">{{
          item.icon
        }}</span>
        {{ item.label }}
      </m3e-menu-item>
    </m3e-menu>
  </Teleport>
</template>

<style scoped>
.ctx-anchor {
  position: fixed;
  width: 0;
  height: 0;
  pointer-events: none;
}
.ctx-menu {
  --m3e-menu-container-min-width: 188px;
}
.ctx-item.danger {
  --m3e-menu-item-color: var(--md-sys-color-error);
}
.ctx-icon {
  font-size: 20px;
}
</style>
