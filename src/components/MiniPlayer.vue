<script setup lang="ts">
import { useRouter } from "vue-router";
import { usePlayerStore } from "@/stores/player";
import PlayerControlIcon from "@/components/PlayerControlIcon.vue";
import ElasticSlider from "@/components/ElasticSlider.vue";
import { formatTime } from "@/utils/format";

const player = usePlayerStore();
const router = useRouter();
</script>

<template>
  <div class="mini-player lm-glass">
    <!-- 进度条置顶，松手 seek -->
    <ElasticSlider
      class="mini-track"
      compact
      fluid
      :value="player.currentTime"
      :max-value="Math.max(1, player.duration || 1)"
      :starting-value="0"
      aria-label="播放进度"
      @value-commit="(v: number) => player.seek(v)"
    />

    <div class="body" @click="router.push('/music/player')">
      <div class="cover">
        <img v-if="player.song?.cover" :src="player.song.cover" alt="" />
        <span v-else class="material-symbols-outlined">music_note</span>
      </div>

      <div class="info">
        <div class="title">{{ player.song?.title || "—" }}</div>
        <div class="artist">{{ player.song?.artist || "未知艺术家" }}</div>
      </div>

      <div class="time tabular-nums">
        {{ formatTime(player.currentTime) }} / {{ formatTime(player.duration) }}
      </div>

      <div class="controls" @click.stop>
        <button class="lm-icon-btn" title="上一首" @click="player.previous()">
          <span class="material-symbols-outlined filled">skip_previous</span>
        </button>
        <button class="lm-icon-btn play" :title="player.playing ? '暂停' : '播放'" @click="player.togglePlay()">
          <PlayerControlIcon :name="player.playing ? 'pause' : 'play'" />
        </button>
        <button class="lm-icon-btn" title="下一首" @click="player.next()">
          <span class="material-symbols-outlined filled">skip_next</span>
        </button>
        <button
          class="lm-icon-btn"
          title="展开播放器"
          @click="router.push('/music/player')"
        >
          <span class="material-symbols-outlined">expand_less</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini-player {
  position: fixed;
  left: var(--lm-nav-width);
  right: 0;
  bottom: 0;
  height: var(--lm-miniplayer-height);
  z-index: 50;
  border-top: 1px solid var(--lm-hairline);
  animation: slide-up 320ms var(--md-sys-motion-easing-emphasized-decelerate);
}
@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: none; }
}

.mini-track {
  position: relative;
  height: 4px;
  cursor: pointer;
  z-index: 1;
}
.mini-track :deep(.track) {
  height: 4px;
  align-items: flex-start;
}
.mini-track :deep(.track-bg) {
  height: 4px;
  border-radius: 0;
}
.mini-track :deep(.knob) {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.body {
  display: flex;
  align-items: center;
  gap: 14px;
  height: calc(var(--lm-miniplayer-height) - 4px);
  padding: 0 16px;
  cursor: pointer;
}

.cover {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--md-sys-shape-corner-small);
  overflow: hidden;
  background: var(--md-sys-color-surface-container-high);
  box-shadow: var(--md-elevation-1), inset 0 0 0 1px var(--lm-hairline);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover .material-symbols-outlined {
  font-size: 22px;
  color: var(--md-sys-color-outline);
}

.info {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 600;
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

.time {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
}

.controls {
  display: flex;
  align-items: center;
  gap: 2px;
}
.controls .play {
  width: 44px;
  height: 44px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.controls .play:hover {
  filter: brightness(1.08);
}
.controls .play .player-control-icon {
  width: 26px;
  height: 23px;
  filter: drop-shadow(0 0 6px rgba(0, 0, 0, 0.18));
}

@media (max-width: 720px) {
  .time {
    display: none;
  }
}
</style>
