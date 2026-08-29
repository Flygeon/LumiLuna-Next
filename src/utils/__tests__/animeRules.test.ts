/**
 * Kazumi 规则引擎单测（方案书 §6）：覆盖模板渲染、规则规范化/校验、
 * 请求构建（XPath/API 双模式）、API 选集解析（嵌套/分隔）。XPath 解析在
 * node 环境无 DOMParser，按「无 DOM → 明确诊断」断言。
 */
import { describe, expect, it } from "vitest";
import {
  AnimeRuleError,
  normalizeRule,
  parseChaptersApi,
  parseChaptersXPath,
  parseSearchApi,
  parseSearchXPath,
  prepareChapterRequest,
  prepareSearchRequest,
  renderTemplate,
  validateRule,
} from "../animeRules";
import type { AnimeRule } from "@shared/types";

/** 最小 XPath 规则 */
function xpathRule(overrides?: Record<string, unknown>): AnimeRule {
  return normalizeRule({
    name: "测试源",
    baseURL: "https://example.com/",
    searchURL: "https://example.com/search?wd=@keyword",
    searchList: "//div[@class='item']",
    searchName: ".//h3",
    searchResult: ".//a",
    chapterRoads: "//div[@class='road']",
    chapterResult: ".//a",
    ...overrides,
  });
}

/** 最小 API 规则 */
function apiRule(overrides?: Record<string, unknown>): AnimeRule {
  return normalizeRule({
    name: "测试API源",
    baseURL: "https://example.com/",
    searchMode: "api",
    chapterMode: "api",
    searchApiConfig: {
      request: { url: "https://example.com/api/search?kw=@keyword" },
      listPath: "$.data[*]",
      namePath: "$.name",
      sourcePath: "$.url",
    },
    chapterApiConfig: {
      request: { url: "https://example.com/api/chapters?src=@source" },
      format: "nested",
      roadsPath: "$.data.roads[*]",
      roadNamePath: "$.name",
      episodesPath: "$.episodes[*]",
      episodeNamePath: "$.name",
      episodeUrlPath: "$.url",
      roadNamesPath: "",
      roadEpisodesPath: "",
    },
    ...overrides,
  });
}

describe("renderTemplate", () => {
  it("渲染 @变量，默认不编码", () => {
    expect(renderTemplate("https://x/@kw/@id", { kw: "hi there", id: "3" })).toBe(
      "https://x/hi there/3",
    );
  });

  it("encode=true 时 URL 编码", () => {
    expect(renderTemplate("https://x/@kw", { kw: "hello world" }, true)).toBe(
      "https://x/hello%20world",
    );
  });

  it("@ 前有词首字符时不视为变量（邮箱等场景）", () => {
    expect(renderTemplate("user@domain/@kw", { kw: "x" })).toBe("user@domain/x");
    expect(renderTemplate("a@b@kw", { kw: "1" })).toBe("a@b@kw");
  });

  it("缺失变量抛错", () => {
    expect(() => renderTemplate("https://x/@nope", {})).toThrow(AnimeRuleError);
  });
});

describe("normalizeRule", () => {
  it("缺 name 抛错", () => {
    expect(() => normalizeRule({})).toThrow(AnimeRuleError);
    expect(() => normalizeRule("string")).toThrow(AnimeRuleError);
    expect(() => normalizeRule(null)).toThrow(AnimeRuleError);
  });

  it("默认值与 Kazumi 一致", () => {
    const rule = normalizeRule({ name: "x", baseURL: "https://example.com/" });
    expect(rule.searchMode).toBe("xpath");
    expect(rule.chapterMode).toBe("xpath");
    expect(rule.muliSources).toBe(true);
    expect(rule.useWebview).toBe(true);
    expect(rule.usePost).toBe(false);
    expect(rule.useLegacyParser).toBe(false);
    expect(rule.adBlocker).toBe(false);
    expect(rule.version).toBe("");
    expect(rule.searchURL).toBe("");
  });

  it("兼容 baseUrl 小写别名", () => {
    expect(normalizeRule({ name: "x", baseUrl: "https://a.example/" }).baseURL).toBe(
      "https://a.example/",
    );
  });

  it("httpHeaders 字符串化", () => {
    const rule = normalizeRule({
      name: "x",
      baseURL: "https://example.com/",
      httpHeaders: { Referer: "https://example.com/" },
    });
    expect(rule.httpHeaders).toEqual({ Referer: "https://example.com/" });
  });

  it("streamRegex / streamJsonPath 透传", () => {
    const rule = normalizeRule({
      name: "x",
      baseURL: "https://example.com/",
      streamRegex: "url:'(.+?\\.m3u8)'",
      streamJsonPath: "$.url",
    });
    expect(rule.streamRegex).toBe("url:'(.+?\\.m3u8)'");
    expect(rule.streamJsonPath).toBe("$.url");
  });
});

