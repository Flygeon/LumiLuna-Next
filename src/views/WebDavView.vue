<script setup lang="ts">
/**
 * WebDAV 远程媒体浏览器：面包屑 + 目录/文件网格。
 * 音频直接进播放器队列；图片/视频走 MediaViewer lightbox（代理 URL）；
 * 书籍暂不支持（提示）。所有请求经 Rust command / 本地代理，凭据不落地前端。
 */
import { computed, onActivated, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import EmptyState from "@/components/EmptyState.vue";
import MediaViewer from "@/components/MediaViewer.vue";
import PageHeader from "@/components/PageHeader.vue";
import { useSettingsStore } from "@/stores/settings";
import { usePlayerStore } from "@/stores/player";
import { capabilities } from "@/capabilities";
import {
  entryType,
  titleOf,
  webdavList,
  webdavListCached,
  webdavMediaUrl,
} from "@/utils/webdav";
import { formatSize } from "@/utils/format";
import { translate } from "@shared/i18n";
import type { MediaEntry, MediaType, WebDavEntry } from "@shared/types";

const settings = useSettingsStore();
const player = usePlayerStore();
const router = useRouter();

const path = ref("");
const entries = ref<WebDavEntry[]>([]);
const loading = ref(false);
const error = ref("");
const toast = ref("");
let toastTimer: number | null = null;

/** 媒体 URL 缓存（Rust command 只做字符串拼装，无网络开销） */
const mediaUrls = new Map<string, string>();
const thumbs = ref(new Map<string, string>());

const viewerOpen = ref(false);
const viewerItems = ref<MediaEntry[]>([]);
const viewerIndex = ref(0);

function t(key: string) {
  return translate(settings.lang, key);
}

function notify(message: string) {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 2600);
}

const crumbs = computed(() => {
  const parts = path.value ? path.value.split("/") : [];
  const items = [{ label: t("webdav.root"), target: "" }];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    items.push({ label: part, target: acc });
  }
  return items;
});

const dirs = computed(() => entries.value.filter((e) => e.isDir));
const files = computed(() => entries.value.filter((e) => !e.isDir));

