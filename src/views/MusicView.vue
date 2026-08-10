<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { useRouter } from "vue-router";
import { translate } from "@shared/i18n";
import type { Song } from "@shared/types";

const library = useLibraryStore();
const player = usePlayerStore();
const settings = useSettingsStore();
const router = useRouter();
const songs = ref<Song[]>([]);

function t(key: string) {
  return translate(settings.lang, key);
}

async function loadSongs() {
  await library.refresh("audio");
  const list: Song[] = [];
  for (const f of library.files) {
    const meta = library.metaMap[f.id];
    list.push({ file: f, meta, coverBase64: null });
  }
  songs.value = list;
}

async function play(song: Song, index: number) {
  player.setIndex(index);
  await player.loadSong(song);
  router.push("/music/player");
}

function formatTime(ms: number) {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

onMounted(loadSongs);
</script>

<template>
  <div class="music-view">
    <div class="toolbar">
      <button class="scan-btn" @click="library.startScan()">
        {{ library.scanning ? t("library.scanning") : t("actions.scan") }}
      </button>
    </div>

    <div v-if="!songs.length" class="empty">
      <div class="empty-icon">🎵</div>
      <p>{{ t("library.empty") }}</p>
      <button class="scan-btn" @click="library.startScan()">{{ t("actions.scan") }}</button>
    </div>

    <div v-else class="song-table">
      <div class="table-header">
        <span class="c-idx">#</span>
        <span class="c-title">标题</span>
        <span class="c-artist">艺人</span>
        <span class="c-album">专辑</span>
        <span class="c-dur">时长</span>
      </div>
      <div
        v-for="(s, i) in songs"
        :key="s.file.id"
        class="song-row"
        @dblclick="play(s, i)"
      >
        <span class="c-idx">{{ i + 1 }}</span>
        <span class="c-title">{{ s.meta.title || s.file.path.split(/[\\/]/).pop() }}</span>
        <span class="c-artist">{{ s.meta.artist || "—" }}</span>
        <span class="c-album">{{ s.meta.album || "—" }}</span>
        <span class="c-dur">{{ formatTime(s.meta.duration_ms || 0) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.music-view {
  height: 100%;
}
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
.empty .scan-btn {
  margin-top: 20px;
}
.song-table {
  display: flex;
  flex-direction: column;
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
}
.table-header,
.song-row {
  display: grid;
  grid-template-columns: 40px 2fr 1.5fr 1.5fr 70px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}
.table-header {
  font-weight: 600;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
}
.song-row {
  border-bottom: 1px solid var(--md-sys-color-outline);
  cursor: pointer;
  transition: background var(--md-sys-motion-duration-short);
}
.song-row:hover {
  background: var(--md-sys-color-surface-container-high);
}
.c-idx {
  color: var(--md-sys-color-on-surface-variant);
}
.c-title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.c-artist,
.c-album {
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
