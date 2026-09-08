/**
 * Bangumi 鉴权层（bangumiAuthApi）回归测试：
 * - 收藏条目/内嵌 subject 的归一化解析（v0 SubjectVO 字段更瘦，兜底不能丢条目）
 * - 鉴权请求的域名回退与错误语义（HTTP 状态要能映射出可读错误，纯网络失败才换域名）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const animeFetch = vi.fn();

vi.mock("@/capabilities", () => ({
  capabilities: {
    animeFetch: (...args: unknown[]) => animeFetch(...args),
  },
}));

import {
  BangumiApiError,
  describeBangumiError,
  fetchAllCollections,
  fetchCurrentUser,
  fromCollectionSubject,
  fromUserCollection,
  setCollectionStatus,
} from "@/utils/bangumiAuthApi";

function jsonOk(payload: unknown) {
  return Promise.resolve({ html: JSON.stringify(payload), finalUrl: undefined });
}

beforeEach(() => animeFetch.mockReset());

describe("fromUserCollection", () => {
  it("解析官方 v0 收藏条目（含 rate/comment/ep_status）", () => {
    const c = fromUserCollection({
      subject_id: 458282,
      type: 3,
      rate: 8,
      comment: "神作",
      updated_at: "2026-09-01T10:00:00Z",
      ep_status: { collect: 5, done: 5 },
      subject: {
        id: 458282,
        name: "Frieren",
        name_cn: "葬送的芙莉莲",
        short_summary: "勇者讨伐魔王之后的故事。",
        images: { large: "https://lain.bgm.tv/pic/cover/l/a.jpg" },
        rating: { rank: 10, total: 20000, count: 20000 },
      },
    });
    expect(c).not.toBeNull();
    expect(c?.subjectId).toBe(458282);
    expect(c?.category).toBe(3);
    expect(c?.rate).toBe(8);
    expect(c?.comment).toBe("神作");
    expect(c?.epStatus).toEqual({ collected: 5, done: 5 });
    expect(c?.subject.nameCn).toBe("葬送的芙莉莲");
    expect(c?.subject.summary).toBe("勇者讨伐魔王之后的故事。");
  });

  it("subject 缺 name 时造占位条目而不是整条丢弃", () => {
    const c = fromUserCollection({ subject_id: 123, type: 1, subject: { id: 123 } });
    expect(c?.subject.name).toBe("123");
    expect(c?.category).toBe(1);
  });

  it("无 subject_id 的脏数据返回 null", () => {
    expect(fromUserCollection({ type: 3 })).toBeNull();
    expect(fromUserCollection(null)).toBeNull();
  });

  it("type 越界钳制到 0-5", () => {
    const c = fromUserCollection({ subject_id: 9, type: 99, subject: { id: 9, name: "x" } });
    expect(c?.category).toBe(5);
  });
});

describe("fromCollectionSubject", () => {
  it("复用 v0 解析并补齐 votes/score 缺失", () => {
    const s = fromCollectionSubject({
      id: 1,
      name: "A",
      name_cn: "甲",
      rating: { score: 9.1, count: 100 },
    });
    expect(s?.nameCn).toBe("甲");
    expect(s?.votes).toBe(100);
  });
});

describe("authRequest 域名与错误", () => {
  it("fetchCurrentUser 走镜像并带 Bearer 头", async () => {
    animeFetch.mockImplementationOnce(async (_rule: string, spec: { url: string }) => {
      expect(spec.url).toContain("api.bgmapi.com/v0/me");
      return jsonOk({ id: "u", username: "flygeon", nickname: "Fly" });
    });
    const user = await fetchCurrentUser("tok-123");
    expect(user.username).toBe("flygeon");
    const spec = animeFetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(spec.headers.Authorization).toBe("Bearer tok-123");
  });

  it("纯网络失败时回退到备用域名", async () => {
    animeFetch
      .mockImplementationOnce(() => Promise.reject(new Error("网络请求失败（连接失败）：xxx")))
      .mockImplementationOnce(async (_rule: string, spec: { url: string }) => {
        expect(spec.url).toContain("api.bgm.tv");
        return jsonOk({ id: "u", username: "flygeon" });
      });
    const user = await fetchCurrentUser("tok");
    expect(user.username).toBe("flygeon");
    expect(animeFetch).toHaveBeenCalledTimes(2);
  });

  it("HTTP 401 不切域名直接上抛，describeBangumiError 给出文案", async () => {
    animeFetch.mockImplementationOnce(() =>
      Promise.reject(new Error("HTTP 401（规则 bangumi · …）")),
    );
    await expect(fetchCurrentUser("bad")).rejects.toBeInstanceOf(BangumiApiError);
    expect(animeFetch).toHaveBeenCalledTimes(1);
    expect(describeBangumiError(new BangumiApiError(401, "x"))).toContain("Access Token");
  });

  it("setCollectionStatus 以 JSON type 提交（Kazumi 同款参数）", async () => {
    animeFetch.mockImplementationOnce(async (_rule: string, spec: Record<string, unknown>) => {
      expect(spec.method).toBe("POST");
      expect(String(spec.url)).toContain("/v0/users/-/collections/458282");
      expect(spec.body).toBe(JSON.stringify({ type: 3 }));
      expect(spec.bodyType).toBe("json");
      return jsonOk({ ok: true });
    });
    await expect(setCollectionStatus("tok", 458282, 3)).resolves.toBeUndefined();
  });
});

describe("fetchAllCollections 分页", () => {
  it("翻到 total 为止并合并条目", async () => {
    const mk = (offset: number, n: number) => ({
      data: Array.from({ length: n }, (_, i) => ({
        subject_id: offset + i + 1,
        type: 3,
        subject: { id: offset + i + 1, name: `s${offset + i}` },
      })),
      total: 55,
      limit: 50,
      offset,
    });
    animeFetch
      .mockImplementationOnce(() => jsonOk(mk(0, 50)))
      .mockImplementationOnce(() => jsonOk(mk(50, 5)));
    const items = await fetchAllCollections("tok", "flygeon");
    expect(items).toHaveLength(55);
    expect(animeFetch).toHaveBeenCalledTimes(2);
  });
});
