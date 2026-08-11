/**
 * 统一 Capabilities 前端接口。
 * 所有原生能力经 invoke（请求/响应）+ listen（事件推送）调用 Rust Command。
 * 前端不直接触碰磁盘/数据库/原生资源。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import type {
  FfmpegStatus,
  ListQuery,
  MediaEntry,
  MediaMetadata,
  ScanConfig,
  ScanProgress,
  Song,
} from "@shared/types";
import { mockInvoke } from "./mock";

/** 在 Tauri 环境下调用；非 Tauri（纯 Web 预览）时降级为 mock。 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri) return mockInvoke<T>(cmd, args);
  return invoke<T>(cmd, args);
}

export const capabilities = {
  // ---- 扫描 ----
  scanStart(config: ScanConfig): Promise<{ jobId: string }> {
    return safeInvoke("scan_start", { config });
  },
  scanCancel(jobId: string): Promise<void> {
    return safeInvoke("scan_cancel", { jobId });
  },
  scanStatus(jobId: string): Promise<ScanProgress | null> {
    return safeInvoke("scan_status", { jobId });
  },
  /** 订阅扫描进度事件；返回取消订阅函数 */
  async onScanProgress(handler: (p: ScanProgress) => void): Promise<UnlistenFn> {
    if (!isTauri) return () => {};
    return listen<ScanProgress>("scan:progress", (e) => handler(e.payload));
  },

  // ---- 媒体库 ----
  listFiles(query?: ListQuery): Promise<MediaEntry[]> {
    return safeInvoke("list_files", { query: query ?? null });
  },
  libraryCounts(): Promise<Record<string, number>> {
    return safeInvoke("library_counts");
  },
  getMetadata(fileId: string): Promise<MediaMetadata> {
    return safeInvoke("get_metadata", { fileId });
  },
  getSong(fileId: string): Promise<Song> {
    return safeInvoke("get_song", { fileId });
  },
  /** 缩略图 data URL；无法生成时返回 null（调用方显示类型占位图） */
  getThumbnail(fileId: string, size = 320): Promise<string | null> {
    return safeInvoke("get_thumbnail", { fileId, size });
  },
  clearThumbnailCache(): Promise<number> {
    return safeInvoke("clear_thumbnail_cache");
  },

  // ---- 收藏 / 历史 / 回收站 ----
  toggleFavorite(fileId: string): Promise<boolean> {
    return safeInvoke("toggle_favorite", { fileId });
  },
  listFavorites(): Promise<MediaEntry[]> {
    return safeInvoke("list_favorites");
  },
  recordPlay(fileId: string): Promise<void> {
    return safeInvoke("record_play", { fileId });
  },
  listHistory(): Promise<MediaEntry[]> {
    return safeInvoke("list_history");
  },
  listTrash(): Promise<MediaEntry[]> {
    return safeInvoke("list_trash");
  },
  emptyTrash(): Promise<number> {
    return safeInvoke("empty_trash");
  },

  // ---- FFmpeg ----
  ffmpegStatus(): Promise<FfmpegStatus> {
    return safeInvoke("ffmpeg_status");
  },
  /** 传 null 清除手动路径，回落到系统 PATH 探测 */
  ffmpegSetPath(dir: string | null): Promise<FfmpegStatus> {
    return safeInvoke("ffmpeg_set_path", { dir });
  },
  async openFfmpegDownloadPage(): Promise<void> {
    const url = await safeInvoke<string>("ffmpeg_download_url");
    if (isTauri) await openUrl(url);
    else window.open(url, "_blank");
  },

  // ---- 系统 ----
  async openFile(path: string): Promise<void> {
    if (!isTauri) return;
    await openPath(path.replace(/\\/g, "/"));
  },
  /** 选择目录，返回路径或 null */
  async pickDirectory(): Promise<string | null> {
    if (!isTauri) return null;
    const result = await dialogOpen({ directory: true, multiple: false });
    if (typeof result === "string") return result;
    if (result && typeof result === "object" && "path" in result) {
      return (result as { path: string }).path;
    }
    return null;
  },
};
