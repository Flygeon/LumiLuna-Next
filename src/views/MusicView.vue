<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { openContextMenu } from "@/composables/useContextMenu";
import { promptText } from "@/composables/useTextPrompt";
import { translate } from "@shared/i18n";
import {
  CURATED_PLAYLISTS,
  metingPlaylist,
  metingSearch,
} from "@/utils/meting";
import type {
  MediaEntry,
  MusicServer,
  OnlinePlaylistEntry,
  OnlineSong,
} from "@shared/types";

const library = useLibraryStore();
const player = usePlayerStore();
const settings = useSettingsStore();
const router = useRouter();

const items = computed(() => library.entries("audio"));
const hasScanDirs = computed(() => settings.scanDirs.length > 0);
const error = ref("");
const toast = ref("");
let toastTimer: number | null = null;

function t(key: string) {
  return translate(settings.lang, key);
}

function notify(message: string) {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 2600);
}

function load() {
  return library.refresh("audio");
}

onMounted(load);
onActivated(() => {
  if (!items.value.length) void load();
});

// ---- 在线音乐（实验性）----
const onlineMode = computed(() => settings.enableOnlineMusic);
const tab = ref<"playlists" | "search">("playlists");

type Detail =
  | { type: "local" }
  | { type: "online"; title: string; songs: OnlineSong[] };
const detail = ref<Detail | null>(null);

const onlineLoading = ref(false);
const onlineError = ref("");
const searchQuery = ref("");
const addName = ref("");
const addId = ref("");

/** 歌单歌曲缓存（key = server:id），用于卡片首曲封面、数量展示与秒开 */
const playlistCache = reactive(new Map<string, OnlineSong[]>());

function keyOf(card: { server?: MusicServer; id?: string }): string {
  return `${card.server}:${card.id}`;
}

function songsOf(card: { server?: MusicServer; id?: string }): OnlineSong[] | null {
  if (!card.id) return null;
  return playlistCache.get(keyOf(card)) ?? null;
}

/** 歌单卡片封面 = 歌单内首曲封面 */
function coverOf(card: { server?: MusicServer; id?: string }): string | undefined {
  return songsOf(card)?.[0]?.pic;
}

function subtitleOf(card: (typeof playlistCards.value)[number]): string {
  if (card.key === "local") return `${items.value.length} ${t("online.tracks")}`;
  const songs = songsOf(card);
  return songs ? `${songs.length} ${t("online.tracks")}` : t("online.playlists");
}

/** 预取当前平台所有在线歌单（封面/数量/点击秒开），单个失败不影响其它 */
async function prefetchPlaylists() {
  const cards = playlistCards.value.filter((c) => c.id);
  await Promise.all(
    cards.map(async (c) => {
      const key = keyOf(c);
      if (playlistCache.has(key)) return;
      try {
        playlistCache.set(key, await metingPlaylist(c.server!, c.id!));
      } catch {
        /* 单个歌单拉取失败不影响其它 */
      }
    }),
  );
}

watch(
  () => [
    onlineMode.value,
    tab.value,
    settings.musicServer,
    settings.onlinePlaylists.map((p) => p.id).join(","),
  ],
  () => {
    if (onlineMode.value && tab.value === "playlists") void prefetchPlaylists();
  },
  { immediate: true },
);

// 关闭在线功能时清掉在线详情，确保回到原模式
watch(
  () => settings.enableOnlineMusic,
  (on) => {
    if (!on) detail.value = null;
  },
);

/** 歌单卡片列表：本地音乐 + 当前平台的预设歌单 + 用户歌单 */
const playlistCards = computed(() => {
  const server = settings.musicServer;
  const cards: {
    key: string;
    name: string;
    server?: MusicServer;
    id?: string;
  }[] = [{ key: "local", name: t("online.local") }];
  for (const p of CURATED_PLAYLISTS) {
    if (p.server === server) {
      cards.push({
        key: `curated:${p.id}`,
        name: settings.playlistRenames[`${p.server}:${p.id}`] ?? p.name,
        server: p.server,
        id: p.id,
      });
    }
  }
  for (const p of settings.onlinePlaylists) {
    if (p.server === server) {
      cards.push({ key: `user:${p.id}`, name: p.name, server: p.server, id: p.id });
    }
  }
  return cards;
});

