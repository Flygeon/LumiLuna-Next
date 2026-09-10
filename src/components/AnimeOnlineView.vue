<script setup lang="ts">
/**
 * 在线番剧根组件（照 Kazumi 复刻的页面流）：
 *   主页「热门番组」(Bangumi 推荐) → 搜索（Bangumi 番剧搜索，含排序）
 *   → 详情（简介/评分/信息）→ 开始观看 → SourceSheet 聚合搜索播放源
 *   → 选中源 → 选集（线路 × 剧集）→ 播放器。
 * 另有：观看历史（点击续播）、规则管理（导入/启用 Kazumi 规则源）。
 */
import { computed, nextTick, onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useAnimeStore } from "@/stores/anime";
import { useBangumiCollectStore } from "@/stores/bangumiCollect";
import { translate } from "@shared/i18n";
import AnimeCard from "@/components/AnimeCard.vue";
import AnimeCollectionPanel from "@/components/AnimeCollectionPanel.vue";
import AnimeInfoPanel from "@/components/AnimeInfoPanel.vue";
import SourceSheet from "@/components/SourceSheet.vue";
import AnimeEpisodesPanel from "@/components/AnimeEpisodesPanel.vue";
import AnimePlayer from "@/components/AnimePlayer.vue";
import AnimeRuleManager from "@/components/AnimeRuleManager.vue";
import { fetchSubjectDetail, searchSubjects } from "@/utils/bangumiApi";
import { landHeroFlight, startHeroFlight, type HeroFlight } from "@/utils/heroTransition";
import type { AnimeHistoryItem, AnimeSearchItem, BangumiSubject } from "@shared/types";

const settings = useSettingsStore();
const anime = useAnimeStore();
const collect = useBangumiCollectStore();
const t = (key: string) => translate(settings.lang, key);

const view = ref<"home" | "search" | "collections" | "info" | "episodes" | "player" | "rules">(
  "home",
);
/** 当前打开的 Bangumi 条目 */
const currentSubject = ref<BangumiSubject | null>(null);
/** 聚合搜索 Sheet 是否打开（在详情页之上） */
const sourcesOpen = ref(false);
/** 详情页面板引用：hero 飞行层的降落点（封面元素）从这里取 */
const infoPanel = ref<InstanceType<typeof AnimeInfoPanel> | null>(null);
/** 进行中的 hero 飞行（overlay 克隆层），见 utils/heroTransition */
let heroFlight: HeroFlight | null = null;

/** 从卡片点击事件里提取封面元素并起飞（克隆飞行层、隐藏源封面） */
function heroTakeoff(ev?: MouseEvent) {
  heroFlight?.cancel();
  const card = ev?.target instanceof Element ? ev.target.closest(".anime-card") : null;
  heroFlight = startHeroFlight(card?.querySelector<HTMLElement>(".cover"));
}

/** 详情页挂载完成后让飞行层降落到详情页封面上 */
async function heroLand() {
  const flight = heroFlight;
  heroFlight = null;
  if (!flight) return;
  await nextTick();
  landHeroFlight(flight, () => infoPanel.value?.coverEl);
}

/** 播放参数 */
const playing = ref<{ roadIndex: number; episodeIndex: number; initialSeekMs?: number } | null>(
  null,
);

const keyword = ref("");
const sort = ref<"heat" | "rank" | "score" | "match">("heat");
const searchLoading = ref(false);

const SORTS: { value: typeof sort.value; label: () => string }[] = [
  { value: "heat", label: () => t("anime.sortHeat") },
  { value: "rank", label: () => t("anime.sortRank") },
  { value: "score", label: () => t("anime.sortScore") },
  { value: "match", label: () => t("anime.sortMatch") },
];

onMounted(async () => {
  await anime.loadRules();
  void anime.loadHistory();
  // 追番面板：有 token 时后台校验并展示离线缓存，不阻塞主页
  void collect.init();
  if (!anime.trending.length && !anime.trendingLoading) {
    void anime.fetchTrendingList();
  }
});

// ---- 主页 / 搜索 ----

