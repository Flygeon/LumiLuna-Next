/**
 * Kazumi 规则（Plugin JSON）规范化与解析策略。
 *
 * 对应参考项目 `lib/plugins/plugins.dart`（模型）与
 * `lib/services/plugin/{xpath,api}_rule_strategy.dart`（双模式解析）。字段默认值
 * 与 Kazumi 完全一致，规则编辑器据此接受/拒绝用户导入的规则。
 */

import type {
  AnimeApiRequest,
  AnimeChapterApiConfig,
  AnimeFetchSpec,
  AnimeRule,
  AnimeSearchApiConfig,
  AnimeSearchItem,
  AnimeRoad,
  AnimeEpisode,
} from "@shared/types";
import {
  readFirstJsonPath,
  readJsonPath,
  validateJsonPath,
  AnimeJsonPathError,
} from "./animeJsonPath";
import { parseHtml, queryNodes, queryText, queryAttr } from "./animeXPath";
import { normalizeEpisodeUrl } from "./animeEpisodeUrl";

export class AnimeRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnimeRuleError";
  }
}

export type AnimeMode = "xpath" | "api";

// ---- 请求构建 ----

const VAR_RE = /(?<![A-Za-z0-9_])@([A-Za-z_][A-Za-z0-9_]*)/g;

/** 模板渲染：@name → variables[name]（encode 时 URL 编码）。变量缺失抛错。 */
export function renderTemplate(
  template: string,
  variables: Record<string, unknown>,
  encode = false,
): string {
  return template.replace(VAR_RE, (match, name: string) => {
    if (!(name in variables)) {
      throw new AnimeRuleError(`缺少模板变量 @${name}`);
    }
    const value = String(variables[name] ?? "");
    return encode ? encodeURIComponent(value) : value;
  });
}

function renderValue(
  value: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    const exact = /^@([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
    if (exact) {
      const name = exact[1];
      if (!(name in variables)) {
        throw new AnimeRuleError(`缺少模板变量 @${name}`);
      }
      return variables[name];
    }
    return renderTemplate(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, variables));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = renderValue(v, variables);
    }
    return out;
  }
  return value;
}

function renderMap(
  input: Record<string, unknown>,
  variables: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    out[renderTemplate(k, variables)] = String(renderValue(v, variables));
  }
  return out;
}

function stringValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v.trim() : String(v);
}

function normalizeRequest(
  raw: Record<string, unknown> | undefined,
): AnimeApiRequest {
  const method = String(raw?.method ?? "GET").toUpperCase();
  return {
    method: method === "POST" ? "POST" : "GET",
    url: String(raw?.url ?? ""),
    headers: stringRecord(raw?.headers),
    query: stringRecord(raw?.query),
    bodyType:
      raw?.bodyType === "json" || raw?.bodyType === "form" ? raw.bodyType : "none",
    body: raw?.body,
  };
}

function normalizeSearchApiConfig(
  raw: Record<string, unknown> | undefined,
): AnimeSearchApiConfig {
  const request = normalizeRequest(
    (raw?.request as Record<string, unknown> | undefined) ?? undefined,
  );
  return {
    request,
    listPath: String(raw?.listPath ?? "$.data[*]"),
    namePath: String(raw?.namePath ?? "$.name"),
    sourcePath: String(raw?.sourcePath ?? "$.url"),
  };
}

function normalizeChapterApiConfig(
  raw: Record<string, unknown> | undefined,
): AnimeChapterApiConfig {
  const request = normalizeRequest(
    (raw?.request as Record<string, unknown> | undefined) ?? undefined,
  );
  const variables: Record<string, string> = {};
  const rawVars = raw?.variables;
  if (rawVars !== null && typeof rawVars === "object" && !Array.isArray(rawVars)) {
    for (const [k, v] of Object.entries(rawVars as Record<string, unknown>)) {
      variables[k] = String(v);
    }
  }
  const episodePageRaw = raw?.episodePage as Record<string, unknown> | undefined;
  return {
    request,
    format: raw?.format === "delimited" ? "delimited" : "nested",
    roadsPath: String(raw?.roadsPath ?? "$.data.roads[*]"),
    roadNamePath: String(raw?.roadNamePath ?? "$.name"),
    episodesPath: String(raw?.episodesPath ?? "$.episodes[*]"),
    episodeNamePath: String(raw?.episodeNamePath ?? "$.name"),
    episodeUrlPath: String(raw?.episodeUrlPath ?? "$.url"),
    roadNamesPath: String(raw?.roadNamesPath ?? ""),
    roadEpisodesPath: String(raw?.roadEpisodesPath ?? ""),
    roadSeparator: String(raw?.roadSeparator ?? "$$$"),
    episodeSeparator: String(raw?.episodeSeparator ?? "#"),
    fieldSeparator: String(raw?.fieldSeparator ?? "$"),
    variables,
    episodePage:
      episodePageRaw && typeof episodePageRaw === "object"
        ? {
            url: String(episodePageRaw.url ?? ""),
            query: stringRecord(episodePageRaw.query),
          }
        : undefined,
  };
}

