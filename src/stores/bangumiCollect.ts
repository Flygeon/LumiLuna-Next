/**
 * Bangumi 追番全局状态（我的追番）。
 *
 * 鉴权模型照 Kazumi BangumiSyncService：用户粘贴官方 Access Token →
 * GET /v0/me 校验并拿到用户名 → 首次授权自动做一次全量同步（收藏列表
 * 缓存到本地 bangumi.json，离线也能看）→ 详情页可切换想看/在看/看过/
 * 搁置/抛弃，成功后同步更新本地缓存与远端 Bangumi。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { LazyStore } from "@tauri-apps/plugin-store";
import { useSettingsStore } from "@/stores/settings";
import { animeLog } from "@/utils/animeLog";
import {
  describeBangumiError,
  fetchAllCollections,
  fetchCurrentUser,
  setCollectionStatus,
} from "@/utils/bangumiAuthApi";
import type {
  BangumiAuthUser,
  BangumiCollectionCategory,
  BangumiSubject,
  BangumiUserCollection,
} from "@shared/types";

/** 收藏缓存独立落盘（settings.json 保持轻量；浏览器预览下静默失败） */
const cache = new LazyStore("bangumi.json");

export type AuthState = "idle" | "checking" | "ok" | "error";

/** 状态切换按钮的展示顺序（0 = 未收藏，不参与按钮） */
export const CATEGORY_ORDER = [1, 2, 3, 4, 5] as const;

