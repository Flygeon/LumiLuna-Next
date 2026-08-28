<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import MediaViewer from "@/components/MediaViewer.vue";
import AnimeOnlineView from "@/components/AnimeOnlineView.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import type { FfmpegStatus, MediaEntry } from "@shared/types";

const library = useLibraryStore();
const settings = useSettingsStore();
const router = useRouter();

const items = computed(() => library.entries("video"));
const hasScanDirs = computed(() => settings.scanDirs.length > 0);
const ffmpeg = ref<FfmpegStatus | null>(null);
const bannerDismissed = ref(false);
/** 详情查看器当前索引；-1 表示未打开 */
const viewerIndex = ref(-1);
/** 本地 / 动漫 分段（在线番剧开关开启时显示） */
const videosTab = ref<"local" | "anime">("local");

function t(key: string) {
  return translate(settings.lang, key);
}

function load() {
  return library.refresh("video");
}

onMounted(async () => {
  await load();
  // 缩略图与时长都依赖 ffmpeg，缺失时给出明确指引
  ffmpeg.value = await capabilities.ffmpegStatus();
});

onActivated(() => {
  if (!items.value.length) void load();
});

function openViewer(_item: MediaEntry, index: number) {
  viewerIndex.value = index;
}

function clearSearch() {
  library.search = "";
  void load();
}
</script>

<template>
  <div class="view">
    <PageHeader :title="t('nav.videos')" :description="t('navDesc.videos')" />

    <!-- 本地 / 动漫 分段 -->
    <div v-if="settings.onlineAnimeEnabled" class="video-tabs">
      <button
        class="seg"
        :class="{ active: videosTab === 'local' }"
        @click="videosTab = 'local'"
      >{{ t("videos.local") }}</button>
      <button
        class="seg"
        :class="{ active: videosTab === 'anime' }"
        @click="videosTab = 'anime'"
      >{{ t("videos.online") }}</button>
    </div>

    <!-- 本地视频 -->
    <template v-if="videosTab === 'local' || !settings.onlineAnimeEnabled">
      <LibraryToolbar :count="items.length" @changed="load" />

      <div
        v-if="ffmpeg && !ffmpeg.available && !bannerDismissed"
        class="ffmpeg-banner"
      >
        <span class="material-symbols-outlined">info</span>
        <div class="text">
          <strong>未检测到 FFmpeg</strong>
          <span>视频缩略图、时长与分辨率需要 FFmpeg 支持。可在设置中指定其安装目录。</span>
        </div>
        <button class="lm-btn lm-btn--text" @click="router.push('/settings')">
          前往设置
        </button>
        <button class="lm-icon-btn" @click="bannerDismissed = true">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <MediaGrid
        v-if="library.loading || items.length"
        :items="items"
        :loading="library.loading"
        aspect="16/9"
        :min-width="260"
        subtitle="resolution"
        @open="openViewer"
        @favorite="library.toggleFavorite"
      />

      <EmptyState
        v-else-if="library.search"
        icon="search_off"
        :title="`未找到与「${library.search}」匹配的视频`"
        description="试试其它关键词，或清除搜索条件。"
        action-label="清除搜索"
        @action="clearSearch"
      />

      <EmptyState
        v-else
        icon="movie"
        :title="t('library.empty')"
        :description="
          hasScanDirs
            ? '已配置扫描目录，点击开始扫描以建立视频索引。'
            : '尚未配置扫描目录。请先在设置中添加要索引的文件夹。'
        "
        :action-label="hasScanDirs ? t('actions.scan') : ''"
        secondary-label="前往设置"
        @action="library.startScan()"
        @secondary="router.push('/settings')"
      />
    </template>

    <!-- 在线番剧 -->
    <AnimeOnlineView v-else-if="settings.onlineAnimeEnabled && videosTab === 'anime'" />

    <MediaViewer
      v-if="viewerIndex >= 0"
      :items="items"
      :index="viewerIndex"
      @update:index="viewerIndex = $event"
      @close="viewerIndex = -1"
      @favorite="library.toggleFavorite"
    />
  </div>
</template>

<style scoped>
.view {
  min-height: 100%;
}
.video-tabs {
  display: flex;
  gap: 4px;
  width: fit-content;
  padding: 3px;
  margin-bottom: 16px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
}
.video-tabs .seg {
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
.video-tabs .seg.active {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--md-elevation-1);
}
</style>
