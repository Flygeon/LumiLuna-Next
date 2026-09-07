/**
 * 集数源站 URL 归一化单测（方案书 §6）：覆盖相对路径补全、同站协议统一、
 * 尾斜杠/query/fragment 清理与幂等性（见 animeEpisodeUrl.ts 头注）。
 */
import { describe, expect, it } from "vitest";
import { normalizeEpisodeUrl } from "../animeEpisodeUrl";

const BASE = "https://example.com/";

describe("normalizeEpisodeUrl：基础", () => {
  it("空输入返回空串", () => {
    expect(normalizeEpisodeUrl(BASE, "")).toBe("");
    expect(normalizeEpisodeUrl(BASE, "   ")).toBe("");
  });

  it("相对路径基于 baseUrl 补全", () => {
    expect(normalizeEpisodeUrl(BASE, "/play/1")).toBe("https://example.com/play/1");
    expect(normalizeEpisodeUrl(BASE, "play/1")).toBe("https://example.com/play/1");
    expect(normalizeEpisodeUrl(BASE, "javascript:void(0)")).toBe("javascript:void(0)");
  });

  it("绝对 URL 原样保留", () => {
    expect(normalizeEpisodeUrl(BASE, "https://cdn.example/a/1")).toBe("https://cdn.example/a/1");
  });
});

describe("normalizeEpisodeUrl：同站协议统一", () => {
  it("http → base 声明的 https", () => {
    expect(normalizeEpisodeUrl(BASE, "http://example.com/a")).toBe("https://example.com/a");
  });

  it("跨站（不同 host）保持原协议", () => {
    expect(normalizeEpisodeUrl(BASE, "http://other.example/a")).toBe("http://other.example/a");
  });

  it("同站但端口不同不改协议", () => {
    expect(normalizeEpisodeUrl(BASE, "http://example.com:8443/a")).toBe(
      "http://example.com:8443/a",
    );
  });

  it("同站且显式端口一致则统一协议", () => {
    expect(normalizeEpisodeUrl("https://example.com:8443/", "http://example.com:8443/a")).toBe(
      "https://example.com:8443/a",
    );
  });
});

describe("normalizeEpisodeUrl：URL 清理", () => {
  it("去除 path 尾斜杠（根路径保留）", () => {
    expect(normalizeEpisodeUrl(BASE, "https://example.com/dir/")).toBe("https://example.com/dir");
    expect(normalizeEpisodeUrl(BASE, "https://example.com/")).toBe("https://example.com/");
  });

  it("去除 fragment，保留非空 query", () => {
    expect(normalizeEpisodeUrl(BASE, "https://example.com/a?x=1#frag")).toBe(
      "https://example.com/a?x=1",
    );
    expect(normalizeEpisodeUrl(BASE, "https://example.com/a#frag")).toBe("https://example.com/a");
  });
});

describe("normalizeEpisodeUrl：幂等", () => {
  it("对已归一化的 URL 再次归一化不变", () => {
    const once = normalizeEpisodeUrl(BASE, "http://example.com/play/1/#frag");
    const twice = normalizeEpisodeUrl(BASE, once);
    expect(twice).toBe(once);
  });

  it("相对路径归一化后为绝对 URL", () => {
    const once = normalizeEpisodeUrl(BASE, "/play/1");
    expect(once).toBe("https://example.com/play/1");
  });
});
