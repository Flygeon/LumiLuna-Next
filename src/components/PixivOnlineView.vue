// 移植自 Pixez（GPL-3.0），本仓库 GPL-3.0-only，兼容。
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { usePixivStore } from "@/stores/pixiv";
import { translate } from "@shared/i18n";
import type { PixivIllust, PixivTrendTag } from "@shared/types";
import PixivCard from "@/components/PixivCard.vue";
import PixivDetailPanel from "@/components/PixivDetailPanel.vue";

const settings = useSettingsStore();
const pixiv = usePixivStore();
const t = (key: string) => translate(settings.lang, key);

type RankMode = "day" | "week" | "month" | "day_male" | "day_female";
type SearchSort = "date_desc" | "popular_desc";

// 排行模式存 store：组件重挂载（切标签/详情返回）后 chips 与列表保持一致
const rankMode = ref<RankMode>((pixiv.rankingMode as RankMode) || "day");
const searchWord = ref("");
const searchSort = ref<SearchSort>("date_desc");
const loggingIn = ref(false);
const loginError = ref("");

const RANK_MODES: { value: RankMode; label: () => string }[] = [
  { value: "day", label: () => t("pixiv.rankDay") },
  { value: "week", label: () => t("pixiv.rankWeek") },
  { value: "month", label: () => t("pixiv.rankMonth") },
  { value: "day_male", label: () => t("pixiv.rankMale") },
  { value: "day_female", label: () => t("pixiv.rankFemale") },
];

const SEARCH_SORTS: { value: SearchSort; label: () => string }[] = [
  { value: "date_desc", label: () => t("pixiv.sortDateDesc") },
  { value: "popular_desc", label: () => t("pixiv.sortPopularDesc") },
];

const loginUserName = computed(() => (pixiv.loginStatus.user ? pixiv.loginStatus.user.name : ""));

onMounted(async () => {
  await pixiv.loadLoginStatus();
  // 已有数据就不重拉：切「本地/Pixiv」标签会导致组件重挂载，
  // 无条件刷新会让每次切标签都白打三个接口、冲掉浏览位置
  if (!pixiv.recommended.length) await pixiv.fetchRecommended();
  if (!pixiv.ranking.length) await pixiv.fetchRanking(rankMode.value);
  if (!pixiv.trendTags.length) void pixiv.fetchTrending(); // 热词失败不阻塞主页
});

// ---- 搜索联想（300ms 防抖） ----
let suggestTimer: number | undefined;
watch(searchWord, (val) => {
  window.clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(() => void pixiv.fetchSuggest(val), 300);
});
onUnmounted(() => window.clearTimeout(suggestTimer));

async function doLogin() {
  loggingIn.value = true;
  loginError.value = "";
  try {
    await pixiv.login();
    // 登录成功后重拉首页：挂载时未登录的那次请求只会留下错误态，不会自动重试
    await Promise.all([pixiv.fetchRecommended(), pixiv.fetchRanking(rankMode.value)]);
  } catch (e) {
    loginError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loggingIn.value = false;
  }
}

async function doLogout() {
  await pixiv.logout();
  // 退出后同样刷新一次，把错误态/旧数据清干净
  await Promise.all([pixiv.fetchRecommended(), pixiv.fetchRanking(rankMode.value)]);
}

function pickRank(m: RankMode) {
  rankMode.value = m;
  void pixiv.fetchRanking(m);
}

async function doSearch() {
  const w = searchWord.value.trim();
  if (!w) return;
  await pixiv.search(w, { sort: searchSort.value });
  pixiv.view = "search";
}

function changeSort(s: SearchSort) {
  searchSort.value = s;
  const w = searchWord.value.trim();
  if (w) void pixiv.search(w, { sort: s });
}

/** 点热词 / 联想词 → 填入关键字直接搜 */
function searchTag(tag: PixivTrendTag | string) {
  searchWord.value = typeof tag === "string" ? tag : tag.name;
  pixiv.suggestions = [];
  void doSearch();
}

function openIllust(ill: PixivIllust) {
  void pixiv.fetchDetail(ill.id);
}

function openRelated(id: number) {
  void pixiv.fetchDetail(id);
}

