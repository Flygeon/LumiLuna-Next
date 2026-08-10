<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { useRouter } from "vue-router";
import { capabilities } from "@/capabilities";
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
    const song: Song = { file: f, meta, coverBase64: null };
    try {
      const full = await capabilities.getSong(f.id);
      if (full.coverBase64) song.coverBase64 = full.coverBase64;
    } catch {}
    list.push(song);
  }
  songs.value = list;
}

async function play(song: Song, index: number) {
  player.setQueue(songs.value, index);
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
  <div class="media-grid-view">
    <div class="toolbar">
      <button class="scan-btn" @click="library.startScan()">
        {{ library.scanning ? t("library.scanning") : t("actions.scan") }}
      </button>
    </div>

    <div v-if="!songs.length" class="empty">
      <div class="empty-icon"><span class="material-symbols-outlined">music_note</span></div>
      <p>{{ t("library.empty") }}</p>
      <button class="scan-btn" @click="library.startScan()">{{ t("actions.scan") }}</button>
    </div>

    <div v-else class="grid">
      <div
        v-for="(s, i) in songs"
        :key="s.file.id"
        class="cell"
        @dblclick="play(s, i)"
      >
        <div class="thumb">
          <img v-if="s.coverBase64" :src="s.coverBase64" alt="" loading="lazy" />
          <span v-else class="placeholder"><span class="material-symbols-outlined">music_note</span></span>
        </div>
        <div class="info">
          <div class="title">{{ s.meta.title || s.file.path.split(/[\\/]/).pop() }}</div>
          <div class="artist">{{ s.meta.artist || "—" }}</div>
        </div>
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
.empty .scan-btn {
  margin-top: 20px;
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
  color: var(--md-sys-color-on-surface-variant);
}
.info {
  padding: 8px 10px;
}
.title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