/** 把对象值全部字符串化（Kazumi 请求 headers/query 的宽松处理） */
function stringRecord(v: unknown): Record<string, string> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = String(val);
  }
  return out;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * 把任意规则 JSON 规范化为内部模型；缺字段用 Kazumi 同款默认值。
 * 非对象 / 缺 name 时抛错。
 */
export function normalizeRule(raw: unknown): AnimeRule {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AnimeRuleError("规则必须是 JSON 对象");
  }
  const json = raw as Record<string, unknown>;
  const name = String(json.name ?? "").trim();
  if (!name) {
    throw new AnimeRuleError("规则缺少 name");
  }
  const httpHeaders = stringRecord(json.httpHeaders);
  const scripts = Array.isArray(json.scripts)
    ? (json.scripts as unknown[]).map((s) => String(s))
    : undefined;
  return {
    api: String(json.api ?? "1"),
    type: String(json.type ?? "anime"),
    name,
    version: String(json.version ?? ""),
    muliSources: bool(json.muliSources, true),
    useWebview: bool(json.useWebview, true),
    useNativePlayer: bool(json.useNativePlayer, true),
    userAgent: String(json.userAgent ?? ""),
    baseURL: String(json.baseURL ?? json.baseUrl ?? ""),
    referer: String(json.referer ?? ""),
    usePost: bool(json.usePost, false),
    useLegacyParser: bool(json.useLegacyParser, false),
    adBlocker: bool(json.adBlocker, false),
    searchMode: json.searchMode === "api" ? "api" : "xpath",
    chapterMode: json.chapterMode === "api" ? "api" : "xpath",
    searchURL: String(json.searchURL ?? ""),
    searchList: String(json.searchList ?? ""),
    searchName: String(json.searchName ?? ""),
    searchResult: String(json.searchResult ?? ""),
    chapterRoads: String(json.chapterRoads ?? ""),
    chapterResult: String(json.chapterResult ?? ""),
    searchApiConfig: normalizeSearchApiConfig(
      json.searchApiConfig as Record<string, unknown> | undefined,
    ),
    chapterApiConfig: normalizeChapterApiConfig(
      json.chapterApiConfig as Record<string, unknown> | undefined,
    ),
    antiCrawlerConfig:
      json.antiCrawlerConfig !== null &&
      typeof json.antiCrawlerConfig === "object"
        ? (json.antiCrawlerConfig as Record<string, unknown>)
        : undefined,
    streamRegex: json.streamRegex !== undefined ? String(json.streamRegex) : undefined,
    streamJsonPath: json.streamJsonPath !== undefined ? String(json.streamJsonPath) : undefined,
    httpHeaders,
    css: json.css !== undefined ? String(json.css) : undefined,
    scripts,
  };
}

