<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import LibraryToolbar from "@/components/LibraryToolbar.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import TrackList from "@/components/TrackList.vue";
import EmptyState from "@/components/EmptyState.vue";
import NowPlayingFeed from "@/components/NowPlayingFeed.vue";
import CachedCover from "@/components/CachedCover.vue";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { useNeteaseStore } from "@/stores/netease";
import { capabilities } from "@/capabilities";
import { openContextMenu, type MenuAnchor } from "@/composables/useContextMenu";
import { promptText } from "@/composables/useTextPrompt";
import { toOnlineSongs } from "@/utils/netease";
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
import type { NeteasePlaylist } from "@shared/types";

const library = useLibraryStore();
const player = usePlayerStore();
const settings = useSettingsStore();
const netease = useNeteaseStore();
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
onMounted(() => {
  void netease.init();
});
watch(
  () => settings.neteaseEnabled,
  (on) => {
    if (on) void netease.init();
  },
);
onActivated(() => {
  if (!items.value.length) void load();
});

// ---- 在线音乐（实验性）----
const onlineMode = computed(() => settings.enableOnlineMusic);
const tab = ref<"feed" | "playlists" | "search">("feed");

type Detail =
  | { type: "local" }
  | { type: "online"; title: string; songs: OnlineSong[] }
  | { type: "cloud"; title: string; songs: OnlineSong[]; loadingMore?: boolean };
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

/** 歌单卡片封面：我的歌单用封面图；其余取歌单内首曲封面 */
function coverOf(card: PlaylistCard): string | undefined {
  if (card.cover) return card.cover;
  return songsOf(card)?.[0]?.pic;
}

