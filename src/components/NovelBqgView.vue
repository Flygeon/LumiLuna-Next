<script setup lang="ts">
import { onMounted, ref } from "vue";
import { capabilities } from "@/capabilities";
import NovelCard from "@/components/NovelCard.vue";
import BookReader from "@/components/BookReader.vue";
import type { NovelCover, NovelDetail, NovelVolume } from "@shared/types";

const BASE = "https://m.bqglll.cc";

const view = ref<"home" | "detail" | "reader">("home");
const selected = ref<{ aid: string; title: string }>({ aid: "", title: "" });
const readerInit = ref<{ cid?: string; chapterTitle?: string }>({});

const searchQuery = ref("");
const searching = ref(false);
const searchResults = ref<NovelCover[]>([]);
const searchError = ref("");

const homeCovers = ref<NovelCover[]>([]);
const homeLoading = ref(false);
const homeError = ref("");

const detail = ref<NovelDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const volumes = ref<NovelVolume[]>([]);
const chapters = ref<{ cid: string; title: string }[]>([]);

function log(msg: string) {
  void capabilities.appLog(`[novel-bqg] ${msg}`).catch(() => {});
}

function coverUrl(u: string | undefined): string {
  if (!u) return "";
  if (u.startsWith("http")) return u;
  if (u.startsWith("/")) return BASE + u;
  return u;
}

async function loadHome() {
  homeLoading.value = true;
  homeError.value = "";
  try {
    homeCovers.value = await capabilities.bqgHome();
    log(`loadHome OK covers=${homeCovers.value.length}`);
  } catch (e) {
    homeError.value = e instanceof Error ? e.message : String(e);
    homeCovers.value = [];
    log(`loadHome ERR: ${homeError.value}`);
  } finally {
    homeLoading.value = false;
  }
}

async function doSearch() {
  const q = searchQuery.value.trim();
  if (!q) return;
  searching.value = true;
  searchError.value = "";
  log(`doSearch q=${JSON.stringify(q)}`);
  try {
    searchResults.value = await capabilities.bqgSearch(q);
    log(`doSearch OK results=${searchResults.value.length}`);
  } catch (e) {
    searchError.value = e instanceof Error ? e.message : String(e);
    searchResults.value = [];
    log(`doSearch ERR: ${searchError.value}`);
  } finally {
    searching.value = false;
  }
}

function openNovel(item: NovelCover) {
  selected.value = { aid: item.aid, title: item.title };
  void openDetail();
}

async function openDetail() {
  view.value = "detail";
  detailLoading.value = true;
  detailError.value = "";
  detail.value = null;
  volumes.value = [];
  chapters.value = [];
  log(`openDetail aid=${selected.value.aid}`);
  try {
    const [d, vols] = await Promise.all([
      capabilities.bqgDetail(selected.value.aid),
      capabilities.bqgCatalogue(selected.value.aid),
    ]);
    detail.value = d;
    volumes.value = vols;
    const list: { cid: string; title: string }[] = [];
    for (const v of vols) list.push(...v.chapters);
    chapters.value = list;
    log(`openDetail OK chapters=${list.length}`);
  } catch (e) {
    detailError.value = e instanceof Error ? e.message : String(e);
    log(`openDetail ERR: ${detailError.value}`);
  } finally {
    detailLoading.value = false;
  }
}

function openReader(cid: string, chapterTitle: string) {
  log(`openReader aid=${selected.value.aid} cid=${cid} title=${chapterTitle}`);
  readerInit.value = { cid, chapterTitle };
  view.value = "reader";
}

function onReaderClose() {
  view.value = "detail";
}

function onDetailBack() {
  view.value = "home";
}

onMounted(loadHome);
</script>

