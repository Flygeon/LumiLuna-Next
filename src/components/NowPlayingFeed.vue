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

/** 无封面时的占位 SVG（确保 img 直接 slot=header 触发 has-header-media） */
const PLACEHOLDER_COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='100%25' height='100%25' fill='%232a2a2e'/%3E%3C/svg%3E";

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
      <m3e-button variant="text" @click="loadAll">{{ t("actions.retry") }}</m3e-button>
    </p>

    <template v-else>
      <!-- 私人 FM / 每日推荐：Hero 卡片 -->
      <section class="feed-section">
        <div class="feed-hero-row">
          <m3e-card class="feed-hero" variant="elevated" actionable @click="playFm">
            <div slot="content" class="feed-hero-inner">
              <span class="hero-icon material-symbols-outlined">radio</span>
              <div class="hero-main">
                <h3 class="hero-title">{{ t("homeFeed.personalFm") }}</h3>
                <p class="hero-desc">{{ fmSubtitle }}</p>
              </div>
              <span class="hero-play material-symbols-outlined" :class="{ spinning: fmLoading }"
                >play_arrow</span
              >
            </div>
          </m3e-card>

          <m3e-card class="feed-hero" variant="elevated" actionable @click="playDaily">
            <div slot="content" class="feed-hero-inner">
              <span class="hero-icon material-symbols-outlined">event_available</span>
              <div class="hero-main">
                <h3 class="hero-title">{{ t("homeFeed.dailyRecommend") }}</h3>
                <p class="hero-desc">{{ dailySubtitle }}</p>
              </div>
              <span class="hero-play material-symbols-outlined" :class="{ spinning: dailyLoading }"
                >play_arrow</span
              >
            </div>
          </m3e-card>
        </div>
      </section>

      <!-- 为你推荐（推荐歌单） -->
      <section v-if="recommendPlaylists.length" class="feed-section">
        <div class="feed-section-head">
          <h3 class="feed-section-title">{{ t("homeFeed.forYou") }}</h3>
          <span class="feed-section-sub"
            >{{ recommendPlaylists.length }} {{ t("homeFeed.playlists") }}</span
          >
        </div>
        <div class="playlist-grid">
          <m3e-card
            v-for="p in recommendPlaylists"
            :key="p.id"
            class="playlist-card"
            variant="elevated"
            actionable
            @click="openPlaylist(p)"
          >
            <img
              slot="header"
              class="playlist-cover-img"
              :src="p.picUrl || PLACEHOLDER_COVER"
              :alt="p.name"
              loading="lazy"
            />
            <div slot="content" class="playlist-meta">
              <div class="playlist-name" :title="p.name">{{ p.name }}</div>
              <div v-if="p.playCount > 0" class="playlist-count">
                <span class="material-symbols-outlined">play_circle</span>
                {{ formatPlayCount(p.playCount) }}
              </div>
              <div v-if="p.copywriter" class="playlist-desc" :title="p.copywriter">
                {{ p.copywriter }}
              </div>
            </div>
          </m3e-card>
        </div>
      </section>

      <div
        v-if="!recommendPlaylists.length && !dailySongs.length && !fmSongs.length"
        class="feed-empty"
      >
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
  animation: lm-rise 340ms var(--md-sys-motion-spring-spatial) both;
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
  cursor: pointer;
  --m3e-card-shape: var(--md-sys-shape-corner-extra-large);
}
.feed-hero-inner {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--md-sys-color-on-surface);
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
  font-weight: 500;
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
  font-weight: 500;
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
.playlist-card {
  cursor: pointer;
}
.playlist-cover-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  display: block;
}
.playlist-count {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
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
