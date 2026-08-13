/**
 * 逐字精排时间轴的 IndexedDB 缓存。
 * key = 歌曲标识（本地 local:<fileId> / 在线 online:<songId>）。
 * value = { v: 1, lines: [{ idx, times, end }] }
 */
export interface PreciseLine {
  idx: number;
  /** 每字起始时间（秒），长度 = 字数；末字 end 用 end 字段 */
  times: number[];
  /** 行结束时间（下一行 start 或估算） */
  end: number;
}

const DB_NAME = "lumiluna";
const STORE = "wordTimes";

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

export async function wordCacheGet(key: string): Promise<PreciseLine[] | null> {
  try {
    const db = await openDb();
    return await new Promise<PreciseLine[] | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const data = req.result;
        if (data && data.v === 1 && Array.isArray(data.lines)) {
          resolve(data.lines as PreciseLine[]);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function wordCacheSet(key: string, lines: PreciseLine[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ v: 1, lines }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 缓存失败不阻塞主流程 */
  }
}