export const useBangumiCollectStore = defineStore("bangumiCollect", () => {
  const settings = useSettingsStore();

  // ---- 账号 / 授权 ----
  const user = ref<BangumiAuthUser | null>(null);
  const authState = ref<AuthState>("idle");
  const authError = ref("");

  // ---- 收藏列表 ----
  const collections = ref<BangumiUserCollection[]>([]);
  const listLoading = ref(false);
  const listError = ref("");
  /** 正在保存状态的条目 id（详情页按钮转圈用） */
  const savingIds = ref<number[]>([]);
  /** 上次成功同步时间戳（毫秒；0 = 从未同步） */
  const lastSyncAt = ref(0);
  /** 同步进度文案（pull 期间展示「已拉取 x/y」） */
  const syncProgress = ref("");

  const authorized = computed(() => authState.value === "ok" && !!user.value);
  const bySubjectId = computed(() => {
    const m = new Map<number, BangumiUserCollection>();
    for (const c of collections.value) m.set(c.subjectId, c);
    return m;
  });

  /** 某条目当前的 Bangumi 收藏状态（0 = 未收藏 / 未授权） */
  function statusOf(subjectId: number | string): BangumiCollectionCategory {
    const c = bySubjectId.value.get(Number(subjectId));
    return c ? c.category : 0;
  }

  /** 按收藏类别筛选（1 想看 / 2 看过 / 3 在看 / 4 搁置 / 5 抛弃） */
  function byCategory(category: BangumiCollectionCategory) {
    return computed(() => collections.value.filter((c) => c.category === category));
  }

  // ---- 缓存读写 ----

  async function loadCache() {
    try {
      const data = await cache.get<{ items: BangumiUserCollection[]; syncedAt: number }>(
        "collections",
      );
      if (data?.items?.length) {
        collections.value = data.items;
        lastSyncAt.value = data.syncedAt || settings.bangumiSyncedAt || 0;
      }
    } catch {
      /* 浏览器预览或文件不存在：用内存态 */
    }
  }

  async function saveCache() {
    settings.bangumiSyncedAt = lastSyncAt.value;
    try {
      await cache.set("collections", { items: collections.value, syncedAt: lastSyncAt.value });
      await cache.save();
    } catch {
      /* 忽略：缓存只是离线兜底 */
    }
  }

  // ---- 生命周期 ----

  /** 应用启动/进入页面时调用：有 token 就后台校验，列表先展示缓存 */
  let initStarted = false;
  async function init() {
    if (initStarted) return;
    initStarted = true;
    await loadCache();
    if (settings.bangumiToken && authState.value === "idle") {
      void validateToken(settings.bangumiToken);
    }
  }

  /** 校验 token → 成功后若从未同步过，自动做一次全量同步（用户要求「首次授权先同步一次」） */
  async function validateToken(token: string): Promise<boolean> {
    authState.value = "checking";
    authError.value = "";
    try {
      user.value = await fetchCurrentUser(token);
      authState.value = "ok";
      settings.bangumiUsername = user.value.username;
      if (!lastSyncAt.value || !collections.value.length) {
        void animeLog(`Bangumi 首次授权成功 user=${user.value.username}，开始初始同步`);
        await pull();
      }
      return true;
    } catch (e) {
      authState.value = "error";
      authError.value = describeBangumiError(e);
      user.value = null;
      void animeLog(`Bangumi 授权失败: ${authError.value}`);
      return false;
    }
  }

  /** 「连接」入口：设置页/我的追番页共用。token 存进 settings（自动持久化） */
  async function connect(token: string): Promise<boolean> {
    const value = token.trim();
    if (!value) {
      authState.value = "error";
      authError.value = "请填写 Bangumi Access Token";
      return false;
    }
    settings.bangumiToken = value;
    return validateToken(value);
  }

  /** 断开：清 token 与用户态，保留本地缓存（重连后立即可看） */
  function disconnect() {
    settings.bangumiToken = "";
    settings.bangumiUsername = "";
    user.value = null;
    authState.value = "idle";
    authError.value = "";
  }

  // ---- 同步 ----

  /** 全量拉取收藏并覆盖本地缓存（首次授权 / 手动刷新共用） */
  async function pull(): Promise<boolean> {
    if (!user.value || !settings.bangumiToken) {
      listError.value = "请先连接 Bangumi 账号";
      return false;
    }
    if (listLoading.value) return false;
    listLoading.value = true;
    listError.value = "";
    syncProgress.value = "";
    try {
      const items = await fetchAllCollections(
        settings.bangumiToken,
        user.value.username,
        (loaded, total) => {
          syncProgress.value = `${loaded}/${total}`;
        },
      );
      if (items.length) collections.value = items;
      lastSyncAt.value = Date.now();
      await saveCache();
      void animeLog(`Bangumi 收藏同步完成：${collections.value.length} 条`);
      return true;
    } catch (e) {
      listError.value = describeBangumiError(e);
      // 401 说明 token 已失效：退回未授权态，让用户重新填
      if (e instanceof Error && e.message.includes("HTTP 401")) {
        authState.value = "error";
        authError.value = listError.value;
      }
      void animeLog(`Bangumi 收藏同步失败: ${listError.value}`);
      return false;
    } finally {
      listLoading.value = false;
      syncProgress.value = "";
    }
  }

  /** 用缓存兜底：列表为空但离线缓存有数据时直接展示（init 已处理，这里给 UI 显式调用） */
  function refreshFromCache() {
    void loadCache();
  }

  // ---- 状态更新（详情页追番按钮） ----

  /**
   * 切换某条目的 Bangumi 收藏状态并同步本地缓存。
   * subject 用于「首次收藏」时在缓存里造出条目（列表页立即可见）。
   */
  async function setStatus(
    subjectId: number,
    category: Exclude<BangumiCollectionCategory, 0>,
    subject?: BangumiSubject | null,
  ): Promise<boolean> {
    if (!authorized.value || !settings.bangumiToken) {
      listError.value = "请先连接 Bangumi 账号";
      return false;
    }
    if (savingIds.value.includes(subjectId)) return false;
    savingIds.value = [...savingIds.value, subjectId];
    listError.value = "";
    try {
      await setCollectionStatus(settings.bangumiToken, subjectId, category);
      const existing = bySubjectId.value.get(subjectId);
      if (existing) {
        existing.category = category;
        existing.updatedAt = new Date().toISOString();
      } else {
        collections.value.unshift({
          subjectId,
          category,
          updatedAt: new Date().toISOString(),
          subject: subject ?? { id: subjectId, name: String(subjectId) },
        });
      }
      await saveCache();
      void animeLog(`Bangumi 状态更新成功 subject=${subjectId} category=${category}`);
      return true;
    } catch (e) {
      listError.value = describeBangumiError(e);
      void animeLog(`Bangumi 状态更新失败 subject=${subjectId}: ${listError.value}`);
      return false;
    } finally {
      savingIds.value = savingIds.value.filter((id) => id !== subjectId);
    }
  }

  return {
    user,
    authState,
    authError,
    authorized,
    collections,
    listLoading,
    listError,
    savingIds,
    lastSyncAt,
    syncProgress,
    statusOf,
    byCategory,
    init,
    connect,
    disconnect,
    pull,
    refreshFromCache,
    setStatus,
  };
});
