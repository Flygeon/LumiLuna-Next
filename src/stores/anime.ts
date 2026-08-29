/**
 * 在线番剧（Kazumi 规则采集）全局状态。
 *
 * 数据流（照 Kazumi 原版复刻）：
 *   主页（Bangumi 热门番组）→ 点条目 → 详情（Bangumi 简介/评分/放送信息/总话数）
 *   → 开始观看 → 聚合搜索（并行查全部已启用规则源，按条目名搜）→ 选中一个源
 *   → 查该源选集（线路 + 剧集）→ 选一集 → 取流 → 本地媒体代理 → <video>。
 * 规则源不再驱动主页浏览，只作为「播放源」被聚合搜索查询（Kazumi 同款）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { capabilities } from "@/capabilities";
import {
  normalizeRule,
  parseChaptersApi,
  parseChaptersXPath,
  parseSearchApi,
  parseSearchXPath,
  prepareChapterRequest,
  prepareSearchRequest,
} from "@/utils/animeRules";
import {
  fetchSubjectDetail,
  fetchTrending,
  searchSubjects,
} from "@/utils/bangumiApi";
import { fetchAnimeHtml } from "@/utils/animeFetcher";
import { extractStaticStream } from "@/utils/animeStream";
import type {
  AnimeEpisode,
  AnimeFavoriteItem,
  AnimeFetchSpec,
  AnimeHistoryItem,
  AnimeRoad,
  AnimeRule,
  AnimeRuleEntry,
  AnimeSearchItem,
  AnimeSourceSearchResult,
  AnimeStream,
  BangumiSubject,
} from "@shared/types";

export const useAnimeStore = defineStore("anime", () => {
  // ---- 规则源（播放源） ----
  const rules = ref<AnimeRuleEntry[]>([]);
  const rulesLoading = ref(false);
  /** 当前选中的播放源规则（聚合搜索里点的那个；驱动取流/代理的历史头） */
  const activeRuleName = ref("");
  const activeRule = computed<AnimeRule | null>(() => {
    const entry = rules.value.find((r) => r.name === activeRuleName.value);
    if (!entry || !entry.enabled || !entry.json) return null;
    try {
      return normalizeRule(JSON.parse(entry.json));
    } catch {
      return null;
    }
  });

  // ---- 主页：Bangumi 热门番组 ----
  const trending = ref<BangumiSubject[]>([]);
  const trendingLoading = ref(false);
  const trendingError = ref("");

  // ---- 搜索：Bangumi 番剧搜索（分页） ----
  const searchItems = ref<BangumiSubject[]>([]);
  const searchLoading = ref(false);
  const searchError = ref("");
  const searchKeyword = ref("");
  const searchSort = ref<"heat" | "rank" | "score" | "match">("heat");
  const searchTotal = ref(0);
  const searchHasMore = ref(false);

  // ---- 详情：Bangumi 条目信息 ----
  const bangumiDetail = ref<BangumiSubject | null>(null);
  /** 当前条目的 Bangumi 数字 id（跨详情页/续播保持，历史按它聚合） */
  const activeBangumiId = ref("");
  const detailLoading = ref(false);
  const detailError = ref("");

  // ---- 聚合搜索（Kazumi SourceSheet：每个源一张卡） ----
  const sourceSearch = ref<AnimeSourceSearchResult[]>([]);
  const sourceSearching = ref(false);
  const sourceSearchKeyword = ref("");

  // ---- 选集：选中源后的线路与剧集 ----
  const selectedRoads = ref<AnimeRoad[]>([]);
  /** 该源的番剧详情页 URL（Kazumi lastSrc，写历史、续播重查线路用） */
  const selectedSrc = ref("");
  const selectedSourceName = computed(() => activeRuleName.value);
  const episodesLoading = ref(false);
  const episodesError = ref("");

  // ---- 取流 ----
  const stream = ref<AnimeStream | null>(null);
  const resolving = ref(false);
  const streamError = ref("");
  /** 取流代次：切换剧集后旧请求的迟到结果被丢弃 */
  let resolveToken = 0;

  // ---- 历史 / 追番 ----
  const history = ref<AnimeHistoryItem[]>([]);
  const favorites = ref<AnimeFavoriteItem[]>([]);

  /** 当前条目展示名（中文名优先，照 Kazumi title 取法） */
  const displayTitle = computed<string>(() => {
    const d = bangumiDetail.value;
    if (d) return d.nameCn || d.name;
    return activeSourceTitle.value;
  });

  // 聚合搜索完成命中的条目名（详情未挂载时的标题兜底）
  const activeSourceTitle = ref("");

  async function loadRules(force = false) {
    if (!force && rules.value.length) return;
    rulesLoading.value = true;
    try {
      rules.value = await capabilities.animeRulesList();
      const still = rules.value.some(
        (r) => r.name === activeRuleName.value && r.enabled,
      );
      if (!still) {
        activeRuleName.value = "";
      }
    } catch {
      rules.value = [];
    } finally {
      rulesLoading.value = false;
    }
  }

  /** 切换播放源（规则管理里选中高亮用） */
  function pickRule(name: string) {
    activeRuleName.value = name;
  }

  // ---- 主页 / 搜索 / 详情 ----

  async function fetchTrendingList() {
    trendingLoading.value = true;
    trendingError.value = "";
    try {
      trending.value = await fetchTrending();
    } catch (e) {
      trendingError.value = e instanceof Error ? e.message : String(e);
      trending.value = [];
    } finally {
      trendingLoading.value = false;
    }
  }

  /** 开始一次 Bangumi 搜索（重置分页） */
  async function searchBangumi(
    keyword: string,
    sort: "heat" | "rank" | "score" | "match" = "heat",
  ) {
    searchKeyword.value = keyword;
    searchSort.value = sort;
    searchItems.value = [];
    searchTotal.value = 0;
    searchHasMore.value = false;
    searchError.value = "";
    await loadMoreBangumi();
  }

  /** 加载下一页搜索（分页追加载） */
  async function loadMoreBangumi() {
    const kw = searchKeyword.value.trim();
    if (!kw || searchLoading.value) return;
    // 已加载过且没有更多（searchHasMore 已置 false）时不再请求
    if (searchItems.value.length > 0 && !searchHasMore.value) return;
    searchLoading.value = true;
    try {
      const page = await searchSubjects(
        kw,
        searchSort.value,
        30,
        searchItems.value.length,
      );
      searchItems.value.push(...page.items);
      searchTotal.value = page.total;
      searchHasMore.value = searchItems.value.length < page.total;
    } catch (e) {
      if (!searchItems.value.length) {
        searchError.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      searchLoading.value = false;
    }
  }

  /** 打开条目详情：拉 Bangumi 元数据（简介/评分/总话数等） */
  async function fetchBangumiInfo(subject: BangumiSubject) {
    detailLoading.value = true;
    detailError.value = "";
    bangumiDetail.value = subject;
    activeBangumiId.value = String(subject.id);
    try {
      const full = await fetchSubjectDetail(subject.id);
      // 详情更完整（简介/总话数/别名），命中则替换
      bangumiDetail.value = full ?? subject;
    } catch (e) {
      detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
      detailLoading.value = false;
    }
  }

  // ---- 聚合搜索（照 Kazumi PluginSearchService.queryAllSource）----

  function resetSourceSearch() {
    sourceSearch.value = [];
    sourceSearching.value = false;
  }

  async function querySingleSource(
    pluginName: string,
    keyword: string,
    spec: { replace?: boolean } = {},
  ): Promise<void> {
    const entry = rules.value.find((r) => r.name === pluginName && r.enabled);
    if (!entry) return;
    const done = (patch: Partial<AnimeSourceSearchResult>) => {
      const idx = sourceSearch.value.findIndex((s) => s.pluginName === pluginName);
      if (idx < 0) return;
      const prev = sourceSearch.value[idx];
      sourceSearch.value[idx] = {
        ...prev,
        ...patch,
        items: spec.replace === false ? prev.items : patch.items ?? prev.items,
      };
    };
    if (spec.replace !== false) done({ status: "pending", message: undefined });
    try {
      const rule = normalizeRule(JSON.parse(entry.json));
      const prepared = prepareSearchRequest(rule, keyword);
      const res = await fetchAnimeHtml(rule.name, prepared);
      const parsed =
        rule.searchMode === "api"
          ? parseSearchApi(res.html, rule)
          : parseSearchXPath(res.html, rule);
      done({
        status: parsed.items.length ? "success" : "noResult",
        message: parsed.items.length ? undefined : parsed.diagnostics[0],
        items: parsed.items,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      done({ status: "error", message: msg, items: [] });
    }
  }

  /** 聚合搜索：并行查全部启用源（Kazumi queryAllSource） */
  async function searchSources(keyword: string) {
    const enabled = rules.value.filter((r) => r.enabled);
    if (!enabled.length) return;
    sourceSearchKeyword.value = keyword;
    sourceSearching.value = true;
    sourceSearch.value = enabled.map((r) => ({
      pluginName: r.name,
      pluginVersion: r.version,
      status: "pending" as const,
      items: [],
    }));
    await Promise.all(
      enabled.map((r) =>
        querySingleSource(r.name, keyword, { replace: false }).catch(() => {}),
      ),
    );
    sourceSearching.value = false;
  }

  /** 换一个关键字再查当前全部源（别名/手动检索后） */
  async function requeryAllSources(keyword: string) {
    sourceSearchKeyword.value = keyword;
    sourceSearching.value = true;
    await Promise.all(
      sourceSearch.value.map((s) =>
        querySingleSource(s.pluginName, keyword).catch(() => {}),
      ),
    );
    sourceSearching.value = false;
  }

  /** 别名检索：用别名再查指定源（结果追加到该源） */
  async function requerySingleSource(pluginName: string, keyword: string) {
    await querySingleSource(pluginName, keyword, { replace: true });
  }

  // ---- 选集 ----

  /**
   * 选中聚合搜索里的一个结果：切到该源并查选集（线路 + 剧集）。
   * 返回是否有有效剧集（false 时调用方应停留在聚合搜索）。
   */
  async function pickSource(
    pluginName: string,
    item: AnimeSearchItem,
  ): Promise<boolean> {
    const entry = rules.value.find((r) => r.name === pluginName && r.enabled);
    if (!entry) return false;
    activeSourceTitle.value = item.name;
    activeRuleName.value = pluginName;
    episodesLoading.value = true;
    episodesError.value = "";
    selectedRoads.value = [];
    selectedSrc.value = item.src;
    try {
      const rule = normalizeRule(JSON.parse(entry.json));
      const spec = prepareChapterRequest(rule, item.src);
      const res = await fetchAnimeHtml(rule.name, spec);
      const parsed =
        rule.chapterMode === "api"
          ? parseChaptersApi(res.html, rule, item.src, rule.baseURL)
          : parseChaptersXPath(res.html, rule, rule.baseURL);
      if (!parsed.roads.length && parsed.diagnostics.length) {
        episodesError.value = parsed.diagnostics[0];
      }
      selectedRoads.value = parsed.roads;
      return parsed.roads.length > 0;
    } catch (e) {
      episodesError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      episodesLoading.value = false;
    }
  }

  /** 续播：找到源重查线路，回到上次位置 */
  async function resumeHistory(h: AnimeHistoryItem): Promise<boolean> {
    activeSourceTitle.value = h.title;
    activeBangumiId.value = /^\d+$/.test(h.animeId) ? h.animeId : "";
    if (activeBangumiId.value) {
      // 数字 id 视为 Bangumi 条目：顺手拉一次详情补封面/标题（失败不阻止续播）
      void fetchSubjectDetail(Number(activeBangumiId.value))
        .then((sub) => {
          if (sub) bangumiDetail.value = sub;
        })
        .catch(() => {});
    } else {
      bangumiDetail.value = null;
    }
    const src = h.detailUrl || h.episodePageUrl || "";
    if (!src || !h.plugin) return false;
    return pickSource(h.plugin, { name: h.title, src });
  }

  // ---- 取流 ----

  /** 取流：先静态提取快速路径，未命中走隐藏 webview 兜底 */
  async function resolveStream(episode: AnimeEpisode): Promise<AnimeStream | null> {
    const rule = activeRule.value;
    if (!rule) return null;
    const token = ++resolveToken;
    resolving.value = true;
    streamError.value = "";
    stream.value = null;
    try {
      const spec: AnimeFetchSpec = {
        method: "GET",
        url: episode.url,
        headers: rule.httpHeaders,
        referer: rule.referer || rule.baseURL || "",
        userAgent: rule.userAgent || "",
        includeCookies: true,
      };
      let staticHit: string | null = null;
      try {
        const res = await fetchAnimeHtml(rule.name, spec);
        const hit = extractStaticStream(res.html, rule, rule.baseURL);
        if (hit) staticHit = hit.url;
      } catch {
        /* 播放页抓取失败则直接进 webview 兜底 */
      }
      if (token !== resolveToken) return null;

      if (staticHit) {
        const media = await capabilities.animeMediaUrl(rule.name, staticHit);
        if (token !== resolveToken) return null;
        stream.value = {
          url: media.url,
          remoteUrl: staticHit,
          proxied: true,
          method: "static",
        };
      } else {
        const webview = await capabilities.animeWebviewResolve(
          rule.name,
          episode.url,
          rule.baseURL,
        );
        if (token !== resolveToken) return null;
        if (!webview) {
          streamError.value = "取流失败，请重试或更换线路";
          return null;
        }
        stream.value = webview;
      }
      return stream.value;
    } catch (e) {
      if (token === resolveToken) {
        streamError.value = e instanceof Error ? e.message : String(e);
      }
      return null;
    } finally {
      if (token === resolveToken) resolving.value = false;
    }
  }

  /** 清空取流状态（切换剧集时由调用方触发） */
  function clearStream() {
    resolveToken++;
    stream.value = null;
    streamError.value = "";
    resolving.value = false;
  }

  // ---- 历史 / 追番 ----

  /** 当前 Bangumi 条目的标识（读详情，回退到源命中条目） */
  function currentBangumiId(): string {
    if (activeBangumiId.value) return activeBangumiId.value;
    const d = bangumiDetail.value;
    if (d) return String(d.id);
    const t = activeSourceTitle.value;
    return t ? `s:${t}` : `s:${selectedSrc.value}`;
  }

  /** 播放中每 5s / 暂停 / 结束时上报进度（Kazumi 按 Bangumi 条目记一条历史） */
  async function saveHistoryProgress(
    episode: AnimeEpisode,
    roadIndex: number,
    episodeIndex: number,
    progressMs: number,
    durationMs: number,
  ) {
    const d = bangumiDetail.value;
    const id = currentBangumiId();
    const title = displayTitle.value;
    const item: AnimeHistoryItem = {
      key: `bangumi:${id}`,
      plugin: activeRuleName.value,
      animeId: id,
      title,
      cover: d?.images?.large ?? null,
      lastEpisode: episode.name,
      episodePageUrl: episode.url,
      detailUrl: selectedSrc.value,
      roadIndex,
      episodeIndex,
      progressMs,
      durationMs,
      updatedAt: Date.now(),
    };
    await upsertHistory(item);
  }

  async function loadHistory() {
    try {
      history.value = await capabilities.animeHistoryList();
    } catch {
      history.value = [];
    }
  }

  async function loadFavorites() {
    try {
      favorites.value = await capabilities.animeFavoritesList();
    } catch {
      favorites.value = [];
    }
  }

  async function upsertHistory(item: AnimeHistoryItem) {
    try {
      await capabilities.animeHistoryUpsert(item);
      const idx = history.value.findIndex((h) => h.key === item.key);
      if (idx >= 0) history.value.splice(idx, 1, item);
      else history.value.unshift(item);
    } catch {
      /* 历史写入失败不阻塞播放 */
    }
  }

  async function removeHistory(key: string) {
    try {
      await capabilities.animeHistoryDelete(key);
      history.value = history.value.filter((h) => h.key !== key);
    } catch {
      /* 忽略 */
    }
  }

  async function toggleFavorite(
    plugin: string,
    animeId: string,
    title: string,
    cover?: string | null,
  ) {
    const existing = favorites.value.some(
      (f) => f.plugin === plugin && f.animeId === animeId,
    );
    try {
      if (existing) {
        await capabilities.animeFavoriteRemove(plugin, animeId);
        favorites.value = favorites.value.filter(
          (f) => !(f.plugin === plugin && f.animeId === animeId),
        );
      } else {
        await capabilities.animeFavoriteAdd(plugin, animeId, title, cover ?? null);
        favorites.value.unshift({
          plugin,
          animeId,
          title,
          cover: cover ?? null,
          addedAt: Date.now(),
        });
      }
    } catch {
      /* 忽略 */
    }
  }

  return {
    rules,
    rulesLoading,
    activeRuleName,
    activeRule,
    trending,
    trendingLoading,
    trendingError,
    searchItems,
    searchLoading,
    searchError,
    searchKeyword,
    searchSort,
    searchTotal,
    searchHasMore,
    bangumiDetail,
    activeBangumiId,
    detailLoading,
    detailError,
    displayTitle,
    sourceSearch,
    sourceSearching,
    sourceSearchKeyword,
    selectedRoads,
    selectedSrc,
    selectedSourceName,
    episodesLoading,
    episodesError,
    stream,
    resolving,
    streamError,
    history,
    favorites,
    loadRules,
    pickRule,
    fetchTrendingList,
    searchBangumi,
    loadMoreBangumi,
    fetchBangumiInfo,
    searchSources,
    requeryAllSources,
    requerySingleSource,
    resetSourceSearch,
    pickSource,
    resumeHistory,
    resolveStream,
    clearStream,
    loadHistory,
    loadFavorites,
    upsertHistory,
    saveHistoryProgress,
    removeHistory,
    toggleFavorite,
  };
});