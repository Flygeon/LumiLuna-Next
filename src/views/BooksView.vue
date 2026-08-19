<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import BookReader from "@/components/BookReader.vue";
import NovelOnlineView from "@/components/NovelOnlineView.vue";
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
/** 正在阅读的书；null 表示未打开阅读器 */
const reading = ref<MediaEntry | null>(null);
/** 本地 / 在线 分段（在线开关开启时显示） */
const bookTab = ref<"local" | "online">("local");

/** 应用内可阅读的格式，其余仍交系统程序 */
const READABLE = ["epub", "pdf"];

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
  if (READABLE.includes(item.ext.toLowerCase())) {
    reading.value = item;
  } else {
    void capabilities.openFile(item.path);
  }
}

function clearSearch() {
  library.search = "";
  void load();
}
</script>

<template>
  <div class="view">
    <PageHeader :title="t('nav.books')" :description="t('navDesc.books')" />

    <!-- 本地 / 在线 分段 -->
    <div v-if="settings.onlineNovelEnabled" class="book-tabs">
      <button
        class="seg"
        :class="{ active: bookTab === 'local' }"
        @click="bookTab = 'local'"
      >{{ t("books.local") }}</button>
      <button
        class="seg"
        :class="{ active: bookTab === 'online' }"
        @click="bookTab = 'online'"
      >{{ t("books.online") }}</button>
    </div>

    <!-- 本地书籍 -->
    <template v-if="bookTab === 'local' || !settings.onlineNovelEnabled">
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
    </template>

    <!-- 在线小说 -->
    <NovelOnlineView v-else-if="settings.onlineNovelEnabled && bookTab === 'online'" />

    <BookReader
      v-if="reading"
      :item="reading"
      @close="reading = null"
    />
  </div>
</template>

<style scoped>
.view {
  min-height: 100%;
}
.book-tabs {
  display: flex;
  gap: 4px;
  width: fit-content;
  padding: 3px;
  margin-bottom: 16px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
}
.book-tabs .seg {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 18px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
}
.book-tabs .seg.active {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--md-elevation-1);
}
</style>