/** 校验规则关键字段；返回可读错误信息列表 */
export function validateRule(rule: AnimeRule): string[] {
  const errors: string[] = [];
  if (!rule.baseURL) errors.push("缺少 baseURL");
  if (rule.searchMode === "api") {
    const req = rule.searchApiConfig?.request;
    if (!req?.url) errors.push("搜索 API 缺少 request.url");
    try {
      validateJsonPath(rule.searchApiConfig?.listPath ?? "");
    } catch (e) {
      errors.push(`搜索 listPath 无效：${(e as Error).message}`);
    }
    try {
      validateJsonPath(rule.searchApiConfig?.namePath ?? "");
    } catch (e) {
      errors.push(`搜索 namePath 无效：${(e as Error).message}`);
    }
    try {
      validateJsonPath(rule.searchApiConfig?.sourcePath ?? "");
    } catch (e) {
      errors.push(`搜索 sourcePath 无效：${(e as Error).message}`);
    }
  } else {
    if (!rule.searchURL) errors.push("缺少 searchURL");
    if (!rule.searchList) errors.push("缺少 searchList");
    if (!rule.searchName) errors.push("缺少 searchName");
    if (!rule.searchResult) errors.push("缺少 searchResult");
  }
  if (rule.chapterMode === "api") {
    const req = rule.chapterApiConfig?.request;
    if (!req?.url) errors.push("选集 API 缺少 request.url");
    for (const [k, v] of Object.entries(rule.chapterApiConfig?.variables ?? {})) {
      try {
        validateJsonPath(v);
      } catch (e) {
        errors.push(`变量 ${k} 无效：${(e as Error).message}`);
      }
    }
  } else {
    if (!rule.chapterRoads) errors.push("缺少 chapterRoads");
    if (!rule.chapterResult) errors.push("缺少 chapterResult");
  }
  return errors;
}

// ---- 请求准备 ----

function ruleTransport(rule: AnimeRule): Pick<AnimeFetchSpec, "referer" | "userAgent"> {
  return {
    referer: rule.referer || rule.baseURL || "",
    userAgent: rule.userAgent || "",
  };
}

/**
 * 校验并规整请求 URL（照 Kazumi `xpath_rule_strategy.dart` 的
 * `Uri.tryParse` + `hasScheme + host.isEmpty` 检查）：
 * - 空 URL / 非法 URL / 非 http(s) / 缺主机名 → 抛可读错误（而不是把
 *   "builder error" 留给 reqwest）
 * - 相对地址基于 baseURL 补全；WHATWG `new URL().href` 顺带把路径里的
 *   非 ASCII 字符 percent 编码（url crate 只吃 ASCII URL，这正是
 *   "网络请求失败：builder error" 的常见诱因）
 */
function resolveRuleUrl(baseURL: string, raw: string, what: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) throw new AnimeRuleError(`${what} URL 为空`);
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    if (!baseURL.trim()) {
      throw new AnimeRuleError(`${what} URL 无效：${trimmed}（不是绝对地址且缺少 baseURL）`);
    }
    try {
      u = new URL(trimmed, baseURL);
    } catch {
      throw new AnimeRuleError(`${what} URL 无效：${trimmed}`);
    }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new AnimeRuleError(`${what} URL 仅支持 http/https：${trimmed}`);
  }
  if (!u.hostname) throw new AnimeRuleError(`${what} URL 缺少主机名：${trimmed}`);
  return u.href;
}

/** 构造搜索请求（XPath / API 双模式） */
export function prepareSearchRequest(
  rule: AnimeRule,
  keyword: string,
): AnimeFetchSpec {
  const transport = ruleTransport(rule);
  if (rule.searchMode === "api") {
    const spec = buildApiRequest(rule.searchApiConfig?.request, { keyword }, rule.baseURL ?? "");
    return { ...spec, ...transport, includeCookies: true };
  }
  const raw = (rule.searchURL ?? "").replace(
    "@keyword",
    encodeURIComponent(keyword),
  );
  const url = resolveRuleUrl(rule.baseURL ?? "", raw, "搜索");
  if (rule.usePost) {
    const uri = splitQuery(url);
    return {
      method: "POST",
      url: uri.base,
      headers: rule.httpHeaders,
      body: new URLSearchParams(uri.query).toString(),
      bodyType: "form",
      ...transport,
      includeCookies: true,
    };
  }
  return { method: "GET", url, headers: rule.httpHeaders, ...transport, includeCookies: true };
}

/** 构造选集请求（XPath / API 双模式）；source 为条目/详情页 URL */
export function prepareChapterRequest(
  rule: AnimeRule,
  source: string,
): AnimeFetchSpec {
  if (rule.chapterMode === "api") {
    const spec = buildApiRequest(rule.chapterApiConfig?.request, { source }, rule.baseURL ?? "");
    return { ...spec, ...ruleTransport(rule), includeCookies: true };
  }
  // XPath 章节请求按 Kazumi 惯例不带 cookie
  const url = normalizeEpisodeUrl(rule.baseURL ?? "", source);
  return { method: "GET", url, headers: rule.httpHeaders, ...ruleTransport(rule) };
}

