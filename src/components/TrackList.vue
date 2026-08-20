<script setup lang="ts">
/**
 * 音乐列表模式行：封面 + 标题/艺人/专辑 + 时长，
 * 悬停出现 收藏 / 下一首播放 / 加入队列 / 更多（右键菜单同款操作）。
 */
import { onBeforeUnmount, ref } from "vue";
import VirtualList from "@/components/VirtualList.vue";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { openContextMenu, type MenuAnchor } from "@/composables/useContextMenu";
import { translate } from "@shared/i18n";
import { formatDuration } from "@/utils/format";
import type { MediaEntry } from "@shared/types";

const props = defineProps<{ items: MediaEntry[] }>();

const emit = defineEmits<{
  (e: "open", item: MediaEntry, index: number): void;
  (e: "favorite", item: MediaEntry): void;
  (e: "notify", message: string): void;
}>();

const library = useLibraryStore();
const player = usePlayerStore();
const settings = useSettingsStore();

const ROW_H = 56;

function t(key: string) {
  return translate(settings.lang, key);
}

function titleOf(item: MediaEntry) {
  return item.title || item.name;
}

function subtitleOf(item: MediaEntry) {
  return [item.artist, item.album].filter(Boolean).join(" · ") || "未知艺术家";
}

function thumbOf(item: MediaEntry) {
  return library.getThumb(item.id);
}

// ---- 缩略图：按 VirtualList 可视区间批量拉取（120ms 防抖，同 MediaGrid）----
const range = ref({ start: 0, end: Math.min(props.items.length, 80) });
let thumbTimer: number | null = null;

function onRangeChange(next: { start: number; end: number }) {
  range.value = next;
  if (!props.items.length) return;
  if (thumbTimer !== null) clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => {
    thumbTimer = null;
    const ids = props.items
      .slice(next.start, next.end)
      .map((item) => item.id);
    if (ids.length) void library.loadThumbnails(ids);
  }, 120);
}

onBeforeUnmount(() => {
  if (thumbTimer !== null) clearTimeout(thumbTimer);
});

// ---- 右击 / 行内操作 ----
function menuOf(item: MediaEntry) {
  return [
    { id: "play", label: t("context.play"), icon: "play_arrow" },
    { id: "play-next", label: t("context.playNext"), icon: "skip_next" },
    { id: "add-queue", label: t("context.addToQueue"), icon: "queue_music" },
    {
      id: "favorite",
      label: item.favorite ? t("context.unfavorite") : t("context.favorite"),
      icon: item.favorite ? "heart_broken" : "favorite",
    },
    { id: "reveal", label: t("context.revealInExplorer"), icon: "folder_open" },
  ];
}

function onMenuSelect(id: string, item: MediaEntry, index: number) {
  switch (id) {
    case "play":
      emit("open", item, index);
      break;
    case "play-next":
      player.playNext(item);
      emit("notify", t("actions.playNextQueued"));
      break;
    case "add-queue":
      void player.addToQueue(item);
      emit("notify", t("actions.addedToQueue"));
      break;
    case "favorite":
      emit("favorite", item);
      break;
    case "reveal":
      void capabilities.revealInExplorer(item.path);
      break;
    default:
      break;
  }
}

function onRowContext(e: MenuAnchor, item: MediaEntry, index: number) {
  openContextMenu(e, menuOf(item), (id) => onMenuSelect(id, item, index));
}
</script>

<template>
  <VirtualList
    :items="items"
    :item-height="ROW_H"
    :item-key="(item: MediaEntry) => item.id"
    @range-change="onRangeChange"
  >
    <template #default="{ item, index }">
      <div
        class="track-row"
        tabindex="0"
        @click="emit('open', item, index)"
        @contextmenu="onRowContext($event, item, index)"
        v-long-press="(pos: MenuAnchor) => onRowContext(pos, item, index)"
        @keydown.enter="emit('open', item, index)"
        @keydown.space.prevent="emit('open', item, index)"
      >
        <div class="r-cover">
          <img v-if="thumbOf(item)" :src="thumbOf(item)" :alt="titleOf(item)" loading="lazy" decoding="async" />
          <span v-else class="material-symbols-outlined">music_note</span>
        </div>

        <div class="r-main">
          <div class="r-title" :title="titleOf(item)">{{ titleOf(item) }}</div>
          <div class="r-sub" :title="subtitleOf(item)">{{ subtitleOf(item) }}</div>
        </div>

        <div class="r-actions">
          <button
            class="lm-icon-btn r-action"
            :class="{ on: item.favorite }"
            :title="item.favorite ? t('context.unfavorite') : t('context.favorite')"
            @click.stop="emit('favorite', item)"
          >
            <span class="material-symbols-outlined" :class="{ filled: item.favorite }">favorite</span>
          </button>
          <button
            class="lm-icon-btn r-action"
            :title="t('context.playNext')"
            @click.stop="player.playNext(item); emit('notify', t('actions.playNextQueued'))"
          >
            <span class="material-symbols-outlined">skip_next</span>
          </button>
          <button
            class="lm-icon-btn r-action"
            :title="t('context.addToQueue')"
            @click.stop="void player.addToQueue(item); emit('notify', t('actions.addedToQueue'))"
          >
            <span class="material-symbols-outlined">queue_music</span>
          </button>
          <button
            class="lm-icon-btn r-action r-action--more"
            :title="t('actions.more')"
            @click.stop="onRowContext($event, item, index)"
          >
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>

        <div class="r-duration tabular-nums">
          {{ item.durationMs ? formatDuration(item.durationMs) : "--:--" }}
        </div>
      </div>
    </template>
  </VirtualList>
</template>

<style scoped>
.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 10px;
  border-radius: var(--md-sys-shape-corner-medium);
  cursor: pointer;
  height: 100%;
  box-sizing: border-box;
  outline: none;
}
.track-row:hover {
  background: var(--md-sys-color-surface-container);
}
.track-row:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: -2px;
}
.r-cover {
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
.r-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.r-cover .material-symbols-outlined {
  font-size: 20px;
}
.r-main {
  flex: 1;
  min-width: 0;
}
.r-title {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.r-sub {
  margin-top: 2px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.r-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.track-row:hover .r-actions,
.track-row:focus-visible .r-actions {
  opacity: 1;
}
/* 触屏没有 hover，行内操作永远不显形。但四个按钮共占 142px，360dp 屏上
   标题只剩 50 来 px，所以移动端只留「更多」——它打开的正是长按/右键
   那份菜单，收藏/下一首播放/加入队列都在里面。
   :global 是因为 .is-mobile 挂在 <html> 上，不在本组件 scope 内。 */
:global(html.is-mobile) .r-actions {
  opacity: 1;
}
:global(html.is-mobile) .r-action:not(.r-action--more) {
  display: none;
}
.r-action {
  width: 34px;
  height: 34px;
}
.r-action .material-symbols-outlined {
  font-size: 20px;
}
.r-action.on {
  color: var(--md-sys-color-error);
}
.r-duration {
  flex: none;
  min-width: 44px;
  text-align: right;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
</style>