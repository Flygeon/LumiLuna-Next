<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import NovelCard from "@/components/NovelCard.vue";
import NovelDetailPanel from "@/components/NovelDetailPanel.vue";
import NovelReader from "@/components/NovelReader.vue";
import type { NovelCover, NovelRecommendBlock, NovelShelfItem } from "@shared/types";

const settings = useSettingsStore();
const t = (key: string) => translate(settings.lang, key);

const view = ref<"home" | "detail" | "reader">("home");
const selected = ref<{ aid: string; title: string }>({ aid: "", title: "" });
const readerInit = ref<{ cid?: string; chapterTitle?: string }>({});

const searchQuery = ref("");
const searching = ref(false);
const searchResults = ref<NovelCover[]>([]);
const searchError = ref("");

const rankSort = ref("allvisit");
const rankResults = ref<NovelCover[]>([]);
const rankLoading = ref(false);

const recommend = ref<NovelRecommendBlock[]>([]);
const shelf = ref<NovelShelfItem[]>([]);

async function loadShelf() {
  try {
    shelf.value = await capabilities.novelShelfList();
  } catch {
    shelf.value = [];
  }
}

async function loadRank() {
  rankLoading.value = true;
  try {
    rankResults.value = await capabilities.novelRank(settings.wenku8Node, settings.novelCharset, rankSort.value, 1);
  } catch {
    rankResults.value = [];
  } finally {
    rankLoading.value = false;
  }
}

async function loadRecommend() {
  try {
    recommend.value = await capabilities.novelRecommend(settings.wenku8Node, settings.novelCharset);
  } catch {
    recommend.value = [];
  }
}

async function doSearch() {
  const q = searchQuery.value.trim();
  if (!q) return;
  searching.value = true;
  searchError.value = "";
  try {
    searchResults.value = await capabilities.novelSearch(settings.wenku8Node, settings.novelCharset, q, 1);
  } catch (e) {
    searchError.value = e instanceof Error ? e.message : String(e);
    searchResults.value = [];
  } finally {
    searching.value = false;
  }
}

function openNovel(item: NovelCover | NovelShelfItem) {
  selected.value = { aid: item.aid, title: item.title };
  view.value = "detail";
}

function openReader(cid: string, chapterTitle: string) {
  readerInit.value = { cid, chapterTitle };
  view.value = "reader";
}

function onReaderClose() {
  view.value = "detail";
  void loadShelf();
}

function onDetailBack() {
  view.value = "home";
  void loadShelf();
}

function pickRank(sort: string) {
  rankSort.value = sort;
  void loadRank();
}

onMounted(() => {
  void loadShelf();
  void loadRank();
  void loadRecommend();
});
</script>

<template>
  <div class="novel-online">
    <!-- 阅读器 -->
    <NovelReader
      v-if="view === 'reader'"
      :aid="selected.aid"
      :title="selected.title"
      :initial-cid="readerInit.cid"
      :initial-chapter-title="readerInit.chapterTitle"
      @close="onReaderClose"
    />

    <!-- 详情 -->
    <NovelDetailPanel
      v-else-if="view === 'detail'"
      :aid="selected.aid"
      :initial-title="selected.title"
      @back="onDetailBack"
      @read="openReader"
    />

    <!-- 主页 -->
    <template v-else>
      <!-- 搜索 -->
      <div class="search-bar">
        <input
          v-model="searchQuery"
          :placeholder="t('novel.searchPlaceholder')"
          @keyup.enter="doSearch"
        />
        <button class="lm-btn lm-btn--tonal" @click="doSearch">
          <span class="material-symbols-outlined">search</span>
          {{ t("novel.search") }}
        </button>
      </div>
      <p v-if="searchError" class="error">{{ searchError }}</p>
      <div v-if="searchResults.length" class="search-results">
        <h3 class="section-title">{{ t("novel.searchResults") }}</h3>
        <div class="novel-grid">
          <NovelCard v-for="n in searchResults" :key="n.aid" :item="n" @open="openNovel(n)" />
        </div>
      </div>

      <!-- 排行榜 -->
      <section class="section">
        <div class="section-head">
          <h3 class="section-title">{{ t("novel.rank") }}</h3>
          <div class="rank-tabs">
            <button
              v-for="s in (['allvisit', 'postdate', 'goodnum'] as const)"
              :key="s"
              class="chip"
              :class="{ active: rankSort === s }"
              @click="pickRank(s)"
            >{{ t("novel.rank_" + s) }}</button>
          </div>
        </div>
        <div v-if="rankLoading" class="state">{{ t("novel.loading") }}</div>
        <div v-else class="novel-grid">
          <NovelCard v-for="n in rankResults" :key="n.aid" :item="n" @open="openNovel(n)" />
        </div>
      </section>

      <!-- 推荐 -->
      <section v-for="(block, i) in recommend" :key="i" class="section">
        <h3 class="section-title">{{ block.title }}</h3>
        <div class="novel-grid">
          <NovelCard v-for="n in block.novels" :key="n.aid" :item="n" @open="openNovel(n)" />
        </div>
      </section>

      <!-- 书架 -->
      <section v-if="shelf.length" class="section">
        <h3 class="section-title">{{ t("novel.shelf") }}</h3>
        <div class="novel-grid">
          <NovelCard v-for="n in shelf" :key="n.aid" :item="n" :subtitle="n.author" @open="openNovel(n)" />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.novel-online {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: lm-rise 340ms var(--md-sys-motion-easing-emphasized-decelerate) both;
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
.error {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-error);
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
  flex-wrap: wrap;
}
.section-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.rank-tabs {
  display: flex;
  gap: 6px;
}
.chip {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-small-size);
  cursor: pointer;
}
.chip.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-color: transparent;
}
.novel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 14px;
}
.state {
  padding: 24px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
</style>