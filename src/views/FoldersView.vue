<script setup lang="ts">
/** 按目录聚合已索引的媒体文件；选中目录后在右侧显示其内容。 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import MediaGrid from "@/components/MediaGrid.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import type { MediaEntry } from "@shared/types";

const library = useLibraryStore();
const player = usePlayerStore();
const settings = useSettingsStore();
const router = useRouter();

const all = ref<MediaEntry[]>([]);
const loading = ref(true);
const selected = ref<string | null>(null);

function t(key: string) {
  return translate(settings.lang, key);
}

onMounted(async () => {
  loading.value = true;
  try {
    all.value = await capabilities.listFiles({ sortBy: "name" });
  } finally {
    loading.value = false;
  }
});

/** 目录 → 文件数，按路径排序 */
const folders = computed(() => {
  const map = new Map<string, number>();
  for (const f of all.value) {
    map.set(f.parent, (map.get(f.parent) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([path, count]) => ({
      path,
      count,
      name: path.split(/[\\/]/).filter(Boolean).pop() || path,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
});

const items = computed(() =>
  selected.value ? all.value.filter((f) => f.parent === selected.value) : [],
);

function pick(path: string) {
  selected.value = path;
  void library.loadThumbnails(
    all.value
      .filter((f) => f.parent === path)
      .slice(0, 120)
      .map((f) => f.id),
  );
}

async function open(item: MediaEntry) {
  if (item.type === "audio") {
    const audioOnly = items.value.filter((i) => i.type === "audio");
    const pos = audioOnly.findIndex((i) => i.id === item.id);
    player.setQueue(audioOnly, Math.max(pos, 0));
    await player.loadById(item.id);
    router.push("/music/player");
    return;
  }
  void capabilities.openFile(item.path);
}
</script>

<template>
  <div class="folders-view">
    <PageHeader :title="t('nav.folders')" :description="t('navDesc.folders')" />

    <div class="folders-body">
      <aside class="tree">
        <div v-if="loading" class="tree-loading">
          <div v-for="n in 8" :key="n" class="lm-skeleton tree-skeleton"></div>
        </div>
        <m3e-list v-else class="tree-list">
          <m3e-list-item
            v-for="f in folders"
            :key="f.path"
            class="tree-item"
            :class="{ active: selected === f.path }"
            :title="f.path"
            @click="pick(f.path)"
          >
            <span
              slot="leading"
              class="material-symbols-outlined"
              :class="{ filled: selected === f.path }"
            >
              folder
            </span>
            <span class="tree-name">{{ f.name }}</span>
            <span slot="trailing" class="tree-count tabular-nums">{{ f.count }}</span>
          </m3e-list-item>
        </m3e-list>

        <div v-if="!loading && !folders.length" class="tree-empty">暂无已索引目录</div>
      </aside>

      <section class="content">
        <template v-if="selected">
          <header class="content-head">
            <h3>{{ selected }}</h3>
            <span class="count tabular-nums">{{ items.length }} 项</span>
          </header>
          <MediaGrid
            :items="items"
            aspect="1"
            :min-width="170"
            subtitle="size"
            @open="open"
            @favorite="library.toggleFavorite"
          />
        </template>

        <EmptyState
          v-else
          icon="folder_open"
          title="选择一个目录"
          description="左侧列出所有包含已索引媒体的目录，点击即可浏览其中的文件。"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.folders-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0;
}

.folders-body {
  flex: 1;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 20px;
  min-height: 0;
}

.tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding-right: 4px;
  border-right: 1px solid var(--lm-hairline);
}
.tree-head {
  padding: 4px 12px 10px;
  font-size: var(--md-sys-typescale-label-small-size);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--md-sys-color-on-surface-variant);
}
.tree-list {
  --m3e-list-item-leading-space: 12px;
  --m3e-list-item-trailing-space: 12px;
}
.tree-item {
  --m3e-list-item-leading-icon-color: var(--md-sys-color-on-surface-variant);
}
.tree-item.active {
  --m3e-list-item-container-color: var(--md-sys-color-secondary-container);
  --m3e-list-item-leading-icon-color: var(--md-sys-color-on-secondary-container);
}
.tree-item .material-symbols-outlined {
  font-size: 20px;
  flex: none;
}
.tree-item .material-symbols-outlined.filled {
  font-variation-settings: "FILL" 1;
}
.tree-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--md-sys-color-on-surface);
}
.tree-count {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.tree-skeleton {
  height: 38px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  margin-bottom: 4px;
}
.tree-empty {
  padding: 16px 12px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

.content {
  overflow-y: auto;
  min-width: 0;
}
.content-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.content-head h3 {
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: var(--md-sys-typescale-title-medium-weight);
  word-break: break-all;
}
.count {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
}

@media (max-width: 900px) {
  .folders-view {
    grid-template-columns: 200px minmax(0, 1fr);
  }
}
</style>
