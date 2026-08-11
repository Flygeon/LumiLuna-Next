<script setup lang="ts">
import { computed, onActivated, onMounted } from "vue";
import { useRouter } from "vue-router";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import type { MediaEntry } from "@shared/types";

const library = useLibraryStore();
const settings = useSettingsStore();
const router = useRouter();

const items = computed(() => library.entries("image"));
const hasScanDirs = computed(() => settings.scanDirs.length > 0);

function t(key: string) {
  return translate(settings.lang, key);
}

function load() {
  return library.refresh("image");
}

onMounted(load);
// keep-alive 复活时补一次，扫描可能已在别处完成
onActivated(() => {
  if (!items.value.length) void load();
});

function open(item: MediaEntry) {
  void capabilities.openFile(item.path);
}

function clearSearch() {
  library.search = "";
  void load();
}
</script>

<template>
  <div class="view">
    <LibraryToolbar :count="items.length" @changed="load" />

    <MediaGrid
      v-if="library.loading || items.length"
      :items="items"
      :loading="library.loading"
      aspect="1"
      :min-width="180"
      subtitle="resolution"
      @open="open"
      @favorite="library.toggleFavorite"
    />

    <EmptyState
      v-else-if="library.search"
      icon="search_off"
      :title="`未找到与「${library.search}」匹配的图片`"
      description="试试其它关键词，或清除搜索条件。"
      action-label="清除搜索"
      @action="clearSearch"
    />

    <EmptyState
      v-else
      icon="image"
      :title="t('library.empty')"
      :description="
        hasScanDirs
          ? '已配置扫描目录，点击开始扫描以建立图片索引。'
          : '尚未配置扫描目录。请先在设置中添加要索引的文件夹。'
      "
      :action-label="hasScanDirs ? t('actions.scan') : ''"
      secondary-label="前往设置"
      @action="library.startScan()"
      @secondary="router.push('/settings')"
    />
  </div>
</template>

<style scoped>
.view {
  min-height: 100%;
}
</style>