describe("validateRule", () => {
  it("XPath 规则缺关键字段", () => {
    const errors = validateRule(
      normalizeRule({ name: "x", baseURL: "" }),
    );
    expect(errors.join("；")).toContain("baseURL");
    expect(errors.join("；")).toContain("searchURL");
    expect(errors.join("；")).toContain("searchList");
    expect(errors.join("；")).toContain("chapterRoads");
  });

  it("XPath 规则完整无错误", () => {
    expect(validateRule(xpathRule())).toEqual([]);
  });

  it("API 规则 listPath 非法", () => {
    const rule = apiRule({
      searchApiConfig: { request: { url: "https://example.com/api" }, listPath: "data[*]" },
    });
    expect(validateRule(rule).join("；")).toContain("listPath");
  });

  it("API 规则完整无错误", () => {
    expect(validateRule(apiRule())).toEqual([]);
  });
});

describe("prepareSearchRequest", () => {
  it("XPath GET：替换 @keyword 并编码", () => {
    const spec = prepareSearchRequest(xpathRule(), "刀剑神域");
    expect(spec.method).toBe("GET");
    expect(spec.url).toBe("https://example.com/search?wd=%E5%88%80%E5%89%91%E7%A5%9E%E5%9F%9F");
    expect(spec.includeCookies).toBe(true);
    expect(spec.referer).toBe("https://example.com/");
  });

  it("XPath 空关键词：保留站点默认列表 URL", () => {
    const spec = prepareSearchRequest(xpathRule(), "");
    expect(spec.url).toBe("https://example.com/search?wd=");
  });

  it("usePost：query 转入 form body", () => {
    const spec = prepareSearchRequest(
      xpathRule({
        usePost: true,
        searchURL: "https://example.com/search?wd=@keyword&extra=1",
      }),
      "abc",
    );
    expect(spec.method).toBe("POST");
    expect(spec.url).toBe("https://example.com/search");
    expect(spec.bodyType).toBe("form");
    expect(spec.body).toBe("wd=abc&extra=1");
  });

  it("API 模式：模板渲染进 URL，query 也渲染", () => {
    const rule = apiRule({
      searchApiConfig: {
        request: {
          url: "https://example.com/api/search",
          query: { kw: "@keyword" },
        },
        listPath: "$.data[*]",
        namePath: "$.name",
        sourcePath: "$.url",
      },
    });
    const spec = prepareSearchRequest(rule, "hello world");
    expect(spec.url).toBe("https://example.com/api/search");
    // query 值只做模板渲染，不预编码（Rust 侧 reqwest 会正确编码）
    expect(spec.query).toEqual({ kw: "hello world" });
    expect(spec.includeCookies).toBe(true);
  });

  it("URL 校验：空 searchURL 抛可读错误（而非 builder error）", () => {
    expect(() => prepareSearchRequest(xpathRule({ searchURL: "" }), "刀")).toThrow(
      /搜索 URL 为空/,
    );
  });

  it("URL 校验：缺协议/相对地址基于 baseURL 补全", () => {
    const spec = prepareSearchRequest(
      xpathRule({ searchURL: "/search?wd=@keyword" }),
      "刀",
    );
    expect(spec.url).toBe("https://example.com/search?wd=%E5%88%80");
  });

  it("URL 校验：非法协议抛错", () => {
    expect(() =>
      prepareSearchRequest(xpathRule({ searchURL: "file:///etc/passwd" }), "刀"),
    ).toThrow(/仅支持 http\/https/);
  });

  it("URL 校验：既非绝对地址又缺 baseURL 抛错", () => {
    expect(() =>
      prepareSearchRequest(xpathRule({ searchURL: "/foo", baseURL: "" }), ""),
    ).toThrow(/不是绝对地址且缺少 baseURL/);
  });

  it("URL 校验：绝对地址非法（缺主机）抛错", () => {
    expect(() => prepareSearchRequest(xpathRule({ searchURL: "https://?q=1" }), "")).toThrow(
      /URL 无效/,
    );
  });

  it("URL 校验：非 ASCII 路径被 percent 编码（url crate 只吃 ASCII）", () => {
    const spec = prepareSearchRequest(
      xpathRule({ searchURL: "https://example.com/中文/首页" }),
      "",
    );
    expect(spec.url).toBe("https://example.com/%E4%B8%AD%E6%96%87/%E9%A6%96%E9%A1%B5");
  });
});

