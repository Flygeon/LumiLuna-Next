/**
 * 统一 Capabilities 前端接口。
 * 所有原生能力经 invoke（请求/响应）+ listen/emit（事件推送）调用 Rust Command。
 * 前端不直接触碰磁盘/数据库/原生资源。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  MediaFile,
  MediaMetadata,
  ScanConfig,
  ScanProgress,
  Song,
} from "@shared/types";

/** 在 Tauri 环境下调用；非 Tauri（纯 Web 预览）时降级为 mock。 */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    return mockInvoke<T>(cmd, args);
  }
  return invoke<T>(cmd, args);
}

// ---- mock 实现（仅用于纯浏览器预览 demo）----
let mockFiles: MediaFile[] = [
  {
    id: "demo1",
    path: "demo/夜曲.flac",
    type: "audio",
    size: 0,
    mtime: 0,
    scanned_at: 0,
    deleted: 0,
  },
];
function mockInvoke<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case "scan_start":
      return Promise.resolve({ jobId: "mock" } as T);
    case "scan_status":
      return Promise.resolve({
        jobId: "mock",
        stage: "done",
        done: 1,
        total: 1,
        percent: 100,
      } as T);
    case "list_files":
      return Promise.resolve(mockFiles as T);
    case "get_metadata":
      return Promise.resolve({
        file_id: "demo1",
        title: "夜曲",
        artist: "周杰伦",
        album: "十一月的萧邦",
        duration_ms: 231000,
      } as T);
    default:
      return Promise.resolve({} as T);
  }
}

export const capabilities = {
  /** 启动扫描任务，返回 jobId */
  scanStart(config: ScanConfig): Promise<{ jobId: string }> {
    return safeInvoke("scan_start", { config });
  },
  scanCancel(jobId: string): Promise<void> {
    return safeInvoke("scan_cancel", { jobId });
  },
  scanStatus(jobId: string): Promise<ScanProgress> {
    return safeInvoke("scan_status", { jobId });
  },
  /** 查询某类型媒体文件列表 */
  listFiles(type?: string): Promise<MediaFile[]> {
    return safeInvoke("list_files", { type });
  },
  getMetadata(fileId: string): Promise<MediaMetadata> {
    return safeInvoke("get_metadata", { fileId });
  },
  /** 获取歌曲（音频+元数据+封面+歌词） */
  getSong(fileId: string): Promise<Song> {
    return safeInvoke("get_song", { fileId });
  },
  /** 获取缩略图/封面（返回 data url 或路径） */
  getThumbnail(fileId: string, size?: number): Promise<string> {
    return safeInvoke("get_thumbnail", { fileId, size });
  },
};
