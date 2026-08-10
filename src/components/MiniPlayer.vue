<script setup lang="ts">
import { usePlayerStore } from "@/stores/player";
import { useRouter } from "vue-router";
import { translate } from "@shared/i18n";
import { useSettingsStore } from "@/stores/settings";

const player = usePlayerStore();
const router = useRouter();
const settings = useSettingsStore();

function t(key: string) {
  return translate(settings.lang, key);
}
</script>

<template>
  <div class="mini-player" @click="router.push('/music/player')">
    <div class="cover" v-if="player.song?.coverBase64">
      <img :src="player.song.coverBase64" alt="" />
    </div>
    <div class="cover default" v-else>🎵</div>
    <div class="info">
      <div class="title">{{ player.song?.meta.title || "—" }}</div>
      <div class="artist">{{ player.song?.meta.artist || "" }}</div>
    </div>
    <div class="progress-track">
      <div
        class="progress-fill"
        :style="{ width: (player.duration ? (player.currentTime / player.duration) * 100 : 0) + '%' }"
      ></div>
    </div>
    <button class="ctrl" @click.stop="player.togglePlay()">
      {{ player.playing ? "⏸" : "▶" }}
    </button>
  </div>
</template>

<style scoped>
.mini-player {
  position: fixed;
  bottom: 0;
  left: 80px;
  right: 0;
  height: 64px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: var(--md-sys-color-surface-container-high);
  border-top: 1px solid var(--md-sys-color-outline);
  z-index: 50;
  cursor: pointer;
}
.cover {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--md-sys-color-surface-variant);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.info {
  flex: 1;
  min-width: 0;
}
.title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
.progress-track {
  width: 120px;
  height: 3px;
  background: var(--md-sys-color-outline);
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--md-sys-color-primary);
  border-radius: 4px;
}
.ctrl {
  border: none;
  background: transparent;
  font-size: 22px;
  cursor: pointer;
  color: var(--md-sys-color-on-surface);
}
</style>