function buildApiRequest(
  request: AnimeSearchApiConfig["request"] | undefined,
  variables: Record<string, unknown>,
  baseURL = "",
): AnimeFetchSpec {
  const method = request?.method === "POST" ? "POST" : "GET";
  const raw = renderTemplate(String(request?.url ?? ""), variables, true);
  const url = resolveRuleUrl(baseURL, raw, "请求");
  const query = request?.query
    ? renderMap(request.query as Record<string, unknown>, variables)
    : undefined;
  const bodyType = request?.bodyType ?? "none";
  let body: string | undefined;
  if (method === "POST" && bodyType !== "none" && request?.body !== undefined) {
    const rendered = renderValue(request.body, variables);
    body =
      bodyType === "form"
        ? new URLSearchParams(rendered as Record<string, string>).toString()
        : JSON.stringify(rendered);
  }
  const headers = request?.headers
    ? renderMap(request.headers as Record<string, unknown>, variables)
    : undefined;
  return { method, url, headers, query, body, bodyType, includeCookies: true };
}

function splitQuery(url: string): { base: string; query: Record<string, string> } {
  const idx = url.indexOf("?");
  if (idx < 0) return { base: url, query: {} };
  const base = url.slice(0, idx);
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(url.slice(idx + 1)).entries()) {
    query[k] = v;
  }
  return { base, query };
}

// ---- 解析：搜索 ----

export interface AnimeSearchParse {
  items: AnimeSearchItem[];
  diagnostics: string[];
}

export function parseSearchXPath(
  html: string,
  rule: AnimeRule,
): AnimeSearchParse {
  const root = parseHtml(html);
  if (!root) return { items: [], diagnostics: ["无法解析 HTML 文档"] };
  const items: AnimeSearchItem[] = [];
  const diagnostics: string[] = [];
  const nodes = queryNodes(rule.searchList, root);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const name = queryText(rule.searchName, node);
    const source = queryAttr(rule.searchResult, node, "href");
    if (!name || !source) {
      diagnostics.push(`搜索节点 ${index} 缺少名称或来源，已跳过`);
      continue;
    }
    items.push({ name, src: source });
  }
  return { items, diagnostics };
}

export function parseSearchApi(raw: string, rule: AnimeRule): AnimeSearchParse {
  const items: AnimeSearchItem[] = [];
  const diagnostics: string[] = [];
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return { items: [], diagnostics: ["API 响应不是有效 JSON"] };
  }
  const config = rule.searchApiConfig!;
  let nodes: unknown[];
  try {
    nodes = readJsonPath(document, config.listPath);
  } catch (e) {
    return { items: [], diagnostics: [(e as Error).message] };
  }
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    let name = "";
    let source = "";
    try {
      name = stringValue(readFirstJsonPath(node, config.namePath));
      source = stringValue(readFirstJsonPath(node, config.sourcePath));
    } catch {
      diagnostics.push(`搜索节点 ${index} 解析失败`);
      continue;
    }
    if (!name || !source) {
      diagnostics.push(`搜索节点 ${index} 缺少名称或来源，已跳过`);
      continue;
    }
    items.push({ name, src: source });
  }
  return { items, diagnostics };
}

// ---- 解析：选集 ----

export interface AnimeChapterParse {
  roads: AnimeRoad[];
  diagnostics: string[];
}

