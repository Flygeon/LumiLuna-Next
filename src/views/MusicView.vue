<script setup lang="ts">
import { computed, onActivated, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { formatDuration } from "@/utils/format";
import { translate } from "@shared/i18n";
import type { MediaEntry } from "@shared/types";

const library = useLibraryStore();
const player = usePlayerStore();
const settings = useSettingsStore();
const router = useRouter();

const items = computed(() => library.entries("audio"));
const hasScanDirs = computed(() => settings.scanDirs.length > 0);

function t(key: string) {
  return translate(settings.lang, key);
}

function load() {
  return library.refresh("audio");
}

// 列表模式没有 MediaGrid 的可视区观察，统一在数据到位后拉取封面
watch(
  items,
  (list) => {
    if (settings.musicLayout === "list" && list.length) {
      void library.loadThumbnails(list.slice(0, 200).map((i) => i.id));
    }
  },
  { immediate: true },
);

onMounted(load);
onActivated(() => {
  if (!items.value.length) void load();
});

/** 单击即播放：整张列表入队，跳转全屏播放器 */
async function play(item: MediaEntry, index: number) {
  player.setQueue(items.value, index);
  await player.loadById(item.id);
  router.push("/music/player");
}

function clearSearch() {
  library.search = "";
  void load();
}

function isCurrent(item: MediaEntry) {
  return player.song?.file.id === item.id;
}
</script>

<template>
  <div class="view">
    <LibraryToolbar :count="items.length" @changed="load" />

    <div v-if="settings.musicLayout === 'grid'">
      <MediaGrid
        v-if="library.loading || items.length"
        :items="items"
        :loading="library.loading"
        aspect="1"
        :min-width="170"
        subtitle="artist"
        @open="play"
        @favorite="library.toggleFavorite"
      />
    </div>

    <div v-else-if="items.length" class="track-list">
      <div class="head">
        <span class="col-index">#</span>
        <span class="col-title">标题</span>
        <span class="col-album">专辑</span>
        <span class="col-time">时长</span>
        <span class="col-fav"></span>
      </div>

      <div
        v-for="(item, i) in items"
        :key="item.id"
        class="row"
        :class="{ current: isCurrent(item) }"
        :style="{ animationDelay: `${Math.min(i, 20) * 20}ms` }"
        tabindex="0"
        @click="play(item, i)"
        @keydown.enter="play(item, i)"
      >
        <span class="col-index tabular-nums">
          <span v-if="!isCurrent(item)">{{ i + 1 }}</span>
          <span v-else class="material-symbols-outlined playing-icon">
            {{ player.playing ? "equalizer" : "pause" }}
          </span>
        </span>

        <span class="col-title">
          <span class="cover">
            <img
              v-if="library.getThumb(item.id)"
              :src="library.getThumb(item.id)"
              alt=""
              loading="lazy"
            />
            <span v-else class="material-symbols-outlined">music_note</span>
          </span>
          <span class="names">
            <span class="name">{{ item.title || item.name }}</span>
            <span class="artist">{{ item.artist || "未知艺术家" }}</span>
          </span>
        </span>

        <span class="col-album">{{ item.album || "—" }}</span>
        <span class="col-time tabular-nums">{{ formatDuration(item.durationMs) || "—" }}</span>
        <span class="col-fav">
          <button
            class="lm-icon-btn fav"
            :class="{ on: item.favorite }"
            @click.stop="library.toggleFavorite(item)"
          >
            <span
              class="material-symbols-outlined"
              :class="{ filled: item.favorite }"
            >favorite</span>
          </button>
        </span>
      </div>
    </div>

    <div v-else-if="library.loading" class="track-list">
      <div v-for="n in 10" :key="n" class="row skeleton">
        <span class="lm-skeleton bar"></span>
      </div>
    </div>

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

.track-list {
  display: flex;
  flex-direction: column;
}

.head {
  display: grid;
  grid-template-columns: 44px minmax(0, 2.4fr) minmax(0, 1.6fr) 76px 48px;
  align-items: center;
  gap: 12px;
  padding: 0 12px 8px;
  font-size: var(--md-sys-typescale-label-small-size);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--md-sys-color-on-surface-variant);
  border-bottom: 1px solid var(--lm-hairline);
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--md-sys-color-background);
}

.row {
  display: grid;
  grid-template-columns: 44px minmax(0, 2.4fr) minmax(0, 1.6fr) 76px 48px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--md-sys-shape-corner-medium);
  cursor: pointer;
  outline: none;
  animation: lm-rise 320ms var(--md-sys-motion-easing-emphasized-decelerate) both;
  transition: background var(--md-sys-motion-duration-short);
}
.row:hover {
  background: var(--md-sys-color-surface-container);
}
.row:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: -2px;
}
.row.current {
  background: var(--md-sys-color-secondary-container);
}
.row.current .name {
  color: var(--md-sys-color-on-secondary-container);
  font-weight: 600;
}

.col-index {
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.playing-icon {
  font-size: 18px;
  color: var(--md-sys-color-primary);
}

.col-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.cover {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: var(--md-sys-shape-corner-small);
  overflow: hidden;
  background: var(--md-sys-color-surface-container-high);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover .material-symbols-outlined {
  font-size: 20px;
  color: var(--md-sys-color-outline);
}
.names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-album,
.col-time {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.col-time {
  text-align: right;
}

.col-fav {
  display: flex;
  justify-content: center;
}
.fav {
  width: 34px;
  height: 34px;
  opacity: 0;
}
.row:hover .fav,
.row:focus-within .fav,
.fav.on {
  opacity: 1;
}
.fav.on {
  color: #ff6b81;
}
.fav .material-symbols-outlined {
  font-size: 19px;
}

.row.skeleton {
  pointer-events: none;
}
.row.skeleton .bar {
  grid-column: 1 / -1;
  height: 42px;
  border-radius: var(--md-sys-shape-corner-medium);
}

@media (max-width: 900px) {
  .head,
  .row {
    grid-template-columns: 36px minmax(0, 1fr) 68px 44px;
  }
  .col-album {
    display: none;
  }
}
</style>