async function openPlaylist(card: (typeof playlistCards.value)[number]) {
  // 本地音乐
  if (!card.id) {
    detail.value = { type: "local" };
    return;
  }
  const key = keyOf(card);
  const cached = playlistCache.get(key);
  if (cached) {
    detail.value = { type: "online", title: card.name, songs: cached };
    return;
  }
  onlineLoading.value = true;
  onlineError.value = "";
  try {
    const songs = await metingPlaylist(card.server!, card.id);
    playlistCache.set(key, songs);
    detail.value = { type: "online", title: card.name, songs };
  } catch (e) {
    onlineError.value = e instanceof Error ? e.message : String(e);
  } finally {
    onlineLoading.value = false;
  }
}

async function doSearch() {
  const q = searchQuery.value.trim();
  if (!q) return;
  onlineLoading.value = true;
  onlineError.value = "";
  try {
    const songs = await metingSearch(settings.musicServer, q);
    detail.value = { type: "online", title: `「${q}」`, songs };
  } catch (e) {
    onlineError.value = e instanceof Error ? e.message : String(e);
  } finally {
    onlineLoading.value = false;
  }
}

function addPlaylist() {
  const id = addId.value.trim();
  if (!id) return;
  const name = addName.value.trim();
  const entry: OnlinePlaylistEntry = {
    server: settings.musicServer,
    id,
    name: name || `${t("online.playlists")} ${id}`,
  };
  settings.onlinePlaylists.push(entry);
  addId.value = "";
  addName.value = "";
}

function removePlaylist(id: string) {
  settings.onlinePlaylists = settings.onlinePlaylists.filter(
    (p) => !(p.server === settings.musicServer && p.id === id),
  );
}

// ---- 右键菜单：歌单重命名 / 歌曲下载 ----

/** 所有在线歌单（预设/用户）均可右键重命名；用户歌单额外可移除；本地歌单无菜单 */
function onPlaylistContext(e: MouseEvent, card: (typeof playlistCards.value)[number]) {
  if (!card.id) return;
  const items: { id: string; label: string; icon: string; danger?: boolean }[] = [
    { id: "rename", label: t("context.renamePlaylist"), icon: "edit" },
  ];
  if (card.key.startsWith("user:")) {
    items.push({
      id: "remove",
      label: t("online.removePlaylist"),
      icon: "delete",
      danger: true,
    });
  }
  openContextMenu(e, items, (id) => {
    if (id === "rename") void renamePlaylist(card);
    else if (id === "remove") removePlaylist(card.id!);
  });
}

async function renamePlaylist(card: (typeof playlistCards.value)[number]) {
  const name = await promptText(t("context.renamePlaylist"), card.name);
  if (!name) return;
  if (card.key.startsWith("user:")) {
    const hit = settings.onlinePlaylists.find(
      (p) => p.server === settings.musicServer && p.id === card.id,
    );
    if (hit) hit.name = name;
  } else if (card.id) {
    // 预设歌单：重命名存覆盖，跨会话保留
    settings.playlistRenames[`${settings.musicServer}:${card.id}`] = name;
  }
}

function onSongContext(e: MouseEvent, song: OnlineSong) {
  openContextMenu(
    e,
    [
      { id: "downloadAudio", label: t("context.downloadAudio"), icon: "download" },
      { id: "downloadCover", label: t("context.downloadCover"), icon: "image" },
    ],
    (id) => {
      if (id === "downloadAudio") void downloadAudio(song);
      else if (id === "downloadCover") void downloadCover(song);
    },
  );
}

