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

  // ---- JSON 转义的 URL（`/` 写成 `\/`）：苹果CMS 系站点普遍如此 ----
  // 事故背景：旧版正则的字符集排除了 `\` 且要求 `https:` 后紧跟 `//`，
  // 导致 akianime 等整类站点静态提取全部落空，只能掉进隐藏 webview（30s 超时而归）。

  it("player_aaaa 配置里 JSON 转义的 m3u8（真实页面片段）", () => {
    const html =
      `<script type="text/javascript">var player_aaaa={"flag":"play","encrypt":0,` +
      `"vod_data":{"vod_name":"\\u65e0\\u804c"},` +
      `"url":"https:\\/\\/fengbao12.com\\/video\\/abc\\/4b20eb12a14f\\/index.m3u8",` +
      `"url_next":"https:\\/\\/fengbao12.com\\/video\\/abc\\/c1ba25aebaba\\/index.m3u8",` +
      `"from":"bfzym3u8","id":"e3cDDE","sid":3,"nid":1}</script>`;
    const hit = extractStaticStream(html, rule(), BASE);
    expect(hit?.method).toBe("player-config");
    expect(hit?.url).toBe(
      "https://fengbao12.com/video/abc/4b20eb12a14f/index.m3u8",
    );
  });

  it("通用 m3u8 也能命中 JSON 转义写法", () => {
    const html = `<div>"url":"https:\\/\\/cdn.example\\/a\\/index.m3u8?token=1"</div>`;
    const hit = extractStaticStream(html, rule(), BASE);
    expect(hit?.method).toBe("generic-m3u8");
    expect(hit?.url).toBe("https://cdn.example/a/index.m3u8?token=1");
  });

  it("通用 mp4 同样支持 JSON 转义写法", () => {
    const html = `{"url":"https:\\/\\/cdn.example\\/a\\/01.mp4"}`;
    const hit = extractStaticStream(html, rule(), BASE);
    expect(hit?.method).toBe("generic-mp4");
    expect(hit?.url).toBe("https://cdn.example/a/01.mp4");
  });

  it("未转义的 URL 行为不变（反转义不得误伤）", () => {
    const hit = extractStaticStream(
      `src="https://cdn.example/a/index.m3u8"`,
      rule(),
      BASE,
    );
    expect(hit?.url).toBe("https://cdn.example/a/index.m3u8");
  });

  it("云解析 token 不当作地址（gugu3：url 是 vwnet-xxx，真址要跑 JS 换）", () => {
    const html =
      `<script>var player_aaaa={"flag":"play","encrypt":0,` +
      `"url":"vwnet-358921638633a60cf600b5cadde8a7a5","from":"yunjie","id":"5044"}</script>`;
    expect(extractStaticStream(html, rule(), BASE)).toBeNull();
  });

  it("配置里 url 为数组时取第一个有效项", () => {
    const html =
      `<script>var player_aaaa={"url":["https:\\/\\/cdn.example\\/a.m3u8",` +
      `"https:\\/\\/cdn.example\\/b.m3u8"]}</script>`;
    const hit = extractStaticStream(html, rule(), BASE);
    expect(hit?.method).toBe("player-config");
    expect(hit?.url).toBe("https://cdn.example/a.m3u8");
  });

  it("配置 JSON 非法时不崩，落到后续路径", () => {
    const html = `<script>var player_aaaa={"url":</script>https://cdn.example/a.m3u8`;
    const hit = extractStaticStream(html, rule(), BASE);
    expect(hit?.method).toBe("generic-m3u8");
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
