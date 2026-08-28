/**
 * 在线番剧（Kazumi 规则采集）全局状态。
 *
 * 数据流（照 Kazumi）：规则 → anime_fetch(列表页) → XPath/JSONPath 出条目
 * → anime_fetch(详情页) → chapterRoads/chapterResult 出线路与剧集
 * → 取流（静态提取快速路径 / 隐藏 webview 兜底）→ 本地媒体代理 → <video>。
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
import { fetchAnimeHtml } from "@/utils/animeFetcher";
import { extractStaticStream } from "@/utils/animeStream";
import type {
  AnimeDetail,
  AnimeEpisode,
  AnimeFavoriteItem,
  AnimeFetchSpec,
  AnimeHistoryItem,
  AnimeItem,
  AnimeRule,
  AnimeRuleEntry,
  AnimeStream,
} from "@shared/types";

export const useAnimeStore = defineStore("anime", () => {
  // ---- 规则源 ----
  const rules = ref<AnimeRuleEntry[]>([]);
  const rulesLoading = ref(false);
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

  // ---- 列表（目录 / 搜索） ----
  const listItems = ref<AnimeItem[]>([]);
  const listLoading = ref(false);
  const listError = ref("");

  // ---- 详情与选集 ----
  const detailTitle = ref("");
  const detail = ref<AnimeDetail | null>(null);
  const detailLoading = ref(false);
  const detailError = ref("");

  // ---- 取流 ----
  const stream = ref<AnimeStream | null>(null);
  const resolving = ref(false);
  const streamError = ref("");
  /** 取流代次：切换剧集后旧请求的迟到结果被丢弃 */
  let resolveToken = 0;

  // ---- 历史 / 追番 ----
  const history = ref<AnimeHistoryItem[]>([]);
  const favorites = ref<AnimeFavoriteItem[]>([]);

  async function loadRules(force = false) {
    if (!force && rules.value.length) return;
    rulesLoading.value = true;
    try {
      rules.value = await capabilities.animeRulesList();
      // 当前数据源被删除/禁用时回退到首个可用规则
      const still = rules.value.some(
        (r) => r.name === activeRuleName.value && r.enabled,
      );
      if (!still) {
        const first = rules.value.find((r) => r.enabled);
        activeRuleName.value = first?.name ?? "";
      }
    } catch {
      rules.value = [];
    } finally {
      rulesLoading.value = false;
    }
  }

  /** 切换数据源并清空当前列表 */
  function pickRule(name: string) {
    activeRuleName.value = name;
    listItems.value = [];
    listError.value = "";
    detail.value = null;
    stream.value = null;
  }

  /**
   * 抓取规则搜索页。keyword 为空时请求站点默认列表，作为「正在热播」浏览。
   */
  async function fetchList(keyword = "") {
    const rule = activeRule.value;
    if (!rule) return;
    listLoading.value = true;
    listError.value = "";
    try {
      const spec = prepareSearchRequest(rule, keyword);
      const res = await fetchAnimeHtml(rule.name, spec);
      const parsed =
        rule.searchMode === "api"
          ? parseSearchApi(res.html, rule)
          : parseSearchXPath(res.html, rule);
      listItems.value = parsed.items.map((i) => ({
        src: i.src,
        title: i.name,
      }));
      if (!parsed.items.length && parsed.diagnostics.length) {
        listError.value = parsed.diagnostics[0];
      }
    } catch (e) {
      listError.value = e instanceof Error ? e.message : String(e);
      listItems.value = [];
    } finally {
      listLoading.value = false;
    }
  }

  /** 打开详情：抓详情页 → 解析线路与剧集 */
  async function loadDetail(src: string, title: string) {
    const rule = activeRule.value;
    if (!rule) return;
    detailTitle.value = title;
    detailLoading.value = true;
    detailError.value = "";
    detail.value = null;
    stream.value = null;
    try {
      const spec = prepareChapterRequest(rule, src);
      const res = await fetchAnimeHtml(rule.name, spec);
      const parsed =
        rule.chapterMode === "api"
          ? parseChaptersApi(res.html, rule, src, rule.baseURL)
          : parseChaptersXPath(res.html, rule, rule.baseURL);
      detail.value = { title, roads: parsed.roads };
      if (!parsed.roads.length && parsed.diagnostics.length) {
        detailError.value = parsed.diagnostics[0];
      }
    } catch (e) {
      detailError.value = e instanceof Error ? e.message : String(e);
    } finally {
      detailLoading.value = false;
    }
  }

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

  async function toggleFavorite(plugin: string, animeId: string, title: string, cover?: string | null) {
    const existing = favorites.value.some((f) => f.plugin === plugin && f.animeId === animeId);
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
    listItems,
    listLoading,
    listError,
    detailTitle,
    detail,
    detailLoading,
    detailError,
    stream,
    resolving,
    streamError,
    history,
    favorites,
    loadRules,
    pickRule,
    fetchList,
    loadDetail,
    resolveStream,
    clearStream,
    loadHistory,
    loadFavorites,
    upsertHistory,
    removeHistory,
    toggleFavorite,
  };
});