async function downloadAudio(song: OnlineSong) {
  const path = await capabilities.pickSavePath(`${song.name} - ${song.artist}.mp3`);
  if (!path) return;
  try {
    await capabilities.downloadTo(song.url, path);
    notify(`${song.name} ${t("context.downloaded")}`);
  } catch (e) {
    notify(`${t("context.downloadFailed")}：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function downloadCover(song: OnlineSong) {
  const path = await capabilities.pickSavePath(`${song.name}.jpg`);
  if (!path) return;
  try {
    await capabilities.downloadTo(song.pic, path);
    notify(`${song.name} ${t("context.downloaded")}`);
  } catch (e) {
    notify(`${t("context.downloadFailed")}：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 在线歌曲入队并跳转全屏播放器 */
function playOnlineSongs(songs: OnlineSong[], index: number) {
  error.value = "";
  void player
    .playOnline(songs, index)
    .then(() => {
      if (player.lastError) {
        error.value = `无法播放「${songs[index].name}」`;
        return;
      }
      router.push("/music/player");
    })
    .catch((e) => {
      error.value = String(e);
    });
}

/** 本地音乐：单击卡片即播放（原模式逻辑） */
async function playLocal(item: MediaEntry, index: number) {
  error.value = "";
  player.setQueue(items.value, index);
  await player.loadById(item.id);
  if (player.lastError) {
    error.value = `无法播放「${item.title || item.name}」`;
    return;
  }
  router.push("/music/player");
}

function clearSearch() {
  library.search = "";
  void load();
}

const showLocal = computed(
  () => !onlineMode.value || detail.value?.type === "local",
);
const showOnlineRoot = computed(() => onlineMode.value && !detail.value);
</script>

<template>
  <div class="view">
    <!-- 在线音乐：歌单 / 搜索 切换 -->
    <div v-if="showOnlineRoot" class="online-tabs">
      <button
        class="seg"
        :class="{ active: tab === 'playlists' }"
        @click="tab = 'playlists'"
      >{{ t("online.playlists") }}</button>
      <button
        class="seg"
        :class="{ active: tab === 'search' }"
        @click="tab = 'search'"
      >{{ t("online.search") }}</button>
    </div>

    <!-- 歌单根列表 -->
    <template v-if="showOnlineRoot && tab === 'playlists'">
      <p class="online-hint">{{ t("online.hint") }}</p>
      <div class="online-grid">
        <button
          v-for="c in playlistCards"
          :key="c.key"
          class="song-card"
          @click="openPlaylist(c)"
          @contextmenu="onPlaylistContext($event, c)"
        >
          <button
            v-if="c.key.startsWith('user:')"
            class="p-remove"
            :title="t('online.removePlaylist')"
            @click.stop="removePlaylist(c.id!)"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
          <div class="thumb">
            <img v-if="coverOf(c)" :src="coverOf(c)" :alt="c.name" loading="lazy" />
            <span v-else class="placeholder material-symbols-outlined">
              {{ c.key === "local" ? "library_music" : "queue_music" }}
            </span>
          </div>
          <div class="s-meta">
            <div class="s-title" :title="c.name">{{ c.name }}</div>
            <div class="s-artist">{{ subtitleOf(c) }}</div>
          </div>
        </button>
      </div>

      <div class="add-playlist">
        <input v-model="addId" :placeholder="t('online.addId')" />
        <input v-model="addName" :placeholder="t('online.addName')" />
        <button class="lm-btn lm-btn--tonal" @click="addPlaylist">
          <span class="material-symbols-outlined">add</span>
          {{ t("online.addBtn") }}
        </button>
      </div>
      <p v-if="settings.onlinePlaylists.length" class="online-hint">
        {{ t("online.addHint") }}
      </p>

      <div v-if="onlineError" class="error-bar">
        <span class="material-symbols-outlined">error</span>
        {{ onlineError }}
      </div>
      <div v-if="onlineLoading" class="loading">{{ t("online.loading") }}</div>
    </template>

    <!-- 搜索根 -->
    <template v-if="showOnlineRoot && tab === 'search'">
      <div class="search-bar">
        <input
          v-model="searchQuery"
          :placeholder="t('online.searchPlaceholder')"
          @keyup.enter="doSearch"
        />
        <button class="lm-btn lm-btn--tonal" @click="doSearch">
          <span class="material-symbols-outlined">search</span>
          {{ t("online.searchBtn") }}
        </button>
      </div>
      <div v-if="onlineError" class="error-bar">
        <span class="material-symbols-outlined">error</span>
        {{ onlineError }}
      </div>
      <div v-if="onlineLoading" class="loading">{{ t("online.loading") }}</div>
    </template>

    <!-- 歌单 / 搜索详情 -->
    <template v-if="detail">
      <div class="detail-head">
        <button class="lm-icon-btn" @click="detail = null">
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <h2>{{ detail.type === "online" ? detail.title : t("online.local") }}</h2>
        <span v-if="detail.type === 'online'" class="count tabular-nums">
          {{ detail.songs.length }} {{ t("online.tracks") }}
        </span>
      </div>

      <div v-if="detail.type === 'online'" class="online-grid">
        <button
          v-for="(song, i) in detail.songs"
          :key="song.id"
          class="song-card"
          @click="playOnlineSongs(detail.songs, i)"
          @contextmenu="onSongContext($event, song)"
        >
          <div class="thumb">
            <img :src="song.pic" :alt="song.name" loading="lazy" decoding="async" />
          </div>
          <div class="s-meta">
            <div class="s-title" :title="song.name">{{ song.name }}</div>
            <div class="s-artist" :title="song.artist">{{ song.artist }}</div>
          </div>
        </button>
      </div>
      <div v-else-if="onlineLoading" class="loading">{{ t("online.loading") }}</div>
    </template>

    <!-- 本地音乐（原模式 或 点开「本地音乐」歌单） -->
    <template v-if="showLocal">
      <LibraryToolbar :count="items.length" @changed="load" />

      <div v-if="error" class="error-bar">
        <span class="material-symbols-outlined">error</span>
        {{ error }}
        <button class="lm-icon-btn" @click="error = ''">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <MediaGrid
        v-if="library.loading || items.length"
        :items="items"
        :loading="library.loading"
        aspect="1"
        :min-width="180"
        subtitle="artist"
        @open="playLocal"
        @favorite="library.toggleFavorite"
      />

      <EmptyState
        v-else-if="library.search"
        icon="search_off"
        :title="`未找到与「${library.search}」匹配的音乐`"
        description="试试其它关键词，或清除搜索条件。"
        action-label="清除搜索"
        @action="clearSearch"
      />

      <EmptyState
        v-else
        icon="music_note"
        :title="t('library.empty')"
        :description="
          hasScanDirs
            ? '已配置扫描目录，点击开始扫描以建立音乐索引。'
            : '尚未配置扫描目录。请先在设置中添加要索引的文件夹。'
        "
        :action-label="hasScanDirs ? t('actions.scan') : ''"
        secondary-label="前往设置"
        @action="library.startScan()"
        @secondary="router.push('/settings')"
      />
    </template>

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.view {
  min-height: 100%;
}

/* ---- 在线音乐 ---- */
.online-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  margin-bottom: 14px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-extra-large);
}
.online-tabs .seg {
  border: none;
  background: transparent;
  padding: 8px 22px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  color: var(--md-sys-color-on-surface-variant);
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.online-tabs .seg.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-weight: 600;
}

.online-hint {
  margin: 0 0 16px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

.add-playlist {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
}
.add-playlist input,
.search-bar input {
  flex: 1;
  min-width: 160px;
  padding: 10px 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  outline: none;
}
.add-playlist input:focus,
.search-bar input:focus {
  border-color: var(--md-sys-color-primary);
}

.p-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--md-sys-motion-duration-short), background 160ms;
}
.song-card:hover .p-remove {
  opacity: 1;
}
.p-remove:hover {
  background: var(--md-sys-color-error);
}
.p-remove .material-symbols-outlined {
  font-size: 16px;
}

