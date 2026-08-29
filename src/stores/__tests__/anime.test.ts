/**
 * 在线番剧聚合搜索回归测试。
 *
 * 覆盖一个真实事故：`searchSources()` 用 `{ replace: false }` 调用
 * `querySingleSource()`，而 `done()` 里写成
 * `items: spec.replace === false ? prev.items : patch.items ?? prev.items`，
 * 导致刚解析出来的 items 被 `prev.items`（恒为空数组）覆盖 —— 网络请求、
 * XPath/JSON 解析全都正常，UI 却永远显示「0 条」。
 *
 * 用 API 模式规则构造用例：node 环境没有 DOM，XPath 分支走不通，
 * 而这条 bug 与解析方式无关，API 模式同样能命中。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const animeFetch = vi.fn();
const appLog = vi.fn();

vi.mock("@/capabilities", () => ({
  capabilities: {
    animeFetch: (...args: unknown[]) => animeFetch(...args),
    appLog: (...args: unknown[]) => {
      appLog(...args);
      return Promise.resolve();
    },
  },
}));

import { useAnimeStore } from "../anime";

/** 最小可用的 API 模式规则（字段与 Kazumi 默认值一致） */
const API_RULE = {
  api: "4",
  type: "anime",
  name: "测试源",
  version: "1.0",
  muliSources: true,
  useWebview: true,
  useNativePlayer: true,
  baseURL: "https://example.com/",
  searchMode: "api",
  chapterMode: "api",
  searchApiConfig: {
    request: { method: "GET", url: "https://example.com/api/search?kw=@keyword" },
    listPath: "$.data[*]",
    namePath: "$.name",
    sourcePath: "$.url",
  },
  chapterApiConfig: {
    request: { method: "GET", url: "https://example.com/api/chapters?src=@source" },
    format: "nested",
    roadsPath: "$.data.roads[*]",
    roadNamePath: "$.name",
    episodesPath: "$.episodes[*]",
    episodeNamePath: "$.name",
    episodeUrlPath: "$.url",
  },
};

function searchResponse() {
  return {
    html: JSON.stringify({
      data: [
        { name: "番剧A", url: "/detail/1" },
        { name: "番剧B", url: "/detail/2" },
      ],
    }),
    finalUrl: "https://example.com/api/search?kw=test",
  };
}

describe("useAnimeStore.searchSources", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    animeFetch.mockReset();
    appLog.mockReset();
  });

  it("聚合搜索必须把解析出的条目写回 sourceSearch（replace:false 不吞结果）", async () => {
    const store = useAnimeStore();
    store.rules = [
      { name: "测试源", version: "1.0", enabled: true, json: JSON.stringify(API_RULE) },
    ];
    animeFetch.mockResolvedValue(searchResponse());

    await store.searchSources("刀剑神域");

    expect(store.sourceSearch).toHaveLength(1);
    const result = store.sourceSearch[0];
    expect(result.pluginName).toBe("测试源");
    expect(result.status).toBe("success");
    // 事故现场：这里曾经是 0
    expect(result.items).toEqual([
      { name: "番剧A", src: "/detail/1" },
      { name: "番剧B", src: "/detail/2" },
    ]);
  });

  it("解析出 0 条时状态为 noResult（不是 success 0 条）", async () => {
    const store = useAnimeStore();
    store.rules = [
      { name: "测试源", version: "1.0", enabled: true, json: JSON.stringify(API_RULE) },
    ];
    animeFetch.mockResolvedValue({ html: JSON.stringify({ data: [] }), finalUrl: "" });

    await store.searchSources("不存在");

    expect(store.sourceSearch[0].status).toBe("noResult");
    expect(store.sourceSearch[0].items).toEqual([]);
  });

  it("请求/解析抛错时状态为 error 且带可读消息", async () => {
    const store = useAnimeStore();
    store.rules = [
      { name: "测试源", version: "1.0", enabled: true, json: JSON.stringify(API_RULE) },
    ];
    animeFetch.mockRejectedValue(new Error("HTTP 403（规则 测试源）"));

    await store.searchSources("刀剑");

    expect(store.sourceSearch[0].status).toBe("error");
    expect(store.sourceSearch[0].message).toContain("403");
    expect(store.sourceSearch[0].items).toEqual([]);
  });

  it("未启用的源不参与聚合搜索", async () => {
    const store = useAnimeStore();
    store.rules = [
      { name: "禁用源", version: "1.0", enabled: false, json: JSON.stringify(API_RULE) },
    ];
    animeFetch.mockResolvedValue(searchResponse());

    await store.searchSources("刀剑");

    expect(store.sourceSearch).toHaveLength(0);
    expect(animeFetch).not.toHaveBeenCalled();
  });

  it("检索链路写 [anime-online] 诊断日志", async () => {
    const store = useAnimeStore();
    store.rules = [
      { name: "测试源", version: "1.0", enabled: true, json: JSON.stringify(API_RULE) },
    ];
    animeFetch.mockResolvedValue(searchResponse());

    await store.searchSources("刀剑");

    const logs = appLog.mock.calls.map((c) => String(c[0]));
    expect(logs.every((l) => l.startsWith("[anime-online]"))).toBe(true);
    expect(logs.some((l) => l.includes("检索开始"))).toBe(true);
    expect(logs.some((l) => l.includes("items=2"))).toBe(true);
  });
});
