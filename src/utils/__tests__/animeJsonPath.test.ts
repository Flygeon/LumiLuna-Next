/**
 * 受限 JSONPath 引擎单测（方案书 §6）：覆盖 Kazumi `RestrictedJsonPath` 白名单
 * 的合法/非法表达式校验，以及 `[*]` 展开、下标、引号键的取值语义。
 */
import { describe, expect, it } from "vitest";
import {
  AnimeJsonPathError,
  readFirstJsonPath,
  readJsonPath,
  validateJsonPath,
} from "../animeJsonPath";

describe("validateJsonPath：合法表达式", () => {
  it.each([
    "$",
    "$.data",
    "$.data.list",
    "$.data[0]",
    "$.data[*]",
    "$.data[*].name",
    "$['data']",
    '$["data"]',
    "$.data['list'][*]",
    "$['has.dot']",
  ])("%s 通过", (expr) => {
    expect(() => validateJsonPath(expr)).not.toThrow();
  });
});

describe("validateJsonPath：非法表达式", () => {
  it.each([
    ["空串", ""],
    ["不以 $ 开头", "data.list"],
    ["尾部点", "$.data."],
    ["连续点", "$.a..b"],
    ["未闭合下标", "$.a[0"],
    ["非数字下标", "$.a[x]"],
    ["混入方法调用", "$.a.length()"],
    ["混入双点", "$..a"],
    ["下标内容非法", "$.a['b"],
  ])("%s 拒绝", (_label, expr) => {
    expect(() => validateJsonPath(expr)).toThrow(AnimeJsonPathError);
  });
});

describe("readJsonPath：取值", () => {
  const doc = {
    code: 0,
    data: {
      list: [
        { name: "番剧A", url: "/a/1" },
        { name: "番剧B", url: "/b/2" },
      ],
    },
  };

  it("读取数组展开", () => {
    expect(readJsonPath(doc, "$.data.list[*].name")).toEqual(["番剧A", "番剧B"]);
  });

  it("读取下标元素", () => {
    expect(readJsonPath(doc, "$.data.list[1]")).toEqual([{ name: "番剧B", url: "/b/2" }]);
  });

  it("读取单值返回单元素数组", () => {
    expect(readJsonPath(doc, "$.code")).toEqual([0]);
  });

  it("未命中返回空数组", () => {
    expect(readJsonPath(doc, "$.data.missing")).toEqual([]);
    expect(readJsonPath(doc, "$.data.list[*].nothing")).toEqual([]);
  });

  it("根节点自身", () => {
    expect(readJsonPath(doc, "$")).toEqual([doc]);
  });

  it("引号键含点号", () => {
    expect(readJsonPath({ "a.b": 1 }, "$['a.b']")).toEqual([1]);
  });

  it("通配符中途继续下钻", () => {
    expect(readJsonPath({ a: [{ b: 1 }, { b: 2 }] }, "$.a[*].b")).toEqual([1, 2]);
  });
});

describe("readFirstJsonPath", () => {
  it("取首个命中值", () => {
    expect(readFirstJsonPath({ a: [{ b: 1 }, { b: 2 }] }, "$.a[*].b")).toBe(1);
  });

  it("未命中返回 null", () => {
    expect(readFirstJsonPath({ a: 1 }, "$.b")).toBeNull();
  });

  it("null 值算命中（返回 null 而非 undefined）", () => {
    expect(readFirstJsonPath({ a: null }, "$.a")).toBeNull();
  });
});