async function load(dir: string) {
  path.value = dir;
  loading.value = true;
  error.value = "";
  let hasCache = false;
  try {
    const cached = await webdavListCached(dir);
    if (cached) {
      // 先展示持久化索引，秒开；随后在后台拉取最新状态并更新缓存
      entries.value = cached;
      hasCache = true;
      loading.value = false;
      for (const f of cached) {
        if (entryType(f) === "image") loadThumb(f);
      }
    }
  } catch {
    /* 读取缓存失败时继续走在线刷新 */
  }

  try {
    const fresh = await webdavList(dir);
    entries.value = fresh;
    hasCache = true;
    loading.value = false;
    // 预解析可见图片的代理 URL（本地字符串拼装，无网络请求）
    for (const f of fresh) {
      if (entryType(f) === "image") loadThumb(f);
    }
  } catch (e) {
    if (!hasCache) {
      error.value = String(e);
      entries.value = [];
      loading.value = false;
    } else {
      // 有缓存时后台刷新失败不打断浏览，仅提示保留的是索引缓存
      loading.value = false;
      notify(`${t("webdav.refresh")} 失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function refresh() {
  // 绕过 30s 缓存强制重列当前目录
  import("@/utils/webdav").then(({ clearWebDavListCache }) => {
    clearWebDavListCache();
    void load(path.value);
  });
}

onMounted(() => {
  if (settings.webdavEnabled) void load("");
});
onActivated(() => {
  if (settings.webdavEnabled && !loading.value && !entries.value.length) {
    void load(path.value);
  }
});
watch(
  () => settings.webdavEnabled,
  (on) => {
    if (on) void load(path.value);
    else entries.value = [];
  },
);

async function mediaUrlOf(entry: WebDavEntry): Promise<string> {
  let url = mediaUrls.get(entry.path);
  if (!url) {
    url = await webdavMediaUrl(entry.path);
    mediaUrls.set(entry.path, url);
  }
  return url;
}

/** 图片缩略图：代理 URL 解析完成后就地更新 */
function thumbSrc(entry: WebDavEntry): string {
  return thumbs.value.get(entry.path) ?? "";
}
function loadThumb(entry: WebDavEntry) {
  if (thumbs.value.has(entry.path)) return;
  void mediaUrlOf(entry)
    .then((url) => {
      thumbs.value = new Map(thumbs.value).set(entry.path, url);
    })
    .catch(() => {});
}
const TYPE_ICONS: Record<string, string> = {
  video: "movie",
  audio: "music_note",
  book: "menu_book",
  other: "description",
};

function toMediaEntry(entry: WebDavEntry, type: MediaType): MediaEntry {
  return {
    id: `webdav:${entry.path}`,
    path: entry.path,
    parent: entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : "",
    name: entry.name,
    ext: entry.name.split(".").pop() ?? "",
    type,
    size: entry.size,
    mtime: entry.mtime,
    scannedAt: entry.mtime,
    deleted: 0,
    title: titleOf(entry),
    hasCover: false,
    favorite: false,
  };
}

function viewerSrcOf(item: MediaEntry): string {
  return mediaUrls.get(item.path) ?? "";
}

function viewerOpenExternal(item: MediaEntry) {
  const url = mediaUrls.get(item.path);
  if (url) void capabilities.openUrl(url);
}

function open(entry: WebDavEntry) {
  const type = entryType(entry);
  if (type === "dir") {
    void load(entry.path);
    return;
  }
  if (type === "audio") {
    const audioOnly = files.value.filter((f) => entryType(f) === "audio");
    const index = Math.max(
      audioOnly.findIndex((a) => a.path === entry.path),
      0,
    );
    player.setQueue(audioOnly, index);
    void player.loadWebDavSong(audioOnly[index]);
    router.push("/music/player");
    return;
  }
  if (type === "image" || type === "video") {
    const mediaFiles = files.value.filter((f) => {
      const ft = entryType(f);
      return ft === "image" || ft === "video";
    });
    const index = Math.max(
      mediaFiles.findIndex((m) => m.path === entry.path),
      0,
    );
    // 打开前先把可见媒体的代理 URL 解析好（本地字符串拼装，无网络请求）
    void Promise.all(mediaFiles.map((m) => mediaUrlOf(m)))
      .then(() => {
        viewerItems.value = mediaFiles.map((m) =>
          toMediaEntry(m, entryType(m) === "image" ? "image" : "video"),
        );
        viewerIndex.value = index;
        viewerOpen.value = true;
      })
      .catch((e) => notify(String(e)));
    return;
  }
  if (type === "book") {
    notify(t("webdav.booksUnsupported"));
    return;
  }
  notify(`${entry.name} · ${formatSize(entry.size)}`);
}

function typeOf(entry: WebDavEntry) {
  return entryType(entry);
}
</script>

<template>
  <div class="webdav-view">
    <PageHeader :title="t('nav.webdav')" />
    <!-- 未启用 / 未配置 -->
    <EmptyState
      v-if="!settings.webdavEnabled"
      icon="cloud_off"
      :title="settings.webdavUrl ? t('webdav.disabled') : t('webdav.notConfigured')"
      :description="t('webdav.notConfiguredHint')"
      :action-label="t('webdav.goSettings')"
      @action="router.push('/settings')"
    />

    <template v-else>
      <!-- 面包屑 + 刷新 -->
      <div class="crumbs">
        <button
          v-for="(c, i) in crumbs"
          :key="c.target"
          class="crumb"
          :class="{ current: i === crumbs.length - 1 }"
          @click="i < crumbs.length - 1 && load(c.target)"
        >
          <span class="material-symbols-outlined" v-if="i === 0">home</span>
          {{ c.label }}
        </button>
        <button class="lm-icon-btn small refresh" title="刷新" @click="refresh">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </div>

      <!-- 错误 -->
      <div v-if="error" class="dav-error">
        <span class="material-symbols-outlined">error</span>
        <span class="err-text">{{ error }}</span>
        <button class="lm-btn lm-btn--text" @click="load(path)">{{ t("webdav.retry") }}</button>
      </div>

      <!-- 加载骨架 -->
      <div v-if="loading" class="dav-grid">
        <div v-for="n in 10" :key="n" class="lm-skeleton tile-skeleton"></div>
      </div>

      <!-- 空目录 -->
      <EmptyState
        v-else-if="!entries.length && !error"
        icon="folder_open"
        :title="t('webdav.emptyDir')"
        :description="t('webdav.emptyDirHint')"
      />

      <template v-else>
        <!-- 目录 -->
        <section v-if="dirs.length" class="dav-section">
          <h4 class="section-title">{{ t("webdav.folders") }}</h4>
          <div class="dav-grid">
            <button
              v-for="d in dirs"
              :key="d.path"
              class="tile dir-tile"
              @click="load(d.path)"
            >
              <span class="material-symbols-outlined tile-icon folder">folder</span>
              <span class="tile-name" :title="d.name">{{ d.name }}</span>
            </button>
          </div>
        </section>

        <!-- 文件 -->
        <section v-if="files.length" class="dav-section">
          <h4 class="section-title">
            {{ t("nav.webdav") }} · {{ files.length }} {{ t("webdav.items") }}
          </h4>
          <div class="dav-grid">
            <button
              v-for="f in files"
              :key="f.path"
              class="tile file-tile"
              @click="open(f)"
              @dblclick="open(f)"
            >
              <img
                v-if="typeOf(f) === 'image'"
                class="tile-thumb"
                :src="thumbSrc(f)"
                loading="lazy"
                alt=""
              />
              <span
                v-else
                class="material-symbols-outlined tile-icon"
                :class="typeOf(f)"
              >{{ TYPE_ICONS[typeOf(f)] ?? "description" }}</span>
              <span class="tile-name" :title="f.name">{{ f.name }}</span>
              <span v-if="!typeOf(f).startsWith('image')" class="tile-size tabular-nums">
                {{ f.size > 0 ? formatSize(f.size) : "" }}
              </span>
            </button>
          </div>
        </section>
      </template>
    </template>

    <!-- 图片/视频 lightbox -->
    <MediaViewer
      v-if="viewerOpen"
      :items="viewerItems"
      :index="viewerIndex"
      :src-of="viewerSrcOf"
      :open-external="viewerOpenExternal"
      @close="viewerOpen = false"
      @update:index="viewerIndex = $event"
    />

    <transition name="toast">
      <div v-if="toast" class="dav-toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.webdav-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
}

/* ---- 面包屑 ---- */
.crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 240px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background var(--md-sys-motion-duration-short);
}
.crumb:hover {
  background: var(--md-sys-color-surface-container);
}
.crumb.current {
  color: var(--md-sys-color-on-surface);
  font-weight: 600;
}
.crumb .material-symbols-outlined {
  font-size: 16px;
}
.crumb:not(:last-child)::after {
  content: "/";
  margin-left: 4px;
  opacity: 0.45;
}
.crumbs .refresh {
  margin-left: 6px;
}

/* ---- 错误 ---- */
.dav-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font-size: var(--md-sys-typescale-body-small-size);
}
.dav-error .material-symbols-outlined {
  font-size: 19px;
  flex: none;
}
.dav-error .err-text {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

/* ---- 网格 ---- */
.dav-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-title {
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.dav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 14px 10px 12px;
  border: none;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-low);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  cursor: pointer;
  transition:
    transform 160ms var(--md-sys-motion-spring),
    background var(--md-sys-motion-duration-short),
    box-shadow var(--md-sys-motion-duration-short);
}
.tile:hover {
  background: var(--md-sys-color-surface-container-high);
  transform: translateY(-2px);
}
.tile:active {
  transform: scale(0.97);
}
.tile-icon {
  font-size: 34px;
  font-variation-settings: 'FILL' 0, 'wght' 300;
  color: var(--md-sys-color-on-surface-variant);
}
.tile-icon.folder {
  color: var(--md-sys-color-primary);
  font-variation-settings: 'FILL' 1, 'wght' 400;
}
.tile-icon.video {
  color: #d98b4a;
}
.tile-icon.audio {
  color: #4aa8d9;
}
.tile-icon.book {
  color: #7d9a5a;
}
.tile-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-high);
}
.tile-name {
  width: 100%;
  font-size: var(--md-sys-typescale-body-small-size);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile-size {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
  opacity: 0.75;
}
.tile-skeleton {
  aspect-ratio: 1;
  border-radius: var(--md-sys-shape-corner-extra-large);
}

/* ---- toast ---- */
.dav-toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  z-index: 300;
  padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  box-shadow: var(--md-elevation-3);
  font-size: var(--md-sys-typescale-body-medium-size);
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