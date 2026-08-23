/**
 * 皮肤校验器单测（方案书 §14 M1）：
 * 覆盖 §4.2 每条格式规则的正反例、远程引用检测、四款内置皮肤必须全部通过。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareVersions, validateSkin, SKIN_CSS_LIMIT } from "../skinSchema";

function validSkin(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    formatVersion: 1,
    manifest: {
      id: "com.example.skin",
      name: "测试皮肤",
      version: "1.0.0",
      author: "tester",
      modes: ["light", "dark"],
      ...overrides,
    },
    tokens: { light: { "--md-sys-color-primary": "#112233" } },
  });
}

function validV2Skin(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    formatVersion: 2,
    manifest: {
      id: "com.example.v2",
      name: "v2 测试",
      version: "1.0.0",
      author: "tester",
      modes: ["light", "dark"],
    },
    tokens: { light: { "--md-sys-color-primary": "#112233" } },
    ...overrides,
  };
}

const EXAMPLE_SAKURA = resolve(__dirname, "../../../example/skins/lumiluna.sakura");
const SAKURA_FILES = [
  "assets/bg.png",
  "assets/icons/delete.svg",
  "assets/icons/favorite.svg",
  "assets/icons/history.svg",
  "assets/icons/image.svg",
  "assets/icons/inventory_2.svg",
  "assets/icons/menu_book.svg",
  "assets/icons/movie.svg",
  "assets/icons/music_note.svg",
  "assets/icons/settings.svg",
];

const EXAMPLE_DIR = resolve(__dirname, "../../../example/skins");

describe("validateSkin：合法文档", () => {
  it("最小令牌皮肤通过并规范化", () => {
    const v = validateSkin(validSkin());
    expect(v.ok).toBe(true);
    expect(v.errors).toHaveLength(0);
    expect(v.skin?.manifest.seedColor).toBe(false); // 默认关
    expect(v.skin?.manifest.modes).toEqual(["light", "dark"]);
    expect(v.warnings).toHaveLength(0);
  });

  it("接受已解析对象与文件原文两种输入", () => {
    expect(validateSkin(JSON.parse(validSkin())).ok).toBe(true);
    expect(validateSkin(validSkin()).ok).toBe(true);
  });

  it("modes 去重", () => {
    const v = validateSkin(validSkin({ modes: ["dark", "dark"] }));
    expect(v.ok).toBe(true);
    expect(v.skin?.manifest.modes).toEqual(["dark"]);
  });
});

describe("validateSkin：拒绝规则", () => {
  it.each([
    ["文件不是合法 JSON", "not json {", "JSON"],
    ["formatVersion 不支持", JSON.stringify({ formatVersion: 3 }), "formatVersion"],
    ["缺 manifest", JSON.stringify({ formatVersion: 1 }), "manifest"],
    ["id 含大写", validSkin({ id: "MySkin" }), "id"],
    ["id 含路径穿越", validSkin({ id: "../evil" }), "id"],
    ["id 连续点", validSkin({ id: "a..b" }), "id"],
    ["id 首字符为点", validSkin({ id: ".hidden" }), "id"],
    ["name 为空", validSkin({ name: "  " }), "name"],
    ["version 非 semver", validSkin({ version: "1.0" }), "version"],
    ["author 缺失", validSkin({ author: undefined }), "author"],
    ["modes 空数组", validSkin({ modes: [] }), "modes"],
    ["modes 非法值", validSkin({ modes: ["lite"] }), "modes"],
    ["seedColor 非布尔", validSkin({ seedColor: "yes" }), "seedColor"],
    ["accent 非颜色", validSkin({ accent: "url(http://x)" }), "accent"],
  ])("拒绝：%s", (_label, raw, keyword) => {
    const v = validateSkin(raw);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
    expect(v.errors.join("\n")).toContain(keyword);
  });

  it("minAppVersion 高于当前应用版本时拒绝", () => {
    const v = validateSkin(validSkin({ minAppVersion: "99.0.0" }), {
      appVersion: "1.1.0",
    });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toContain("99.0.0");
  });

  it("tokens 键不在白名单", () => {
    const doc = JSON.parse(validSkin());
    doc.tokens.light = { "--am-ease-lyric": "1s", "--lm-made-up-token": "8px" };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("--am-ease-lyric");
    expect(v.errors.join("\n")).toContain("--lm-made-up-token");
  });

  it("v1 格式使用布局令牌拒收（仅 v2 开放）", () => {
    const doc = JSON.parse(validSkin());
    doc.tokens.light = { "--lm-nav-width": "104px" };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("仅 v2 格式支持");
  });

  it("scrim 不在白名单（半透明蒙层保护）", () => {
    const doc = JSON.parse(validSkin());
    doc.tokens.light = { "--md-sys-color-scrim": "#000000" };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
  });

  it("颜色值非法", () => {
    const doc = JSON.parse(validSkin());
    doc.tokens.light = { "--md-sys-color-primary": "javascript:alert(1)" };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
  });

  it("形状令牌非长度值", () => {
    const doc = JSON.parse(validSkin());
    doc.tokens.light = { "--md-sys-shape-corner-medium": "12" };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
  });

  it("时长令牌非 ms", () => {
    const doc = JSON.parse(validSkin());
    doc.tokens.light = { "--md-sys-motion-duration-short": "0.2s" };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
  });

  it("缓动令牌非法曲线", () => {
    const doc = JSON.parse(validSkin());
    doc.tokens.light = { "--md-sys-motion-spring": "cubic-bezier(a, b, c, d)" };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
  });

  it("合法缓动曲线通过", () => {
    const doc = JSON.parse(validSkin());
    doc.tokens.light = { "--md-sys-motion-spring": "cubic-bezier(0.34, 1.56, 0.64, 1)" };
    expect(validateSkin(doc).ok).toBe(true);
  });

  it("css 超过大小上限拒绝", () => {
    const doc = JSON.parse(validSkin());
    delete doc.tokens;
    doc.css = "a{color:red}".repeat(Math.ceil((SKIN_CSS_LIMIT + 10) / "a{color:red}".length));
    expect(doc.css.length).toBeGreaterThan(SKIN_CSS_LIMIT);
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("上限");
  });

  it("tokens 与 css 均缺失拒绝", () => {
    const doc = JSON.parse(validSkin());
    delete doc.tokens;
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("至少提供其一");
  });

  it("assets 非 null 拒绝（v1 预留字段）", () => {
    const doc = JSON.parse(validSkin());
    doc.assets = { preview: "x.png" };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("assets");
  });

  it("assets 为 null 通过", () => {
    const doc = JSON.parse(validSkin());
    doc.assets = null;
    expect(validateSkin(doc).ok).toBe(true);
  });
});

describe("validateSkin：远程引用警告（不拦截）", () => {
  const base = () => {
    const doc = JSON.parse(validSkin());
    delete doc.tokens;
    return doc;
  };

  it("url() 与 @import 均被检出并去重", () => {
    const doc = base();
    doc.css =
      '.a { background: url("https://evil.example/bg.png"); } ' +
      ".b { background: url('https://evil.example/bg.png'); } " +
      '@import url(https://cdn.example/lib.css); ' +
      ".c { background: url(data:image/png;base64,AAAA); }";
    const v = validateSkin(doc);
    expect(v.ok).toBe(true);
    expect(v.warnings).toHaveLength(1);
    const refs = v.warnings[0]!.refs;
    expect(refs).toContain("https://evil.example/bg.png");
    expect(refs).toContain("https://cdn.example/lib.css");
    expect(refs).toHaveLength(2); // 去重 + data URI 不算
  });

  it("本地 data URI 不产生警告", () => {
    const doc = base();
    doc.css = '.a { background: url(data:image/svg+xml;base64,AAAA); }';
    const v = validateSkin(doc);
    expect(v.ok).toBe(true);
    expect(v.warnings).toHaveLength(0);
  });
});

describe("compareVersions", () => {
  it("基本比较", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });
});

describe("validateSkin v2：布局令牌范围", () => {
  const mk = (token: string, value: string) => {
    const doc = validV2Skin() as { tokens: { light: Record<string, string> } };
    doc.tokens.light[token] = value;
    return doc;
  };
  it.each([
    ["--lm-nav-width", "104px", true],
    ["--lm-nav-width", "40px", false],
    ["--lm-nav-width", "300px", false],
    ["--lm-content-pad", "0px", true],
    ["--lm-content-pad", "65px", false],
    ["--lm-surface-blur", "48px", true],
    ["--lm-surface-blur", "48.01px", false],
    ["--lm-titlebar-height", "32px", true],
    ["--lm-miniplayer-height", "48px", true],
  ])("%s=%s → %s", (token, value, ok) => {
    expect(validateSkin(mk(token, value)).ok).toBe(ok);
  });
  it("越界错误文案带允许区间", () => {
    const v = validateSkin(mk("--lm-nav-width", "300px"));
    expect(v.errors.join("\n")).toContain("56–240px");
  });
});

describe("validateSkin v2：background", () => {
  it("合法配置通过并带默认值", () => {
    const v = validateSkin(
      validV2Skin({
        background: { light: { image: "assets/bg.png" } },
      }),
      { files: ["assets/bg.png"] },
    );
    expect(v.ok).toBe(true);
    expect(v.skin?.background?.light?.overlay).toBe(0.3);
    expect(v.skin?.background?.light?.size).toBe("cover");
  });
  it("引用包内不存在的文件拒收", () => {
    const v = validateSkin(
      validV2Skin({ background: { light: { image: "assets/none.png" } } }),
      { files: ["assets/bg.png"] },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("不在皮肤包内");
  });
  it("远程背景图进入警告清单", () => {
    const v = validateSkin(
      validV2Skin({ background: { dark: { image: "https://cdn.example/dark.jpg" } } }),
    );
    expect(v.ok).toBe(true);
    expect(v.warnings[0]?.refs).toContain("https://cdn.example/dark.jpg");
  });
  it("overlay 越界拒收", () => {
    const v = validateSkin(
      validV2Skin({ background: { light: { image: "assets/bg.png", overlay: 1.5 } } }),
      { files: ["assets/bg.png"] },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("overlay");
  });
  it("v1 格式携带 background 拒收（需 formatVersion 2）", () => {
    const doc = JSON.parse(validSkin());
    doc.background = { light: { image: "assets/bg.png" } };
    const v = validateSkin(doc);
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("formatVersion");
  });
});

describe("validateSkin v2：icons", () => {
  it("svg 模式：清单内合法图标通过", () => {
    const v = validateSkin(
      validV2Skin({ icons: { mode: "svg", svg: { dir: "assets/icons" } } }),
      { files: SAKURA_FILES },
    );
    expect(v.ok).toBe(true);
  });
  it("svg 模式：目录无 svg 拒收", () => {
    const v = validateSkin(
      validV2Skin({ icons: { mode: "svg", svg: { dir: "assets/icons" } } }),
      { files: ["assets/bg.png"] },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("没有 .svg");
  });
  it("svg 模式：非法图标文件名拒收", () => {
    const v = validateSkin(
      validV2Skin({ icons: { mode: "svg", svg: { dir: "assets/icons" } } }),
      { files: ["assets/icons/Home Icon.svg"] },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("文件名");
  });
  it("font 模式：非字体扩展名拒收", () => {
    const v = validateSkin(
      validV2Skin({ icons: { mode: "font", font: { file: "assets/icons.png" } } }),
      { files: ["assets/icons.png"] },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toContain("woff2");
  });
  it("font 模式：远程字体进入警告清单", () => {
    const v = validateSkin(
      validV2Skin({
        icons: { mode: "font", font: { file: "https://cdn.example/icons.woff2" } },
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.warnings[0]?.refs).toContain("https://cdn.example/icons.woff2");
  });
});

describe("example 皮肤源文件", () => {
  it("v1 四款保持通过（回归）", () => {
    for (const id of ["lumiluna.mono-ink", "lumiluna.roundify", "lumiluna.midnight", "lumiluna.md1"]) {
      const raw = readFileSync(resolve(EXAMPLE_DIR, `${id}.json`), "utf-8");
      const v = validateSkin(raw);
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });
  it("sakura（v2）源文件按包清单校验通过", () => {
    const raw = readFileSync(resolve(EXAMPLE_SAKURA, "skin.json"), "utf-8");
    const v = validateSkin(raw, { files: SAKURA_FILES });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.skin?.formatVersion).toBe(2);
    expect(v.skin?.icons?.mode).toBe("svg");
    expect(v.skin?.background?.light?.image).toBe("assets/bg.png");
  });
});

describe("example 皮肤源文件", () => {
  it("v1 四款保持通过（回归）", () => {
    for (const id of ["lumiluna.mono-ink", "lumiluna.roundify", "lumiluna.midnight", "lumiluna.md1"]) {
      const raw = readFileSync(resolve(EXAMPLE_DIR, `${id}.json`), "utf-8");
      const v = validateSkin(raw);
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });
  it("sakura（v2）源文件按包清单校验通过", () => {
    const raw = readFileSync(resolve(EXAMPLE_SAKURA, "skin.json"), "utf-8");
    const v = validateSkin(raw, { files: SAKURA_FILES });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.skin?.formatVersion).toBe(2);
    expect(v.skin?.icons?.mode).toBe("svg");
    expect(v.skin?.background?.light?.image).toBe("assets/bg.png");
  });
});
