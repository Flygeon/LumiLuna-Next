/**
 * Bangumi 鉴权 API 客户端（access token 版）。
 *
 * 照 Kazumi（lib/request/apis/bangumi_api.dart + bangumi_sync_service.dart）的
 * 已验证路线实现：
 * - 用户在 https://next.bgm.tv/demo/access-token 获取官方 Access Token，
 *   粘贴进本应用完成「授权」（Kazumi 同款方案，不走 OAuth 回调）
 * - 鉴权接口走官方镜像 api.bgmapi.com（实测国内/海外均可达；api.bgm.tv 的
 *   鉴权路由对部分网络不可达）。镜像失败时逐域名回退到 api.bgm.tv
 * - POST /v0/users/-/collections/{subject_id}（"-" = 当前用户）以 JSON
 *   {type: n} 新增或修改收藏（Kazumi updateBangumiById 同款参数）
 * - 所有请求经 Rust anime_fetch 通道（浏览器 UA 会被 Bangumi 拦截）
 */
import { capabilities } from "@/capabilities";
import { fromV0 } from "@/utils/bangumiApi";
import type {
  AnimeFetchSpec,
  BangumiAuthUser,
  BangumiCollectionCategory,
  BangumiSubject,
  BangumiUserCollection,
} from "@shared/types";

const BANGUMI_UA = "LumiLuna/1.0 (Desktop; https://github.com/Flygeon/LumiLuna-Next)";

/** 鉴权接口域名：Kazumi 同款镜像优先，官方域兜底。 */
const AUTH_DOMAINS = ["https://api.bgmapi.com", "https://api.bgm.tv"];
/** 上一次调用成功的域名；模块级记忆，避免每请求都撞一遍死域名 */
let preferredDomain = AUTH_DOMAINS[0];

/** 带 HTTP 状态码的 Bangumi 错误（store 侧按状态语义化文案，照 Kazumi describeError） */
export class BangumiApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BangumiApiError";
    this.status = status;
  }
}

