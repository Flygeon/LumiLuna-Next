/**
 * 长按手势指令 v-long-press —— 触屏替代右键菜单（Phase 1 移动端适配）。
 *
 * 为什么不直接依赖 WebView 的原生 contextmenu：
 * Chromium Android 虽然会在长按时派发 contextmenu，但在不可选中的元素上
 * 触发时机/是否派发随 WebView 版本而异，且会先弹出系统的文本选择/复制气泡，
 * 与应用内 M3 菜单重复。这里用显式定时器判定，行为在各机型上确定一致。
 *
 * 桌面完全 no-op：mounted 直接返回，右键路径与原先零差异。
 */
import type { Directive } from "vue";
import { isMobile } from "@/capabilities";

/** 长按判定时长（与 Android 系统长按手感一致） */
const LONG_PRESS_MS = 500;
/** 手指移动超过该像素判定为滚动，取消长按 */
const MOVE_TOLERANCE = 10;

export type LongPressHandler = (pos: { clientX: number; clientY: number }) => void;

interface LongPressCleanup {
  dispose: () => void;
}

const registry = new WeakMap<HTMLElement, LongPressCleanup>();

export const vLongPress: Directive<HTMLElement, LongPressHandler | undefined> = {
  mounted(el, binding) {
    // 桌面/浏览器预览不介入：保留原生右键
    if (!isMobile) return;

    let timer: number | null = null;
    let startX = 0;
    let startY = 0;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    /** 长按已触发菜单后，吞掉紧随的 click，避免同时打开详情/开始播放。
     *  挂到 document 捕获阶段——目标元素上的 @click 是冒泡阶段监听，
     *  document 捕获先于目标触发，能可靠拦下。 */
    const swallowNextClick = () => {
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      document.addEventListener("click", swallow, { capture: true, once: true });
      // 若这次长按后没有产生 click（部分机型如此），定时撤掉监听，
      // 否则会误吞用户下一次正常点击。
      window.setTimeout(
        () => document.removeEventListener("click", swallow, true),
        800,
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      // 鼠标（含移动端外接鼠标）仍走右键语义，不启用长按
      if (e.pointerType === "mouse") return;
      startX = e.clientX;
      startY = e.clientY;
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        swallowNextClick();
        binding.value?.({ clientX: startX, clientY: startY });
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (timer === null) return;
      if (
        Math.abs(e.clientX - startX) > MOVE_TOLERANCE ||
        Math.abs(e.clientY - startY) > MOVE_TOLERANCE
      ) {
        clearTimer(); // 判定为滚动列表，不弹菜单
      }
    };

    const onPointerEnd = () => clearTimer();

    /** 屏蔽 WebView 原生长按菜单（文本选择气泡 / 图片保存），避免与自定义菜单叠加 */
    const onNativeContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    el.addEventListener("pointerleave", onPointerEnd);
    el.addEventListener("contextmenu", onNativeContextMenu);
    // 供 theme.css 抑制原生长按高亮/选中（见 html.is-mobile [data-long-press]）
    el.dataset.longPress = "";

    registry.set(el, {
      dispose() {
        clearTimer();
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerup", onPointerEnd);
        el.removeEventListener("pointercancel", onPointerEnd);
        el.removeEventListener("pointerleave", onPointerEnd);
        el.removeEventListener("contextmenu", onNativeContextMenu);
      },
    });
  },
  unmounted(el) {
    registry.get(el)?.dispose();
    registry.delete(el);
  },
};
