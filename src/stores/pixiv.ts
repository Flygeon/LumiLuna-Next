// 移植自 Pixez（GPL-3.0），本仓库 GPL-3.0-only，兼容。
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { capabilities } from "@/capabilities";
import { useSettingsStore } from "@/stores/settings";
import type {
  PixivComment,
  PixivIllust,
  PixivIllustDetail,
  PixivIllustPage,
  PixivLoginStatus,
  PixivSearchOpts,
  PixivTrendTag,
  PixivUserDetail,
  PixivUgoiraFrame,
} from "@shared/types";

/** 图片 Blob URL 内存缓存（不要用 base64，大图会爆内存） */
const imageCache = new Map<string, string>();

/** ugoira 帧 Blob URL 缓存（key = illust id） */
const ugoiraCache = new Map<number, { src: string; delay: number }[]>();

/** 每个会话只尝试一次「刷新会话恢复 user」——失败不反复打扰后端 */
let userFixTried = false;

export const usePixivStore = defineStore("pixiv", () => {
  const settings = useSettingsStore();

  const loginStatus = ref<PixivLoginStatus>({ loggedIn: false });
  const recommended = ref<PixivIllust[]>([]);
  const ranking = ref<PixivIllust[]>([]);
  const searchItems = ref<PixivIllust[]>([]);
  const detail = ref<PixivIllust | null>(null);
  const related = ref<PixivIllust[]>([]);
  const loading = ref(false);
  const error = ref("");
  const view = ref<"home" | "search" | "detail" | "bookmarks" | "follow" | "user">("home");

  // 评论（属于当前 detail）
  const comments = ref<PixivComment[]>([]);
  const commentsNext = ref<number | null>(null);
  const commentsLoading = ref(false);
  const commentsError = ref("");

  // 收藏（当前 detail 的状态）+ 我的收藏列表
  const bookmarked = ref(false);
  const bookmarkItems = ref<PixivIllust[]>([]);
  const bookmarkNext = ref<string | null>(null);

  // 关注流
  const followItems = ref<PixivIllust[]>([]);
  const followNext = ref<string | null>(null);

  // 作者页
  const userDetail = ref<PixivUserDetail | null>(null);
  const userIllusts = ref<PixivIllust[]>([]);
  const userNext = ref<string | null>(null);
  const followingAuthor = ref(false);

  // 搜索增强
  const trendTags = ref<PixivTrendTag[]>([]);
  const suggestions = ref<string[]>([]);

  // 列表翻页（各列表的 next_url）
  const recommendedNext = ref<string | null>(null);
  const rankingNext = ref<string | null>(null);
  const searchNext = ref<string | null>(null);

  const loginLabel = computed(() =>
    loginStatus.value.user
      ? loginStatus.value.user.name
      : "",
  );

  async function loadLoginStatus() {
    try {
      loginStatus.value = await capabilities.pixivLoginStatus();
      // 已存 refresh token 但未登录（如 app 重启后 pixiv.json 丢失）→ 尝试恢复
      if (!loginStatus.value.loggedIn && settings.pixivRefreshToken) {
        try {
          loginStatus.value = await capabilities.pixivSetRefreshToken(
            settings.pixivRefreshToken,
          );
        } catch {
          /* 恢复失败忽略，等用户重新登录 */
        }
      }
      // 已登录但 user 丢失（旧版本登录时 OAuth user.id 解析失败存了 None）
      // → 刷新一次会话把 user 补回来（每会话只试一次，避免反复打后端）
      if (loginStatus.value.loggedIn && !loginStatus.value.user && !userFixTried) {
        userFixTried = true;
        try {
          loginStatus.value = await capabilities.pixivRefreshSession();
        } catch {
          /* 刷新失败保持原状态 */
        }
      }
    } catch {
      loginStatus.value = { loggedIn: false };
    }
  }

  async function login() {
    return capabilities.pixivLoginOpen();
  }

  async function logout() {
    await capabilities.pixivLogout();
    loginStatus.value = { loggedIn: false };
  }

  async function fetchRecommended() {
    loading.value = true;
    error.value = "";
    try {
      const p = await capabilities.pixivRecommended();
      recommended.value = p.illusts;
      recommendedNext.value = p.nextUrl ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** 当前排行模式：组件重挂载后恢复 chips 选中态与列表一致 */
  const rankingMode = ref("day");

  async function fetchRanking(mode: string, date?: string) {
    loading.value = true;
    error.value = "";
    rankingMode.value = mode;
    try {
      const p = await capabilities.pixivRanking(mode, date);
      ranking.value = p.illusts;
      rankingNext.value = p.nextUrl ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function search(word: string, opts?: PixivSearchOpts) {
    loading.value = true;
    error.value = "";
    try {
      const p = await capabilities.pixivSearch(word, opts);
      searchItems.value = p.illusts;
      searchNext.value = p.nextUrl ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** 通用「加载更多」：请求 next_url 并追加到列表 */
  async function loadMore(
    nextUrl: string,
    append: (items: PixivIllust[], next: string | null) => void,
  ) {
    try {
      const p: PixivIllustPage = await capabilities.pixivNext(nextUrl);
      append(p.illusts, p.nextUrl ?? null);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function fetchRecommendedMore() {
    if (!recommendedNext.value || loading.value) return;
    loading.value = true;
    await loadMore(recommendedNext.value, (items, next) => {
      recommended.value = [...recommended.value, ...items];
      recommendedNext.value = next;
    });
    loading.value = false;
  }

  async function fetchRankingMore() {
    if (!rankingNext.value || loading.value) return;
    loading.value = true;
    await loadMore(rankingNext.value, (items, next) => {
      ranking.value = [...ranking.value, ...items];
      rankingNext.value = next;
    });
    loading.value = false;
  }

  async function fetchSearchMore() {
    if (!searchNext.value || loading.value) return;
    loading.value = true;
    await loadMore(searchNext.value, (items, next) => {
      searchItems.value = [...searchItems.value, ...items];
      searchNext.value = next;
    });
    loading.value = false;
  }

  async function fetchDetail(id: number) {
    loading.value = true;
    error.value = "";
    // 换作品先清旧评论/收藏态，避免新面板短暂显示上一幅的数据
    comments.value = [];
    commentsNext.value = null;
    commentsError.value = "";
    bookmarked.value = false;
    try {
      const d = await capabilities.pixivIllustDetail(id);
      detail.value = d.illust;
      related.value = d.related;
      view.value = "detail";
      // 收藏状态异步补查（失败不影响详情展示）
      void capabilities
        .pixivBookmarkDetail(id)
        .then((b) => (bookmarked.value = b))
        .catch(() => {});
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  // ---- 收藏 ----

  async function toggleBookmark(id: number) {
    if (detail.value?.id !== id) return;
    const was = bookmarked.value;
    try {
      if (was) {
        await capabilities.pixivBookmarkDelete(id);
        bookmarked.value = false;
      } else {
        await capabilities.pixivBookmarkAdd(id, "public");
        bookmarked.value = true;
      }
    } catch (e) {
      bookmarked.value = was; // 失败回滚
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function fetchBookmarks() {
    const uid = loginStatus.value.user?.id;
    if (!uid) {
      error.value = "登录信息不完整，请退出后重新登录";
      return;
    }
    loading.value = true;
    error.value = "";
    try {
      const p = await capabilities.pixivUserBookmarks(uid, "public");
      bookmarkItems.value = p.illusts;
      bookmarkNext.value = p.nextUrl ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchBookmarksMore() {
    if (!bookmarkNext.value || loading.value) return;
    loading.value = true;
    await loadMore(bookmarkNext.value, (items, next) => {
      bookmarkItems.value = [...bookmarkItems.value, ...items];
      bookmarkNext.value = next;
    });
    loading.value = false;
  }

  // ---- 关注流 ----

  async function fetchFollow() {
    loading.value = true;
    error.value = "";
    try {
      const p = await capabilities.pixivFollow("public");
      followItems.value = p.illusts;
      followNext.value = p.nextUrl ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchFollowMore() {
    if (!followNext.value || loading.value) return;
    loading.value = true;
    await loadMore(followNext.value, (items, next) => {
      followItems.value = [...followItems.value, ...items];
      followNext.value = next;
    });
    loading.value = false;
  }

  // ---- 作者页 ----

  async function openUser(userId: number) {
    userDetail.value = null;
    userIllusts.value = [];
    userNext.value = null;
    followingAuthor.value = false;
    view.value = "user";
    loading.value = true;
    try {
      const [ud, p] = await Promise.all([
        capabilities.pixivUserDetail(userId),
        capabilities.pixivUserIllusts(userId),
      ]);
      userDetail.value = ud;
      userIllusts.value = p.illusts;
      userNext.value = p.nextUrl ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchUserIllustsMore() {
    if (!userNext.value || loading.value) return;
    loading.value = true;
    await loadMore(userNext.value, (items, next) => {
      userIllusts.value = [...userIllusts.value, ...items];
      userNext.value = next;
    });
    loading.value = false;
  }

  async function toggleFollowAuthor(userId: number) {
    const was = followingAuthor.value;
    try {
      await capabilities.pixivFollowUser(userId, was);
      followingAuthor.value = !was;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  // ---- 搜索增强 ----

  async function fetchTrending() {
    try {
      trendTags.value = await capabilities.pixivTrendingTags();
    } catch {
      trendTags.value = []; // 非关键数据，失败静默
    }
  }

  async function fetchSuggest(term: string) {
    const q = term.trim();
    if (!q) {
      suggestions.value = [];
      return;
    }
    try {
      suggestions.value = await capabilities.pixivSearchSuggest(q);
    } catch {
      suggestions.value = [];
    }
  }

  // ---- 评论 ----

  async function fetchComments(illustId: number) {
    commentsLoading.value = true;
    commentsError.value = "";
    try {
      const page = await capabilities.pixivIllustComments(illustId, null);
      comments.value = page.comments;
      commentsNext.value = page.nextOffset ?? null;
    } catch (e) {
      commentsError.value = e instanceof Error ? e.message : String(e);
    } finally {
      commentsLoading.value = false;
    }
  }

  async function fetchCommentsMore() {
    if (commentsNext.value == null || commentsLoading.value) return;
    commentsLoading.value = true;
    commentsError.value = "";
    try {
      const page = await capabilities.pixivIllustComments(
        detail.value?.id ?? 0,
        commentsNext.value,
      );
      comments.value = [...comments.value, ...page.comments];
      commentsNext.value = page.nextOffset ?? null;
    } catch (e) {
      commentsError.value = e instanceof Error ? e.message : String(e);
    } finally {
      commentsLoading.value = false;
    }
  }

  /** 将 Pixiv 图片 URL 经 Rust 代理转为 Blob URL（带内存缓存） */
  async function imageUrl(url: string): Promise<string> {
    if (!url) return "";
    const cached = imageCache.get(url);
    if (cached) return cached;
    const bytes = await capabilities.pixivImage(url);
    // bytes 可能是 Uint8Array 或 number[]，统一转成 Uint8Array 再构造 Blob，
    // 否则 number[] 会被 Blob 当成字符串导致图片损坏。
    const blob = new Blob([new Uint8Array(bytes as ArrayLike<number>)], {
      type: "image/jpeg",
    });
    const obj = URL.createObjectURL(blob);
    imageCache.set(url, obj);
    return obj;
  }

  /** 热词 chip 配图（squareMedium，代理 + 缓存） */
  async function trendCover(url: string): Promise<string> {
    return imageUrl(url);
  }

  // ---- ugoira ----

  /** 拉取并解压 ugoira 帧，返回 { blobUrl, delay } 列表（带缓存） */
  async function fetchUgoira(id: number): Promise<{ src: string; delay: number }[]> {
    const cached = ugoiraCache.get(id);
    if (cached) return cached;
    const meta = await capabilities.pixivUgoiraFrames(id);
    const out = await Promise.all(
      meta.frames.map(async (f: PixivUgoiraFrame) => {
        const bytes = await capabilities.pixivFrameBytes(f.path);
        const blob = new Blob([new Uint8Array(bytes as ArrayLike<number>)], {
          type: "image/jpeg",
        });
        return { src: URL.createObjectURL(blob), delay: f.delayMs };
      }),
    );
    ugoiraCache.set(id, out);
    return out;
  }

  /** 根据当前图片质量设置挑出封面 URL */
  function coverUrl(illust: PixivIllust): string {
    const u = illust.imageUrls;
    const q = settings.pixivImageQuality as keyof typeof u;
    const url =
      (u[q] as string | undefined) ??
      u.large ??
      u.medium ??
      u.squareMedium ??
      u.original ??
      "";
    return url;
  }

  function reset() {
    recommended.value = [];
    ranking.value = [];
    searchItems.value = [];
    detail.value = null;
    related.value = [];
    comments.value = [];
    commentsNext.value = null;
    commentsError.value = "";
    bookmarked.value = false;
    bookmarkItems.value = [];
    bookmarkNext.value = null;
    followItems.value = [];
    followNext.value = null;
    userDetail.value = null;
    userIllusts.value = [];
    userNext.value = null;
    trendTags.value = [];
    suggestions.value = [];
    recommendedNext.value = null;
    rankingNext.value = null;
    searchNext.value = null;
    error.value = "";
    view.value = "home";
  }

  return {
    loginStatus,
    recommended,
    ranking,
    searchItems,
    detail,
    related,
    loading,
    error,
    view,
    comments,
    commentsNext,
    commentsLoading,
    commentsError,
    bookmarked,
    bookmarkItems,
    bookmarkNext,
    followItems,
    followNext,
    userDetail,
    userIllusts,
    userNext,
    followingAuthor,
    trendTags,
    suggestions,
    recommendedNext,
    rankingNext,
    searchNext,
    rankingMode,
    loginLabel,
    loadLoginStatus,
    login,
    logout,
    fetchRecommended,
    fetchRanking,
    search,
    fetchRecommendedMore,
    fetchRankingMore,
    fetchSearchMore,
    fetchDetail,
    toggleBookmark,
    fetchBookmarks,
    fetchBookmarksMore,
    fetchFollow,
    fetchFollowMore,
    openUser,
    fetchUserIllustsMore,
    toggleFollowAuthor,
    fetchTrending,
    fetchSuggest,
    fetchComments,
    fetchCommentsMore,
    imageUrl,
    trendCover,
    fetchUgoira,
    coverUrl,
    reset,
  };
});
