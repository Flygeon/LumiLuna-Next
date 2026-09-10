/**
 * 卡片 → 详情页的 hero 飞行过渡。
 *
 * 参考 Kazumi（Flutter）Hero 动画的实现语义：路由切换时在 overlay 层放一个
 * 源封面的克隆，把它从源位置/尺寸补间到目标位置/尺寸，飞行期间隐藏两端
 * 原元素防止重影。
 *
 * 上一版直接对详情页封面做 FLIP（在目标元素上 animate），受详情页入场
 * 动画（lm-rise）与挂载测量时序影响实际不生效；本版改为独立的 fixed
 * 克隆层，完全不依赖目标容器的布局与动画状态——只要能量到目标 rect
 * 就能飞，量不到就静默取消，绝不留残影。
 */

export interface HeroFlight {
  /** 降落到目标元素；目标不可测（未挂载/零尺寸）时自动取消并返回 false */
  land(destEl: HTMLElement | null | undefined): boolean;
  /** 主动取消飞行，恢复现场 */
  cancel(): void;
}

/** 飞行时长与缓动：对齐 MD3 emphasized decelerate（与页面入场动画同族） */
const HERO_DURATION_MS = 420;
const HERO_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";

/**
 * 从源封面元素起飞：克隆一个 fixed 飞行层挂到 body 上并隐藏源元素。
 * 源元素不可用时返回 null（调用方按无动画处理）。
 */
export function startHeroFlight(srcEl: HTMLElement | null | undefined): HeroFlight | null {
  if (!srcEl?.isConnected) return null;
  const from = srcEl.getBoundingClientRect();
  if (!from.width || !from.height) return null;

  const clone = srcEl.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  // 克隆层：脱离文档流钉在源 rect 上；清掉继承的过渡/动画/变换，
  // 保证起点状态干净（卡片 hover 的 scale 等不会带进飞行层）
  clone.style.cssText += [
    "position:fixed",
    `left:${from.left}px`,
    `top:${from.top}px`,
    `width:${from.width}px`,
    `height:${from.height}px`,
    "margin:0",
    "z-index:4000",
    "pointer-events:none",
    "transition:none",
    "animation:none",
    "transform:none",
    "transform-origin:top left",
    "visibility:visible",
    "opacity:1",
    "box-shadow:var(--md-elevation-3), inset 0 0 0 1px var(--lm-hairline)",
  ].join(";");
  document.body.appendChild(clone);
  srcEl.style.visibility = "hidden";

  let settled = false;
  let destEl: HTMLElement | null = null;
  const restore = () => {
    if (settled) return;
    settled = true;
    clone.remove();
    srcEl.style.visibility = "";
    if (destEl) destEl.style.visibility = "";
  };

  return {
    land(dest) {
      if (settled) return false;
      if (!dest?.isConnected) {
        restore();
        return false;
      }
      const to = dest.getBoundingClientRect();
      if (!to.width || !to.height) {
        restore();
        return false;
      }
      destEl = dest;
      dest.style.visibility = "hidden";
      // transform 补间（合成层动画）：平移 + 按宽高比缩放。
      // 卡片与详情页封面同为 3:4，等比缩放不产生形变。
      const dx = to.left - from.left;
      const dy = to.top - from.top;
      const sx = to.width / from.width;
      const sy = to.height / from.height;
      const anim = clone.animate(
        [
          { transform: "translate(0px, 0px) scale(1, 1)" },
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        ],
        { duration: HERO_DURATION_MS, easing: HERO_EASING, fill: "forwards" },
      );
      anim.onfinish = restore;
      anim.oncancel = restore;
      return true;
    },
    cancel: restore,
  };
}

/**
 * 等详情页完成挂载与首帧布局后再降落。
 * nextTick 由调用方保证（视图已切换），这里再让出两帧：
 * 第一帧完成样式计算，第二帧拿到稳定 rect。
 */
export function landHeroFlight(
  flight: HeroFlight | null,
  getDest: () => HTMLElement | null | undefined,
): void {
  if (!flight) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!flight.land(getDest())) flight.cancel();
    }),
  );
}
