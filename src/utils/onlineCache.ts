/**
 * 在线音乐本地缓存（IndexedDB）：
 * - 封面图：URL → dataURL，重启/重新进入不再请求网络
 * - meting 歌词：歌曲 id → LRC 文本
 *
 * 独立数据库（lumiluna-online），与 wordCache 的 lumiluna 互不干扰。
 */
const DB_NAME = "lumiluna-online";
const STORE = "kv";

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

async function kvGet(key: string): Promise<unknown> {
  try {
    const db = await openDb();
    return await new Promise<unknown>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
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

// ---- 封面 ----

const COVER_PREFIX = "cover:";

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader 失败"));
    reader.readAsDataURL(blob);
  });
}

/** 取缓存封面（dataURL）；无缓存返回 null */
export async function coverGet(url: string): Promise<string | null> {
  const v = await kvGet(COVER_PREFIX + url);
  return typeof v === "string" && v ? v : null;
}

/**
 * 解析封面：缓存命中直接返回 dataURL；否则 fetch 下载 → 转 dataURL → 写入缓存。
 * 失败时返回原始 URL（优雅降级，不阻塞展示）。
 */
export async function resolveCover(url: string): Promise<string> {
  if (!url) return url;
  const cached = await coverGet(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.size) throw new Error("空响应");
    const dataUrl = await blobToDataUrl(blob);
    await kvSet(COVER_PREFIX + url, dataUrl);
    return dataUrl;
  } catch (e) {
    console.warn(
      "[封面缓存] 获取失败，回退原 URL:",
      e instanceof Error ? e.message : e,
    );
    return url;
  }
}

// ---- meting 歌词 ----

const LRC_PREFIX = "lrc:";

/** 取缓存的歌词文本；无缓存返回 null */
export async function lrcGet(songId: string): Promise<string | null> {
  const v = await kvGet(LRC_PREFIX + songId);
  return typeof v === "string" ? v : null;
}

/** 写入歌词文本缓存 */
export async function lrcSet(songId: string, text: string): Promise<void> {
  if (!text) return;
  await kvSet(LRC_PREFIX + songId, text);
}
