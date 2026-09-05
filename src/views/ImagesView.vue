<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import MediaViewer from "@/components/MediaViewer.vue";
import PixivOnlineView from "@/components/PixivOnlineView.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

const library = useLibraryStore();
const settings = useSettingsStore();
const router = useRouter();

const items = computed(() => library.entries("image"));
const hasScanDirs = computed(() => settings.scanDirs.length > 0);
/** 详情查看器当前索引；-1 表示未打开 */
const viewerIndex = ref(-1);
/** 本地 / Pixiv 分段（在线图片开关开启时显示） */
const imagesTab = ref<"local" | "pixiv">("local");

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

function openViewer(_item: unknown, index: number) {
  viewerIndex.value = index;
}

function clearSearch() {
  library.search = "";
  void load();
}
</script>

<template>
  <div class="view">
    <PageHeader :title="t('nav.images')" :description="t('navDesc.images')" />

    <!-- 本地 / Pixiv 分段 -->
    <div v-if="settings.onlinePixivEnabled" class="image-tabs">
      <button
        class="seg"
        :class="{ active: imagesTab === 'local' }"
        @click="imagesTab = 'local'"
      >{{ t("pixiv.local") }}</button>
      <button
        class="seg"
        :class="{ active: imagesTab === 'pixiv' }"
        @click="imagesTab = 'pixiv'"
      >{{ t("pixiv.online") }}</button>
    </div>

    <!-- 本地图片 -->
    <template v-if="imagesTab === 'local' || !settings.onlinePixivEnabled">
      <LibraryToolbar :count="items.length" @changed="load" />

      <MediaGrid
        v-if="library.loading || items.length"
        :items="items"
        :loading="library.loading"
        aspect="1"
        :min-width="180"
        subtitle="resolution"
        @open="openViewer"
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

      <MediaViewer
        v-if="viewerIndex >= 0"
        :items="items"
        :index="viewerIndex"
        @update:index="viewerIndex = $event"
        @close="viewerIndex = -1"
        @favorite="library.toggleFavorite"
      />
    </template>

    <!-- 在线 Pixiv -->
    <PixivOnlineView v-else-if="settings.onlinePixivEnabled && imagesTab === 'pixiv'" />
  </div>
</template>

<style scoped>
.view {
  min-height: 100%;
}
.image-tabs {
  display: flex;
  gap: 4px;
  width: fit-content;
  padding: 3px;
  margin-bottom: 16px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
}
.image-tabs .seg {
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
.image-tabs .seg.active {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--md-elevation-1);
}
</style>