export function parseChaptersXPath(
  html: string,
  rule: AnimeRule,
  baseUrl: string,
): AnimeChapterParse {
  const root = parseHtml(html);
  if (!root) return { roads: [], diagnostics: ["无法解析 HTML 文档"] };
  const roads: AnimeRoad[] = [];
  const diagnostics: string[] = [];
  const roadNodes = queryNodes(rule.chapterRoads, root);
  for (let roadIndex = 0; roadIndex < roadNodes.length; roadIndex++) {
    const roadNode = roadNodes[roadIndex];
    const episodes: AnimeEpisode[] = [];
    const episodeNodes = queryNodes(rule.chapterResult, roadNode);
    for (let episodeIndex = 0; episodeIndex < episodeNodes.length; episodeIndex++) {
      const episodeNode = episodeNodes[episodeIndex];
      const source = queryAttr(rule.chapterResult, episodeNode, "href");
      if (!source) {
        diagnostics.push(
          `线路 ${roadIndex} 的剧集节点 ${episodeIndex} 缺少 URL，已跳过`,
        );
        continue;
      }
      const name = queryText(rule.chapterResult, episodeNode).replace(/\s+/g, "");
      const url = normalizeEpisodeUrl(baseUrl, source);
      if (!url) continue;
      episodes.push({
        url,
        name: name.length > 0 ? name : `第${episodeIndex + 1}集`,
      });
    }
    if (episodes.length === 0) {
      diagnostics.push(`线路 ${roadIndex} 没有有效剧集，已跳过`);
      continue;
    }
    roads.push({ name: `播放线路${roads.length + 1}`, episodes });
  }
  return { roads, diagnostics };
}

export function parseChaptersApi(
  raw: string,
  rule: AnimeRule,
  source: string,
  baseUrl: string,
): AnimeChapterParse {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return { roads: [], diagnostics: ["API 响应不是有效 JSON"] };
  }
  const config = rule.chapterApiConfig!;
  const rootVariables: Record<string, unknown> = { source };
  for (const [key, path] of Object.entries(config.variables ?? {})) {
    try {
      const value = readFirstJsonPath(document, path);
      if (value === null || value === undefined) {
        return { roads: [], diagnostics: [`章节响应变量 ${key} 未匹配到值`] };
      }
      rootVariables[key] = value;
    } catch (e) {
      return { roads: [], diagnostics: [(e as Error).message] };
    }
  }
  return config.format === "delimited"
    ? parseDelimited(document, config, rootVariables, baseUrl)
    : parseNested(document, config, rootVariables, baseUrl);
}

function parseNested(
  document: unknown,
  config: AnimeChapterApiConfig,
  rootVariables: Record<string, unknown>,
  baseUrl: string,
): AnimeChapterParse {
  const roads: AnimeRoad[] = [];
  const diagnostics: string[] = [];
  const hasRoads = (config.roadsPath ?? "").trim().length > 0;
  let roadNodes: unknown[];
  try {
    roadNodes = hasRoads ? readJsonPath(document, config.roadsPath) : [document];
  } catch (e) {
    return { roads: [], diagnostics: [(e as Error).message] };
  }
  for (let roadIndex = 0; roadIndex < roadNodes.length; roadIndex++) {
    const roadNode = roadNodes[roadIndex];
    let roadName = "";
    try {
      roadName =
        hasRoads && (config.roadNamePath ?? "").trim().length > 0
          ? stringValue(readFirstJsonPath(roadNode, config.roadNamePath))
          : "";
    } catch (e) {
      diagnostics.push(`线路节点 ${roadIndex} 名称解析失败`);
    }
    let episodeNodes: unknown[];
    try {
      episodeNodes = readJsonPath(roadNode, config.episodesPath);
    } catch (e) {
      diagnostics.push(`线路节点 ${roadIndex} 剧集解析失败：${(e as Error).message}`);
      continue;
    }
    const episodes: AnimeEpisode[] = [];
    for (let episodeIndex = 0; episodeIndex < episodeNodes.length; episodeIndex++) {
      const episodeNode = episodeNodes[episodeIndex];
      try {
        const episodeName = stringValue(
          readFirstJsonPath(episodeNode, config.episodeNamePath),
        );
        const rawUrl =
          (config.episodeUrlPath ?? "").trim().length === 0
            ? ""
            : stringValue(readFirstJsonPath(episodeNode, config.episodeUrlPath));
        const pageUrl = resolveEpisodePageUrl(
          config,
          rootVariables,
          rawUrl,
          roadIndex,
          episodeIndex,
          baseUrl,
        );
        if (!pageUrl) {
          diagnostics.push(
            `线路 ${roadIndex} 的剧集节点 ${episodeIndex} 缺少 URL，已跳过`,
          );
          continue;
        }
        episodes.push({
          url: pageUrl,
          name: episodeName.length > 0 ? episodeName : `第${episodeIndex + 1}集`,
        });
      } catch (e) {
        diagnostics.push(
          `线路 ${roadIndex} 的剧集节点 ${episodeIndex} 解析失败：${(e as Error).message}`,
        );
      }
    }
    if (episodes.length === 0) {
      diagnostics.push(`线路 ${roadIndex} 没有有效剧集，已跳过`);
      continue;
    }
    roads.push({
      name: roadName.length > 0 ? roadName : `播放线路${roads.length + 1}`,
      episodes,
    });
  }
  return { roads, diagnostics };
}

