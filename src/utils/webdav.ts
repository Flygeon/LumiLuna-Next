/**
 * WebDAV 适配器：目录浏览、媒体 URL、连接测试的前端封装。
 *
 * 所有网络请求都经 Rust command（凭据只在 Rust 侧，前端 URL 不含凭据）；
 * 媒体通过 127.0.0.1 本地代理流式访问（支持 Range/拖动进度）。
 * 浏览器预览（非 Tauri）由 capabilities mock 提供演示数据。
 */
import { capabilities } from "@/capabilities";
import type { WebDavEntry, WebDavStatus } from "@shared/types";

/** 目录列举内存缓存（TTL），避免来回切目录时重复 PROPFIND */
const LIST_CACHE_TTL = 30_000;
const listCache = new Map<string, { t: number; entries: WebDavEntry[] }>();

/** 列举目录内容；命中缓存直接返回 */
export async function webdavList(path: string): Promise<WebDavEntry[]> {
  const hit = listCache.get(path);
  if (hit && Date.now() - hit.t < LIST_CACHE_TTL) return hit.entries;
  const entries = await capabilities.webdavList(path);
  listCache.set(path, { t: Date.now(), entries });
  return entries;
}

/** 清空目录列举缓存（刷新按钮用） */
export function clearWebDavListCache() {
  listCache.clear();
}

/** 取媒体访问用的本地代理 URL（不含凭据） */
export function webdavMediaUrl(path: string): Promise<string> {
  return capabilities.webdavMediaUrl(path);
}

/** 连接测试（PROPFIND 根目录） */
export function webdavTest(): Promise<WebDavStatus> {
  return capabilities.webdavTest();
}

// ---- 条目分类（镜像 src-tauri/src/media.rs 的白名单子集）----

const IMAGE_EXTS = new Set([
  "jpg", "jpeg", "jpe", "png", "gif", "webp", "bmp", "tif", "tiff",
  "avif", "heic", "heif", "jfif", "ico", "svg",
]);
const VIDEO_EXTS = new Set([
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "flv", "wmv", "mpg", "mpeg",
  "ts", "m2ts", "3gp", "ogv",
]);
const AUDIO_EXTS = new Set([
  "mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wma", "aiff",
  "aif", "ape", "alac", "mpc", "wv",
]);
const BOOK_EXTS = new Set([
  "epub", "pdf", "mobi", "azw3", "fb2", "cbz", "cbr", "txt",
]);

export type DavEntryType =
  | "dir"
  | "image"
  | "video"
  | "audio"
  | "book"
  | "other";

export function entryType(entry: WebDavEntry): DavEntryType {
  if (entry.isDir) return "dir";
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (BOOK_EXTS.has(ext)) return "book";
  return "other";
}

/** 去掉扩展名的文件名（展示/播放标题用） */
export function titleOf(entry: WebDavEntry): string {
  return entry.name.replace(/\.[^.]+$/, "");
}