describe("prepareChapterRequest", () => {
  it("XPath 模式：URL 归一化、不带 cookie", () => {
    const spec = prepareChapterRequest(xpathRule(), "/detail/1/");
    expect(spec.method).toBe("GET");
    expect(spec.url).toBe("https://example.com/detail/1");
    expect(spec.includeCookies).toBeUndefined();
  });

  it("API 模式：source 变量进 URL", () => {
    const spec = prepareChapterRequest(apiRule(), "https://example.com/detail/1");
    expect(spec.url).toBe(
      "https://example.com/api/chapters?src=https%3A%2F%2Fexample.com%2Fdetail%2F1",
    );
    expect(spec.includeCookies).toBe(true);
  });
});

describe("parseSearchApi", () => {
  it("解析列表并跳过缺字段节点", () => {
    const raw = JSON.stringify({
      data: [
        { name: "番剧A", url: "/a" },
        { name: "番剧B", url: "/b" },
        { name: "无链接" },
      ],
    });
    const parsed = parseSearchApi(raw, apiRule());
    expect(parsed.items).toEqual([
      { name: "番剧A", src: "/a" },
      { name: "番剧B", src: "/b" },
    ]);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it("非法 JSON 返回明确诊断", () => {
    const parsed = parseSearchApi("not json", apiRule());
    expect(parsed.items).toEqual([]);
    expect(parsed.diagnostics[0]).toContain("JSON");
  });
});

describe("parseChaptersApi：nested", () => {
  it("解析多线路与剧集，URL 归一化", () => {
    const raw = JSON.stringify({
      data: {
        roads: [
          { name: "线路一", episodes: [{ name: "第1集", url: "/play/1" }] },
          {
            name: "线路二",
            episodes: [
              { name: "第2集", url: "https://cdn.example/2.mp4" },
              { name: "第3集", url: "https://cdn.example/3.mp4" },
            ],
          },
        ],
      },
    });
    const parsed = parseChaptersApi(raw, apiRule(), "https://example.com/detail/1", "https://example.com/");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.roads).toEqual([
      {
        name: "线路一",
        episodes: [{ name: "第1集", url: "https://example.com/play/1" }],
      },
      {
        name: "线路二",
        episodes: [
          { name: "第2集", url: "https://cdn.example/2.mp4" },
          { name: "第3集", url: "https://cdn.example/3.mp4" },
        ],
      },
    ]);
  });

  it("无 roadsPath 时把整个文档当单线路", () => {
    const rule = apiRule({
      chapterApiConfig: {
        request: { url: "https://example.com/api" },
        roadsPath: "",
        roadNamePath: "",
        episodesPath: "$.episodes[*]",
        episodeNamePath: "$.name",
        episodeUrlPath: "$.url",
        roadNamesPath: "",
        roadEpisodesPath: "",
      },
    });
    const raw = JSON.stringify({
      episodes: [{ name: "第1集", url: "/play/1" }],
    });
    const parsed = parseChaptersApi(raw, rule, "s", "https://example.com/");
    expect(parsed.roads).toHaveLength(1);
    expect(parsed.roads[0].episodes[0].url).toBe("https://example.com/play/1");
  });

  it("variables + episodePage 模板渲染播放页", () => {
    const rule = apiRule({
      chapterApiConfig: {
        request: { url: "https://example.com/api" },
        format: "nested",
        roadsPath: "$.data.roads[*]",
        roadNamePath: "$.name",
        episodesPath: "$.episodes[*]",
        episodeNamePath: "$.name",
        episodeUrlPath: "$.url",
        roadNamesPath: "",
        roadEpisodesPath: "",
        variables: { vid: "$.data.vid" },
        episodePage: {
          url: "https://player.example.com/play/@vid/@episodeUrl",
          query: { ep: "@episodeNumber" },
        },
      },
    });
    const raw = JSON.stringify({
      data: {
        vid: "123",
        roads: [{ name: "A", episodes: [{ name: "第1集", url: "ep-1.mp4" }] }],
      },
    });
    const parsed = parseChaptersApi(raw, rule, "https://example.com/detail/1", "https://example.com/");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.roads[0].episodes[0].url).toBe(
      "https://player.example.com/play/123/ep-1.mp4?ep=1",
    );
  });

  it("variable 未匹配返回诊断", () => {
    const rule = apiRule({
      chapterApiConfig: {
        request: { url: "https://example.com/api" },
        variables: { vid: "$.data.missing" },
        roadsPath: "$.data.roads[*]",
        roadNamePath: "$.name",
        episodesPath: "$.episodes[*]",
        episodeNamePath: "$.name",
        episodeUrlPath: "$.url",
        roadNamesPath: "",
        roadEpisodesPath: "",
      },
    });
    const parsed = parseChaptersApi(JSON.stringify({ data: {} }), rule, "s", "https://example.com/");
    expect(parsed.roads).toEqual([]);
    expect(parsed.diagnostics[0]).toContain("vid");
  });
});