/** 把 BangumiApiError 映射成用户可读的中文错误（Kazumi describeError 同款分支） */
export function describeBangumiError(e: unknown): string {
  if (e instanceof BangumiApiError) {
    switch (e.status) {
      case 400:
        return "请求被 Bangumi 拒绝（验证错误），请检查条目状态参数";
      case 401:
        return "Access Token 无效或已过期，请重新获取并填写";
      case 403:
        return "Bangumi 拒绝访问，请检查 Token 权限或稍后重试";
      case 404:
        return "Bangumi 找不到该条目或收藏记录";
      case 429:
        return "Bangumi 请求过于频繁，请稍后重试";
    }
    return `Bangumi 服务请求失败（HTTP ${e.status}），请稍后重试`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 从 anime_fetch 的失败信息里提取 HTTP 状态码（Rust 侧格式：HTTP {status}（…）） */
function httpStatusOf(message: string): number | null {
  const m = /HTTP (\d{3})/.exec(message);
  return m ? Number(m[1]) : null;
}

async function authRequest(
  token: string,
  spec: Pick<AnimeFetchSpec, "method" | "body" | "bodyType"> & { path: string },
): Promise<unknown> {
  if (!token) throw new BangumiApiError(401, "尚未连接 Bangumi 账号");
  const ordered = [preferredDomain, ...AUTH_DOMAINS.filter((d) => d !== preferredDomain)];
  let lastErr: unknown = null;
  for (const domain of ordered) {
    try {
      const res = await capabilities.animeFetch("bangumi", {
        method: spec.method,
        url: `${domain}${spec.path}`,
        headers: { Authorization: `Bearer ${token}` },
        body: spec.body,
        bodyType: spec.bodyType,
        includeCookies: false,
        referer: "https://bgm.tv/",
        userAgent: BANGUMI_UA,
      });
      preferredDomain = domain;
      return JSON.parse(res.html);
    } catch (e) {
      const status = httpStatusOf(e instanceof Error ? e.message : String(e));
      if (status !== null) {
        // 域名可达但接口报错：换域名没有意义（路由/鉴权问题），直接上抛
        throw new BangumiApiError(status, e instanceof Error ? e.message : String(e));
      }
      lastErr = e; // 纯网络失败：试下一个域名
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Bangumi 鉴权接口不可达");
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** GET /v0/me：校验 access token 并取当前用户（镜像用 /v0/me，官方域兜底 /me） */
export async function fetchCurrentUser(token: string): Promise<BangumiAuthUser> {
  let data: unknown;
  try {
    data = await authRequest(token, { method: "GET", path: "/v0/me" });
  } catch (e) {
    if (e instanceof BangumiApiError && e.status === 404) {
      data = await authRequest(token, { method: "GET", path: "/me" });
    } else {
      throw e;
    }
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const username = str(d.username) || str(d.id);
  if (!username) throw new BangumiApiError(401, "Bangumi 返回的用户信息不完整");
  const avatar = (d.avatar ?? {}) as Record<string, unknown>;
  return {
    id: str(d.id) || username,
    username,
    nickname: str(d.nickname) || username,
    avatar: str(avatar.large) || str(avatar.common) || undefined,
  };
}

/**
 * 收藏接口内嵌的 subject（v0 SubjectVO）→ BangumiSubject。
 *
 * SubjectVO 比搜索 VO 更瘦：简介在 short_summary、评分人数在 rating.count，
 * 缺字段就留空，详情页会自行拉全量详情补齐。
 */
export function fromCollectionSubject(raw: unknown): BangumiSubject | null {
  const base = fromV0(raw);
  if (base) {
    const d = (raw ?? {}) as Record<string, unknown>;
    const rating = (d.rating ?? {}) as Record<string, unknown>;
    if (base.rating === undefined && typeof rating.score === "number") {
      base.rating = rating.score;
    }
    if (!base.votes && typeof rating.count === "number") base.votes = rating.count;
    if (!base.summary && typeof d.short_summary === "string") {
      base.summary = d.short_summary.trim() || undefined;
    }
    return base;
  }
  // 兜底：连 name 都没有的极瘦 VO（理论上不该发生），造一个仅含 id 的占位条目
  const d = (raw ?? {}) as Record<string, unknown>;
  const id = Number(d.id ?? 0);
  if (!id) return null;
  return { id, name: str(d.name) || String(id), nameCn: str(d.name_cn) };
}

/** 收藏列表数组元素（UserSubjectCollection）→ BangumiUserCollection */
export function fromUserCollection(raw: unknown): BangumiUserCollection | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const subjectId = Number(d.subject_id ?? (d.subject as Record<string, unknown>)?.id ?? 0);
  if (!subjectId) return null;
  const subject = fromCollectionSubject(d.subject) ?? { id: subjectId, name: String(subjectId) };
  const category = Math.min(Math.max(Number(d.type ?? 0), 0), 5) as BangumiCollectionCategory;
  const epStatus = (d.ep_status ?? {}) as Record<string, unknown>;
  return {
    subjectId,
    category,
    rate: typeof d.rate === "number" && d.rate > 0 ? d.rate : undefined,
    comment: str(d.comment) || undefined,
    updatedAt: str(d.updated_at) || undefined,
    epStatus:
      typeof epStatus.collect === "number" || typeof epStatus.done === "number"
        ? {
            collected: typeof epStatus.collect === "number" ? epStatus.collect : undefined,
            done: typeof epStatus.done === "number" ? epStatus.done : undefined,
          }
        : undefined,
    subject,
  };
}

export interface BangumiCollectionPage {
  items: BangumiUserCollection[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * 拉取用户的番剧收藏（一页）。username 传 "-" 表示当前授权用户。
 * 端点与 Kazumi bangumiGetAllCollections 同款：
 * GET /v0/users/{username}/collections?subject_type=2&limit=50&offset=n
 */
export async function fetchUserCollections(
  token: string,
  username: string,
  limit = 50,
  offset = 0,
): Promise<BangumiCollectionPage> {
  const path = `/v0/users/${encodeURIComponent(username || "-")}/collections?subject_type=2&limit=${limit}&offset=${offset}`;
  const data = (await authRequest(token, { method: "GET", path })) as {
    data?: unknown[];
    total?: number;
    limit?: number;
    offset?: number;
  } | null;
  const items: BangumiUserCollection[] = [];
  for (const raw of data?.data ?? []) {
    const c = fromUserCollection(raw);
    if (c) items.push(c);
  }
  return {
    items,
    total: data?.total ?? items.length,
    limit: data?.limit ?? limit,
    offset: data?.offset ?? offset,
  };
}

/**
 * 新增/修改当前用户对某条目的收藏状态（Kazumi updateBangumiById 同款：
 * POST + JSON {type}，"-" 代表当前用户）。成功后返回归一化收藏条目。
 */
export async function setCollectionStatus(
  token: string,
  subjectId: number,
  category: Exclude<BangumiCollectionCategory, 0>,
): Promise<void> {
  await authRequest(token, {
    method: "POST",
    path: `/v0/users/-/collections/${subjectId}`,
    body: JSON.stringify({ type: category }),
    bodyType: "json",
  });
}

/**
 * 全量翻页拉取收藏（首次授权后的同步、手动刷新共用）。
 * onProgress(current, total) 用于进度展示；上限 40 页（2000 条）防御死循环。
 */
export async function fetchAllCollections(
  token: string,
  username: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<BangumiUserCollection[]> {
  const out: BangumiUserCollection[] = [];
  const pageSize = 50;
  for (let page = 0; page < 40; page++) {
    const res = await fetchUserCollections(token, username, pageSize, page * pageSize);
    out.push(...res.items);
    onProgress?.(out.length, res.total);
    if (!res.items.length || out.length >= res.total) break;
  }
  return out;
}
