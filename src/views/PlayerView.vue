<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { useRouter } from "vue-router";
import { translate } from "@shared/i18n";
import FluidBackground from "@/components/FluidBackground.vue";
import LyricsView from "@/components/LyricsView.vue";
import { formatDuration } from "@/utils/format";

const player = usePlayerStore();
const settings = useSettingsStore();
const router = useRouter();
const rightTab = ref<"lyrics" | "queue">("lyrics");
const speed = ref(1);
const isDragging = ref(false);

/** 当前歌曲是否有翻译/罗马音副行（无则切换按钮置灰） */
const hasSubLine = computed(() =>
  player.lyrics.some((l) => l.translation || l.romaji),
);

/** 副行显示模式按钮：翻译 ⇄ 罗马音 */
const subModeLabel = computed(() =>
  settings.lyricSubMode === "translation"
    ? t("player.translation")
    : t("player.romaji"),
);
function cycleSubMode() {
  settings.lyricSubMode =
    settings.lyricSubMode === "translation" ? "romaji" : "translation";
}

function t(key: string) {
  return translate(settings.lang, key);
}

/** 歌词来源徽标：仅「更精确的逐字歌词」开启且当前歌曲完成尝试后显示；点击可切换来源 */
const sourceBadge = computed(() => {
  const switchHint = t("player.lyricSwitchHint");
  if (!settings.preciseLyrics || !player.lyricsSource) return null;
  if (player.lyricsSource === "qq") {
    return {
      text: t("player.lyricSourceQq"),
      hint: `${t("player.lyricSourceQqHint")} · ${switchHint}`,
    };
  }
  if (player.lyricsSource === "kg") {
    return {
      text: t("player.lyricSourceKg"),
      hint: `${t("player.lyricSourceKgHint")} · ${switchHint}`,
    };
  }
  const reason = player.lyricFallbackReason
    ? t(`player.lyricReason_${player.lyricFallbackReason}`)
    : "";
  const detail = player.lyricFallbackDetail ? `：${player.lyricFallbackDetail}` : "";
  return {
    text: t("player.lyricSourceLocal"),
    hint: `${reason ? `${t("player.lyricSourceLocal")}（${reason}${detail}）` : t("player.lyricSourceLocal")} · ${switchHint}`,
  };
});

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
  player.setPlaybackRate(speed.value);
}

onMounted(() => {
  // audio 元素由 store 全局持有，这里只确保已起播
  player.initAudio();
  player.setPlaybackRate(speed.value);
});

onBeforeUnmount(() => {
  // 不中断播放，退出后由 MiniPlayer 接管
  player.detachAudio();
});
</script>