describe("parseChaptersApi：delimited", () => {
  it("按分隔符拆分线路与剧集", () => {
    const rule = apiRule({
      chapterApiConfig: {
        request: { url: "https://example.com/api" },
        format: "delimited",
        roadsPath: "",
        roadNamePath: "",
        episodesPath: "",
        episodeNamePath: "",
        episodeUrlPath: "",
        roadNamesPath: "$.data.names",
        roadEpisodesPath: "$.data.episodes",
        roadSeparator: "$$$",
        episodeSeparator: "#",
        fieldSeparator: "$",
      },
    });
    const raw = JSON.stringify({
      data: {
        names: "线路一$$$线路二",
        episodes:
          "第1集$https://example.com/play/1###第2集$https://example.com/play/2$$$第3集$https://example.com/play/3",
      },
    });
    const parsed = parseChaptersApi(raw, rule, "s", "https://example.com/");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.roads).toEqual([
      {
        name: "线路一",
        episodes: [
          { name: "第1集", url: "https://example.com/play/1" },
          { name: "第2集", url: "https://example.com/play/2" },
        ],
      },
      {
        name: "线路二",
        episodes: [{ name: "第3集", url: "https://example.com/play/3" }],
      },
    ]);
  });

  it("条目缺字段分隔符时跳过并诊断", () => {
    const rule = apiRule({
      chapterApiConfig: {
        request: { url: "https://example.com/api" },
        format: "delimited",
        roadsPath: "",
        roadNamePath: "",
        episodesPath: "",
        episodeNamePath: "",
        episodeUrlPath: "",
        roadNamesPath: "$.data.names",
        roadEpisodesPath: "$.data.episodes",
        roadSeparator: "$$$",
        episodeSeparator: "#",
        fieldSeparator: "$",
      },
    });
    const raw = JSON.stringify({
      data: { names: "", episodes: "第1集" },
    });
    const parsed = parseChaptersApi(raw, rule, "s", "https://example.com/");
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.roads).toEqual([]);
  });
});

describe("XPath 解析：node 环境无 DOM", () => {
  it("parseSearchXPath 返回无 DOM 诊断", () => {
    const parsed = parseSearchXPath("<html></html>", xpathRule());
    expect(parsed.items).toEqual([]);
    expect(parsed.diagnostics[0]).toContain("HTML");
  });

  it("parseChaptersXPath 返回无 DOM 诊断", () => {
    const parsed = parseChaptersXPath("<html></html>", xpathRule(), "https://example.com/");
    expect(parsed.roads).toEqual([]);
    expect(parsed.diagnostics[0]).toContain("HTML");
  });
});
