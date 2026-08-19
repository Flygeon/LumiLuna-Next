<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import NovelCard from "@/components/NovelCard.vue";
import NovelDetailPanel from "@/components/NovelDetailPanel.vue";
import NovelReader from "@/components/NovelReader.vue";
import { openWenku8Login, isLoginRequiredError } from "@/novel/wenku8Login";
import { reloginRequested, clearRelogin } from "@/novel/wenku8Auth";
import type { NovelCover, NovelRecommendBlock, NovelShelfItem, Wenku8LoginStatus } from "@shared/types";

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
const homeError = ref("");

const recommend = ref<NovelRecommendBlock[]>([]);
const shelf = ref<NovelShelfItem[]>([]);

// ---- Wenku8 登录态 ----
const loginStatus = ref<Wenku8LoginStatus>({ loggedIn: false });
const loggingIn = ref(false);
const loginBanner = ref("");

async function refreshLoginStatus() {
  try {
    loginStatus.value = await capabilities.wenku8LoginStatus();
  } catch {
    loginStatus.value = { loggedIn: false };
  }
}

async function doLogin() {
  loggingIn.value = true;
  loginBanner.value = "";
  clearRelogin();
  try {
    const status = await openWenku8Login();
    loginStatus.value = status;
    await loadShelf(); // 登录后立即刷新在线书架
  } catch (e) {
    loginBanner.value = e instanceof Error ? e.message : String(e);
  } finally {
    loggingIn.value = false;
  }
}

async function doLogout() {
  try {
    await capabilities.wenku8Logout();
    loginStatus.value = { loggedIn: false };
    await loadShelf();
  } catch (e) {
    console.warn("[Novel] 退出登录失败:", e);
  }
}

async function loadShelf() {
  try {
    shelf.value = await capabilities.novelShelfList();
    // 若抓取结果提示需要重新登录（在线书架被拦截），给出重登提示
  } catch (e) {
    if (isLoginRequiredError(e)) {
      loginBanner.value = "登录态已失效，请重新登录以同步书架。";
      await refreshLoginStatus();
    } else {
      console.warn("[Novel] 书架加载失败:", e);
    }
  }
}

async function loadRank() {
  rankLoading.value = true;
  try {
    rankResults.value = await capabilities.novelRank(settings.wenku8Node, settings.novelCharset, rankSort.value, 1);
    homeError.value = "";
  } catch (e) {
    console.warn("[Novel] 排行榜加载失败:", e);
    rankResults.value = [];
    homeError.value = e instanceof Error ? e.message : String(e);
  } finally {
    rankLoading.value = false;
  }
}

async function loadRecommend() {
  try {
    recommend.value = await capabilities.novelRecommend(settings.wenku8Node, settings.novelCharset);
  } catch (e) {
    console.warn("[Novel] 推荐加载失败:", e);
    recommend.value = [];
  }
}

async function loadHome() {
  homeError.value = "";
  await Promise.all([loadShelf(), loadRank(), loadRecommend()]);
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
  void refreshLoginStatus();
  void loadHome();
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
      <!-- Wenku8 登录态提示条 -->
      <div v-if="!loginStatus.loggedIn" class="login-bar login-bar--off">
        <span class="material-symbols-outlined">account_circle</span>
        <span class="login-text">{{ t("novel.loginHint") }}</span>
        <button class="lm-btn lm-btn--filled" :disabled="loggingIn" @click="doLogin">
          <span v-if="loggingIn" class="material-symbols-outlined spin">progress_activity</span>
          <span v-else class="material-symbols-outlined">login</span>
          {{ loggingIn ? t("novel.loggingIn") : t("novel.login") }}
        </button>
      </div>
      <div v-else class="login-bar login-bar--on">
        <span class="material-symbols-outlined">verified_user</span>
        <span class="login-text">
          {{ t("novel.loggedInAs") }} {{ loginStatus.nickname || loginStatus.uname || "" }}
        </span>
        <button class="lm-btn lm-btn--text" @click="doLogout">
          <span class="material-symbols-outlined">logout</span>
          {{ t("novel.logout") }}
        </button>
      </div>
      <p v-if="loginBanner" class="login-banner">{{ loginBanner }}</p>
      <div v-if="reloginRequested" class="login-bar login-bar--off">
        <span class="material-symbols-outlined">error</span>
        <span class="login-text">{{ t("novel.reloginHint") }}</span>
        <button class="lm-btn lm-btn--filled" :disabled="loggingIn" @click="doLogin">
          <span class="material-symbols-outlined">login</span>
          {{ t("novel.relogin") }}
        </button>
      </div>

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
      <div v-if="homeError" class="home-error">
        <span>{{ homeError }}</span>
        <button class="lm-btn lm-btn--text" @click="loadHome">
          <span class="material-symbols-outlined">refresh</span>
          {{ t("novel.retry") }}
        </button>
      </div>
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
.home-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font-size: var(--md-sys-typescale-body-small-size);
}
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.login-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  font-size: var(--md-sys-typescale-body-medium-size);
}
.login-bar .material-symbols-outlined {
  font-size: 22px;
}
.login-bar--off {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.login-bar--on {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.login-text {
  flex: 1;
}
.login-banner {
  margin: 0;
  padding: 8px 14px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font-size: var(--md-sys-typescale-body-small-size);
}
.spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to {
    transform: rotate(360deg);
  }
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