<template>
  <div class="player-page">
    <FluidBackground />

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
          <div class="cover" v-if="player.song?.cover">
            <img :src="player.song.cover" alt="" />
          </div>
          <div class="cover default" v-else><span class="material-symbols-outlined">music_note</span></div>
        </div>

        <div class="song-info">
          <div class="title">{{ player.song?.title || "—" }}</div>
          <div class="artist">
            {{ player.song?.artist || "" }}<span v-if="player.song?.album"> · </span>{{ player.song?.album || "" }}
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
            <button class="side-btn" :class="{ active: player.repeatMode !== 'off' }" :title="t('player.repeat')" @click="player.cycleRepeat()">
              <span class="material-symbols-outlined">{{ player.repeatMode === 'one' ? 'repeat_one' : 'repeat' }}</span>
            </button>
            <button class="side-btn" :class="{ active: player.shuffleMode }" :title="t('player.shuffle')" @click="player.toggleShuffle()">
              <span class="material-symbols-outlined">shuffle</span>
            </button>
          </div>
          <div class="ctrl-group center">
            <button class="side-btn" :title="t('player.prev')" @click="player.previous()">
              <span class="material-symbols-outlined">skip_previous</span>
            </button>
            <button class="main-btn" @click="player.togglePlay()">
              <span class="material-symbols-outlined">{{ player.playing ? "pause" : "play_arrow" }}</span>
            </button>
            <button class="side-btn" :title="t('player.next')" @click="player.next()">
              <span class="material-symbols-outlined">skip_next</span>
            </button>
          </div>
          <div class="ctrl-group right">
            <button class="side-btn speed" @click="cycleSpeed">{{ speed }}x</button>
          </div>
        </div>
      </div>

      <!-- 右栏：歌词/队列 -->
      <div class="right-col">
        <div class="right-head">
          <div class="segment">
            <button
              class="seg-btn"
              :class="{ active: rightTab === 'lyrics' }"
              @click="rightTab = 'lyrics'"
            >{{ t("actions.lyrics") }}</button>
            <button
              class="seg-btn"
              :class="{ active: rightTab === 'queue' }"
              @click="rightTab = 'queue'"
            >{{ t("actions.queue") }}</button>
          </div>
          <button
            v-if="sourceBadge"
            class="source-badge"
            :class="player.lyricsSource"
            :title="sourceBadge.hint"
            @click="player.switchLyricSource()"
          >
            <span class="material-symbols-outlined">
              {{
                player.lyricsSource === "qq"
                  ? "verified"
                  : player.lyricsSource === "kg"
                    ? "graphic_eq"
                    : "info"
              }}
            </span>
            {{ sourceBadge.text }}
          </button>
          <button
            v-if="hasSubLine"
            class="source-badge sub"
            :class="{ disabled: !hasSubLine }"
            :title="t('player.lyricSubModeSwitch')"
            @click="cycleSubMode"
          >
            <span class="material-symbols-outlined">
              {{ settings.lyricSubMode === "translation" ? "translate" : "abc" }}
            </span>
            {{ subModeLabel }}
          </button>
        </div>
        <div class="right-content">
          <LyricsView v-if="rightTab === 'lyrics'" />
          <div v-else-if="player.queue.length" class="queue-list">
            <button
              v-for="(item, i) in player.queue"
              :key="player.queueTitle(item) + item.id"
              class="queue-item"
              :class="{ current: i === player.currentIndex }"
              @click="player.playFromQueue(i)"
            >
              <span class="q-index tabular-nums">
                <span v-if="i !== player.currentIndex">{{ i + 1 }}</span>
                <span v-else class="material-symbols-outlined">equalizer</span>
              </span>
              <span class="q-names">
                <span class="q-title">{{ player.queueTitle(item) }}</span>
                <span class="q-artist">{{ player.queueArtist(item) }}</span>
              </span>
              <span class="q-time tabular-nums">
                {{ formatDuration(player.queueDuration(item)) }}
              </span>
            </button>
          </div>
          <div v-else class="queue-empty">{{ t("actions.queue") }}</div>
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
.right-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
}
.segment {
  display: flex;
  gap: 6px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  align-self: flex-start;
}
.source-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
  font-family: inherit;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.65);
  transition: background 180ms ease;
}
.source-badge:hover {
  background: rgba(255, 255, 255, 0.18);
}
.source-badge .material-symbols-outlined {
  font-size: 14px;
}
.source-badge.qq {
  background: rgba(76, 217, 100, 0.16);
  color: #7cfc9b;
}
.source-badge.kg {
  background: rgba(56, 160, 255, 0.18);
  color: #7cc4ff;
}
.source-badge.local {
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.65);
}
.source-badge.sub {
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.75);
}
.source-badge.sub.disabled {
  opacity: 0.4;
  cursor: default;
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
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  height: 100%;
}
.queue-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 180ms ease;
}
.queue-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.queue-item.current {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.q-index {
  width: 22px;
  text-align: center;
  font-size: 12px;
  opacity: 0.6;
}
.q-index .material-symbols-outlined {
  font-size: 16px;
  opacity: 1;
}
.q-names {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.q-title {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.q-artist {
  font-size: 12px;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.q-time {
  font-size: 12px;
  opacity: 0.55;
}
.queue-empty {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  margin-top: 40%;
}
</style>
