/**
 * WebDAV 适配器：目录浏览、媒体 URL、连接测试的前端封装。
 *
 * 所有网络请求都经 Rust command（凭据只在 Rust 侧，前端 URL 不含凭据）；
 * 媒体通过 127.0.0.1 本地代理流式访问（支持 Range/拖动进度）。
 * 浏览器预览（非 Tauri）由 capabilities mock 提供演示数据。
 *
 * 缓存策略：
 * - 内存缓存（TTL 30s）：来回切目录时避免重复 PROPFIND。
 * - IndexedDB 持久缓存：按路径索引目录内容，重启后仍可秒开/离线查看。
 * - 后台刷新：页面先返回缓存内容，再调 `webdavList` 拉取最新状态并更新缓存。
 */
import { capabilities } from "@/capabilities";
import type { WebDavEntry, WebDavStatus } from "@shared/types";

/** 目录列举内存缓存（TTL），避免来回切目录时重复 PROPFIND */
const LIST_CACHE_TTL = 30_000;
const listCache = new Map<string, { t: number; entries: WebDavEntry[] }>();

// ---- IndexedDB 持久缓存（按目录路径索引）----

const DB_NAME = "lumiluna-webdav";
const STORE = "kv";
const LIST_PREFIX = "list:";

interface WebDavListCache {
  savedAt: number;
  entries: WebDavEntry[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/** 读取某个目录的持久化索引；无缓存返回 null */
export async function webdavListCached(
  path: string,
): Promise<WebDavEntry[] | null> {
  const hit = listCache.get(path);
  if (hit && Date.now() - hit.t < LIST_CACHE_TTL) return hit.entries;
  const cached = await kvGet<WebDavListCache>(LIST_PREFIX + path);
  return cached?.entries ?? null;
}

/** 列举目录内容；命中内存缓存直接返回，否则在线拉取并写入持久化索引 */
export async function webdavList(path: string): Promise<WebDavEntry[]> {
  const hit = listCache.get(path);
  if (hit && Date.now() - hit.t < LIST_CACHE_TTL) return hit.entries;
  const entries = await capabilities.webdavList(path);
  listCache.set(path, { t: Date.now(), entries });
  await kvSet(LIST_PREFIX + path, { savedAt: Date.now(), entries });
  return entries;
}

/** 清空内存列表缓存（刷新按钮用，不清持久索引，成功后会被最新数据覆盖） */
export function clearWebDavListCache() {
  listCache.clear();
}

/** 清空全部 WebDAV 索引缓存（设置变更/登出等场景） */
export async function clearWebDavCache() {
  listCache.clear();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 清理失败可忽略 */
  }
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