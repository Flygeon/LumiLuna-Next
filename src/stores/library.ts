import { defineStore } from "pinia";
import { ref } from "vue";
import { capabilities } from "@/capabilities";
import { useSettingsStore } from "@/stores/settings";
import type { MediaFile, MediaMetadata, ScanProgress } from "@shared/types";

export const useLibraryStore = defineStore("library", () => {
  const files = ref<MediaFile[]>([]);
  const metaMap = ref<Record<string, MediaMetadata>>({});
  const thumbCache = ref<Record<string, string>>({});
  const loading = ref(false);
  const scanning = ref(false);
  const progress = ref<ScanProgress | null>(null);
  const scanLogs = ref<string[]>([]);
  const loadedTypes = ref<Set<string>>(new Set());

  async function refresh(type?: string, force = false) {
    // 如果已有该类型缓存且不强制刷新，跳过
    if (type && !force && loadedTypes.value.has(type) && files.value.length > 0) {
      return;
    }
    loading.value = true;
    try {
      files.value = await capabilities.listFiles(type);
      // 批量获取元数据（仅获取尚未缓存的）
      const missing = files.value.filter((f) => !metaMap.value[f.id]);
      const metas = await Promise.all(
        missing.slice(0, 200).map((f) => capabilities.getMetadata(f.id)),
      );
      metas.forEach((m) => {
        metaMap.value[m.file_id] = m;
      });
      if (type) loadedTypes.value.add(type);
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
    const list = files.value;
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
      // 轮询进度
      const poll = setInterval(async () => {
        const p = await capabilities.scanStatus(jobId);
        progress.value = p;
        if (p.stage === "done") {
          clearInterval(poll);
          scanning.value = false;
          // 扫描完成后强制刷新所有类型
          loadedTypes.value.clear();
          thumbCache.value = {};
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
