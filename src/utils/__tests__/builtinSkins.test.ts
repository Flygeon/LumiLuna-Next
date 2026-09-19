/**
 * 内置皮肤回归：src/skins/ 下的皮肤会由 skins store 在首次启动播种进皮肤库，
 * 因此必须始终通过校验器，且不携带远程引用（否则播种/导入会触发知情确认）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateSkin, SKIN_CSS_LIMIT } from "../skinSchema";

const BUILTIN = resolve(__dirname, "../../skins/lumiluna.ak-ui.json");

function loadBuiltin() {
  return validateSkin(readFileSync(BUILTIN, "utf-8"));
}

describe("内置皮肤 lumiluna.ak-ui", () => {
  it("通过校验，且是纯视觉皮肤（不改导航结构）", () => {
    const v = loadBuiltin();
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.skin?.formatVersion).toBe(1);
    expect(v.skin?.manifest.id).toBe("lumiluna.ak-ui");
    expect(v.skin?.manifest.modes).toEqual(["light", "dark"]);
    expect(v.skin?.manifest.seedColor).toBe(false);
    // 皮肤只能影响外观：没有布局能力位，也不引用任何布局钩子属性
    expect(Object.keys(v.skin?.manifest ?? {})).not.toContain("layout");
    expect(v.skin?.css ?? "").not.toContain("data-lm-terminal");
    expect(v.skin?.css ?? "").not.toContain('data-lm-region="nav"');
  });

  it("css 非空、不超限、无远程引用", () => {
    const v = loadBuiltin();
    expect(v.skin?.css).toBeTruthy();
    expect(v.skin!.css!.length).toBeLessThan(SKIN_CSS_LIMIT);
    expect(v.warnings).toEqual([]);
  });

  it("浅深两套都写全了主色/表面/前景/发丝线（令牌不做浅→深继承）", () => {
    const v = loadBuiltin();
    for (const scope of ["light", "dark"] as const) {
      const t = v.skin?.tokens?.[scope] ?? {};
      for (const key of [
        "--md-sys-color-primary",
        "--md-sys-color-surface",
        "--md-sys-color-on-surface",
        "--md-sys-color-outline-variant",
        "--lm-hairline",
      ]) {
        expect(t[key], `${scope}.${key}`).toBeTruthy();
      }
    }
  });

  it("圆角令牌收在 12px 以内（去胶囊 / 去大圆角），但不改 corner-full", () => {
    const v = loadBuiltin();
    const t = v.skin?.tokens?.dark ?? {};
    for (const [key, value] of Object.entries(t)) {
      if (key.startsWith("--md-sys-shape-corner-") && key !== "--md-sys-shape-corner-full") {
        expect(Number.parseFloat(value), key).toBeLessThanOrEqual(12);
      }
    }
    expect(t["--md-sys-shape-corner-full"]).toBeUndefined();
  });
});

/** WCAG 相对亮度 / 对比度（ak-ui 质量清单要求 AA） */
function luminance(color: string): number {
  const s = color.replace("#", "");
  const rgb = [0, 2, 4].map((i) => Number.parseInt(s.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe("内置皮肤 lumiluna.ak-ui 的可访问性", () => {
  const tokens = (mode: "light" | "dark") => loadBuiltin().skin?.tokens?.[mode] ?? {};
  const pairs: Array<[string, string, string]> = [
    ["--md-sys-color-on-surface", "--md-sys-color-surface", "正文/画布"],
    ["--md-sys-color-on-surface-variant", "--md-sys-color-surface-container", "次要文字/容器"],
    ["--md-sys-color-on-primary", "--md-sys-color-primary", "主按钮"],
    ["--md-sys-color-on-tertiary", "--md-sys-color-tertiary", "强调按钮"],
    ["--md-sys-color-on-error", "--md-sys-color-error", "错误态"],
    ["--md-sys-color-on-secondary-container", "--md-sys-color-secondary-container", "选中容器"],
    ["--md-sys-color-on-primary-container", "--md-sys-color-primary-container", "主容器"],
    ["--md-sys-color-on-error-container", "--md-sys-color-error-container", "错误容器"],
  ];

  for (const mode of ["light", "dark"] as const) {
    it(`${mode}：文字对比度全部 ≥ 4.5:1`, () => {
      const t = tokens(mode);
      for (const [fg, bg, label] of pairs) {
        const ratio = contrast(t[fg], t[bg]);
        expect(ratio, `${mode} ${label} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("两种模式 outline 对画布 ≥ 3:1（控件边界可辨识）", () => {
    for (const mode of ["light", "dark"] as const) {
      const t = tokens(mode);
      const ratio = contrast(t["--md-sys-color-outline"], t["--md-sys-color-surface"]);
      expect(ratio, `${mode} outline = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });
});
