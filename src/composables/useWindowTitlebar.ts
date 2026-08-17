/**
 * 自定义窗口顶栏（沉浸式标题栏）：
 * - 在 Tauri 桌面端隐藏系统标题栏后，提供拖拽移动、最小化、最大化/还原、关闭。
 * - 纯 Web 预览（非 Tauri）下自动降级为无操作。
 */
import { onBeforeUnmount, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/capabilities";

export function useWindowTitlebar() {
  const win = isTauri ? getCurrentWindow() : null;
  const isMaximized = ref(false);
  let unlistenResize: (() => void) | null = null;

  async function refreshMaximized() {
    if (!win) return;
    try {
      isMaximized.value = await win.isMaximized();
    } catch {
      /* 忽略状态刷新失败 */
    }
  }

  /** 标题栏空白区域拖拽窗口；点击按钮/链接/输入框时不触发拖拽 */
  function onDragStart(e: MouseEvent) {
    if (!win || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [data-no-drag]")) {
      return;
    }
    void win.startDragging().catch(() => {});
  }

  async function minimize() {
    try {
      await win?.minimize();
    } catch {
      /* 非 Tauri 或无权限时忽略 */
    }
  }

  async function toggleMaximize() {
    if (!win) return;
    try {
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
      await refreshMaximized();
    } catch {
      /* 忽略窗口状态操作失败 */
    }
  }

  async function closeWindow() {
    try {
      await win?.close();
    } catch {
      /* 忽略关闭失败 */
    }
  }

  if (win) {
    void refreshMaximized();
    win
      .onResized(() => refreshMaximized())
      .then((unlisten) => {
        unlistenResize = unlisten;
      })
      .catch(() => {});
  }

  onBeforeUnmount(() => {
    unlistenResize?.();
    unlistenResize = null;
  });

  return {
    isTauri,
    isMaximized,
    onDragStart,
    minimize,
    toggleMaximize,
    closeWindow,
  };
}