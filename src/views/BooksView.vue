<script setup lang="ts">
import { onMounted } from "vue";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";

const library = useLibraryStore();
const settings = useSettingsStore();

function t(key: string) {
  return translate(settings.lang, key);
}

onMounted(() => library.refresh("book"));

function openFile(path: string) {
  capabilities.openFile(path);
}
</script>

<template>
  <div class="media-grid-view">
    <div class="toolbar">
      <button class="scan-btn" @click="library.startScan()">
        {{ library.scanning ? t("library.scanning") : t("actions.scan") }}
      </button>
    </div>
    <div v-if="!library.files.length" class="empty">
      <div class="empty-icon"><span class="material-symbols-outlined">library_books</span></div>
      <p>{{ t("library.empty") }}</p>
    </div>
    <div v-else class="grid">
      <div v-for="f in library.files" :key="f.id" class="cell" @click="openFile(f.path)">
        <div class="cover"><span class="material-symbols-outlined">menu_book</span></div>
        <div class="name">{{ f.path.split(/[\\/]/).pop() }}</div>
      </div>
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
.empty-icon .material-symbols-outlined {
  font-size: 60px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 20px;
}
.cell {
  cursor: pointer;
  transition: transform var(--md-sys-motion-duration-short);
}
.cell:hover {
  transform: translateY(-4px);
}
.cover {
  aspect-ratio: 3/4;
  border-radius: var(--md-sys-shape-corner-small);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--md-sys-color-surface-container-high);
}
.cover .material-symbols-outlined {
  font-size: 48px;
}
.name {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
