// 移植自 Pixez（GPL-3.0），本仓库 GPL-3.0-only，兼容。
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { capabilities } from "@/capabilities";
import { useSettingsStore } from "@/stores/settings";
import type {
  PixivComment,
  PixivIllust,
  PixivIllustDetail,
  PixivLoginStatus,
  PixivSearchOpts,
} from "@shared/types";

/** 图片 Blob URL 内存缓存（不要用 base64，大图会爆内存） */
const imageCache = new Map<string, string>();

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
  const view = ref<"home" | "search" | "detail">("home");

  // 评论（属于当前 detail）
  const comments = ref<PixivComment[]>([]);
  const commentsNext = ref<number | null>(null);
  const commentsLoading = ref(false);
  const commentsError = ref("");

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
      recommended.value = (await capabilities.pixivRecommended()).illusts;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchRanking(mode: string, date?: string) {
    loading.value = true;
    error.value = "";
    try {
      ranking.value = (await capabilities.pixivRanking(mode, date)).illusts;
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
      searchItems.value = (await capabilities.pixivSearch(word, opts)).illusts;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchDetail(id: number) {
    loading.value = true;
    error.value = "";
    // 换作品先清旧评论，避免新面板短暂显示上一幅的评论
    comments.value = [];
    commentsNext.value = null;
    commentsError.value = "";
    try {
      const d = await capabilities.pixivIllustDetail(id);
      detail.value = d.illust;
      related.value = d.related;
      view.value = "detail";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
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
    loginLabel,
    loadLoginStatus,
    login,
    logout,
    fetchRecommended,
    fetchRanking,
    search,
    fetchDetail,
    fetchComments,
    fetchCommentsMore,
    imageUrl,
    coverUrl,
    reset,
  };
});
