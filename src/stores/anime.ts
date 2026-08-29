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
import { animeFetchCacheStats, fetchAnimeHtml } from "@/utils/animeFetcher";
import { animeLog } from "@/utils/animeLog";
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

/**
 * 各类请求的超时（毫秒）。
 * 聚合搜索同时查几十个源，单个死站拖满 15s 会把整轮检索推到分钟级；
 * 搜索给 10s，详情/播放页给 15s（页面更大，且一次只有一个请求）。
 */
const SEARCH_TIMEOUT_MS = 10_000;
const DETAIL_TIMEOUT_MS = 15_000;
const PLAY_PAGE_TIMEOUT_MS = 15_000;

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
      // 规则是否可用（能否被 normalizeRule 接受）直接影响后面能不能检索出结果，
      // 这里把每条规则的名字/模式/搜索关键字段落盘，便于定位「整库都 0 条」。
      void animeLog(
        `规则库加载 ${rules.value.length} 条：` +
          (rules.value
            .map((r) => {
              try {
                const rule = normalizeRule(JSON.parse(r.json));
                return `${rule.name}[${rule.searchMode}/${rule.chapterMode}]`;
              } catch (e) {
                return `${r.name}[JSON 解析失败: ${(e as Error).message}]`;
              }
            })
            .join(", ") || "无"),
      );
    } catch (e) {
      void animeLog(`规则库加载失败: ${(e as Error).message}`);
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
    // 注意：replace 只控制「请求前是否把卡片重置为 pending」，不参与结果回写。
    // 结果 items 必须始终以 patch.items 为准（此前写成
    // `spec.replace === false ? prev.items : ...`，导致 searchSources 走
    // replace:false 分支时把刚解析出来的 items 整个丢掉，UI 永远 0 条）。
    const done = (patch: Partial<AnimeSourceSearchResult>) => {
      const idx = sourceSearch.value.findIndex((s) => s.pluginName === pluginName);
      if (idx < 0) {
        void animeLog(
          `[${pluginName}] done() 找不到对应卡片（idx<0），patch=${JSON.stringify(patch).slice(0, 200)}`,
        );
        return;
      }
      const prev = sourceSearch.value[idx];
      sourceSearch.value[idx] = {
        ...prev,
        ...patch,
        items: patch.items ?? prev.items,
      };
    };
    if (spec.replace !== false) done({ status: "pending", message: undefined });
    try {
      const rule = normalizeRule(JSON.parse(entry.json));
      const prepared = prepareSearchRequest(rule, keyword);
      void animeLog(
        `[${pluginName}] 检索开始 kw="${keyword}" mode=${rule.searchMode} url=${prepared.url}`,
      );
      const started = Date.now();
      const res = await fetchAnimeHtml(rule.name, prepared, {
        timeoutMs: SEARCH_TIMEOUT_MS,
      });
      const parsed =
        rule.searchMode === "api"
          ? parseSearchApi(res.html, rule)
          : parseSearchXPath(res.html, rule);
      void animeLog(
        `[${pluginName}] 检索耗时 ${Date.now() - started}ms（缓存/并发: ` +
          `${JSON.stringify(animeFetchCacheStats())}）`,
      );
      void animeLog(
        `[${pluginName}] 检索完成 html=${res.html.length}B items=${parsed.items.length}` +
          ` diag=${parsed.diagnostics.slice(0, 3).join(" | ") || "无"}` +
          ` first=${parsed.items[0] ? `${parsed.items[0].name} -> ${parsed.items[0].src}` : "无"}`,
      );
      done({
        status: parsed.items.length ? "success" : "noResult",
        message: parsed.items.length ? undefined : parsed.diagnostics[0],
        items: parsed.items,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void animeLog(`[${pluginName}] 检索失败: ${msg}`);
      done({ status: "error", message: msg, items: [] });
    }
  }

  /** 聚合搜索：并行查全部启用源（Kazumi queryAllSource） */
  async function searchSources(keyword: string) {
    const enabled = rules.value.filter((r) => r.enabled);
    void animeLog(
      `聚合搜索开始 kw="${keyword}" 启用源=${enabled.length}` +
        `（${enabled.map((r) => r.name).join(", ") || "无"}）`,
    );
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
    void animeLog(
      `聚合搜索结束 kw="${keyword}" 结果=` +
        sourceSearch.value
          .map((s) => `${s.pluginName}:${s.status}(${s.items.length})`)
          .join(", "),
    );
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
      void animeLog(
        `[${pluginName}] 选集请求 mode=${rule.chapterMode} url=${spec.url}`,
      );
      const res = await fetchAnimeHtml(rule.name, spec, {
        timeoutMs: DETAIL_TIMEOUT_MS,
      });
      const parsed =
        rule.chapterMode === "api"
          ? parseChaptersApi(res.html, rule, item.src, rule.baseURL)
          : parseChaptersXPath(res.html, rule, rule.baseURL);
      void animeLog(
        `[${pluginName}] 选集解析 html=${res.html.length}B roads=${parsed.roads.length}` +
          ` 剧集数=${parsed.roads.map((r) => r.episodes.length).join("/") || "无"}` +
          ` diag=${parsed.diagnostics.slice(0, 3).join(" | ") || "无"}`,
      );
      if (!parsed.roads.length && parsed.diagnostics.length) {
        episodesError.value = parsed.diagnostics[0];
      }
      selectedRoads.value = parsed.roads;
      return parsed.roads.length > 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void animeLog(`[${pluginName}] 选集失败: ${msg}`);
      episodesError.value = msg;
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
        const res = await fetchAnimeHtml(rule.name, spec, {
          timeoutMs: PLAY_PAGE_TIMEOUT_MS,
        });
        const hit = extractStaticStream(res.html, rule, rule.baseURL);
        if (hit) staticHit = hit.url;
        void animeLog(
          `[${rule.name}] 播放页静态取流 ${hit ? `命中(${hit.method})` : "未命中"}` +
            ` html=${res.html.length}B`,
        );
      } catch (e) {
        void animeLog(
          `[${rule.name}] 播放页抓取失败，转 webview 兜底: ${(e as Error).message}`,
        );
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
        const started = Date.now();
        const webview = await capabilities.animeWebviewResolve(
          rule.name,
          episode.url,
          rule.baseURL,
        );
        if (token !== resolveToken) return null;
        if (!webview) {
          void animeLog(
            `[${rule.name}] webview 取流未拿到地址（耗时 ${Date.now() - started}ms）` +
              ` page=${episode.url}`,
          );
          streamError.value = "取流失败，请重试或更换线路";
          return null;
        }
        void animeLog(
          `[${rule.name}] webview 取流成功（耗时 ${Date.now() - started}ms）` +
            ` remote=${webview.remoteUrl}`,
        );
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