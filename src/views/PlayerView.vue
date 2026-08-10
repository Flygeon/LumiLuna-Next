<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { useRouter } from "vue-router";
import { translate } from "@shared/i18n";
import FluidBackground from "@/components/FluidBackground.vue";
import LyricsView from "@/components/LyricsView.vue";

const player = usePlayerStore();
const settings = useSettingsStore();
const router = useRouter();
const audioRef = ref<HTMLAudioElement | null>(null);
const rightTab = ref<"lyrics" | "queue">("lyrics");
const speed = ref(1);
const isDragging = ref(false);

function t(key: string) {
  return translate(settings.lang, key);
}

function formatTime(s: number) {
  if (Number.isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

function onProgressClick(e: MouseEvent) {
  const bar = (e.currentTarget as HTMLElement);
  const rect = bar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  player.seek(pct * player.duration);
}

function cycleSpeed() {
  const speeds = [1, 1.5, 2, 0.5, 0.75];
  speed.value = speeds[(speeds.indexOf(speed.value) + 1) % speeds.length];
  if (audioRef.value) audioRef.value.playbackRate = speed.value;
}

onMounted(() => {
  if (audioRef.value) player.bindAudio(audioRef.value);
  // demo：无数据时清空音频源
});

onBeforeUnmount(() => {
  player.togglePlay();
});
</script>

<template>
  <div class="player-page">
    <FluidBackground />
    <audio ref="audioRef" v-if="player.song"></audio>

    <!-- 顶部覆盖层 -->
    <div class="player-topbar">
      <button class="back" @click="router.back()"><span class="material-symbols-outlined">arrow_back</span> {{ t("player.back") }}</button>
      <div class="now-title">{{ t("player.nowPlaying") }}</div>
      <div class="right-placeholder"></div>
    </div>

    <div class="player-body">
      <!-- 左栏：封面 + 信息 + 进度 + 控制 -->
      <div class="left-col">
        <div class="cover-wrap" :class="{ hover: player.playing }">
          <div class="cover" v-if="player.song?.coverBase64">
            <img :src="player.song.coverBase64" alt="" />
          </div>
          <div class="cover default" v-else><span class="material-symbols-outlined">music_note</span></div>
        </div>

        <div class="song-info">
          <div class="title">{{ player.song?.meta.title || "—" }}</div>
          <div class="artist">
            {{ player.song?.meta.artist || "" }}<span v-if="player.song?.meta.album"> · </span>{{ player.song?.meta.album || "" }}
          </div>
        </div>

        <div class="progress-section">
          <div
            class="progress-bar"
            :class="{ dragging: isDragging }"
            @mousedown="isDragging = true"
            @mousemove="isDragging && onProgressClick($event)"
            @mouseup="isDragging = false"
            @mouseleave="isDragging = false"
            @click="onProgressClick"
          >
            <div
              class="progress-fill"
              :style="{ width: (player.duration ? (player.currentTime / player.duration) * 100 : 0) + '%' }"
            ></div>
            <div
              class="progress-thumb"
              :style="{ left: (player.duration ? (player.currentTime / player.duration) * 100 : 0) + '%' }"
            ></div>
          </div>
          <div class="time-row">
            <span>{{ formatTime(player.currentTime) }}</span>
            <span>-{{ formatTime(player.duration - player.currentTime) }}</span>
          </div>
        </div>

        <div class="controls">
          <div class="ctrl-group left">
            <button class="side-btn" :title="t('player.repeat')"><span class="material-symbols-outlined">repeat</span></button>
            <button class="side-btn" :title="t('player.shuffle')"><span class="material-symbols-outlined">shuffle</span></button>
          </div>
          <div class="ctrl-group center">
            <button class="side-btn" :title="t('player.prev')"><span class="material-symbols-outlined">skip_previous</span></button>
            <button class="main-btn" @click="player.togglePlay()">
              <span class="material-symbols-outlined">{{ player.playing ? "pause" : "play_arrow" }}</span>
            </button>
            <button class="side-btn" :title="t('player.next')"><span class="material-symbols-outlined">skip_next</span></button>
          </div>
          <div class="ctrl-group right">
            <button class="side-btn speed" @click="cycleSpeed">{{ speed }}x</button>
          </div>
        </div>
      </div>

      <!-- 右栏：歌词/队列 -->
      <div class="right-col">
        <div class="segment">
          <button
            class="seg-btn"
            :class="{ active: rightTab === 'lyrics' }"
            @click="rightTab = 'lyrics'"
          >{{ t("player.lyrics") }}</button>
          <button
            class="seg-btn"
            :class="{ active: rightTab === 'queue' }"
            @click="rightTab = 'queue'"
          >{{ t("player.queue") }}</button>
        </div>
        <div class="right-content">
          <LyricsView v-if="rightTab === 'lyrics'" />
          <div v-else class="queue-empty">播放队列</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player-page {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #000;
  color: #fff;
}
.player-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  z-index: 10;
  background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent);
}
.back {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  opacity: 0.9;
  display: flex;
  align-items: center;
  gap: 4px;
}
.now-title {
  font-size: 14px;
  opacity: 0.8;
}
.right-placeholder {
  width: 60px;
}
.player-body {
  height: 100%;
  display: flex;
  padding-top: 60px;
}
.left-col {
  flex: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  z-index: 2;
}
.right-col {
  flex: 5.5;
  display: flex;
  flex-direction: column;
  padding: 0 20px;
  z-index: 2;
}
.cover-wrap {
  width: min(42vw, 52vh);
  aspect-ratio: 1;
  border-radius: calc(min(42vw, 52vh) * 0.14);
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.35),
    0 4px 16px rgba(0, 0, 0, 0.25);
  transition: transform 250ms cubic-bezier(0.25, 0.8, 0.25, 1),
    filter 250ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.cover-wrap:hover {
  transform: scale(1.05);
  filter: brightness(0.85);
}
.cover {
  width: 100%;
  height: 100%;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover.default {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #222;
}
.cover.default .material-symbols-outlined {
  font-size: 120px;
}
.song-info {
  margin-top: 28px;
  text-align: center;
}
.song-info .title {
  font-size: 24px;
  font-weight: 700;
}
.song-info .artist {
  font-size: 14px;
  opacity: 0.6;
  margin-top: 6px;
}
.progress-section {
  width: 425px;
  margin-top: 24px;
}
.progress-bar {
  width: 425px;
  height: 5px;
  background: rgba(255, 255, 255, 0.22);
  border-radius: 4px;
  position: relative;
  cursor: pointer;
  transition: height 250ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.progress-bar:hover,
.progress-bar.dragging {
  height: 10px;
}
.progress-fill {
  height: 100%;
  background: #fff;
  border-radius: 4px;
}
.progress-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.25);
  opacity: 0;
  transition: opacity 200ms;
}
.progress-bar:hover .progress-thumb {
  opacity: 1;
}
.time-row {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.7;
}
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 425px;
  margin-top: 16px;
}
.ctrl-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.main-btn {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: none;
  background: #fff;
  color: #000;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 200ms;
}
.main-btn .material-symbols-outlined {
  font-size: 34px;
}
.main-btn:hover {
  transform: scale(1.03);
}
.main-btn:active {
  transform: scale(0.8);
}
.side-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: #fff;
  opacity: 0.7;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.side-btn .material-symbols-outlined {
  font-size: 20px;
}
.side-btn:active {
  transform: scale(0.8);
}
.speed {
  font-size: 13px;
  width: 44px;
}
.segment {
  display: flex;
  gap: 6px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  align-self: flex-start;
  margin-bottom: 16px;
}
.seg-btn {
  border: none;
  background: transparent;
  color: #fff;
  opacity: 0.6;
  padding: 6px 18px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  transition: all 200ms;
}
.seg-btn.active {
  background: #fff;
  color: #000;
  opacity: 1;
}
.right-content {
  flex: 1;
  overflow: hidden;
}
.queue-empty {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  margin-top: 40%;
}
</style>
