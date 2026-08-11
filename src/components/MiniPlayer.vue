<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { usePlayerStore } from "@/stores/player";
import { formatTime } from "@/utils/format";

const player = usePlayerStore();
const router = useRouter();

const progress = computed(() =>
  player.duration ? (player.currentTime / player.duration) * 100 : 0,
);

function seek(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  const ratio = (e.clientX - el.getBoundingClientRect().left) / el.offsetWidth;
  player.seek(Math.max(0, Math.min(1, ratio)) * player.duration);
}
</script>

<template>
  <div class="mini-player lm-glass">
    <!-- 进度条置顶，点击可跳转 -->
    <div class="track" @click.stop="seek">
      <div class="fill" :style="{ width: progress + '%' }">
        <span class="knob"></span>
      </div>
    </div>

    <div class="body" @click="router.push('/music/player')">
      <div class="cover">
        <img v-if="player.song?.coverBase64" :src="player.song.coverBase64" alt="" />
        <span v-else class="material-symbols-outlined">music_note</span>
      </div>

      <div class="info">
        <div class="title">{{ player.song?.meta.title || "—" }}</div>
        <div class="artist">{{ player.song?.meta.artist || "未知艺术家" }}</div>
      </div>

      <div class="time tabular-nums">
        {{ formatTime(player.currentTime) }} / {{ formatTime(player.duration) }}
      </div>

      <div class="controls" @click.stop>
        <button class="lm-icon-btn" title="上一首" @click="player.previous()">
          <span class="material-symbols-outlined filled">skip_previous</span>
        </button>
        <button class="lm-icon-btn play" @click="player.togglePlay()">
          <span class="material-symbols-outlined filled">
            {{ player.playing ? "pause" : "play_arrow" }}
          </span>
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

.track {
  position: relative;
  height: 4px;
  cursor: pointer;
  background: var(--md-sys-color-surface-container-highest);
}
.track:hover .knob {
  opacity: 1;
}
.fill {
  position: relative;
  height: 100%;
  background: var(--md-sys-color-primary);
  transition: width 180ms linear;
}
.knob {
  position: absolute;
  right: -5px;
  top: 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--md-sys-color-primary);
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity var(--md-sys-motion-duration-short);
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
.controls .play .material-symbols-outlined {
  font-size: 26px;
}

@media (max-width: 720px) {
  .time {
    display: none;
  }
}
</style>