function subtitleOf(card: PlaylistCard): string {
  if (card.key === "local") return `${items.value.length} ${t("online.tracks")}`;
  if (card.count !== undefined) return `${card.count} ${t("online.tracks")}`;
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

/** 歌单卡片（含网易云：云盘 + 我的歌单） */
type PlaylistCard = {
  key: string;
  name: string;
  server?: MusicServer;
  id?: string;
  /** 远程封面（我的歌单） */
  cover?: string;
  /** 数量副标题（云盘/我的歌单） */
  count?: number;
};

/** 歌单卡片列表：网易云（云盘+我的歌单）→ 本地音乐 → 预设歌单 → 用户歌单 */
const playlistCards = computed<PlaylistCard[]>(() => {
  const server = settings.musicServer;
  const cards: PlaylistCard[] = [];
  if (settings.neteaseEnabled && netease.loggedIn) {
    cards.push({
      key: "cloud",
      name: t("netease.cloud"),
      id: "cloud",
      count: netease.cloudCount,
    });
    for (const p of netease.playlists) {
      cards.push({
        key: `mine:${p.id}`,
        name: p.name,
        id: `mine:${p.id}`,
        cover: p.coverUrl,
        count: p.trackCount,
      });
    }
  }
  cards.push({ key: "local", name: t("online.local") });
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

async function openPlaylist(card: PlaylistCard) {
  // 网易云云盘
  if (card.key === "cloud") {
    await openCloud();
    return;
  }
  // 网易云我的歌单
  if (card.key.startsWith("mine:")) {
    const id = Number(card.key.slice("mine:".length));
    onlineLoading.value = true;
    onlineError.value = "";
    try {
      const songs = await capabilities.neteasePlaylistDetail(id);
      const online = await toOnlineSongs(songs);
      detail.value = { type: "online", title: card.name, songs: online };
    } catch (e) {
      onlineError.value = e instanceof Error ? e.message : String(e);
    } finally {
      onlineLoading.value = false;
    }
    return;
  }
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

/** 打开云盘：首页 + 批量解析播放 URL */
async function openCloud() {
  onlineLoading.value = true;
  onlineError.value = "";
  try {
    const songs = await netease.loadCloudPage(0);
    const online = await toOnlineSongs(songs);
    detail.value = { type: "cloud", title: t("netease.cloud"), songs: online };
  } catch (e) {
    onlineError.value = e instanceof Error ? e.message : String(e);
  } finally {
    onlineLoading.value = false;
  }
}

/** 云盘分页加载更多 */
async function loadMoreCloud() {
  const d = detail.value;
  if (!d || d.type !== "cloud" || d.loadingMore) return;
  d.loadingMore = true;
  onlineError.value = "";
  try {
    const songs = await netease.loadCloudPage(d.songs.length);
    const online = await toOnlineSongs(songs);
    d.songs.push(...online);
  } catch (e) {
    onlineError.value = e instanceof Error ? e.message : String(e);
  } finally {
    d.loadingMore = false;
  }
}

/** 退出登录：清 Rust 侧 cookie + 本地状态 */
async function logoutNetease() {
  await netease.logout();
  if (detail.value?.type === "cloud") detail.value = null;
  notify(t("netease.loggedOut"));
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
function onPlaylistContext(e: MenuAnchor, card: PlaylistCard) {
  if (!card.id) return;
  // 网易云云盘/我的歌单不支持重命名/移除
  if (card.key === "cloud" || card.key.startsWith("mine:")) return;
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

function onSongContext(e: MenuAnchor, song: OnlineSong) {
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
  // 网易云无版权/VIP 歌曲 url 为空，直接提示不进入播放器
  if (!songs[index]?.url) {
    error.value = t("netease.playFailed");
    return;
  }
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

/** 现在就听信息流：直接播放 */
function handleFeedPlaySongs(songs: OnlineSong[], index: number) {
  playOnlineSongs(songs, index);
}

/** 现在就听信息流：打开推荐歌单 */
async function openNeteasePlaylist(id: number, name: string) {
  onlineLoading.value = true;
  onlineError.value = "";
  try {
    const songs = await capabilities.neteasePlaylistDetail(id);
    const online = await toOnlineSongs(songs);
    detail.value = { type: "online", title: name, songs: online };
  } catch (e) {
    onlineError.value = e instanceof Error ? e.message : String(e);
  } finally {
    onlineLoading.value = false;
  }
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
    <PageHeader :title="t('nav.music')" :description="t('navDesc.music')" />
    <!-- 在线音乐：推荐 / 歌单 / 搜索 切换 -->
    <div v-if="showOnlineRoot" class="online-tabs">
      <button
        class="seg"
        :class="{ active: tab === 'feed' }"
        @click="tab = 'feed'"
      >{{ t("homeFeed.forYou") }}</button>
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

    <!-- 现在就听信息流 -->
    <template v-if="showOnlineRoot && tab === 'feed'">
      <NowPlayingFeed
        @play-songs="handleFeedPlaySongs"
        @open-playlist="openNeteasePlaylist"
      />
    </template>

    <!-- 歌单根列表 -->
    <template v-if="showOnlineRoot && tab === 'playlists'">
      <!-- 网易云账号条 -->
      <div v-if="settings.neteaseEnabled" class="netease-bar">
        <template v-if="netease.loggedIn">
          <CachedCover
            v-if="netease.profile?.avatarUrl"
            :url="netease.profile.avatarUrl"
            class="avatar"
            alt=""
          />
          <span v-else class="avatar placeholder">
            <span class="material-symbols-outlined">person</span>
          </span>
          <span class="nickname">{{ netease.profile?.nickname ?? "" }}</span>
          <span class="spacer"></span>
          <button class="lm-btn lm-btn--text" @click="logoutNetease">
            <span class="material-symbols-outlined">logout</span>
            {{ t("netease.logout") }}
          </button>
        </template>
        <template v-else>
          <span class="avatar placeholder">
            <span class="material-symbols-outlined">person</span>
          </span>
          <span class="nickname">{{ t("netease.loginHint") }}</span>
          <span class="spacer"></span>
          <button class="lm-btn lm-btn--tonal" @click="netease.openQr()">
            <span class="material-symbols-outlined">qr_code</span>
            {{ t("netease.login") }}
          </button>
        </template>
      </div>
      <p class="online-hint">{{ t("online.hint") }}</p>
      <div class="online-grid">
        <button
          v-for="c in playlistCards"
          :key="c.key"
          class="song-card"
          @click="openPlaylist(c)"
          @contextmenu="onPlaylistContext($event, c)"
          v-long-press="(pos: MenuAnchor) => onPlaylistContext(pos, c)"
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
            <CachedCover v-if="coverOf(c)" :url="coverOf(c)" :alt="c.name" />
            <span v-else class="placeholder material-symbols-outlined">
              {{ c.key === "local" ? "library_music" : c.key === "cloud" ? "cloud" : "queue_music" }}
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
        <h2>{{ detail.type === "local" ? t("online.local") : detail.title }}</h2>
        <span v-if="detail.type !== 'local'" class="count tabular-nums">
          {{ detail.songs.length }} {{ t("online.tracks") }}
        </span>
        <div
          v-if="detail.type !== 'local'"
          class="segmented view-toggle"
        >
          <button
            class="seg"
            :class="{ active: settings.musicViewMode === 'grid' }"
            :title="t('settings.musicViewMode_grid')"
            @click="settings.musicViewMode = 'grid'"
          >
            <span class="material-symbols-outlined">grid_view</span>
          </button>
          <button
            class="seg"
            :class="{ active: settings.musicViewMode === 'list' }"
            :title="t('settings.musicViewMode_list')"
            @click="settings.musicViewMode = 'list'"
          >
            <span class="material-symbols-outlined">view_list</span>
          </button>
        </div>
      </div>

      <div
        v-if="(detail.type === 'online' || detail.type === 'cloud') && settings.musicViewMode === 'grid'"
        class="online-grid"
      >
        <button
          v-for="(song, i) in detail.songs"
          :key="song.id"
          class="song-card"
          @click="playOnlineSongs(detail.songs, i)"
          @contextmenu="onSongContext($event, song)"
          v-long-press="(pos: MenuAnchor) => onSongContext(pos, song)"
        >
          <div class="thumb">
            <CachedCover v-if="song.pic" :url="song.pic" :alt="song.name" />
            <span v-else class="placeholder material-symbols-outlined">music_note</span>
          </div>
          <div class="s-meta">
            <div class="s-title" :title="song.name">{{ song.name }}</div>
            <div class="s-artist" :title="song.artist">{{ song.artist }}</div>
          </div>
        </button>
      </div>

      <div
        v-else-if="(detail.type === 'online' || detail.type === 'cloud') && settings.musicViewMode === 'list'"
        class="online-list"
      >
        <button
          v-for="(song, i) in detail.songs"
          :key="song.id"
          class="online-row"
          @click="playOnlineSongs(detail.songs, i)"
          @contextmenu="onSongContext($event, song)"
          v-long-press="(pos: MenuAnchor) => onSongContext(pos, song)"
        >
          <div class="o-thumb">
            <CachedCover v-if="song.pic" :url="song.pic" :alt="song.name" />
            <span v-else class="material-symbols-outlined">music_note</span>
          </div>
          <div class="o-main">
            <div class="o-title" :title="song.name">{{ song.name }}</div>
            <div class="o-artist" :title="song.artist">{{ song.artist || "—" }}</div>
          </div>
        </button>
      </div>
      <div v-else-if="onlineLoading" class="loading">{{ t("online.loading") }}</div>

      <!-- 云盘：空态 / 加载更多 -->
      <EmptyState
        v-if="detail.type === 'cloud' && !detail.songs.length && !onlineLoading"
        icon="cloud_off"
        :title="t('netease.cloudEmpty')"
        :description="t('netease.cloudEmptyHint')"
      />
      <div v-if="detail.type === 'cloud' && detail.loadingMore" class="loading">
        {{ t("online.loading") }}
      </div>
      <button
        v-if="detail.type === 'cloud' && !detail.loadingMore && netease.cloudHasMore"
        class="load-more"
        @click="loadMoreCloud"
      >
        {{ t("netease.loadMore") }}
      </button>
    </template>

    <!-- 本地音乐（原模式 或 点开「本地音乐」歌单） -->
    <template v-if="showLocal">
      <div class="local-head">
        <LibraryToolbar :count="items.length" @changed="load" />
        <div class="segmented view-toggle">
          <button
            class="seg"
            :class="{ active: settings.musicViewMode === 'grid' }"
            :title="t('settings.musicViewMode_grid')"
            @click="settings.musicViewMode = 'grid'"
          >
            <span class="material-symbols-outlined">grid_view</span>
          </button>
          <button
            class="seg"
            :class="{ active: settings.musicViewMode === 'list' }"
            :title="t('settings.musicViewMode_list')"
            @click="settings.musicViewMode = 'list'"
          >
            <span class="material-symbols-outlined">view_list</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="error-bar">
        <span class="material-symbols-outlined">error</span>
        {{ error }}
        <button class="lm-icon-btn" @click="error = ''">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <MediaGrid
        v-if="(library.loading || items.length) && settings.musicViewMode === 'grid'"
        :items="items"
        :loading="library.loading"
        aspect="1"
        :min-width="180"
        subtitle="artist"
        @open="playLocal"
        @favorite="library.toggleFavorite"
      />

      <TrackList
        v-else-if="items.length && settings.musicViewMode === 'list'"
        :items="items"
        @open="playLocal"
        @favorite="library.toggleFavorite"
        @notify="notify"
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

    <!-- 网易云登录弹窗（扫码 / 手机号） -->
    <transition name="qr-fade">
      <div v-if="netease.qrOpen" class="qr-mask" @click.self="netease.closeQr()">
        <div class="qr-card">
          <h3>{{ t("netease.loginTitle") }}</h3>
          <!-- 切换 tab -->
          <div class="phone-tabs">
            <button
              :class="['phone-tab', { active: netease.authTab === 'qr' }]"
              @click="netease.authTab = 'qr'; netease.phoneError = ''"
            >
              <span class="material-symbols-outlined">qr_code</span>
              {{ t("netease.qrTab") }}
            </button>
            <button
              :class="['phone-tab', { active: netease.authTab === 'phone' }]"
              @click="netease.authTab = 'phone'; netease.phoneError = ''"
            >
              <span class="material-symbols-outlined">smartphone</span>
              {{ t("netease.phoneTab") }}
            </button>
          </div>

          <!-- 扫码登录 -->
          <template v-if="netease.authTab === 'qr'">
            <div class="qr-img-wrap">
              <img v-if="netease.qrCode" :src="netease.qrCode" alt="QR" class="qr-img" />
              <div v-else class="qr-loading">{{ t("online.loading") }}</div>
            </div>
            <p class="qr-status" :class="{ error: netease.qrState === 'error' }">
              <template v-if="netease.qrState === 'wait'">{{ t("netease.scanWaiting") }}</template>
              <template v-else-if="netease.qrState === 'scanned'">{{ t("netease.scanScanned") }}</template>
              <template v-else-if="netease.qrState === 'confirmed'">{{ t("netease.scanConfirmed") }}</template>
              <template v-else-if="netease.qrState === 'success'">{{ t("netease.scanSuccess") }}</template>
              <template v-else-if="netease.qrState === 'timeout'">{{ t("netease.scanTimeout") }}</template>
              <template v-else-if="netease.qrState === 'error'">{{ netease.qrError }}</template>
            </p>
            <div class="qr-actions">
              <button class="lm-btn lm-btn--text" @click="netease.closeQr()">
                {{ t("actions.cancel") }}
              </button>
              <button
                v-if="netease.qrState === 'error' || netease.qrState === 'timeout'"
                class="lm-btn lm-btn--tonal"
                @click="netease.openQr()"
              >
                <span class="material-symbols-outlined">refresh</span>
                {{ t("netease.login") }}
              </button>
            </div>
          </template>

          <!-- 手机号登录 -->
          <template v-else>
            <div class="phone-form">
              <input
                v-model="netease.phone"
                type="tel"
                inputmode="numeric"
                maxlength="11"
                placeholder="手机号"
                class="phone-input"
                @keyup.enter="netease.sendSmsCaptcha()"
              />
              <div class="sms-row">
                <input
                  v-model="netease.smsCode"
                  type="text"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="短信验证码"
                  class="phone-input sms-input"
                  @keyup.enter="netease.phoneLogin()"
                />
                <button
                  class="sms-btn"
                  :disabled="netease.smsSending || netease.smsCooldown > 0"
                  @click="netease.sendSmsCaptcha()"
                >
                  <template v-if="netease.smsCooldown > 0">
                    {{ netease.smsCooldown }}s
                  </template>
                  <template v-else-if="netease.smsSending">
                    发送中…
                  </template>
                  <template v-else>
                    获取验证码
                  </template>
                </button>
              </div>
              <p v-if="netease.phoneError" class="phone-error">{{ netease.phoneError }}</p>
              <button
                class="phone-login-btn"
                :disabled="netease.phoneLogging"
                @click="netease.phoneLogin()"
              >
                {{ netease.phoneLogging ? "登录中…" : "登录" }}
              </button>
              <div class="phone-actions">
                <button class="lm-btn lm-btn--text" @click="netease.closeQr()">
                  {{ t("actions.cancel") }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </transition>

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
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  transition:
    transform 220ms var(--md-sys-motion-spring-soft),
    box-shadow 220ms var(--md-sys-motion-easing-standard);
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
  transform: translateY(-4px) scale(1.015);
  box-shadow: var(--md-elevation-3), inset 0 0 0 1px var(--lm-hairline);
}
.song-card:active .thumb {
  transform: translateY(-1px) scale(0.995);
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

/* 在线歌单/搜索详情：列表模式行 */
.online-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.online-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 10px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.online-row:hover {
  background: var(--md-sys-color-surface-container);
}
.o-thumb {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--md-sys-shape-corner-small);
  overflow: hidden;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-outline);
}
.o-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.o-thumb .material-symbols-outlined {
  font-size: 20px;
}
.o-main {
  flex: 1;
  min-width: 0;
}
.o-title {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.o-artist {
  margin-top: 2px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.o-duration {
  flex: none;
  min-width: 44px;
  text-align: right;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

.local-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
/* LibraryToolbar 根节点类名是 .toolbar */
.local-head :deep(.toolbar) {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}
.view-toggle {
  display: flex;
  gap: 2px;
  flex: none;
  padding: 3px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container);
}
.view-toggle .seg {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 30px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}
.view-toggle .seg.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.view-toggle .material-symbols-outlined {
  font-size: 18px;
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

/* ---- 网易云账号 ---- */
.netease-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-extra-large);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
}
.avatar.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}
.avatar.placeholder .material-symbols-outlined {
  font-size: 20px;
}
.nickname {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.netease-bar .spacer {
  flex: 1;
}

/* ---- 登录弹窗 ---- */
.qr-mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}
.qr-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 300px;
  padding: 24px 28px 18px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-extra-large);
  box-shadow: var(--md-elevation-3);
  animation: lm-rise 260ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.qr-card h3 {
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: var(--md-sys-typescale-title-medium-weight);
}
.qr-img-wrap {
  width: 224px;
  height: 224px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--md-sys-shape-corner-medium);
  background: #fff;
  overflow: hidden;
}
.qr-img {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
.qr-loading {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.qr-status {
  min-height: 20px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  text-align: center;
}
.qr-status.error {
  color: var(--md-sys-color-error);
}
.qr-actions {
  display: flex;
  gap: 8px;
}
.qr-actions .material-symbols-outlined {
  font-size: 18px;
}

/* ---- 手机号登录 tab ---- */
.phone-tabs {
  display: flex;
  gap: 4px;
  width: 100%;
  background: var(--md-sys-color-surface-container);
  border-radius: var(--md-sys-shape-corner-full);
  padding: 3px;
}
.phone-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-small-size);
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.phone-tab.active {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--md-elevation-1);
}
.phone-tab .material-symbols-outlined {
  font-size: 16px;
}
.phone-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}
.phone-input {
  height: 40px;
  width: 100%;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-small-size);
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.phone-input:focus {
  border-color: var(--md-sys-color-primary);
}
.sms-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.sms-input {
  flex: 1;
  min-width: 0;
}
.sms-btn {
  height: 40px;
  padding: 0 14px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-small-size);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.sms-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sms-btn:hover:not(:disabled) {
  background: var(--md-sys-color-surface-container-highest);
}
.phone-error {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-error);
  text-align: center;
  margin: 0;
}
.phone-login-btn {
  height: 40px;
  width: 100%;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.phone-login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.phone-login-btn:hover:not(:disabled) {
  opacity: 0.92;
}
.phone-actions {
  display: flex;
  justify-content: center;
}

.qr-fade-enter-active,
.qr-fade-leave-active {
  transition: opacity 200ms var(--md-sys-motion-easing-standard);
}
.qr-fade-enter-from,
.qr-fade-leave-to {
  opacity: 0;
}

/* 云盘加载更多 */
.load-more {
  display: block;
  margin: 18px auto 8px;
  padding: 9px 22px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.load-more:hover {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
}

</style>