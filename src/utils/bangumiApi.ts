/**
 * Bangumi.tv API 客户端（照 Kazumi bangumi_api.dart）。
 *
 * 供「在线番剧」主页（热门番组）/ 搜索 / 详情使用。走 Rust anime_fetch：
 * - api.bgm.tv 对默认浏览器 UA 会直接封掉，这里显式带 Bangumi 认可的 UA
 * （LumiLuna/1.0 形如「应用名/版本」），并带 referer bgm.tv
 * - 前端 fetch 无法设置 User-Agent 头，故必须经 Rust 通道
 *
 * 归一化响应格式为 BangumiSubject：
 * - api.bgm.tv v0（search / detail / calendar）：snake_case：name_cn / meta_tags / rating.score
 * - next.bgm.tv p1（历史遗留）：camelCase：nameCN / metaTags / rating.score
 *
 * ⚠️ next.bgm.tv 的 /p1/* 接口自 2026-08 起**全线不响应**（trending 与
 * /p1/subjects/{id} 实测 25s 零字节，超时而非报错）。热播榜与详情已改走
 * api.bgm.tv（/calendar 与 /v0/subjects/{id}），均验证可用。p1 的解析函数
 * 仅保留兼容，不要在新链路上依赖它。
 */
import { capabilities } from "@/capabilities";
import type { AnimeFetchSpec, BangumiSubject } from "@shared/types";

const BANGUMI_UA =
  "LumiLuna/1.0 (Desktop; https://github.com/Flygeon/LumiLuna-Next)";
const API = "https://api.bgm.tv";
// next.bgm.tv 的 /p1/* 自 2026-08 起全线不响应，已不再请求。

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

/**
 * api.bgm.tv/calendar 条目 → BangumiSubject。
 *
 * 每日放送的字段比 p1 少（没有 infobox 别名、没有 eps），但多了
 * collection.doing（在看人数）——这正是「热度」的唯一可靠来源。
 */
export function fromCalendar(raw: unknown): BangumiSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const id = Number(d.id ?? 0);
  if (!id || typeof d.name !== "string") return null;
  const rating = (d.rating ?? {}) as Record<string, unknown>;
  const images = (d.images ?? {}) as Record<string, unknown>;
  const collection = (d.collection ?? {}) as Record<string, unknown>;
  const summary = typeof d.summary === "string" ? d.summary.trim() : "";
  return {
    id,
    name: d.name,
    nameCn: typeof d.name_cn === "string" ? d.name_cn : "",
    summary: summary || undefined,
    airDate: typeof d.air_date === "string" ? d.air_date : undefined,
    airWeekday: typeof d.air_weekday === "number" ? d.air_weekday : undefined,
    rank: typeof d.rank === "number" ? d.rank : undefined,
    rating: typeof rating.score === "number" ? rating.score : undefined,
    votes: typeof rating.total === "number" ? rating.total : undefined,
    platform: typeof d.platform === "string" ? d.platform : undefined,
    images: Object.keys(images).length
      ? (images as BangumiSubject["images"])
      : undefined,
    doing: typeof collection.doing === "number" ? collection.doing : undefined,
  };
}

/**
 * 热门番组（正在热播）。
 *
 * 原为 next.bgm.tv /p1/trending/subjects，该接口已死（见文件头说明），
 * 改用 api.bgm.tv/calendar（每日放送）：它给出当季**正在播**的全部条目
 * （实测 7 天合计 113 部），按 collection.doing 降序即等价于热度榜。
 * 顺带比原接口更贴「正在热播」的语义——原接口混入了已完结的热门老番。
 */
export async function fetchTrending(limit = 30): Promise<BangumiSubject[]> {
  const data = (await getJson(`${API}/calendar`)) as
    | { weekday?: unknown; items?: unknown }[]
    | null;
  const out: BangumiSubject[] = [];
  for (const day of data ?? []) {
    for (const raw of (day?.items as unknown[]) ?? []) {
      const subj = fromCalendar(raw);
      if (subj) out.push(subj);
    }
  }
  // 同一部番可能出现在多个星期分组里（跨季/重播），按 id 去重保留热度最高的
  const byId = new Map<number, BangumiSubject>();
  for (const s of out) {
    const prev = byId.get(s.id);
    if (!prev || (s.doing ?? 0) > (prev.doing ?? 0)) byId.set(s.id, s);
  }
  return [...byId.values()]
    .sort((a, b) => (b.doing ?? 0) - (a.doing ?? 0))
    .slice(0, limit);
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

/**
 * 详情：覆盖图/简介/标签/别名/评分/放送日期/总集数。
 *
 * 原走 next.bgm.tv /p1/subjects/{id}（已死），改走 api.bgm.tv
 * /v0/subjects/{id}：字段更全（含 infobox 别名、meta_tags、summary），
 * 且实测 1s 内返回。拿不到时返回 null，调用方保留列表条目的轻量数据。
 */
export async function fetchSubjectDetail(
  id: number | string,
): Promise<BangumiSubject | null> {
  const data = await getJson(`${API}/v0/subjects/${id}`);
  return fromV0(data);
}