.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.loading {
  padding: 20px 0;
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-body-small-size);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.detail-head h2 {
  flex: 1;
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-head .count {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

.online-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.song-card {
  position: relative;
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
.song-card .thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--md-sys-shape-corner-medium);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  transition: transform 200ms var(--md-sys-motion-spring-soft), box-shadow 200ms;
}
.song-card .thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.song-card .thumb .placeholder {
  font-size: 44px;
  color: var(--md-sys-color-outline);
  opacity: 0.7;
}
.song-card:hover .thumb {
  transform: translateY(-3px);
  box-shadow: var(--md-elevation-2), inset 0 0 0 1px var(--lm-hairline);
}
.s-meta {
  padding: 0 2px;
  min-width: 0;
}
.s-title {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.s-artist {
  margin-top: 2px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.error-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 14px;
  margin-bottom: 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font-size: var(--md-sys-typescale-body-small-size);
}
.error-bar > .material-symbols-outlined {
  font-size: 20px;
}
.error-bar .lm-icon-btn {
  margin-left: auto;
  width: 30px;
  height: 30px;
  color: inherit;
}
.error-bar .lm-icon-btn .material-symbols-outlined {
  font-size: 17px;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  box-shadow: var(--md-elevation-3);
  font-size: var(--md-sys-typescale-body-medium-size);
  z-index: 100;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 240ms var(--md-sys-motion-easing-emphasized-decelerate);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