<template>
  <div class="novel-bqg">
    <!-- 阅读器 -->
    <Teleport v-if="view === 'reader'" to="body">
      <BookReader
        :novel-source="{
          aid: selected.aid,
          title: selected.title,
          source: 'bqg',
          initialCid: readerInit.cid,
          initialChapterTitle: readerInit.chapterTitle,
        }"
        @close="onReaderClose"
      />
    </Teleport>

    <!-- 详情 -->
    <div v-else-if="view === 'detail'" class="detail">
      <button class="lm-btn lm-btn--text back" @click="onDetailBack">
        <span class="material-symbols-outlined">arrow_back</span>
        返回
      </button>

      <p v-if="detailError" class="error">{{ detailError }}</p>
      <div v-else-if="detailLoading" class="state">加载中……</div>

      <template v-else-if="detail">
        <div class="detail-head">
          <img class="cover" :src="coverUrl(detail.img_url)" :alt="detail.title" />
          <div class="meta">
            <h3 class="title">{{ detail.title }}</h3>
            <p v-if="detail.author" class="line">作者：{{ detail.author }}</p>
            <p v-if="detail.status" class="line">状态：{{ detail.status }}</p>
            <p v-if="detail.fin_update" class="line">更新：{{ detail.fin_update }}</p>
            <p v-if="detail.tags.length" class="line">分类：{{ detail.tags.join(" / ") }}</p>
          </div>
        </div>

        <p v-if="detail.introduce" class="introduce">{{ detail.introduce }}</p>

        <section class="section">
          <h4 class="section-title">目录（{{ chapters.length }}）</h4>
          <div v-if="chapters.length" class="chapter-list">
            <button
              v-for="ch in chapters"
              :key="ch.cid"
              class="chapter"
              @click="openReader(ch.cid, ch.title)"
            >
              {{ ch.title }}
            </button>
          </div>
          <p v-else class="state">暂无目录</p>
        </section>
      </template>
    </div>

    <!-- 主页 -->
    <template v-else>
      <div class="search-bar">
        <input v-model="searchQuery" placeholder="搜索笔趣阁小说" @keyup.enter="doSearch" />
        <button class="lm-btn lm-btn--tonal" :disabled="searching" @click="doSearch">
          <span class="material-symbols-outlined">search</span>
          {{ searching ? "搜索中" : "搜索" }}
        </button>
      </div>
      <p v-if="searchError" class="error">{{ searchError }}</p>

      <div v-if="searchResults.length" class="search-results">
        <h3 class="section-title">搜索结果</h3>
        <div class="novel-grid">
          <NovelCard v-for="n in searchResults" :key="n.aid" :item="n" @open="openNovel(n)" />
        </div>
      </div>

      <section class="section">
        <h3 class="section-title">热门小说</h3>
        <div v-if="homeLoading" class="state">加载中……</div>
        <p v-else-if="homeError" class="error">{{ homeError }}</p>
        <div v-else class="novel-grid">
          <NovelCard v-for="n in homeCovers" :key="n.aid" :item="n" @open="openNovel(n)" />
        </div>
      </section>

      <div
        v-if="!homeLoading && !homeError && !searchResults.length && !homeCovers.length"
        class="state"
      >
        暂无数据
      </div>
    </template>
  </div>
</template>

<style scoped>
.novel-bqg {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: lm-rise 340ms var(--md-sys-motion-spring-spatial) both;
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
.section-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.novel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
}
.state {
  padding: 24px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.back {
  align-self: flex-start;
}
.detail-head {
  display: flex;
  gap: 16px;
}
.cover {
  width: 120px;
  height: 160px;
  object-fit: cover;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-highest);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.title {
  margin: 0 0 4px;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 500;
}
.line {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.introduce {
  margin: 0;
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: 1.7;
  color: var(--md-sys-color-on-surface);
  white-space: pre-wrap;
}
.chapter-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.chapter {
  text-align: left;
  padding: 10px 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-small-size);
  cursor: pointer;
}
.chapter:hover {
  background: var(--md-sys-color-surface-container-high);
}
</style>
