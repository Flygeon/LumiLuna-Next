/**
 * 统一 Capabilities 前端接口。
 * 所有原生能力经 invoke（请求/响应）+ listen（事件推送）调用 Rust Command。
 * 前端不直接触碰磁盘/数据库/原生资源。
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type {
  BookProgress,
  FfmpegStatus,
  ListQuery,
  MediaEntry,
  MediaMetadata,
  ScanConfig,
  ScanProgress,
  SmtcCommand,
  SmtcMedia,
  SmtcPlayback,
  NeteaseCloudPage,
  NeteasePlaylist,
  NeteaseProfile,
  NeteaseQrCheck,
  NeteaseSong,
  Song,
  WebDavEntry,
  WebDavStatus,
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
  libraryCounts(minSize = 0): Promise<Record<string, number>> {
    return safeInvoke("library_counts", { minSize });
  },
  getMetadata(fileId: string): Promise<MediaMetadata> {
    return safeInvoke("get_metadata", { fileId });
  },
  getSong(fileId: string): Promise<Song> {
    return safeInvoke("get_song", { fileId });
  },
  /**
   * 缩略图。后端返回磁盘缓存路径，这里转成 asset:// URL 交给 <img> 流式加载。
   * 不用 base64 data URL：上万张图会把渲染进程内存撑爆。
   */
  async getThumbnail(fileId: string, size = 320): Promise<string | null> {
    const path = await safeInvoke<string | null>("get_thumbnail", { fileId, size });
    if (!path) return null;
    return isTauri ? convertFileSrc(path) : path;
  },
  clearThumbnailCache(): Promise<number> {
    return safeInvoke("clear_thumbnail_cache");
  },
  /** 查询缓存中是否已有缩略图（PDF 封面按需生成前先探测） */
  async thumbnailCachePath(fileId: string, size = 320): Promise<string | null> {
    const path = await safeInvoke<string | null>("thumbnail_cache_path", {
      fileId,
      size,
    });
    return path ? (isTauri ? convertFileSrc(path) : path) : null;
  },
  /** 保存前端渲染的封面（PDF 首页）到缩略图缓存 */
  async saveThumbnail(
    fileId: string,
    jpeg: Uint8Array,
    size = 320,
  ): Promise<string | null> {
    const path = await safeInvoke<string | null>("save_thumbnail", {
      fileId,
      size,
      jpeg: Array.from(jpeg),
    });
    return path ? (isTauri ? convertFileSrc(path) : path) : null;
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

  // ---- 书籍阅读进度 ----
  getBookProgress(fileId: string): Promise<BookProgress | null> {
    return safeInvoke("get_book_progress", { fileId });
  },
  saveBookProgress(
    bookId: string,
    location: string,
    page: number,
    percent: number,
  ): Promise<void> {
    return safeInvoke("save_book_progress", { bookId, location, page, percent });
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

  // ---- Windows 系统媒体控件 (SMTC) ----
  smtcSetMedia(media: SmtcMedia): Promise<void> {
    return safeInvoke("smtc_set_media", { ...media });
  },
  smtcSetPlayback(state: SmtcPlayback): Promise<void> {
    return safeInvoke("smtc_set_playback", { ...state });
  },
  /** 订阅系统媒体键（播放/暂停/上一首/下一首/拖动进度）；返回取消订阅函数 */
  async onSmtcCommand(handler: (cmd: SmtcCommand) => void): Promise<UnlistenFn> {
    if (!isTauri) return () => {};
    return listen<SmtcCommand>("smtc:command", (e) => handler(e.payload));
  },

  // ---- WebDAV ----
  webdavConfigure(url: string, username: string, password: string): Promise<void> {
    return safeInvoke("webdav_configure", { url, username, password });
  },
  webdavList(path: string): Promise<WebDavEntry[]> {
    return safeInvoke("webdav_list", { path });
  },
  webdavTest(): Promise<WebDavStatus> {
    return safeInvoke("webdav_test");
  },
  webdavMediaUrl(path: string): Promise<string> {
    return safeInvoke("webdav_media_url", { path });
  },

  // ---- 网易云账号 ----
  neteaseLoginQrKey(): Promise<string> {
    return safeInvoke("netease_login_qr_key");
  },
  neteaseLoginQrCheck(key: string): Promise<NeteaseQrCheck> {
    return safeInvoke("netease_login_qr_check", { key });
  },
  neteaseAccount(): Promise<NeteaseProfile> {
    return safeInvoke("netease_account");
  },
  neteaseUserPlaylists(offset = 0, limit = 100): Promise<NeteasePlaylist[]> {
    return safeInvoke("netease_user_playlists", { offset, limit });
  },
  neteasePlaylistDetail(id: number): Promise<NeteaseSong[]> {
    return safeInvoke("netease_playlist_detail", { id });
  },
  neteaseCloud(offset = 0, limit = 50): Promise<NeteaseCloudPage> {
    return safeInvoke("netease_cloud", { offset, limit });
  },
  neteaseSongUrl(ids: number[]): Promise<{ id: number; url: string }[]> {
    return safeInvoke("netease_song_url", { ids });
  },
  neteaseLogout(): Promise<void> {
    return safeInvoke("netease_logout");
  },

  // ---- 系统 ----
  /** 在系统浏览器中打开 URL（浏览器预览退化 window.open） */
  async openUrl(url: string): Promise<void> {
    if (!isTauri) {
      window.open(url, "_blank");
      return;
    }
    await openUrl(url);
  },
  async openFile(path: string): Promise<void> {
    if (!isTauri) return;
    await openPath(path.replace(/\\/g, "/"));
  },
  /** 在系统文件管理器中定位并选中文件 */
  async revealInExplorer(path: string): Promise<void> {
    if (!isTauri) return;
    await revealItemInDir(path.replace(/\\/g, "/"));
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
  /** 保存文件对话框，返回目标路径或 null（用户取消） */
  async pickSavePath(defaultName: string): Promise<string | null> {
    if (!isTauri) return null;
    const result = await dialogSave({ defaultPath: defaultName });
    return typeof result === "string" ? result : null;
  },
  /** 下载 URL 字节到本地路径（走系统网络栈，无 CORS 限制） */
  async downloadTo(url: string, dest: string): Promise<void> {
    if (!isTauri) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeFile(dest, bytes);
  },
};