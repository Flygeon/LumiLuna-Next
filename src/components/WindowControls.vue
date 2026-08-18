<script setup lang="ts">
defineProps<{
  isMaximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
}>();
</script>

<template>
  <div class="window-controls">
    <button
      class="wc-btn"
      title="最小化"
      aria-label="最小化"
      @click="minimize"
    >
      <span class="wc-icon minimize" />
    </button>
    <button
      class="wc-btn"
      :title="isMaximized ? '还原' : '最大化'"
      :aria-label="isMaximized ? '还原' : '最大化'"
      @click="toggleMaximize"
    >
      <span v-if="isMaximized" class="wc-icon restore" />
      <span v-else class="wc-icon maximize" />
    </button>
    <button
      class="wc-btn wc-close"
      title="关闭"
      aria-label="关闭"
      @click="close"
    >
      <span class="wc-icon close" />
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  align-items: center;
}

.wc-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 48px;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
  outline: none;
}
.wc-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--md-sys-color-on-surface);
}
.wc-btn:active {
  background: rgba(0, 0, 0, 0.1);
}
.wc-close:hover {
  background: #e81123;
  color: #fff;
}
.wc-close:active {
  background: #c50f1f;
  color: #fff;
}

[data-theme="dark"] .wc-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--md-sys-color-on-surface);
}
[data-theme="dark"] .wc-btn:active {
  background: rgba(255, 255, 255, 0.12);
}

.wc-icon {
  display: block;
  position: relative;
}
.wc-icon.minimize {
  width: 10px;
  height: 1px;
  background: currentColor;
}
.wc-icon.maximize {
  width: 10px;
  height: 10px;
  border: 1px solid currentColor;
}
.wc-icon.restore {
  position: relative;
  width: 10px;
  height: 10px;
}
.wc-icon.restore::before {
  content: '';
  position: absolute;
  top: -2px;
  left: 2px;
  width: 8px;
  height: 8px;
  border: 1px solid currentColor;
  background: inherit;
}
.wc-icon.restore::after {
  content: '';
  position: absolute;
  bottom: -2px;
  right: 2px;
  width: 8px;
  height: 8px;
  border: 1px solid currentColor;
  background: var(--md-sys-color-surface-container, #f2f3f5);
}
.wc-icon.close {
  width: 10px;
  height: 10px;
}
.wc-icon.close::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 10px;
  height: 1px;
  background: currentColor;
  transform: rotate(45deg);
}
.wc-icon.close::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 10px;
  height: 1px;
  background: currentColor;
  transform: rotate(-45deg);
}
</style>