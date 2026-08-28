<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useAnimeStore } from "@/stores/anime";
import { translate } from "@shared/i18n";

const props = defineProps<{
  roadIndex: number;
  episodeIndex: number;
  /** 续播起点（毫秒），来自历史记录 */
  initialSeekMs?: number;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "switch", roadIndex: number, episodeIndex: number): void;
}>();

const settings = useSettingsStore();
const anime = useAnimeStore();
const t = (key: string) => translate(settings.lang, key);

const video = ref<HTMLVideoElement | null>(null);
const drawerOpen = ref(false);
const speed = ref(1);
let reportTimer: number | undefined;

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const episode = computed(() => {
  const road = anime.detail?.roads[props.roadIndex];
  return road?.episodes[props.episodeIndex];
});
const isFirst = computed(() => props.roadIndex === 0 && props.episodeIndex === 0);
const isLast = computed(() => {
  const roads = anime.detail?.roads ?? [];
  return (
    props.roadIndex >= roads.length - 1 &&
    props.episodeIndex >= (roads[roads.length - 1]?.episodes.length ?? 0) - 1
  );
});

function reportHistory() {
  const v = video.value;
  if (!v || !episode.value) return;
  const rule = anime.activeRule;
  const animeId = anime.detailTitle || episode.value.url;
  void anime.upsertHistory({
    key: `${rule?.name ?? ""}:${animeId}`,
    plugin: rule?.name ?? "",
    animeId,
    title: anime.detailTitle,
    cover: anime.detail?.cover ?? null,
    lastEpisode: episode.value.name,
    episodePageUrl: episode.value.url,
    roadIndex: props.roadIndex,
    episodeIndex: props.episodeIndex,
    progressMs: Math.floor(v.currentTime * 1000),
    durationMs: Math.floor((v.duration || 0) * 1000),
    updatedAt: Date.now(),
  });
}

function scheduleReport() {
  if (reportTimer) window.clearTimeout(reportTimer);
  reportTimer = window.setTimeout(() => {
    reportTimer = undefined;
    reportHistory();
  }, 5000);
}

function onError() {
  if (!anime.streamError) {
    anime.streamError = t("anime.streamFailed");
  }
}

function retry() {
  anime.clearStream();
  void ensureStream();
}

async function ensureStream() {
  if (!anime.stream && episode.value) {
    await anime.resolveStream(episode.value);
  }
}

function onLoadedMetadata() {
  const v = video.value;
  if (!v) return;
  if (props.initialSeekMs && Number.isFinite(v.duration)) {
    v.currentTime = Math.min(props.initialSeekMs / 1000, v.duration);
  }
}

function cycleSpeed() {
  const i = SPEEDS.indexOf(speed.value);
  speed.value = SPEEDS[(i + 1) % SPEEDS.length];
  if (video.value) video.value.playbackRate = speed.value;
}

/** 上一集 / 下一集（同线路内切换，越界则进出相邻线路） */
function playNext(delta: number) {
  const roads = anime.detail?.roads ?? [];
  let ri = props.roadIndex;
  let ei = props.episodeIndex + delta;
  if (ei < 0) {
    if (ri === 0) return;
    ri -= 1;
    ei = (roads[ri]?.episodes.length ?? 0) - 1;
  } else if (ei >= (roads[ri]?.episodes.length ?? 0)) {
    if (ri >= roads.length - 1) return;
    ri += 1;
    ei = 0;
  }
  emit("switch", ri, ei);
}

onMounted(() => {
  const v = video.value;
  if (v) {
    v.addEventListener("timeupdate", scheduleReport);
    v.addEventListener("ended", reportHistory);
    v.addEventListener("loadedmetadata", onLoadedMetadata);
  }
  void ensureStream();
});

onBeforeUnmount(() => {
  if (reportTimer) window.clearTimeout(reportTimer);
  reportHistory();
  const v = video.value;
  if (v) {
    v.removeEventListener("timeupdate", scheduleReport);
    v.removeEventListener("ended", reportHistory);
    v.removeEventListener("loadedmetadata", onLoadedMetadata);
  }
});
</script>

