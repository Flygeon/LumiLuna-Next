import { defineStore } from "pinia";
import { ref } from "vue";
import { capabilities } from "@/capabilities";
import { useSettingsStore } from "@/stores/settings";
import type { MediaFile, MediaMetadata, ScanProgress } from "@shared/types";

export const useLibraryStore = defineStore("library", () => {
  // 按类型缓存文件列表
  const filesByType = ref<Record<string, MediaFile[]>>({});
  const metaMap = ref<Record<string, MediaMetadata>>({});
  const thumbCache = ref<Record<string, string>>({});
  const loading = ref(false);
  const scanning = ref(false);
  const progress = ref<ScanProgress | null>(null);
  const scanLogs = ref<string[]>([]);
  const loadedTypes = ref<Set<string>>(new Set());

  /** 当前活跃类型（供模板用） */
  const files = ref<MediaFile[]>([]);

  async function refresh(type?: string, force = false) {
    const key = type || "__all__";
    // 如果已有该类型缓存且不强制刷新，直接返回
    if (!force && loadedTypes.value.has(key) && filesByType.value[key]?.length >= 0) {
      files.value = filesByType.value[key] || [];
      return;
    }
    loading.value = true;
    try {
      const list = await capabilities.listFiles(type);
      filesByType.value[key] = list;
      files.value = list;
      // 批量获取元数据（仅获取尚未缓存的）
      const missing = list.filter((f) => !metaMap.value[f.id]);
      const metas = await Promise.all(
        missing.slice(0, 200).map((f) => capabilities.getMetadata(f.id)),
      );
      metas.forEach((m) => {
        metaMap.value[m.file_id] = m;
      });
      loadedTypes.value.add(key);
    } finally {
      loading.value = false;
    }
  }

  /** 异步增量加载缩略图（带缓存 + 并发控制） */
  async function loadThumbnails(
    type: string,
    onThumb: (id: string, dataUrl: string) => void,
    concurrency = 6,
  ) {
    const list = filesByType.value[type] || files.value;
    let index = 0;
    async function worker() {
      while (index < list.length) {
        const i = index++;
        const f = list[i];
        if (thumbCache.value[f.id]) {
          onThumb(f.id, thumbCache.value[f.id]);
          continue;
        }
        try {
          const dataUrl = await capabilities.getThumbnail(f.id, 300);
          if (dataUrl) {
            thumbCache.value[f.id] = dataUrl;
            onThumb(f.id, dataUrl);
          }
        } catch {}
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, list.length) }, () => worker()),
    );
  }

  async function startScan(dirs?: string[]) {
    scanning.value = true;
    scanLogs.value = [];
    try {
      const settings = useSettingsStore();
      const scanDirs = dirs && dirs.length ? dirs : (settings.scanDirs.length ? settings.scanDirs : ["/"]);
      const { jobId } = await capabilities.scanStart({ dirs: scanDirs });
      const poll = setInterval(async () => {
        const p = await capabilities.scanStatus(jobId);
        progress.value = p;
        if (p.stage === "done") {
          clearInterval(poll);
          scanning.value = false;
          // 扫描完成后强制刷新所有类型
          loadedTypes.value.clear();
          thumbCache.value = {};
          filesByType.value = {};
          await refresh();
        }
      }, 500);
    } catch (e) {
      scanning.value = false;
      scanLogs.value.push(`扫描失败: ${e}`);
    }
  }

  return {
    files,
    filesByType,
    metaMap,
    thumbCache,
    loading,
    scanning,
    progress,
    scanLogs,
    refresh,
    loadThumbnails,
    startScan,
  };
});
