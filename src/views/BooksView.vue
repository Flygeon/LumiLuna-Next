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

const items = computed(() => library.entries("book"));
const hasScanDirs = computed(() => settings.scanDirs.length > 0);

function t(key: string) {
  return translate(settings.lang, key);
}

function load() {
  return library.refresh("book");
}

onMounted(load);
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
      aspect="3/4"
      :min-width="150"
      subtitle="size"
      @open="open"
      @favorite="library.toggleFavorite"
    />

    <EmptyState
      v-else-if="library.search"
      icon="search_off"
      :title="`未找到与「${library.search}」匹配的书籍`"
      description="试试其它关键词，或清除搜索条件。"
      action-label="清除搜索"
      @action="clearSearch"
    />

    <EmptyState
      v-else
      icon="menu_book"
      :title="t('library.empty')"
      :description="
        hasScanDirs
          ? '已配置扫描目录，点击开始扫描以建立书籍索引。支持 EPUB / PDF / MOBI 等格式。'
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
