<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount } from "vue";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";

const library = useLibraryStore();
const settings = useSettingsStore();
const thumbs = ref<Record<string, string>>({});
let cancelled = false;

function t(key: string) {
  return translate(settings.lang, key);
}

onMounted(async () => {
  await library.refresh("image");
  // 使用缓存的缩略图
  for (const f of library.files) {
    if (library.thumbCache[f.id]) {
      thumbs.value[f.id] = library.thumbCache[f.id];
    }
  }
  // 异步增量加载未缓存的缩略图
  await library.loadThumbnails("image", (id, dataUrl) => {
    if (!cancelled) {
      thumbs.value = { ...thumbs.value, [id]: dataUrl };
    }
  });
});

onBeforeUnmount(() => {
  cancelled = true;
});

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
      <div class="empty-icon"><span class="material-symbols-outlined">image</span></div>
      <p>{{ t("library.empty") }}</p>
    </div>
    <div v-else class="grid">
      <div v-for="f in library.files" :key="f.id" class="cell" @click="openFile(f.path)">
        <div class="thumb">
          <img v-if="thumbs[f.id]" :src="thumbs[f.id]" alt="" loading="lazy" />
          <span v-else class="placeholder"><span class="material-symbols-outlined">image</span></span>
        </div>
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
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}
.cell {
  border-radius: var(--md-sys-shape-corner-medium);
  overflow: hidden;
  background: var(--md-sys-color-surface-container-low);
  cursor: pointer;
  transition: transform var(--md-sys-motion-duration-short);
}
.cell:hover {
  transform: scale(1.02);
}
.thumb {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--md-sys-color-surface-container-high);
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.placeholder .material-symbols-outlined {
  font-size: 48px;
}
.name {
  padding: 8px 10px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
