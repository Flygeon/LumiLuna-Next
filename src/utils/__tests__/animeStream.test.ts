/**
 * 静态取流单测（方案书 §6）：覆盖规则正则、规则 JSONPath、通用 m3u8、
 * 通用 mp4/flv 四条快速路径的命中优先级与 URL 归一化，以及流挑选策略。
 */
import { describe, expect, it } from "vitest";
import { extractStaticStream, pickStream } from "../animeStream";
import type { AnimeRule } from "@shared/types";

const BASE = "https://example.com/";

function rule(overrides?: Partial<AnimeRule>): AnimeRule {
  return {
    name: "测试源",
    baseURL: BASE,
    searchMode: "xpath",
    chapterMode: "xpath",
    searchURL: "",
    searchList: "",
    searchName: "",
    searchResult: "",
    chapterRoads: "",
    chapterResult: "",
    ...overrides,
  } as AnimeRule;
}

describe("extractStaticStream", () => {
  it("优先规则正则（取首个捕获组）", () => {
    const hit = extractStaticStream(
      `var url = "https://cdn.example/a/index.m3u8";`,
      rule({ streamRegex: `url = "([^"]+)"` }),
      BASE,
    );
    expect(hit?.method).toBe("regex");
    expect(hit?.url).toBe("https://cdn.example/a/index.m3u8");
  });

  it("规则正则无捕获组时用全匹配", () => {
    const hit = extractStaticStream(
      `var u = https://cdn.example/a/1.mp4;`,
      rule({ streamRegex: "https://[^\"'\\\\s;]+" }),
      BASE,
    );
    expect(hit?.method).toBe("regex");
    expect(hit?.url).toBe("https://cdn.example/a/1.mp4");
  });

  it("规则正则非法时落到通用路径", () => {
    const hit = extractStaticStream(
      `https://cdn.example/a/index.m3u8`,
      rule({ streamRegex: "(" }),
      BASE,
    );
    expect(hit?.method).toBe("generic-m3u8");
  });

  it("规则 JSONPath 从内嵌 <script> JSON 提取", () => {
    const html = `<html><script>{"url":"/play/1/index.m3u8"}</script></html>`;
    const hit = extractStaticStream(html, rule({ streamJsonPath: "$.url" }), BASE);
    expect(hit?.method).toBe("jsonpath");
    expect(hit?.url).toBe("https://example.com/play/1/index.m3u8");
  });

  it("整页即为 JSON 时直接提取", () => {
    const html = JSON.stringify({ playUrl: "https://cdn.example/a.m3u8?token=1" });
    const hit = extractStaticStream(html, rule({ streamJsonPath: "$.playUrl" }), BASE);
    expect(hit?.method).toBe("jsonpath");
    expect(hit?.url).toBe("https://cdn.example/a.m3u8?token=1");
  });

  it("JSONPath 未命中时落到通用 m3u8", () => {
    const html = `<script>window.x = {"a":1}</script>https://cdn.example/a/index.m3u8`;
    const hit = extractStaticStream(html, rule({ streamJsonPath: "$.url" }), BASE);
    expect(hit?.method).toBe("generic-m3u8");
  });

  it("通用 m3u8 直链", () => {
    const hit = extractStaticStream(
      `src="https://cdn.example/a/index.m3u8?token=abc"`,
      rule(),
      BASE,
    );
    expect(hit?.method).toBe("generic-m3u8");
    expect(hit?.url).toBe("https://cdn.example/a/index.m3u8?token=abc");
  });

  it("通用 m3u8 支持协议相对", () => {
    const hit = extractStaticStream(`"//cdn.example/a/index.m3u8"`, rule(), BASE);
    expect(hit?.method).toBe("generic-m3u8");
    expect(hit?.url).toBe("https://cdn.example/a/index.m3u8");
  });

  it("通用 mp4 直链（无 m3u8 时）", () => {
    const hit = extractStaticStream(
      `<video src="https://cdn.example/a/1.mp4"></video>`,
      rule(),
      BASE,
    );
    expect(hit?.method).toBe("generic-mp4");
    expect(hit?.url).toBe("https://cdn.example/a/1.mp4");
  });

  it("flv 同样命中", () => {
    const hit = extractStaticStream(
      `"https://cdn.example/live.flv?x=1"`,
      rule(),
      BASE,
    );
    expect(hit?.method).toBe("generic-mp4");
    expect(hit?.url).toBe("https://cdn.example/live.flv?x=1");
  });

  it("页面无任何流返回 null", () => {
    expect(extractStaticStream("<html>没有视频</html>", rule(), BASE)).toBeNull();
  });
});

describe("pickStream", () => {
  it("优先 m3u8", () => {
    expect(pickStream(["https://cdn.example/a.mp4", "https://cdn.example/a.m3u8"])).toBe(
      "https://cdn.example/a.m3u8",
    );
  });

  it("空数组返回 null", () => {
    expect(pickStream([])).toBeNull();
  });

  it("URL 去重（按 # 前片段）", () => {
    const urls = [
      "https://cdn.example/a.m3u8#1",
      "https://cdn.example/a.m3u8#2",
      "https://cdn.example/b.m3u8",
    ];
    expect(pickStream(urls)).toBe("https://cdn.example/a.m3u8#1");
  });
});