function parseDelimited(
  document: unknown,
  config: AnimeChapterApiConfig,
  rootVariables: Record<string, unknown>,
  baseUrl: string,
): AnimeChapterParse {
  const roads: AnimeRoad[] = [];
  const diagnostics: string[] = [];
  try {
    const namesValue = stringValue(
      readFirstJsonPath(document, config.roadNamesPath),
    );
    const episodesValue = stringValue(
      readFirstJsonPath(document, config.roadEpisodesPath),
    );
    if (!episodesValue) return { roads, diagnostics };
    const roadNames = namesValue.split(config.roadSeparator);
    const roadGroups = episodesValue.split(config.roadSeparator);
    for (let roadIndex = 0; roadIndex < roadGroups.length; roadIndex++) {
      const episodes: AnimeEpisode[] = [];
      const entries = roadGroups[roadIndex].split(config.episodeSeparator);
      for (let episodeIndex = 0; episodeIndex < entries.length; episodeIndex++) {
        const entry = entries[episodeIndex].trim();
        if (!entry) continue;
        const separatorIndex = entry.indexOf(config.fieldSeparator);
        if (separatorIndex < 0) {
          diagnostics.push(
            `线路 ${roadIndex} 的剧集条目 ${episodeIndex} 缺少字段分隔符，已跳过`,
          );
          continue;
        }
        const name = entry.slice(0, separatorIndex).trim();
        const rawUrl = entry.slice(separatorIndex + config.fieldSeparator.length).trim();
        try {
          const pageUrl = resolveEpisodePageUrl(
            config,
            rootVariables,
            rawUrl,
            roadIndex,
            episodeIndex,
            baseUrl,
          );
          if (!pageUrl) {
            diagnostics.push(
              `线路 ${roadIndex} 的剧集条目 ${episodeIndex} 缺少 URL，已跳过`,
            );
            continue;
          }
          episodes.push({
            url: pageUrl,
            name: name.length > 0 ? name : `第${episodeIndex + 1}集`,
          });
        } catch (e) {
          diagnostics.push(
            `线路 ${roadIndex} 的剧集条目 ${episodeIndex} 解析失败：${(e as Error).message}`,
          );
        }
      }
      if (episodes.length === 0) {
        diagnostics.push(`线路 ${roadIndex} 没有有效剧集，已跳过`);
        continue;
      }
      const configuredName =
        roadIndex < roadNames.length ? roadNames[roadIndex].trim() : "";
      roads.push({
        name: configuredName.length > 0 ? configuredName : `播放线路${roads.length + 1}`,
        episodes,
      });
    }
  } catch (e) {
    diagnostics.push((e as Error).message);
  }
  return { roads, diagnostics };
}

/** episodePage 模板渲染 + 与 baseUrl 归一化；无模板时直接归一化原始 URL */
function resolveEpisodePageUrl(
  config: AnimeChapterApiConfig,
  rootVariables: Record<string, unknown>,
  rawUrl: string,
  roadIndex: number,
  episodeIndex: number,
  baseUrl: string,
): string {
  const page = config.episodePage;
  if (!page) return normalizeEpisodeUrl(baseUrl, rawUrl);
  const variables: Record<string, unknown> = {
    ...rootVariables,
    episodeUrl: rawUrl,
    roadIndex,
    roadNumber: roadIndex + 1,
    episodeIndex,
    episodeNumber: episodeIndex + 1,
  };
  const path = renderTemplate(page.url, variables, true);
  let uri: URL;
  try {
    uri = new URL(path, baseUrl);
  } catch {
    throw new AnimeRuleError(`剧集页面 URL 无效: ${path}`);
  }
  const renderedQuery = renderMap(page.query ?? {}, variables);
  for (const [k, v] of Object.entries(renderedQuery)) {
    uri.searchParams.set(k, v);
  }
  return normalizeEpisodeUrl(baseUrl, uri.toString());
}

/** 供编辑器/测试导出 */
export { AnimeJsonPathError };
