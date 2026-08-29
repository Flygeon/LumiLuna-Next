/**
 * Bangumi.tv API 客户端（照 Kazumi bangumi_api.dart）。
 *
 * 供「在线番剧」主页（热门番组）/ 搜索 / 详情使用。走 Rust anime_fetch：
 * - api.bgm.tv 对默认浏览器 UA 会直接封掉，这里显式带 Bangumi 认可的 UA
 * （LumiLuna/1.0 形如「应用名/版本」），并带 referer bgm.tv
 * - 前端 fetch 无法设置 User-Agent 头，故必须经 Rust 通道
 *
 * 归一化两种响应格式为 BangumiSubject：
 * - api.bgm.tv v0（search）：snake_case：name_cn / meta_tags / rating.score
 * - next.bgm.tv p1（trending / detail）：camelCase：nameCN / metaTags / rating.score
 */
import { capabilities } from "@/capabilities";
import type { AnimeFetchSpec, BangumiSubject } from "@shared/types";

const BANGUMI_UA =
  "LumiLuna/1.0 (Desktop; https://github.com/Flygeon/LumiLuna-Next)";
const API = "https://api.bgm.tv";
const NEXT = "https://next.bgm.tv";

/** 从 infobox 提取别名（照 Kazumi：key === '别名' 的 values） */
function aliasFromInfobox(infobox: unknown): string[] {
  if (!Array.isArray(infobox)) return [];
  const alias: string[] = [];
  for (const row of infobox) {
    if (!row || typeof row !== "object") continue;
    const r = row as { key?: unknown; values?: unknown };
    if (r.key !== "别名" || !Array.isArray(r.values)) continue;
    for (const val of r.values) {
      const v = (val as { v?: unknown })?.v;
      if (typeof v === "string" && v.trim()) alias.push(v.trim());
    }
  }
  return alias;
}

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * index.ero + next.bgm.tv p1 格式 → BangumiSubject
 * （trending 的 subject 包裹对象与 /p1/subjects/{id} 详情都用这份模型）
 */
export function fromP1(raw: unknown): BangumiSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const id = Number(d.id ?? 0);
  if (!id || typeof d.name !== "string") return null;
  const rating = (d.rating ?? {}) as Record<string, unknown>;
  const images = (d.images ?? {}) as Record<string, unknown>;
  const airtime = (d.airtime ?? {}) as Record<string, unknown>;
  const platform = (d.platform ?? {}) as Record<string, unknown>;
  return {
    id,
    name: d.name as string,
    nameCn: typeof d.nameCN === "string" ? (d.nameCN as string) : "",
    summary: typeof d.summary === "string" ? (d.summary as string) : undefined,
    airDate: typeof airtime.date === "string" ? (airtime.date as string) : undefined,
    airWeekday: typeof airtime.weekday === "number" ? (airtime.weekday as number) : undefined,
    rank: typeof rating.rank === "number" ? (rating.rank as number) : undefined,
    rating: typeof rating.score === "number" ? (rating.score as number) : undefined,
    votes: typeof rating.total === "number" ? (rating.total as number) : undefined,
    eps:
      typeof d.eps === "number"
        ? (d.eps as number)
        : typeof d.total_episodes === "number"
          ? (d.total_episodes as number)
          : undefined,
    platform:
      typeof platform.typeCN === "string"
        ? (platform.typeCN as string)
        : typeof platform.type === "string"
          ? (platform.type as string)
          : undefined,
    images:
      Object.keys(images).length > 0
        ? (images as BangumiSubject["images"])
        : undefined,
    tags: asStrings(d.metaTags),
    alias: aliasFromInfobox(d.infobox),
  };
}

/** api.bgm.tv v0 搜索条目 → BangumiSubject */
export function fromV0(raw: unknown): BangumiSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const id = Number(d.id ?? 0);
  if (!id || typeof d.name !== "string") return null;
  const rating = (d.rating ?? {}) as Record<string, unknown>;
  const images = (d.images ?? {}) as Record<string, unknown>;
  return {
    id,
    name: d.name as string,
    nameCn: typeof d.name_cn === "string" ? (d.name_cn as string) : "",
    summary: typeof d.summary === "string" ? (d.summary as string) : undefined,
    airDate: typeof d.date === "string" ? (d.date as string) : undefined,
    rank:
      typeof rating.rank === "number"
        ? (rating.rank as number)
        : typeof d.rank === "number"
          ? (d.rank as number)
          : undefined,
    rating: typeof rating.score === "number" ? (rating.score as number) : undefined,
    votes: typeof rating.total === "number" ? (rating.total as number) : undefined,
    eps:
      typeof d.eps === "number"
        ? (d.eps as number)
        : typeof d.total_episodes === "number"
          ? (d.total_episodes as number)
          : undefined,
    platform: typeof d.platform === "string" ? (d.platform as string) : undefined,
    images:
      Object.keys(images).length > 0
        ? (images as BangumiSubject["images"])
        : undefined,
    tags: asStrings(d.meta_tags),
    alias: aliasFromInfobox(d.infobox),
  };
}

/** 经 Rust anime_fetch 发请求并解析 JSON（只用于 Bangumi 域名） */
async function getJson(
  url: string,
  spec?: Pick<AnimeFetchSpec, "method" | "body" | "bodyType">,
): Promise<unknown> {
  const res = await capabilities.animeFetch("bangumi", {
    method: spec?.method ?? "GET",
    url,
    headers: {},
    body: spec?.body,
    bodyType: spec?.bodyType,
    includeCookies: false,
    referer: "https://bgm.tv/",
    userAgent: BANGUMI_UA,
  });
  return JSON.parse(res.html);
}

/** 热门番组（Kazumi 主页同款：next.bgm.tv trending，type=2 动画） */
export async function fetchTrending(limit = 30): Promise<BangumiSubject[]> {
  const data = (await getJson(
    `${NEXT}/p1/trending/subjects?type=2&limit=${limit}`,
  )) as { data?: { subject?: unknown }[] } | null;
  const out: BangumiSubject[] = [];
  for (const e of data?.data ?? []) {
    const subj = fromP1(e.subject ?? e);
    if (subj) out.push(subj);
  }
  return out;
}

export interface BangumiSearchPage {
  items: BangumiSubject[];
  total: number;
}

/** 聚合搜索：按关键字在 Bangumi 搜番剧（Kazumi bangumiSearch 同款参数） */
export async function searchSubjects(
  keyword: string,
  sort: "heat" | "rank" | "score" | "match" = "heat",
  limit = 24,
  offset = 0,
): Promise<BangumiSearchPage> {
  const body = JSON.stringify({
    keyword,
    sort,
    filter: { type: [2], nsfw: false },
  });
  const data = (await getJson(
    `${API}/v0/search/subjects?limit=${limit}&offset=${offset}`,
    { method: "POST", body, bodyType: "json" },
  )) as { data?: unknown[]; total?: number } | null;
  const items: BangumiSubject[] = [];
  for (const e of data?.data ?? []) {
    const subj = fromV0(e);
    if (subj) items.push(subj);
  }
  return { items, total: data?.total ?? 0 };
}

/** 详情：覆盖图/简介/标签/评分/放送日期/总集数（概览 tab 同款数据） */
export async function fetchSubjectDetail(
  id: number | string,
): Promise<BangumiSubject | null> {
  const data = await getJson(`${NEXT}/p1/subjects/${id}`);
  return fromP1(data);
}