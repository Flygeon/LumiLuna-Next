<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";
import type { MediaEntry } from "@shared/types";

const library = useLibraryStore();
const player = usePlayerStore();
const settings = useSettingsStore();
const router = useRouter();

const items = computed(() => library.entries("audio"));
const hasScanDirs = computed(() => settings.scanDirs.length > 0);
const error = ref("");

function t(key: string) {
  return translate(settings.lang, key);
}

function load() {
  return library.refresh("audio");
}

onMounted(load);
onActivated(() => {
  if (!items.value.length) void load();
});

/** 单击卡片即播放：整张列表入队，跳转全屏播放器 */
async function play(item: MediaEntry, index: number) {
  error.value = "";
  player.setQueue(items.value, index);
  await player.loadById(item.id);
  if (player.lastError) {
    error.value = `无法播放「${item.title || item.name}」`;
    return;
  }
  router.push("/music/player");
}

function clearSearch() {
  library.search = "";
  void load();
}
</script>

<template>
  <div class="view">
    <LibraryToolbar :count="items.length" @changed="load" />

    <div v-if="error" class="error-bar">
      <span class="material-symbols-outlined">error</span>
      {{ error }}
      <button class="lm-icon-btn" @click="error = ''">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <MediaGrid
      v-if="library.loading || items.length"
      :items="items"
      :loading="library.loading"
      aspect="1"
      :min-width="180"
      subtitle="artist"
      @open="play"
      @favorite="library.toggleFavorite"
    />

    <EmptyState
      v-else-if="library.search"
      icon="search_off"
      :title="`未找到与「${library.search}」匹配的音乐`"
      description="试试其它关键词，或清除搜索条件。"
      action-label="清除搜索"
      @action="clearSearch"
    />

    <EmptyState
      v-else
      icon="music_note"
      :title="t('library.empty')"
      :description="
        hasScanDirs
          ? '已配置扫描目录，点击开始扫描以建立音乐索引。'
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
.error-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 14px;
  margin-bottom: 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font-size: var(--md-sys-typescale-body-small-size);
}
.error-bar > .material-symbols-outlined {
  font-size: 20px;
}
.error-bar .lm-icon-btn {
  margin-left: auto;
  width: 30px;
  height: 30px;
  color: inherit;
}
.error-bar .lm-icon-btn .material-symbols-outlined {
  font-size: 17px;
}
</style>
