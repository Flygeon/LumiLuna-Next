<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import MediaViewer from "@/components/MediaViewer.vue";
import AnimeOnlineView from "@/components/AnimeOnlineView.vue";
import SegmentedTabs from "@/components/SegmentedTabs.vue";
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
/** 在线番剧未启用时不传 tab，组件会只渲染内容、不显示分段条 */
const videoTabs = computed(() => [
  { value: "local", label: t("videos.local"), icon: "movie" },
  { value: "anime", label: t("videos.online"), icon: "public" },
]);

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
  // 用户可能刚从「设置」页改完 ffmpeg 路径回来；强制刷新一次避免横幅残留
  void capabilities.ffmpegStatus().then((s) => {
    ffmpeg.value = s;
  });
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
    <SegmentedTabs v-model="videosTab" :tabs="settings.onlineAnimeEnabled ? videoTabs : []">
      <!-- 本地视频 -->
      <template v-if="videosTab === 'local' || !settings.onlineAnimeEnabled">
        <LibraryToolbar :count="items.length" @changed="load" />

        <div v-if="ffmpeg && !ffmpeg.available && !bannerDismissed" class="ffmpeg-banner">
          <span class="material-symbols-outlined">info</span>
          <div class="text">
            <strong>未检测到 FFmpeg</strong>
            <span>视频缩略图、时长与分辨率需要 FFmpeg 支持。可在设置中指定其安装目录。</span>
          </div>
          <m3e-button variant="text" @click="router.push('/settings')">前往设置</m3e-button>
          <m3e-icon-button @click="bannerDismissed = true">
            <span class="material-symbols-outlined">close</span>
          </m3e-icon-button>
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

      <!-- 在线番剧：用 KeepAlive 缓存实例。
           此前切到「本地」再切回「动漫」会整棵重建：重放全部卡片入场动画 +
           重新解码封面图 + 重跑 loadRules/loadHistory，观感就是"刷新卡卡的"。 -->
      <KeepAlive v-else>
        <AnimeOnlineView />
      </KeepAlive>
    </SegmentedTabs>

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
</style>