function cardTitle(s: BangumiSubject) {
  return s.nameCn || s.name;
}
function cardCover(s: BangumiSubject) {
  return s.images?.large;
}
/** 副标题：热播榜给「在看人数」（更能说明热度），其余给放送平台 */
function cardSubtitle(s: BangumiSubject) {
  if (typeof s.doing === "number" && s.doing > 0) {
    return s.doing >= 10000 ? `${(s.doing / 10000).toFixed(1)} 万人在看` : `${s.doing} 人在看`;
  }
  return s.platform ? `${s.platform}` : undefined;
}
function toCard(s: BangumiSubject) {
  return {
    src: String(s.id),
    title: cardTitle(s),
    cover: cardCover(s),
    desc: cardSubtitle(s),
  };
}

/** 点热门/搜索结果条目 → 详情页（带 hero 飞入动画） */
async function openInfo(s: BangumiSubject, ev?: MouseEvent) {
  heroTakeoff(ev);
  currentSubject.value = s;
  view.value = "info";
  void anime.fetchBangumiInfo(s);
  await heroLand();
}

/** 开始 Bangumi 搜索（带排序） */
async function doSearch() {
  const kw = keyword.value.trim();
  if (!kw) return;
  searchLoading.value = true;
  try {
    await anime.searchBangumi(kw, sort.value);
  } finally {
    searchLoading.value = false;
  }
}

function changeSort(v: typeof sort.value) {
  sort.value = v;
  if (anime.searchKeyword) void anime.searchBangumi(anime.searchKeyword, v);
}

// ---- 聚合搜索别名/手动检索（关键字可能更新） ----

/**
 * 聚合搜索的关键字。
 *
 * 三级兜底，全部来自 store（不再用 `anime.trending[0]` 这种「热播榜第一条」
 * 的假兜底——它会让点 A 的搜索拿 B 的标题去查，直接播错番）：
 *   1. 当前详情条目（从主页/搜索页点进来的）
 *   2. 当前在看的番剧标题（历史续播写入的 Bangumi 标题）
 *   3. 当前播放源里的条目名（详情都没拉到时的最后兜底）
 * 三级都空就交给 searchSources 拦下来，宁可不搜也不喂一屏无关热门。
 */
const sourceKeyword = computed(() => {
  const own = currentSubject.value;
  const ownTitle = own ? (own.nameCn || own.name || "").trim() : "";
  return ownTitle || anime.activeBangumiTitle || anime.activeSourceTitle || "";
});

function openSources() {
  // 播放器里「换源」时退回详情页再弹 Sheet
  if (view.value === "player") {
    playing.value = null;
    view.value = "info";
  }
  sourcesOpen.value = true;
  void anime.searchSources(sourceKeyword.value);
}

function closeSources() {
  sourcesOpen.value = false;
}

/** 连点保护：pickSource 平均 2-3s，期间不给反馈会让用户一直点（日志里同一
 *  URL 连发 6 次的来源）。先切视图给「加载剧集…」，再挡住后续点击。 */
let picking = false;

/** 聚合搜索选中一个源 → 加载选集 → 进选集页 */
async function onPickSource(pluginName: string, item: AnimeSearchItem) {
  if (picking) return;
  picking = true;
  sourcesOpen.value = false;
  // 先切视图：选集面板立刻显示「正在加载剧集」，而不是停在 Sheet 上假死
  view.value = "episodes";
  try {
    const ok = await anime.pickSource(pluginName, item);
    if (!ok && !anime.selectedRoads.length) {
      // 选集为空时退回详情页并保留错误，用户可换源
      view.value = "info";
    }
  } finally {
    picking = false;
  }
}

// ---- 选集 / 播放 / 历史 ----

function playEpisode(roadIndex: number, episodeIndex: number, initialSeekMs?: number) {
  anime.clearStream();
  playing.value = { roadIndex, episodeIndex, initialSeekMs };
  view.value = "player";
}

function onPlayerClose() {
  playing.value = null;
  view.value = "episodes";
  void anime.loadHistory();
}

function onPlayerSwitch(roadIndex: number, episodeIndex: number) {
  playEpisode(roadIndex, episodeIndex);
}

