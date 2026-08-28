<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useAnimeStore } from "@/stores/anime";
import { translate } from "@shared/i18n";
import AnimeCard from "@/components/AnimeCard.vue";
import AnimeDetailPanel from "@/components/AnimeDetailPanel.vue";
import AnimePlayer from "@/components/AnimePlayer.vue";
import AnimeRuleManager from "@/components/AnimeRuleManager.vue";
import type { AnimeHistoryItem, AnimeItem } from "@shared/types";

const settings = useSettingsStore();
const anime = useAnimeStore();
const t = (key: string) => translate(settings.lang, key);

const view = ref<"home" | "detail" | "player" | "rules">("home");
const selected = ref<AnimeItem | null>(null);
const playing = ref<{ roadIndex: number; episodeIndex: number; initialSeekMs?: number } | null>(null);

const keyword = ref("");
const searching = ref(false);
/** 当前列表来自搜索（true）还是浏览（false） */
const searchMode = ref(false);

const enabledRules = computed(() => anime.rules.filter((r) => r.enabled));

onMounted(async () => {
  await anime.loadRules();
  void anime.loadHistory();
  if (anime.activeRule && !anime.listItems.length) {
    void anime.fetchList();
  }
});

function onSourceChange(event: Event) {
  const name = (event.target as HTMLSelectElement).value;
  anime.pickRule(name);
  searchMode.value = false;
  keyword.value = "";
  void anime.fetchList();
}

function browse() {
  searchMode.value = false;
  keyword.value = "";
  void anime.fetchList();
}

async function doSearch() {
  const q = keyword.value.trim();
  if (!q) return;
  searching.value = true;
  searchMode.value = true;
  try {
    await anime.fetchList(q);
  } finally {
    searching.value = false;
  }
}

function openDetail(item: AnimeItem) {
  selected.value = item;
  view.value = "detail";
}

/** 历史续播：先载入选集，成功后再进播放器并跳转进度 */
async function openHistory(h: AnimeHistoryItem) {
  if (!h.episodePageUrl) return;
  selected.value = {
    src: h.episodePageUrl,
    title: h.title,
    cover: h.cover ?? undefined,
  };
  view.value = "detail";
  await anime.loadDetail(h.episodePageUrl, h.title);
  const road = anime.detail?.roads[h.roadIndex];
  if (road && road.episodes[h.episodeIndex]) {
    playEpisode(h.roadIndex, h.episodeIndex, h.progressMs || undefined);
  }
}

function playEpisode(roadIndex: number, episodeIndex: number, initialSeekMs?: number) {
  anime.clearStream();
  playing.value = { roadIndex, episodeIndex, initialSeekMs };
  view.value = "player";
}

function onPlayerClose() {
  playing.value = null;
  view.value = "detail";
  void anime.loadHistory();
}

function onDetailBack() {
  selected.value = null;
  view.value = "home";
  void anime.loadHistory();
}
</script>

<template>
  <div class="anime-online">
    <!-- 主页 -->
    <template v-if="view === 'home'">
      <div class="toolbar">
        <label class="source">
          <span class="material-symbols-outlined">source_environment</span>
          <select
            :value="anime.activeRuleName"
            :disabled="!enabledRules.length"
            @change="onSourceChange"
          >
            <option v-for="r in enabledRules" :key="r.name" :value="r.name">
              {{ r.name }}<template v-if="r.version"> · v{{ r.version }}</template>
            </option>
          </select>
        </label>
        <button class="lm-btn lm-btn--tonal" @click="view = 'rules'">
          <span class="material-symbols-outlined">rule</span>
          {{ t("anime.manageRules") }}
        </button>
      </div>

      <p v-if="!enabledRules.length" class="state">{{ t("anime.noSource") }}</p>

      <template v-else>
        <!-- 观看历史 -->
        <section v-if="anime.history.length" class="section">
          <h3 class="section-title">{{ t("anime.history") }}</h3>
          <div class="anime-grid">
            <AnimeCard
              v-for="h in anime.history"
              :key="h.key"
              :item="{ src: h.episodePageUrl ?? '', title: h.title, cover: h.cover ?? undefined }"
              :subtitle="h.lastEpisode ?? undefined"
              @open="openHistory(h)"
            />
          </div>
        </section>

        <!-- 搜索 -->
        <div class="search-bar">
          <input
            v-model="keyword"
            :placeholder="t('anime.searchPlaceholder')"
            @keyup.enter="doSearch"
          />
          <button class="lm-btn lm-btn--tonal" :disabled="searching" @click="doSearch">
            <span class="material-symbols-outlined">search</span>
            {{ t("anime.searchBtn") }}
          </button>
        </div>

        <!-- 列表 -->
        <section class="section">
          <div class="section-head">
            <h3 class="section-title">{{ searchMode ? t("anime.search") : t("anime.browse") }}</h3>
            <button v-if="searchMode" class="chip" @click="browse">{{ t("anime.browse") }}</button>
          </div>
          <div v-if="anime.listLoading || searching" class="state">{{ t("anime.loading") }}</div>
          <div v-else-if="anime.listError && !anime.listItems.length" class="state">
            {{ anime.listError }}
          </div>
          <div v-else-if="anime.listItems.length" class="anime-grid">
            <AnimeCard
              v-for="(item, i) in anime.listItems"
              :key="i"
              :item="item"
              @open="openDetail(item)"
            />
          </div>
          <div v-else class="state">{{ t("anime.empty") }}</div>
        </section>
      </template>
    </template>

    <!-- 详情 -->
    <AnimeDetailPanel
      v-else-if="view === 'detail' && selected"
      :item="selected"
      @back="onDetailBack"
      @play="playEpisode"
    />

    <!-- 规则管理 -->
    <AnimeRuleManager v-else-if="view === 'rules'" @back="view = 'home'" />

    <!-- 播放器 -->
    <AnimePlayer
      v-else-if="view === 'player' && playing"
      :key="`${playing.roadIndex}-${playing.episodeIndex}`"
      :road-index="playing.roadIndex"
      :episode-index="playing.episodeIndex"
      :initial-seek-ms="playing.initialSeekMs"
      @close="onPlayerClose"
      @switch="playEpisode"
    />
  </div>
</template>

<style scoped>
.anime-online {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: lm-rise 340ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.source {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 8px 0 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
}
.source .material-symbols-outlined {
  font-size: 19px;
}
.source select {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  outline: none;
  cursor: pointer;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.section-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.chip {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-small-size);
  cursor: pointer;
}
.chip:hover {
  color: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}
.anime-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}
.search-bar {
  display: flex;
  gap: 8px;
}
.search-bar input {
  flex: 1;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  outline: none;
}
.search-bar input:focus {
  border-color: var(--md-sys-color-primary);
}
.state {
  padding: 24px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
</style>
