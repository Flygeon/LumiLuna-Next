<script setup lang="ts">
/**
 * 窗口控制按钮（最小化 / 最大化 / 关闭）。
 *
 * 迁移到 @m3e/web 的 m3e-icon-button：矩形（shape=square）铺满标题栏高度，
 * 普通 hover 用半透明 state-layer，关闭按钮 hover 保持 Windows 经典红色（#e81123），
 * 全部通过 m3e 暴露的 CSS 令牌定制，不再手画 SVG。
 */
defineProps<{
  isMaximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
}>();
</script>

<template>
  <div class="window-controls">
    <m3e-icon-button
      class="wc-btn"
      variant="standard"
      shape="square"
      title="最小化"
      aria-label="最小化"
      @click="minimize"
    >
      <span class="material-symbols-outlined wc-icon">remove</span>
    </m3e-icon-button>
    <m3e-icon-button
      class="wc-btn"
      variant="standard"
      shape="square"
      :title="isMaximized ? '还原' : '最大化'"
      :aria-label="isMaximized ? '还原' : '最大化'"
      @click="toggleMaximize"
    >
      <span v-if="isMaximized" class="material-symbols-outlined wc-icon">filter_none</span>
      <span v-else class="material-symbols-outlined wc-icon">crop_square</span>
    </m3e-icon-button>
    <m3e-icon-button
      class="wc-btn wc-close"
      variant="standard"
      shape="square"
      title="关闭"
      aria-label="关闭"
      @click="close"
    >
      <span class="material-symbols-outlined wc-icon">close</span>
    </m3e-icon-button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  align-items: center;
  height: 100%;
}

/* 矩形铺满标题栏高度（44 x 48），去除默认圆形 state-layer 圆角 */
.wc-btn {
  --m3e-icon-button-shape-square: 0;
  --m3e-icon-button-container-height: 48px;
  --m3e-icon-button-container-width: 44px;
  /* 图标尺寸走组件令牌：shadow DOM ::slotted(*){font-size:inherit !important} 会覆盖外部 font-size */
  --m3e-icon-button-icon-size: 18px;
  width: 44px;
  height: 48px;
  --m3e-icon-button-icon-color: var(--md-sys-color-on-surface-variant);
  --m3e-icon-button-hover-icon-color: var(--md-sys-color-on-surface);
  --m3e-icon-button-hover-state-layer-color: rgba(0, 0, 0, 0.06);
  --m3e-icon-button-pressed-state-layer-color: rgba(0, 0, 0, 0.1);
}
[data-theme="dark"] .wc-btn {
  --m3e-icon-button-hover-state-layer-color: rgba(255, 255, 255, 0.08);
  --m3e-icon-button-pressed-state-layer-color: rgba(255, 255, 255, 0.12);
}

/* 关闭按钮：Windows 经典红 hover */
.wc-close {
  --m3e-icon-button-hover-icon-color: #fff;
  --m3e-icon-button-hover-state-layer-color: #e81123;
  --m3e-icon-button-pressed-state-layer-color: #c50f1f;
}

.wc-icon {
  line-height: 1;
}
</style>
