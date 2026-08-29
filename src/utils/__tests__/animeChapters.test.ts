/**
 * 选集 XPath 解析单测：验证「线路/剧集」提取与 Kazumi 语义一致。
 *
 * node 环境无 document.evaluate（真实 XPath 只在 WebView2 里跑），这里 mock
 * animeXPath 模块，重点验证 parseChaptersXPath 的取值逻辑：chapterResult 选中的
 * 就是剧集元素，href 与文本必须直接从该元素读取（照 Kazumi
 * xpath_rule_strategy.dart 的 episode.attributes['href'] / episode.text），
 * 而不是再以该元素为上下文求一次 chapterResult（后者是修复前的 bug，
 * 导致每条线路都报「剧集节点 0 缺少 URL」）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../animeXPath", () => ({
  parseHtml: vi.fn(),
  queryNodes: vi.fn(),
  queryText: vi.fn(),
  queryAttr: vi.fn(),
  queryFirstNode: vi.fn(),
}));

import * as xpath from "../animeXPath";
import { normalizeRule, parseChaptersXPath } from "../animeRules";

const parseHtml = xpath.parseHtml as unknown as ReturnType<typeof vi.fn>;
const queryNodes = xpath.queryNodes as unknown as ReturnType<typeof vi.fn>;

function rule(overrides?: Record<string, unknown>) {
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

const ROADS_EXPR = "//div[@class='road']";
const EPS_EXPR = ".//a";

/** 伪造 DOM 元素：只有 getAttribute/textContent 两个成员被 parseChaptersXPath 用到 */
function el(attrs: Record<string, string>, text: string): Element {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    textContent: text,
  } as unknown as Element;
}

beforeEach(() => {
  vi.clearAllMocks();
  parseHtml.mockReturnValue({} as Element);
});

describe("parseChaptersXPath", () => {
  it("从 chapterResult 选中的剧集元素直接读 href 与文本", () => {
    queryNodes.mockImplementation((expr: string) => {
      if (expr === ROADS_EXPR) return [el({}, "")]; // 一条线路
      return [el({ href: "/play/1" }, "第1集"), el({ href: "/play/2" }, "第2集")];
    });
    const res = parseChaptersXPath("<html/>", rule(), "https://example.com/");
    expect(res.roads).toHaveLength(1);
    expect(res.roads[0].name).toBe("播放线路1");
    expect(res.roads[0].episodes).toEqual([
      { url: "https://example.com/play/1", name: "第1集" },
      { url: "https://example.com/play/2", name: "第2集" },
    ]);
    expect(res.diagnostics).toEqual([]);
  });

  it("剧集节点缺 href → 跳过并报诊断，其余保留", () => {
    queryNodes.mockImplementation((expr: string) => {
      if (expr === ROADS_EXPR) return [el({}, "")];
      return [el({}, "无链接"), el({ href: "/play/2" }, "第2集")];
    });
    const res = parseChaptersXPath("<html/>", rule(), "https://example.com/");
    expect(res.roads).toHaveLength(1);
    expect(res.roads[0].episodes).toEqual([
      { url: "https://example.com/play/2", name: "第2集" },
    ]);
    expect(res.diagnostics[0]).toContain("缺少 URL");
  });

  it("线路没有有效剧集 → 整条线路跳过", () => {
    queryNodes.mockImplementation((expr: string) => {
      if (expr === ROADS_EXPR) return [el({}, ""), el({}, "")];
      return [el({}, "空节点")];
    });
    const res = parseChaptersXPath("<html/>", rule(), "https://example.com/");
    expect(res.roads).toHaveLength(0);
    expect(res.diagnostics.join("；")).toContain("没有有效剧集");
  });

  it("无 HTML 文档 → 明确诊断", () => {
    parseHtml.mockReturnValue(null);
    const res = parseChaptersXPath("", rule(), "https://example.com/");
    expect(res.roads).toHaveLength(0);
    expect(res.diagnostics[0]).toContain("无法解析");
  });
});
