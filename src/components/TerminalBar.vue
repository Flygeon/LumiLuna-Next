<script setup lang="ts">
/**
 * 终端布局顶部命令条：侧栏被隐藏后唯一的常驻导航
 * （回主页 + 当前位置 + 该模块的实时计数）。
 */
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

defineProps<{
  /** 当前页面标题（App.vue 按路由解析） */
  title: string;
  /** 当前模块的媒体计数；null = 该页无计数 */
  count?: number | null;
}>();

const settings = useSettingsStore();
const router = useRouter();

function t(key: string) {
  return translate(settings.lang, key);
}
</script>

<template>
  <div class="term-bar">
    <button type="button" class="term-bar-home" @click="router.push('/home')">
      <span class="material-symbols-outlined">arrow_back</span>
      <span class="term-bar-home-label">{{ t("terminal.backHome") }}</span>
    </button>
    <span class="term-bar-sep" aria-hidden="true"></span>
    <span class="term-bar-title">{{ title }}</span>
    <span v-if="count !== null && count !== undefined" class="term-bar-count tabular-nums">
      {{ count }}
    </span>
  </div>
</template>

<style scoped>
.term-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--ak-space-3, 12px);
  min-height: 52px;
  padding: 0 var(--lm-content-pad, 24px);
  border-bottom: var(--ak-line-hairline, 1px) solid var(--md-sys-color-outline-variant);
}
.term-bar-home {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 var(--ak-space-3, 12px);
  border: 0;
  background: transparent;
  color: var(--ak-text-secondary, var(--md-sys-color-on-surface-variant));
  font: inherit;
  cursor: pointer;
  transition: color var(--ak-motion-fast, 120ms)
    var(--ak-ease-standard, cubic-bezier(0.2, 0, 0, 1));
}
.term-bar-home:hover {
  color: var(--ak-text-primary, var(--md-sys-color-on-surface));
}
.term-bar-home:focus-visible {
  outline: var(--ak-focus-width, 3px) solid var(--ak-focus-color, var(--md-sys-color-primary));
  outline-offset: var(--ak-focus-offset, 3px);
}
.term-bar-home .material-symbols-outlined {
  font-size: 18px;
}
.term-bar-home-label {
  font-size: var(--md-sys-typescale-label-large-size);
  letter-spacing: var(--ak-type-wide, 0.12em);
}
.term-bar-sep {
  width: var(--ak-line-strong, 4px);
  height: 16px;
  background: var(--ak-signal-action, var(--md-sys-color-tertiary));
}
.term-bar-title {
  font-size: var(--md-sys-typescale-title-small-size);
  font-weight: 700;
  color: var(--ak-text-primary, var(--md-sys-color-on-surface));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.term-bar-count {
  margin-left: auto;
  font-family: var(--ak-font-mono, ui-monospace, Consolas, monospace);
  font-size: 15px;
  color: var(--ak-text-secondary, var(--md-sys-color-on-surface-variant));
}
</style>
