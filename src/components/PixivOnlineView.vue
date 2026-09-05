// 移植自 Pixez（GPL-3.0），本仓库 GPL-3.0-only，兼容。
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { usePixivStore } from "@/stores/pixiv";
import { translate } from "@shared/i18n";
import type { PixivIllust } from "@shared/types";
import PixivCard from "@/components/PixivCard.vue";
import PixivDetailPanel from "@/components/PixivDetailPanel.vue";

const settings = useSettingsStore();
const pixiv = usePixivStore();
const t = (key: string) => translate(settings.lang, key);

type RankMode = "day" | "week" | "month" | "day_male" | "day_female";
type SearchSort = "date_desc" | "popular_desc";

const rankMode = ref<RankMode>("day");
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

const loginUserName = computed(() =>
  pixiv.loginStatus.user ? pixiv.loginStatus.user.name : "",
);

onMounted(async () => {
  await pixiv.loadLoginStatus();
  await pixiv.fetchRecommended();
  await pixiv.fetchRanking(rankMode.value);
});

async function doLogin() {
  loggingIn.value = true;
  loginError.value = "";
  try {
    await pixiv.login();
  } catch (e) {
    loginError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loggingIn.value = false;
  }
}

async function doLogout() {
  await pixiv.logout();
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

function openIllust(ill: PixivIllust) {
  void pixiv.fetchDetail(ill.id);
}

function openRelated(id: number) {
  void pixiv.fetchDetail(id);
}

function backFromDetail() {
  pixiv.view = "home";
  void pixiv.fetchRecommended();
}
</script>

<template>
  <div class="pixiv-online">
    <!-- 登录态条 -->
    <div v-if="!pixiv.loginStatus.loggedIn" class="login-bar login-bar--off">
      <span class="material-symbols-outlined">account_circle</span>
      <span class="login-text">{{ t("pixiv.loginHint") }}</span>
      <button class="lm-btn lm-btn--filled" :disabled="loggingIn" @click="doLogin">
        <span v-if="loggingIn" class="material-symbols-outlined spin">progress_activity</span>
        <span v-else class="material-symbols-outlined">login</span>
        {{ loggingIn ? t("pixiv.loggingIn") : t("pixiv.login") }}
      </button>
    </div>
    <div v-else class="login-bar login-bar--on">
      <span class="material-symbols-outlined">check_circle</span>
      <span class="login-text">{{ t("pixiv.loggedInAs").replace("{name}", loginUserName) }}</span>
      <button class="lm-btn lm-btn--tonal" @click="doLogout">
        <span class="material-symbols-outlined">logout</span>
        {{ t("pixiv.logout") }}
      </button>
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
    />

    <!-- 搜索结果 -->
    <template v-else-if="pixiv.view === 'search'">
      <div class="search-head">
        <button class="back" @click="pixiv.view = 'home'">
          <span class="material-symbols-outlined">arrow_back</span>
          {{ t("pixiv.back") }}
        </button>
        <h2 class="page-title">{{ t("pixiv.search") }}</h2>
      </div>

      <div class="search-bar">
        <input
          v-model="searchWord"
          :placeholder="t('pixiv.searchPlaceholder')"
          @keyup.enter="doSearch"
        />
        <button class="lm-btn lm-btn--filled" :disabled="pixiv.loading" @click="doSearch">
          <span v-if="pixiv.loading" class="material-symbols-outlined spin">progress_activity</span>
          <span v-else class="material-symbols-outlined">search</span>
          {{ t("pixiv.search") }}
        </button>
      </div>

      <div class="sort-row">
        <span class="sort-label">{{ t("pixiv.rank") }}</span>
        <button
          v-for="s in SEARCH_SORTS"
          :key="s.value"
          class="chip"
          :class="{ active: searchSort === s.value }"
          @click="changeSort(s.value)"
        >{{ s.label() }}</button>
      </div>

      <div v-if="pixiv.loading && !pixiv.searchItems.length" class="state">{{ t("pixiv.loading") }}</div>
      <div v-else-if="pixiv.error && !pixiv.searchItems.length" class="state list-error">{{ pixiv.error }}</div>
      <div v-else-if="pixiv.searchItems.length" class="pixiv-grid">
        <PixivCard
          v-for="ill in pixiv.searchItems"
          :key="ill.id"
          :illust="ill"
          @open="openIllust(ill)"
        />
      </div>
      <div v-else class="state">{{ t("pixiv.empty") }}</div>
    </template>

    <!-- 主页 -->
    <template v-else>
      <div class="search-bar">
        <input
          v-model="searchWord"
          :placeholder="t('pixiv.searchPlaceholder')"
          @keyup.enter="doSearch"
        />
        <button class="lm-btn lm-btn--tonal" :disabled="pixiv.loading" @click="doSearch">
          <span v-if="pixiv.loading" class="material-symbols-outlined spin">progress_activity</span>
          <span v-else class="material-symbols-outlined">search</span>
          {{ t("pixiv.search") }}
        </button>
      </div>

      <!-- 推荐 -->
      <section class="section">
        <h3 class="section-title">
          <span class="material-symbols-outlined">auto_awesome</span>
          {{ t("pixiv.recommend") }}
        </h3>
        <div v-if="pixiv.loading && !pixiv.recommended.length" class="state">{{ t("pixiv.loading") }}</div>
        <div v-else-if="pixiv.error && !pixiv.recommended.length" class="state list-error">
          {{ pixiv.error }}
          <button class="lm-btn lm-btn--text" @click="pixiv.fetchRecommended()">
            <span class="material-symbols-outlined">refresh</span>{{ t("pixiv.retry") }}
          </button>
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
      </section>

      <!-- 排行 -->
      <section class="section">
        <div class="section-head">
          <h3 class="section-title">
            <span class="material-symbols-outlined">leaderboard</span>
            {{ t("pixiv.rank") }}
          </h3>
          <div class="rank-tabs">
            <button
              v-for="m in RANK_MODES"
              :key="m.value"
              class="chip"
              :class="{ active: rankMode === m.value }"
              @click="pickRank(m.value)"
            >{{ m.label() }}</button>
          </div>
        </div>
        <div v-if="pixiv.loading && !pixiv.ranking.length" class="state">{{ t("pixiv.loading") }}</div>
        <div v-else-if="pixiv.ranking.length" class="pixiv-grid">
          <PixivCard
            v-for="ill in pixiv.ranking"
            :key="ill.id"
            :illust="ill"
            @open="openIllust(ill)"
          />
        </div>
        <div v-else class="state">{{ t("pixiv.empty") }}</div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pixiv-online {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: lm-rise 340ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.search-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  cursor: pointer;
}
.back:hover {
  background: var(--md-sys-color-surface-container);
}
.page-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 600;
  flex: 1;
  min-width: 0;
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
.chip {
  display: inline-flex;
  align-items: center;
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
.chip.active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  border-color: transparent;
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
  font-weight: 600;
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