/**
 * 点击观看历史 → 打开 Bangumi 详情页（不再直接续播，由用户在详情页选源选集）。
 * animeId 是 Bangumi 数字 id 时直接拉详情；是 "s:标题" 兜底键时按标题搜一次。
 * 两条路都查不到（源已删/离线）才退回旧的续播逻辑。
 */
async function openHistory(h: AnimeHistoryItem, ev?: MouseEvent) {
  const numericId = /^\d+$/.test(h.animeId) ? Number(h.animeId) : 0;
  try {
    if (numericId) {
      const full = await fetchSubjectDetail(numericId);
      if (full) {
        // 详情已拉全：直接展示，不再让详情页重复请求
        heroTakeoff(ev);
        currentSubject.value = full;
        view.value = "info";
        anime.showSubject(full);
        await heroLand();
        return;
      }
    } else if (h.title) {
      const page = await searchSubjects(h.title, "match", 1);
      const hit = page.items[0];
      if (hit) {
        heroTakeoff(ev);
        currentSubject.value = hit;
        view.value = "info";
        void anime.fetchBangumiInfo(hit);
        await heroLand();
        return;
      }
    }
  } catch {
    /* 网络失败走下方续播兜底 */
  }
  // 兜底：找不到 Bangumi 条目时按旧逻辑回查该源线路续播
  if (picking) return;
  picking = true;
  try {
    const ok = await anime.resumeHistory(h);
    if (!ok) {
      // 源可能被删/失效，回详情页让用户换源
      if (anime.bangumiDetail) {
        view.value = "info";
      }
      return;
    }
    const road = anime.selectedRoads[h.roadIndex];
    const target = road?.episodes[h.episodeIndex];
    if (target) {
      playEpisode(h.roadIndex, h.episodeIndex, h.progressMs || undefined);
    } else {
      playEpisode(0, 0);
    }
  } finally {
    picking = false;
  }
}

function backFromInfo() {
  currentSubject.value = null;
  view.value = "home";
  void anime.loadHistory();
}

function backFromEpisodes() {
  view.value = "info";
}
</script>

