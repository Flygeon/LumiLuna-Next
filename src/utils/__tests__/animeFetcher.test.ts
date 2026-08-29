/**
 * 抓取层（animeFetcher）回归测试：在途合并 / TTL 缓存 / 并发闸门。
 *
 * 背景：聚合搜索会同时打几十个源，没有这三层保护时表现为
 * 「检索特别慢、界面经常无响应」——死站拖满 15s、几十条连接互抢带宽触发限流。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { clearAnimeFetchCache, fetchAnimeHtml } from "../animeFetcher";
import type { AnimeFetchSpec } from "@shared/types";

function spec(url: string): AnimeFetchSpec {
  return { method: "GET", url };
}

/** 闸门是异步放行的（acquireSlot 内部有 await），派发后要让出一次宏任务才进网络层 */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  animeFetch.mockReset();
  appLog.mockReset();
  clearAnimeFetchCache();
});

describe("在途合并", () => {
  it("并发的同 key 请求只真正发一次", async () => {
    let release: ((v: unknown) => void) | undefined;
    animeFetch.mockImplementation(
      () => new Promise((res) => (release = res as (v: unknown) => void)),
    );
    const a = fetchAnimeHtml("rule", spec("https://e.com/s?wd=1"));
    const b = fetchAnimeHtml("rule", spec("https://e.com/s?wd=1"));
    await tick(); // 等闸门放行、网络层真正拿到请求
    expect(animeFetch).toHaveBeenCalledTimes(1);
    release?.({ html: "<html>命中</html>", finalUrl: null });
    const [ra, rb] = await Promise.all([a, b]);
    expect(animeFetch).toHaveBeenCalledTimes(1);
    expect(ra.html).toBe("<html>命中</html>");
    expect(rb.html).toBe(ra.html);
  });

  it("不同 URL 不合并", async () => {
    animeFetch.mockResolvedValue({ html: "x", finalUrl: null });
    await Promise.all([
      fetchAnimeHtml("rule", spec("https://e.com/a")),
      fetchAnimeHtml("rule", spec("https://e.com/b")),
    ]);
    expect(animeFetch).toHaveBeenCalledTimes(2);
  });
});

describe("TTL 缓存", () => {
  it("同一请求第二次直接复用，不再打网络", async () => {
    animeFetch.mockResolvedValue({ html: "<html/>", finalUrl: null });
    const s = spec("https://e.com/cached");
    await fetchAnimeHtml("rule", s);
    await fetchAnimeHtml("rule", s);
    expect(animeFetch).toHaveBeenCalledTimes(1);
  });

  it("skipCache 可强制重新抓取（用户手动重试）", async () => {
    animeFetch.mockResolvedValue({ html: "<html/>", finalUrl: null });
    const s = spec("https://e.com/retry");
    await fetchAnimeHtml("rule", s);
    await fetchAnimeHtml("rule", s, { skipCache: true });
    expect(animeFetch).toHaveBeenCalledTimes(2);
  });

  it("失败结果不入缓存（多为瞬时故障，缓存住会刷不出来）", async () => {
    animeFetch.mockRejectedValueOnce(new Error("network timeout"));
    animeFetch.mockResolvedValueOnce({ html: "ok", finalUrl: null });
    const s = spec("https://e.com/flaky");
    await expect(fetchAnimeHtml("rule", s)).rejects.toThrow("network timeout");
    const res = await fetchAnimeHtml("rule", s);
    expect(res.html).toBe("ok");
    expect(animeFetch).toHaveBeenCalledTimes(2);
  });
});

describe("并发闸门", () => {
  it("同时在途请求数不超过上限（8）", async () => {
    let cur = 0;
    let max = 0;
    const gates: Array<() => void> = [];
    animeFetch.mockImplementation(() => {
      cur += 1;
      max = Math.max(max, cur);
      return new Promise((res) => {
        gates.push(() => {
          cur -= 1;
          res({ html: "x", finalUrl: null });
        });
      });
    });
    const total = 30;
    const promises = Array.from({ length: total }, (_, i) =>
      fetchAnimeHtml("rule", spec(`https://e.com/p/${i}`)),
    );
    try {
      await tick();
      // 闸门只允许前 8 个进到网络层，其余排队
      expect(animeFetch).toHaveBeenCalledTimes(8);
      expect(max).toBe(8);
    } finally {
      // 无论断言是否通过都要放行干净，否则残留的在途请求会拖垮后续用例
      for (let i = 0; i < total * 2 && gates.length; i++) {
        const batch = gates.splice(0, gates.length);
        for (const g of batch) g();
        await tick();
      }
      await Promise.allSettled(promises);
    }
    expect(animeFetch).toHaveBeenCalledTimes(total);
    expect(max).toBeLessThanOrEqual(8);
  });
});

describe("超时透传", () => {
  it("调用方指定的 timeoutMs 会传给 Rust（搜索用短超时）", async () => {
    animeFetch.mockResolvedValue({ html: "x", finalUrl: null });
    await fetchAnimeHtml("rule", spec("https://e.com/timeout"), {
      timeoutMs: 10_000,
    });
    expect(animeFetch.mock.calls[0]?.[1]).toMatchObject({ timeoutMs: 10_000 });
  });

  it("未指定时不塞 timeoutMs（交给 Rust 侧默认值）", async () => {
    animeFetch.mockResolvedValue({ html: "x", finalUrl: null });
    await fetchAnimeHtml("rule", spec("https://e.com/default-timeout"));
    expect(animeFetch.mock.calls[0]?.[1]).not.toHaveProperty("timeoutMs");
  });
});