function openUser(id: number) {
  void pixiv.openUser(id);
}

function backFromDetail() {
  pixiv.view = "home";
  // 仅当列表为空才重拉：推荐/排行已有数据时反复刷新既浪费又冲掉浏览位置
  if (!pixiv.recommended.length) void pixiv.fetchRecommended();
}

function goBookmarks() {
  pixiv.view = "bookmarks";
  if (!pixiv.bookmarkItems.length) void pixiv.fetchBookmarks();
}

function goFollow() {
  pixiv.view = "follow";
  if (!pixiv.followItems.length) void pixiv.fetchFollow();
}

function backToHome() {
  pixiv.view = "home";
}
</script>

<template>
  <div class="pixiv-online">
    <!-- 登录态条 -->
    <div v-if="!pixiv.loginStatus.loggedIn" class="login-bar login-bar--off">
      <span class="material-symbols-outlined">account_circle</span>
      <span class="login-text">{{ t("pixiv.loginHint") }}</span>
      <m3e-button variant="filled" :disabled="loggingIn" @click="doLogin">
        <span v-if="loggingIn" slot="icon" class="material-symbols-outlined spin"
          >progress_activity</span
        >
        <span v-else slot="icon" class="material-symbols-outlined">login</span>
        {{ loggingIn ? t("pixiv.loggingIn") : t("pixiv.login") }}
      </m3e-button>
    </div>
    <div v-else class="login-bar login-bar--on">
      <span class="material-symbols-outlined">check_circle</span>
      <span class="login-text">{{ t("pixiv.loggedInAs").replace("{name}", loginUserName) }}</span>
      <m3e-button variant="tonal" @click="doLogout">
        <span slot="icon" class="material-symbols-outlined">logout</span>
        {{ t("pixiv.logout") }}
      </m3e-button>
    </div>
    <p v-if="loginError" class="login-banner">{{ loginError }}</p>

    <!-- 详情 -->
    <PixivDetailPanel
      v-if="pixiv.view === 'detail' && pixiv.detail"
      :key="pixiv.detail.id"
      :illust="pixiv.detail"
      :related="pixiv.related"
      :loading="pixiv.loading"
      :error="pixiv.error"
      @back="backFromDetail"
      @open-related="openRelated"
      @open-user="openUser"
    />

    <!-- 我的收藏 -->
    <template v-else-if="pixiv.view === 'bookmarks'">
      <div class="search-head">
        <m3e-button variant="text" class="back" @click="backToHome">
          <span slot="icon" class="material-symbols-outlined">arrow_back</span>
          {{ t("pixiv.back") }}
        </m3e-button>
        <h2 class="page-title">{{ t("pixiv.myBookmarks") }}</h2>
      </div>
      <div v-if="pixiv.loading && !pixiv.bookmarkItems.length" class="state">
        {{ t("pixiv.loading") }}
      </div>
      <div v-else-if="pixiv.error && !pixiv.bookmarkItems.length" class="state list-error">
        {{ pixiv.error }}
        <m3e-button variant="text" @click="pixiv.fetchBookmarks()">
          <span slot="icon" class="material-symbols-outlined">refresh</span>{{ t("pixiv.retry") }}
        </m3e-button>
      </div>
      <div v-else-if="pixiv.bookmarkItems.length" class="pixiv-grid">
        <PixivCard
          v-for="ill in pixiv.bookmarkItems"
          :key="ill.id"
          :illust="ill"
          @open="openIllust(ill)"
        />
      </div>
      <div v-else class="state">{{ t("pixiv.empty") }}</div>
      <div v-if="pixiv.bookmarkNext" class="load-more">
        <m3e-button variant="tonal" :disabled="pixiv.loading" @click="pixiv.fetchBookmarksMore()">
          <span v-if="pixiv.loading" slot="icon" class="material-symbols-outlined spin"
            >progress_activity</span
          >
          <span v-else slot="icon" class="material-symbols-outlined">expand_more</span>
          {{ t("pixiv.loadMore") }}
        </m3e-button>
      </div>
    </template>

    <!-- 关注流 -->
    <template v-else-if="pixiv.view === 'follow'">
      <div class="search-head">
        <m3e-button variant="text" class="back" @click="backToHome">
          <span slot="icon" class="material-symbols-outlined">arrow_back</span>
          {{ t("pixiv.back") }}
        </m3e-button>
        <h2 class="page-title">{{ t("pixiv.followFeed") }}</h2>
      </div>
      <div v-if="pixiv.loading && !pixiv.followItems.length" class="state">
        {{ t("pixiv.loading") }}
      </div>
      <div v-else-if="pixiv.error && !pixiv.followItems.length" class="state list-error">
        {{ pixiv.error }}
        <m3e-button variant="text" @click="pixiv.fetchFollow()">
          <span slot="icon" class="material-symbols-outlined">refresh</span>{{ t("pixiv.retry") }}
        </m3e-button>
      </div>
      <div v-else-if="pixiv.followItems.length" class="pixiv-grid">
        <PixivCard
          v-for="ill in pixiv.followItems"
          :key="ill.id"
          :illust="ill"
          @open="openIllust(ill)"
        />
      </div>
      <div v-else class="state">{{ t("pixiv.empty") }}</div>
      <div v-if="pixiv.followNext" class="load-more">
        <m3e-button variant="tonal" :disabled="pixiv.loading" @click="pixiv.fetchFollowMore()">
          <span v-if="pixiv.loading" slot="icon" class="material-symbols-outlined spin"
            >progress_activity</span
          >
          <span v-else slot="icon" class="material-symbols-outlined">expand_more</span>
          {{ t("pixiv.loadMore") }}
        </m3e-button>
      </div>
    </template>

    <!-- 作者页 -->
    <template v-else-if="pixiv.view === 'user'">
      <div class="search-head">
        <m3e-button variant="text" class="back" @click="backToHome">
          <span slot="icon" class="material-symbols-outlined">arrow_back</span>
          {{ t("pixiv.back") }}
        </m3e-button>
        <h2 class="page-title">{{ pixiv.userDetail?.user.name || "" }}</h2>
      </div>

      <div v-if="pixiv.loading && !pixiv.userDetail" class="state">{{ t("pixiv.loading") }}</div>
      <div v-else-if="pixiv.error && !pixiv.userDetail" class="state list-error">
        {{ pixiv.error }}
      </div>

      <template v-else-if="pixiv.userDetail">
        <div class="user-card">
          <div class="user-meta">
            <span class="user-name">{{ pixiv.userDetail.user.name }}</span>
            <span class="user-stats">
              {{ pixiv.userDetail.totalIllusts }} {{ t("pixiv.works") }} ·
              {{ pixiv.userDetail.following }} {{ t("pixiv.followFeed") }}
            </span>
          </div>
          <m3e-button
            :variant="pixiv.followingAuthor ? 'tonal' : 'filled'"
            @click="pixiv.toggleFollowAuthor(pixiv.userDetail.user.id)"
          >
            <span slot="icon" class="material-symbols-outlined">{{
              pixiv.followingAuthor ? "person_remove" : "person_add"
            }}</span>
            {{ pixiv.followingAuthor ? t("pixiv.unfollow") : t("pixiv.follow") }}
          </m3e-button>
        </div>

        <div v-if="pixiv.userIllusts.length" class="pixiv-grid">
          <PixivCard
            v-for="ill in pixiv.userIllusts"
            :key="ill.id"
            :illust="ill"
            @open="openIllust(ill)"
          />
        </div>
        <div v-else class="state">{{ t("pixiv.empty") }}</div>
        <div v-if="pixiv.userNext" class="load-more">
          <m3e-button
            variant="tonal"
            :disabled="pixiv.loading"
            @click="pixiv.fetchUserIllustsMore()"
          >
            <span v-if="pixiv.loading" slot="icon" class="material-symbols-outlined spin"
              >progress_activity</span
            >
            <span v-else slot="icon" class="material-symbols-outlined">expand_more</span>
            {{ t("pixiv.loadMore") }}
          </m3e-button>
        </div>
      </template>
    </template>

    <!-- 搜索结果 -->
    <template v-else-if="pixiv.view === 'search'">
      <div class="search-head">
        <m3e-button variant="text" class="back" @click="backToHome">
          <span slot="icon" class="material-symbols-outlined">arrow_back</span>
          {{ t("pixiv.back") }}
        </m3e-button>
        <h2 class="page-title">{{ t("pixiv.search") }}</h2>
      </div>

      <div class="search-bar">
        <input
          v-model="searchWord"
          :placeholder="t('pixiv.searchPlaceholder')"
          @keyup.enter="doSearch"
        />
        <m3e-button variant="filled" :disabled="pixiv.loading" @click="doSearch">
          <span v-if="pixiv.loading" slot="icon" class="material-symbols-outlined spin"
            >progress_activity</span
          >
          <span v-else slot="icon" class="material-symbols-outlined">search</span>
          {{ t("pixiv.search") }}
        </m3e-button>
      </div>

      <!-- 联想词 -->
      <m3e-chip-set v-if="searchWord.trim() && pixiv.suggestions.length" class="suggest-row">
        <m3e-suggestion-chip
          v-for="s in pixiv.suggestions.slice(0, 12)"
          :key="s"
          @click="searchTag(s)"
        >
          {{ s }}
        </m3e-suggestion-chip>
      </m3e-chip-set>

      <div class="sort-row">
        <span class="sort-label">{{ t("pixiv.rank") }}</span>
        <m3e-chip-set>
          <m3e-filter-chip
            v-for="s in SEARCH_SORTS"
            :key="s.value"
            :selected="searchSort === s.value"
            @click="changeSort(s.value)"
          >
            {{ s.label() }}
          </m3e-filter-chip>
        </m3e-chip-set>
      </div>

      <div v-if="pixiv.loading && !pixiv.searchItems.length" class="state">
        {{ t("pixiv.loading") }}
      </div>
      <div v-else-if="pixiv.error && !pixiv.searchItems.length" class="state list-error">
        {{ pixiv.error }}
      </div>
      <div v-else-if="pixiv.searchItems.length" class="pixiv-grid">
        <PixivCard
          v-for="ill in pixiv.searchItems"
          :key="ill.id"
          :illust="ill"
          @open="openIllust(ill)"
        />
      </div>
      <div v-else class="state">{{ t("pixiv.empty") }}</div>

      <div v-if="pixiv.searchNext" class="load-more">
        <m3e-button variant="tonal" :disabled="pixiv.loading" @click="pixiv.fetchSearchMore()">
          <span v-if="pixiv.loading" slot="icon" class="material-symbols-outlined spin"
            >progress_activity</span
          >
          <span v-else slot="icon" class="material-symbols-outlined">expand_more</span>
          {{ t("pixiv.loadMore") }}
        </m3e-button>
      </div>
    </template>

    <!-- 主页 -->
    <template v-else>
      <div v-if="pixiv.loginStatus.loggedIn" class="home-toolbar">
        <m3e-button variant="tonal" @click="goBookmarks">
          <span slot="icon" class="material-symbols-outlined">bookmarks</span>
          {{ t("pixiv.myBookmarks") }}
        </m3e-button>
        <m3e-button variant="tonal" @click="goFollow">
          <span slot="icon" class="material-symbols-outlined">favorite</span>
          {{ t("pixiv.followFeed") }}
        </m3e-button>
      </div>

      <div class="search-bar">
        <input
          v-model="searchWord"
          :placeholder="t('pixiv.searchPlaceholder')"
          @keyup.enter="doSearch"
        />
        <m3e-button variant="tonal" :disabled="pixiv.loading" @click="doSearch">
          <span v-if="pixiv.loading" slot="icon" class="material-symbols-outlined spin"
            >progress_activity</span
          >
          <span v-else slot="icon" class="material-symbols-outlined">search</span>
          {{ t("pixiv.search") }}
        </m3e-button>
      </div>

      <!-- 热门标签 -->
      <div v-if="pixiv.trendTags.length" class="trend-row">
        <span class="sort-label">{{ t("pixiv.hotTags") }}</span>
        <m3e-chip-set class="trend-chips">
          <m3e-suggestion-chip
            v-for="tag in pixiv.trendTags.slice(0, 10)"
            :key="tag.name"
            :title="tag.translatedName || tag.name"
            @click="searchTag(tag)"
          >
            # {{ tag.translatedName || tag.name }}
          </m3e-suggestion-chip>
        </m3e-chip-set>
      </div>

      <!-- 推荐 -->
      <section class="section">
        <h3 class="section-title">
          <span class="material-symbols-outlined">auto_awesome</span>
          {{ t("pixiv.recommend") }}
        </h3>
        <div v-if="pixiv.loading && !pixiv.recommended.length" class="state">
          {{ t("pixiv.loading") }}
        </div>
        <div v-else-if="pixiv.error && !pixiv.recommended.length" class="state list-error">
          {{ pixiv.error }}
          <m3e-button variant="text" @click="pixiv.fetchRecommended()">
            <span slot="icon" class="material-symbols-outlined">refresh</span>{{ t("pixiv.retry") }}
          </m3e-button>
        </div>
        <div v-else-if="pixiv.recommended.length" class="pixiv-grid">
          <PixivCard
            v-for="ill in pixiv.recommended"
            :key="ill.id"
            :illust="ill"
            @open="openIllust(ill)"
          />
        </div>
        <div v-else class="state">{{ t("pixiv.empty") }}</div>
        <div v-if="pixiv.recommendedNext" class="load-more">
          <m3e-button
            variant="tonal"
            :disabled="pixiv.loading"
            @click="pixiv.fetchRecommendedMore()"
          >
            <span v-if="pixiv.loading" slot="icon" class="material-symbols-outlined spin"
              >progress_activity</span
            >
            <span v-else slot="icon" class="material-symbols-outlined">expand_more</span>
            {{ t("pixiv.loadMore") }}
          </m3e-button>
        </div>
      </section>

      <!-- 排行 -->
      <section class="section">
        <div class="section-head">
          <h3 class="section-title">
            <span class="material-symbols-outlined">leaderboard</span>
            {{ t("pixiv.rank") }}
          </h3>
          <m3e-chip-set class="rank-tabs">
            <m3e-filter-chip
              v-for="m in RANK_MODES"
              :key="m.value"
              :selected="rankMode === m.value"
              @click="pickRank(m.value)"
            >
              {{ m.label() }}
            </m3e-filter-chip>
          </m3e-chip-set>
        </div>
        <div v-if="pixiv.loading && !pixiv.ranking.length" class="state">
          {{ t("pixiv.loading") }}
        </div>
        <div v-else-if="pixiv.ranking.length" class="pixiv-grid">
          <PixivCard
            v-for="ill in pixiv.ranking"
            :key="ill.id"
            :illust="ill"
            @open="openIllust(ill)"
          />
        </div>
        <div v-else class="state">{{ t("pixiv.empty") }}</div>
        <div v-if="pixiv.rankingNext" class="load-more">
          <m3e-button variant="tonal" :disabled="pixiv.loading" @click="pixiv.fetchRankingMore()">
            <span v-if="pixiv.loading" slot="icon" class="material-symbols-outlined spin"
              >progress_activity</span
            >
            <span v-else slot="icon" class="material-symbols-outlined">expand_more</span>
            {{ t("pixiv.loadMore") }}
          </m3e-button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pixiv-online {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: lm-rise 340ms var(--md-sys-motion-spring-spatial) both;
}
.home-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.search-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.page-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-bar {
  display: flex;
  gap: 8px;
}
.search-bar input {
  flex: 1;
  min-width: 0;
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
.sort-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.sort-label {
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.suggest-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.trend-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.trend-row .sort-label {
  padding-top: 6px;
  flex-shrink: 0;
}
.trend-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.section-title .material-symbols-outlined {
  font-size: 18px;
  color: var(--md-sys-color-primary);
}
.rank-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.pixiv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}
.load-more {
  display: flex;
  justify-content: center;
  padding: 4px 0;
}
.user-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
}
.user-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.user-name {
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.user-stats {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
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
.state {
  padding: 24px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.list-error {
  color: var(--md-sys-color-error);
  white-space: pre-line;
  line-height: 1.6;
  max-width: 640px;
  margin-inline: auto;
}
.spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