<template>
  <div class="anime-online">
    <!-- 主页：热门番组 -->
    <template v-if="view === 'home'">
      <div class="toolbar">
        <h2 class="page-title">
          <span class="material-symbols-outlined">local_fire_department</span>
          {{ t("anime.trendingTitle") }}
        </h2>
        <button class="lm-btn lm-btn--tonal" @click="view = 'search'">
          <span class="material-symbols-outlined">search</span>
          {{ t("anime.searchPageTitle") }}
        </button>
        <button class="lm-btn lm-btn--tonal" @click="view = 'collections'">
          <span class="material-symbols-outlined">subscriptions</span>
          {{ t("anime.myCollection") }}
        </button>
        <button class="lm-btn lm-btn--tonal" @click="view = 'rules'">
          <span class="material-symbols-outlined">rule</span>
          {{ t("anime.manageRules") }}
        </button>
      </div>

      <!-- 观看历史 -->
      <section v-if="anime.history.length" class="section">
        <h3 class="section-title">{{ t("anime.history") }}</h3>
        <div class="anime-grid">
          <AnimeCard
            v-for="h in anime.history"
            :key="h.key"
            :item="{
              src: h.episodePageUrl ?? '',
              title: h.title,
              cover: h.cover ?? undefined,
            }"
            :subtitle="h.lastEpisode ?? undefined"
            @open="openHistory(h, $event)"
          />
        </div>
      </section>

      <!-- Bangumi 推荐 -->
      <section class="section">
        <h3 class="section-title">
          <span class="material-symbols-outlined">trending_up</span>
          {{ t("anime.browse") }}
        </h3>
        <div v-if="anime.trendingLoading && !anime.trending.length" class="state">
          {{ t("anime.loading") }}
        </div>
        <div v-else-if="anime.trendingError && !anime.trending.length" class="state list-error">
          {{ anime.trendingError }}
        </div>
        <div v-else-if="anime.trending.length" class="anime-grid">
          <AnimeCard
            v-for="s in anime.trending"
            :key="s.id"
            :item="toCard(s)"
            @open="openInfo(s, $event)"
          />
        </div>
        <div v-else class="state">{{ t("anime.searchNoResult") }}</div>
      </section>
    </template>

    <!-- 搜索：Bangumi 番剧搜索 -->
    <template v-else-if="view === 'search'">
      <div class="search-head">
        <button class="back" @click="view = 'home'">
          <span class="material-symbols-outlined">arrow_back</span>
          {{ t("anime.back") }}
        </button>
        <h2 class="page-title">{{ t("anime.searchPageTitle") }}</h2>
      </div>

      <div class="search-bar">
        <input
          v-model="keyword"
          :placeholder="t('anime.searchPlaceholder')"
          @keyup.enter="doSearch"
        />
        <button
          class="lm-btn lm-btn--filled"
          :disabled="searchLoading || anime.searchLoading"
          @click="doSearch"
        >
          <span v-if="searchLoading || anime.searchLoading" class="material-symbols-outlined spin"
            >progress_activity</span
          >
          <span v-else class="material-symbols-outlined">search</span>
          {{ t("anime.searchBtn") }}
        </button>
      </div>

      <template v-if="anime.searchItems.length || anime.searchLoading || anime.searchError">
        <div class="sort-row">
          <span class="sort-label">{{ t("anime.searchSort") }}</span>
          <button
            v-for="s in SORTS"
            :key="s.value"
            class="chip"
            :class="{ active: sort === s.value }"
            @click="changeSort(s.value)"
          >
            {{ s.label }}
          </button>
        </div>

        <div v-if="anime.searchLoading && !anime.searchItems.length" class="state">
          {{ t("anime.loading") }}
        </div>
        <div v-else-if="anime.searchError && !anime.searchItems.length" class="state list-error">
          {{ anime.searchError }}
        </div>

        <div v-else-if="anime.searchItems.length" class="anime-grid">
          <AnimeCard
            v-for="s in anime.searchItems"
            :key="s.id"
            :item="toCard(s)"
            @open="openInfo(s, $event)"
          />
        </div>
        <div v-else class="state">{{ t("anime.searchNoResult") }}</div>

        <div v-if="anime.searchHasMore" class="load-more">
          <button
            class="lm-btn lm-btn--tonal"
            :disabled="anime.searchLoading"
            @click="anime.loadMoreBangumi()"
          >
            <span v-if="anime.searchLoading" class="material-symbols-outlined spin"
              >progress_activity</span
            >
            <span v-else class="material-symbols-outlined">expand_more</span>
            {{ t("anime.searchMore") }}
          </button>
        </div>
      </template>
    </template>

    <!-- 我的追番（Bangumi 收藏） -->
    <AnimeCollectionPanel
      v-else-if="view === 'collections'"
      @back="view = 'home'"
      @open="openInfo"
    />

    <!-- 详情 -->
    <template v-else-if="view === 'info' && currentSubject">
      <AnimeInfoPanel
        ref="infoPanel"
        :subject="anime.bangumiDetail"
        :loading="anime.detailLoading"
        :error="anime.detailError"
        @back="backFromInfo"
        @open-sources="openSources"
        @open-collection="view = 'collections'"
      />
      <SourceSheet
        v-if="sourcesOpen"
        :keyword="sourceKeyword"
        :subject="currentSubject"
        @close="closeSources"
        @pick="onPickSource"
      />
    </template>

    <!-- 选集（选中源后的线路 × 剧集） -->
    <AnimeEpisodesPanel
      v-else-if="view === 'episodes'"
      @back="backFromEpisodes"
      @play="playEpisode"
      @change-source="openSources"
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
      @switch="onPlayerSwitch"
      @choose-source="openSources"
    />
  </div>
</template>

<style scoped>
.anime-online {
  display: flex;
  flex-direction: column;
  gap: 22px;
  animation: lm-rise 340ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.page-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 600;
  flex: 1;
  min-width: 0;
}
.page-title .material-symbols-outlined {
  font-size: 24px;
  color: var(--md-sys-color-primary);
}
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
.anime-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
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
.search-bar .material-symbols-outlined {
  font-size: 18px;
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
.load-more {
  display: flex;
  justify-content: center;
  padding: 4px 0;
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
