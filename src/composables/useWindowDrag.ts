/**
 * Windows 样式标题栏窗口拖拽 composable
 * 移植自参考项目 use-window-controls.ts
 *
 * - 指针拖拽窗口（screen 坐标，rAF 节流）
 * - 双击标题栏最大化/还原（300ms 判定）
 * - 4px 拖拽阈值避免点击抖动
 * - 非 Tauri / 浏览器预览全部空操作
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";

const DOUBLE_CLICK_MS = 300;
const DRAG_THRESHOLD_PX = 4;

export function useWindowDrag() {
  const isMaximized = ref(false);

  let appWindow: ReturnType<typeof getCurrentWindow> | null = null;
  try {
    appWindow = getCurrentWindow();
  } catch {
    /* 浏览器预览无 Tauri 运行时 */
  }

  let unlistenResized: (() => void) | null = null;

  let drag: {
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    startWindowX: number;
    startWindowY: number;
    pending: { x: number; y: number } | null;
    frameScheduled: boolean;
    moved: boolean;
  } | null = null;

  let lastPressAt = 0;

  onMounted(async () => {
    if (!appWindow) return;
    try {
      isMaximized.value = await appWindow.isMaximized();
      unlistenResized = await appWindow.onResized(() => {
        void appWindow!.isMaximized().then((m) => (isMaximized.value = m));
      });
    } catch {
      /* 忽略 */
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });

  onBeforeUnmount(() => {
    if (unlistenResized) {
      unlistenResized();
      unlistenResized = null;
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  });

  function minimize() {
    if (!appWindow) return;
    void appWindow.minimize().catch(() => {});
  }

  function toggleMaximize() {
    if (!appWindow) return;
    void (async () => {
      try {
        await appWindow!.toggleMaximize();
        isMaximized.value = await appWindow!.isMaximized();
      } catch {
        /* 忽略 */
      }
    })();
  }

  function close() {
    if (!appWindow) return;
    void appWindow.close().catch(() => {});
  }

  function startDrag(event: PointerEvent) {
    if (!appWindow || event.button !== 0) return;
    // 仅鼠标拖拽，触屏不处理
    if (event.pointerType !== "mouse") return;

    const now = Date.now();
    if (now - lastPressAt < DOUBLE_CLICK_MS) {
      // 双击
      lastPressAt = 0;
      drag = null;
      toggleMaximize();
      return;
    }
    lastPressAt = now;

    if (drag) return;
    event.preventDefault();

    void (async () => {
      try {
        const pos = await appWindow!.outerPosition();
        drag = {
          pointerId: event.pointerId,
          startScreenX: event.screenX,
          startScreenY: event.screenY,
          startWindowX: pos.x,
          startWindowY: pos.y,
          pending: null,
          frameScheduled: false,
          moved: false,
        };
        const el = event.currentTarget as HTMLElement;
        el.setPointerCapture?.(event.pointerId);
      } catch {
        /* 浏览器预览 */
      }
    })();
  }

  function onPointerMove(event: PointerEvent) {
    if (!appWindow || !drag || event.pointerId !== drag.pointerId) return;
    const dx = event.screenX - drag.startScreenX;
    const dy = event.screenY - drag.startScreenY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    drag.pending = {
      x: drag.startWindowX + dx,
      y: drag.startWindowY + dy,
    };
    if (!drag.frameScheduled) {
      drag.frameScheduled = true;
      requestAnimationFrame(() => {
        if (drag) drag.frameScheduled = false;
        flushPending();
      });
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (!appWindow || !drag || event.pointerId !== drag.pointerId) return;
    if (drag.pending) {
      const { x, y } = drag.pending;
      drag.pending = null;
      void appWindow
        .setPosition(new PhysicalPosition(x, y))
        .catch(() => {});
    }
    drag = null;
  }

  function flushPending() {
    if (!appWindow || !drag?.pending) return;
    const { x, y } = drag.pending;
    drag.pending = null;
    void appWindow
      .setPosition(new PhysicalPosition(x, y))
      .catch(() => {});
  }

  return { isMaximized, minimize, toggleMaximize, close, startDrag };
}