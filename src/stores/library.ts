import { defineStore } from "pinia";
import { ref } from "vue";
import { capabilities } from "@/capabilities";
import type { MediaFile, MediaMetadata, ScanProgress } from "@shared/types";

export const useLibraryStore = defineStore("library", () => {
  const files = ref<MediaFile[]>([]);
  const metaMap = ref<Record<string, MediaMetadata>>({});
  const loading = ref(false);
  const scanning = ref(false);
  const progress = ref<ScanProgress | null>(null);
  const scanLogs = ref<string[]>([]);

  async function refresh(type?: string) {
    loading.value = true;
    try {
      files.value = await capabilities.listFiles(type);
      // 批量获取元数据
      const metas = await Promise.all(
        files.value.slice(0, 200).map((f) => capabilities.getMetadata(f.id)),
      );
      metas.forEach((m) => {
        metaMap.value[m.file_id] = m;
      });
    } finally {
      loading.value = false;
    }
  }

  async function startScan(dirs: string[]) {
    scanning.value = true;
    scanLogs.value = [];
    try {
      const { jobId } = await capabilities.scanStart({ dirs });
      // 轮询进度（demo 简化；正式用 Tauri 事件推送）
      const poll = setInterval(async () => {
        const p = await capabilities.scanStatus(jobId);
        progress.value = p;
        if (p.stage === "done") {
          clearInterval(poll);
          scanning.value = false;
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
    loading,
    scanning,
    progress,
    scanLogs,
    refresh,
    startScan,
  };
});
