import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { capabilities, isTauri } from "@/capabilities";
import { useSettingsStore } from "@/stores/settings";
import type { ListQuery, MediaEntry, ScanProgress } from "@shared/types";

export type SortKey = NonNullable<ListQuery["sortBy"]>;

/** 缩略图内存缓存上限，防止大图库把渲染进程撑爆 */
const THUMB_CACHE_LIMIT = 1200;

export const useLibraryStore = defineStore("library", () => {
  /** 按类型缓存列表 */
  const entriesByType = ref<Record<string, MediaEntry[]>>({});
  const counts = ref<Record<string, number>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  // 缩略图不需要深响应，用 shallowRef + 版本号手动触发，避免大对象 proxy 开销
  const thumbCache = shallowRef<Map<string, string>>(new Map());
  const thumbVersion = ref(0);

  const scanning = ref(false);
  const progress = ref<ScanProgress | null>(null);
  const currentJobId = ref<string | null>(null);
  let unlistenScan: UnlistenFn | null = null;

  // ---- 视图状态（搜索/排序，各类型共用）----
  const search = ref("");
  const sortBy = ref<SortKey>("name");
  const sortDesc = ref(false);

  function getThumb(id: string): string | undefined {
    void thumbVersion.value; // 建立依赖，缓存更新时重新求值
    return thumbCache.value.get(id);
  }

  function setThumb(id: string, url: string) {
    const cache = thumbCache.value;
    if (cache.size >= THUMB_CACHE_LIMIT) {
      // Map 保持插入序，删最早的一批
      const drop = Math.floor(THUMB_CACHE_LIMIT * 0.2);
      let i = 0;
      for (const key of cache.keys()) {
        if (i++ >= drop) break;
        cache.delete(key);
      }
    }
    cache.set(id, url);
    thumbVersion.value++;
  }

  function entries(type: string): MediaEntry[] {
    return entriesByType.value[type] ?? [];
  }

  /** 拉取某类型列表。搜索、排序、体积过滤都下推到 SQL，不在前端做。 */
  async function refresh(type: string) {
    loading.value = true;
    error.value = null;
    try {
      const list = await capabilities.listFiles({
        type,
        search: search.value || undefined,
        sortBy: sortBy.value,
        desc: sortDesc.value,
        minSize: minSizeBytes(),
      });
      entriesByType.value = { ...entriesByType.value, [type]: list };
    } catch (e) {
      error.value = String(e);
      entriesByType.value = { ...entriesByType.value, [type]: [] };
    } finally {
      loading.value = false;
    }
  }

  /** 设置里的 MB 阈值换算成字节 */
  function minSizeBytes(): number {
    const mb = useSettingsStore().minFileSizeMb;
    return mb > 0 ? Math.round(mb * 1024 * 1024) : 0;
  }

  async function refreshCounts() {
    try {
      counts.value = await capabilities.libraryCounts(minSizeBytes());
    } catch {
      /* 角标失败不影响主流程 */
    }
  }

  /**
   * 按需加载缩略图（供虚拟滚动只请求可视区）。
   * 并发受限，已缓存的直接跳过。
   */
  async function loadThumbnails(ids: string[], concurrency = 6) {
    const pending = ids.filter((id) => id && !thumbCache.value.has(id));
    if (!pending.length) return;

    // PDF 需要前端渲染封面，先按 id 找出对应条目
    const entryOf = (id: string) => {
      for (const list of Object.values(entriesByType.value)) {
        const hit = list.find((e) => e.id === id);
        if (hit) return hit;
      }
      return undefined;
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const id = pending[cursor++];
        if (thumbCache.value.has(id)) continue;
        try {
          const url = await capabilities.getThumbnail(id, 320);
          if (url) {
            setThumb(id, url);
            continue;
          }
          // 后端拿不到封面时，PDF 用 pdf.js 渲染首页补上
          const entry = entryOf(id);
          if (entry?.ext.toLowerCase() === "pdf") {
            const generated = await generatePdfCover(entry);
            if (generated) setThumb(id, generated);
          }
        } catch {
          /* 单张失败不影响其它 */
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, pending.length) }, worker),
    );
  }

  /** 用 pdf.js 渲染 PDF 首页作为封面，并回存到后端磁盘缓存 */
  async function generatePdfCover(entry: MediaEntry): Promise<string | null> {
    if (!isTauri) return null;
    try {
      const cached = await capabilities.thumbnailCachePath(entry.id, 320);
      if (cached) return cached;

      const { readFile } = await import("@tauri-apps/plugin-fs");
      const { renderPdfCover, toArrayBuffer } = await import("@/utils/pdf");
      const bytes = await readFile(entry.path);
      const jpeg = await renderPdfCover(toArrayBuffer(bytes), 320);
      if (!jpeg) return null;
      return await capabilities.saveThumbnail(entry.id, jpeg, 320);
    } catch {
      return null;
    }
  }

  /** 扫描完成后所有缓存都失效 */
  function invalidate() {
    entriesByType.value = {};
    thumbCache.value = new Map();
    thumbVersion.value++;
  }

  async function startScan(dirs?: string[]) {
    if (scanning.value) return;
    const settings = useSettingsStore();
    const scanDirs = dirs?.length ? dirs : settings.scanDirs;
    if (!scanDirs.length) {
      error.value = "empty-dirs";
      return;
    }

    scanning.value = true;
    error.value = null;
    progress.value = null;

    // 事件驱动进度，替代旧的 500ms 轮询
    unlistenScan?.();
    unlistenScan = await capabilities.onScanProgress((p) => {
      if (p.jobId !== currentJobId.value) return;
      progress.value = p;
      if (p.stage === "done" || p.stage === "cancelled" || p.stage === "error") {
        void finishScan(p);
      }
    });

    try {
      const { jobId } = await capabilities.scanStart({ dirs: scanDirs });
      currentJobId.value = jobId;
      // 浏览器 mock 无事件通道，回落到一次性查询
      await pollIfNoEvents(jobId);
    } catch (e) {
      error.value = String(e);
      scanning.value = false;
      unlistenScan?.();
      unlistenScan = null;
    }
  }

  /** mock / 事件缺失场景的兜底：任务已是终态时直接收尾 */
  async function pollIfNoEvents(jobId: string) {
    const status = await capabilities.scanStatus(jobId);
    if (status && ["done", "cancelled", "error"].includes(status.stage)) {
      progress.value = status;
      await finishScan(status);
    }
  }

  async function finishScan(p: ScanProgress) {
    scanning.value = false;
    currentJobId.value = null;
    unlistenScan?.();
    unlistenScan = null;
    if (p.stage === "error") {
      error.value = p.error ?? "scan-failed";
      return;
    }
    invalidate();
    await refreshCounts();
  }

  async function cancelScan() {
    if (currentJobId.value) {
      await capabilities.scanCancel(currentJobId.value);
    }
  }

  async function toggleFavorite(entry: MediaEntry) {
    const next = await capabilities.toggleFavorite(entry.id);
    // 就地更新所有列表里的同一条目
    for (const list of Object.values(entriesByType.value)) {
      const hit = list.find((e) => e.id === entry.id);
      if (hit) hit.favorite = next;
    }
    entriesByType.value = { ...entriesByType.value };
  }

  const scanLabel = computed(() => {
    const p = progress.value;
    if (!p) return "";
    if (p.stage === "enumerate") return `正在枚举 ${p.done}`;
    if (p.stage === "store") return `正在入库 ${p.done}/${p.total}`;
    if (p.stage === "parse") return `正在解析 ${p.done}/${p.total}`;
    return "";
  });

  return {
    entriesByType,
    counts,
    loading,
    error,
    scanning,
    progress,
    scanLabel,
    search,
    sortBy,
    sortDesc,
    entries,
    getThumb,
    refresh,
    refreshCounts,
    loadThumbnails,
    invalidate,
    startScan,
    cancelScan,
    toggleFavorite,
  };
});
