<script setup lang="ts">
/**
 * 现在就听 / 信息流：私人 FM、每日推荐、为你推荐（推荐歌单）。
 * 参考参考项目 home 页的 feed 排列，UI 使用 LumiLuna MD3 token。
 */
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useNeteaseStore } from "@/stores/netease";
import { capabilities } from "@/capabilities";
import { toOnlineSongs } from "@/utils/netease";
import { translate } from "@shared/i18n";
import type { NeteaseRecommendPlaylist, NeteaseSong, OnlineSong } from "@shared/types";

const settings = useSettingsStore();
const netease = useNeteaseStore();

const emit = defineEmits<{
  (e: "play-songs", songs: OnlineSong[], index: number): void;
  (e: "open-playlist", id: number, name: string): void;
}>();

function t(key: string) {
  return translate(settings.lang, key);
}

// ---- 状态 ----
const status = ref<"loading" | "ready" | "error">("loading");
const error = ref("");
const recommendPlaylists = ref<NeteaseRecommendPlaylist[]>([]);
const dailySongs = ref<NeteaseSong[]>([]);
const fmSongs = ref<NeteaseSong[]>([]);
const fmLoading = ref(false);
const dailyLoading = ref(false);

function formatPlayCount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

async function loadAll() {
  status.value = "loading";
  error.value = "";
  try {
    const [playlists, daily, fm] = await Promise.all([
      capabilities.neteaseRecommendPlaylists(20),
      capabilities.neteaseDailyRecommendSongs().catch(() => []),
      capabilities.neteasePersonalFm().catch(() => []),
    ]);
    recommendPlaylists.value = Array.isArray(playlists) ? playlists : [];
    dailySongs.value = Array.isArray(daily) ? daily : [];
    fmSongs.value = Array.isArray(fm) ? fm : [];
    status.value = "ready";
  } catch (e) {
    status.value = "error";
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function playDaily() {
  if (dailyLoading.value || !dailySongs.value.length) return;
  dailyLoading.value = true;
  try {
    const songs = await toOnlineSongs(dailySongs.value);
    emit("play-songs", songs, 0);
  } finally {
    dailyLoading.value = false;
  }
}

async function playFm() {
  if (fmLoading.value || !fmSongs.value.length) return;
  fmLoading.value = true;
  try {
    const songs = await toOnlineSongs(fmSongs.value);
    emit("play-songs", songs, 0);
  } finally {
    fmLoading.value = false;
  }
}

function openPlaylist(item: NeteaseRecommendPlaylist) {
  emit("open-playlist", item.id, item.name);
}

const dailySubtitle = computed(() =>
  dailySongs.value.length ? t("homeFeed.dailyHint") : t("homeFeed.empty"),
);
const fmSubtitle = computed(() =>
  fmSongs.value.length ? t("homeFeed.fmHint") : t("homeFeed.empty"),
);

onMounted(loadAll);
</script>

<template>
  <div class="home-feed">
    <div v-if="status === 'loading'" class="feed-loading">{{ t("online.loading") }}</div>
    <p v-else-if="status === 'error'" class="feed-error">
      <span class="material-symbols-outlined">error</span>
      {{ error }}
      <button class="lm-btn lm-btn--text" @click="loadAll">{{ t("actions.retry") }}</button>
    </p>

    <template v-else>
      <!-- 私人 FM / 每日推荐：Hero 卡片 -->
      <section class="feed-section">
        <div class="feed-hero-row">
          <button class="feed-hero" @click="playFm">
            <span class="hero-icon material-symbols-outlined">radio</span>
            <div class="hero-main">
              <h3 class="hero-title">{{ t("homeFeed.personalFm") }}</h3>
              <p class="hero-desc">{{ fmSubtitle }}</p>
            </div>
            <span class="hero-play material-symbols-outlined" :class="{ spinning: fmLoading }">play_arrow</span>
          </button>

          <button class="feed-hero" @click="playDaily">
            <span class="hero-icon material-symbols-outlined">event_available</span>
            <div class="hero-main">
              <h3 class="hero-title">{{ t("homeFeed.dailyRecommend") }}</h3>
              <p class="hero-desc">{{ dailySubtitle }}</p>
            </div>
            <span class="hero-play material-symbols-outlined" :class="{ spinning: dailyLoading }">play_arrow</span>
          </button>
        </div>
      </section>

      <!-- 为你推荐（推荐歌单） -->
      <section v-if="recommendPlaylists.length" class="feed-section">
        <div class="feed-section-head">
          <h3 class="feed-section-title">{{ t("homeFeed.forYou") }}</h3>
          <span class="feed-section-sub">{{ recommendPlaylists.length }} {{ t("homeFeed.playlists") }}</span>
        </div>
        <div class="playlist-grid">
          <button
            v-for="p in recommendPlaylists"
            :key="p.id"
            class="playlist-card"
            @click="openPlaylist(p)"
          >
            <div class="playlist-cover">
              <img v-if="p.picUrl" :src="p.picUrl" :alt="p.name" loading="lazy" />
              <span v-else class="material-symbols-outlined">queue_music</span>
              <span v-if="p.playCount > 0" class="playlist-count">
                <span class="material-symbols-outlined">play_circle</span>
                {{ formatPlayCount(p.playCount) }}
              </span>
            </div>
            <div class="playlist-meta">
              <div class="playlist-name" :title="p.name">{{ p.name }}</div>
              <div v-if="p.copywriter" class="playlist-desc" :title="p.copywriter">{{ p.copywriter }}</div>
            </div>
          </button>
        </div>
      </section>

      <div v-if="!recommendPlaylists.length && !dailySongs.length && !fmSongs.length" class="feed-empty">
        {{ t("homeFeed.empty") }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.home-feed {
  display: flex;
  flex-direction: column;
  gap: 24px;
  animation: lm-rise 340ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.feed-loading,
.feed-error,
.feed-empty {
  padding: 40px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.feed-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--md-sys-color-error);
}
.feed-error .material-symbols-outlined {
  font-size: 20px;
}
.feed-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.feed-hero-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.feed-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 180ms var(--md-sys-motion-easing-standard), box-shadow 180ms;
}
.feed-hero:hover {
  transform: translateY(-2px);
  box-shadow: var(--md-elevation-2);
}
.feed-hero:active {
  transform: scale(0.98);
}
.hero-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  font-size: 26px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.hero-main {
  flex: 1;
  min-width: 0;
}
.hero-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.hero-desc {
  margin: 4px 0 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hero-play {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  font-size: 22px;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
.hero-play.spinning {
  animation: lm-spin 1s linear infinite;
}
.feed-section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.feed-section-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.feed-section-sub {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
/* 移动端：180px 下限在 328px 可用宽下只能排一列，下调后稳定两列。
   :global 是因为 .is-mobile 挂在 <html> 上，不在本组件 scope 内。 */
:global(html.is-mobile .home-feed .playlist-grid) {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.playlist-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.playlist-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  color: var(--md-sys-color-outline);
  transition:
    transform 220ms var(--md-sys-motion-spring-soft),
    box-shadow 220ms var(--md-sys-motion-easing-standard);
}
.playlist-card:hover .playlist-cover {
  transform: translateY(-4px) scale(1.015);
  box-shadow: var(--md-elevation-3), inset 0 0 0 1px var(--lm-hairline);
}
.playlist-card:active .playlist-cover {
  transform: translateY(-1px) scale(0.995);
}
.playlist-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.playlist-cover .material-symbols-outlined {
  font-size: 36px;
}
.playlist-count {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.playlist-count .material-symbols-outlined {
  font-size: 13px;
}
.playlist-meta {
  min-width: 0;
}
.playlist-name {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.playlist-desc {
  margin-top: 2px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>