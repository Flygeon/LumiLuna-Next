/**
 * 网络抓取前端封装（调 Rust `anime_fetch`）。
 *
 * - 统一异常为 AnimeFetchError（超时 / HTTP 非 2xx / 网络失败）
 * - 相同（规则 + 请求）在途请求合并，避免重复点击触发重复抓取
 * - 不做 HTML 缓存：解析结果由 store 持有，重复进入详情时允许重新抓取
 */
import type { AnimeFetchResult, AnimeFetchSpec } from "@shared/types";
import { capabilities } from "@/capabilities";

export class AnimeFetchError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AnimeFetchError";
  }
}

const inFlight = new Map<string, Promise<AnimeFetchResult>>();

function specKey(ruleName: string, spec: AnimeFetchSpec): string {
  return [
    ruleName,
    spec.method,
    spec.url,
    spec.body ?? "",
    spec.includeCookies ? "c" : "",
  ].join("|");
}

export async function fetchAnimeHtml(
  ruleName: string,
  spec: AnimeFetchSpec,
): Promise<AnimeFetchResult> {
  const key = specKey(ruleName, spec);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = doFetch(ruleName, spec).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function doFetch(
  ruleName: string,
  spec: AnimeFetchSpec,
): Promise<AnimeFetchResult> {
  try {
    return await capabilities.animeFetch(ruleName, spec);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    // Rust 侧约定错误信息前缀：HTTP xxx / timeout / network
    const statusMatch = /HTTP (\d{3})/.exec(msg);
    throw new AnimeFetchError(msg, statusMatch ? Number(statusMatch[1]) : undefined);
  }
}
