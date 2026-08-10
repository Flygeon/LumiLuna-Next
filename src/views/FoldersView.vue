<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";
import { useLibraryStore } from "@/stores/library";

const settings = useSettingsStore();
const library = useLibraryStore();

function t(key: string) {
  return translate(settings.lang, key);
}
</script>

<template>
  <div class="folders-view">
    <div class="toolbar">
      <button class="scan-btn" @click="library.startScan()">
        {{ t("actions.addDir") }}
      </button>
    </div>
    <div class="empty">
      <div class="empty-icon">📁</div>
      <p>{{ t("nav.folders") }} · 树形浏览本地目录</p>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  margin-bottom: 16px;
}
.scan-btn {
  padding: 8px 20px;
  border: none;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  border-radius: var(--md-sys-shape-corner-extra-large);
  cursor: pointer;
  font-weight: 600;
}
.empty {
  text-align: center;
  margin-top: 80px;
  color: var(--md-sys-color-on-surface-variant);
}
.empty-icon {
  font-size: 60px;
  margin-bottom: 16px;
}
</style>
