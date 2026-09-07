/**
 * 网络抓取前端封装（调 Rust `anime_fetch`）。
 *
 * 三层保护，缺一不可——聚合搜索会同时打几十个源：
 * 1. 在途合并：相同（规则 + 请求）的并发请求只发一次，重复点击不放大
 * 2. TTL 缓存：同一关键字重复搜索、反复进出同一详情页/播放页不再重发请求
 * 3. 并发闸门：限制同时在途的抓取数。几十条连接同时开会互相抢带宽 +
 *    触发对方站点限流，结果就是大面积超时（表现为「检索特别慢 / 无响应」）
 *
 * 只缓存成功结果：失败原因多为瞬时（超时/被限流），缓存住会让用户刷不出来。
 */
import type { AnimeFetchResult, AnimeFetchSpec } from "@shared/types";
import { capabilities } from "@/capabilities";
import { animeLog } from "./animeLog";

export class AnimeFetchError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "AnimeFetchError";
  }
}

/** 缓存有效期：5 分钟内重复访问同一地址直接复用 */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** 缓存条目上限（HTML 单条可能上百 KB，不能无限堆） */
const CACHE_MAX_ENTRIES = 96;
/** 同时在途抓取上限（Rust 侧已真并发，这里只做节流） */
const MAX_CONCURRENT = 8;

interface CacheEntry {
  at: number;
  value: AnimeFetchResult;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<AnimeFetchResult>>();

// ---- 并发闸门 ----
let active = 0;
const waiting: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => {
      active += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

function specKey(ruleName: string, spec: AnimeFetchSpec): string {
  return [ruleName, spec.method, spec.url, spec.body ?? "", spec.includeCookies ? "c" : ""].join(
    "|",
  );
}

function putCache(key: string, value: AnimeFetchResult): void {
  // Map 迭代序即插入序：超限时删最老的一条
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), value });
}

export interface FetchAnimeHtmlOptions {
  /** 覆盖本次请求超时（毫秒） */
  timeoutMs?: number;
  /** 跳过缓存（用户手动重试 / 强制刷新时用） */
  skipCache?: boolean;
}

export async function fetchAnimeHtml(
  ruleName: string,
  spec: AnimeFetchSpec,
  opts: FetchAnimeHtmlOptions = {},
): Promise<AnimeFetchResult> {
  const key = specKey(ruleName, spec);
  if (!opts.skipCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      void animeLog(`缓存命中 ${ruleName} ${spec.url}（age=${Date.now() - hit.at}ms）`);
      return hit.value;
    }
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = doFetch(ruleName, spec, opts)
    .then((res) => {
      putCache(key, res);
      return res;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function doFetch(
  ruleName: string,
  spec: AnimeFetchSpec,
  opts: FetchAnimeHtmlOptions,
): Promise<AnimeFetchResult> {
  await acquireSlot();
  try {
    const withTimeout: AnimeFetchSpec =
      opts.timeoutMs === undefined ? spec : { ...spec, timeoutMs: opts.timeoutMs };
    return await capabilities.animeFetch(ruleName, withTimeout);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    // Rust 侧约定错误信息前缀：HTTP xxx / network / timeout
    const statusMatch = /HTTP (\d{3})/.exec(msg);
    throw new AnimeFetchError(msg, statusMatch ? Number(statusMatch[1]) : undefined);
  } finally {
    releaseSlot();
  }
}

/** 清空抓取缓存（规则变更 / 用户强制刷新用） */
export function clearAnimeFetchCache(): void {
  cache.clear();
}

/** 缓存概况，供诊断日志输出 */
export function animeFetchCacheStats(): { entries: number; active: number; waiting: number } {
  return { entries: cache.size, active, waiting: waiting.length };
}