<template>
  <Teleport to="body">
    <div class="anime-player">
      <video
        ref="video"
        :src="anime.stream?.url"
        controls
        autoplay
        playsinline
        @error="onError"
      ></video>

      <!-- 顶栏 -->
      <div class="topbar">
        <button class="bar-btn" :title="t('anime.exit')" @click="emit('close')">
          <span class="material-symbols-outlined">close</span>
        </button>
        <div class="title" :title="anime.detailTitle">
          {{ anime.detailTitle }}<span v-if="episode" class="ep"> · {{ episode.name }}</span>
        </div>
        <button
          class="bar-btn"
          :class="{ active: drawerOpen }"
          :title="t('anime.episodes')"
          @click="drawerOpen = !drawerOpen"
        >
          <span class="material-symbols-outlined">list</span>
        </button>
      </div>

      <!-- 选集抽屉 -->
      <div v-if="drawerOpen" class="drawer">
        <template v-for="(road, ri) in anime.detail?.roads ?? []" :key="ri">
          <div class="road-name">{{ road.name }}</div>
          <div class="ep-grid">
            <button
              v-for="(ep, ei) in road.episodes"
              :key="ei"
              class="ep"
              :class="{ active: ri === props.roadIndex && ei === props.episodeIndex }"
              @click="emit('switch', ri, ei)"
            >{{ ep.name }}</button>
          </div>
        </template>
      </div>

      <!-- 取流状态 / 失败 -->
      <div v-if="anime.resolving" class="overlay state">
        <span class="material-symbols-outlined spin">progress_activity</span>
        <span>{{ t("anime.streamResolving") }}</span>
      </div>
      <div v-else-if="anime.streamError" class="overlay state error">
        <span>{{ anime.streamError }}</span>
        <button class="lm-btn lm-btn--filled" @click="retry">
          <span class="material-symbols-outlined">refresh</span>
          {{ t("anime.retry") }}
        </button>
      </div>

      <!-- 快捷控制 -->
      <div v-if="episode && !anime.streamError" class="bottombar">
        <button class="bar-btn" :disabled="isFirst" :title="t('anime.prevEp')" @click="playNext(-1)">
          <span class="material-symbols-outlined">skip_previous</span>
        </button>
        <button class="speed-btn" :title="t('anime.speed')" @click="cycleSpeed">
          {{ speed }}x
        </button>
        <button class="bar-btn" :disabled="isLast" :title="t('anime.nextEp')" @click="playNext(1)">
          <span class="material-symbols-outlined">skip_next</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.anime-player {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: #000;
  animation: lm-fade-in 200ms var(--md-sys-motion-easing-standard);
}
video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #000;
}
/* 顶栏：渐变底避免与控制条冲突 */
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(rgba(0, 0, 0, 0.55), transparent);
  color: #fff;
  z-index: 5;
}
.bar-btn {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: #fff;
  cursor: pointer;
}
.bar-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
.bar-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.bar-btn.active {
  background: rgba(255, 255, 255, 0.24);
}
.bar-btn .material-symbols-outlined {
  font-size: 24px;
}
.title {
  flex: 1;
  min-width: 0;
  font-size: var(--md-sys-typescale-title-small-size);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title .ep {
  opacity: 0.75;
}
.speed-btn {
  height: 30px;
  min-width: 52px;
  padding: 0 10px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
}
.speed-btn:hover {
  background: rgba(255, 255, 255, 0.24);
}
/* 选集抽屉 */
.drawer {
  position: absolute;
  top: 58px;
  right: 12px;
  width: min(360px, calc(100vw - 24px));
  max-height: 60vh;
  overflow-y: auto;
  padding: 14px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--md-elevation-3);
  z-index: 5;
}
.road-name {
  margin: 8px 0 6px;
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: 600;
  color: var(--md-sys-color-primary);
}
.ep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
}
.ep {
  height: 32px;
  border: none;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-small-size);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ep:hover {
  background: var(--md-sys-color-surface-container-highest);
}
.ep.active {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font-weight: 600;
}
/* 状态层 */
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: var(--md-sys-typescale-body-medium-size);
  z-index: 4;
}
.overlay .material-symbols-outlined {
  font-size: 34px;
}
.overlay.state.error .material-symbols-outlined {
  color: var(--md-sys-color-error);
}
.spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to {
    transform: rotate(360deg);
  }
}
/* 底部快捷控制 */
.bottombar {
  position: absolute;
  left: 50%;
  bottom: 74px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  z-index: 5;
}
@keyframes lm-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
