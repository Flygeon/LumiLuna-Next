/**
 * 皮肤运行时桥：终端布局能力位（App.vue 据此隐藏侧栏、落地 /home）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { activeSkinDoc, skinSafeMode, skinTerminalLayout } from "../skinRuntime";
import { validateSkin, type SkinDocument } from "../skinSchema";

function skinWith(layout?: string): SkinDocument {
  const v = validateSkin(
    JSON.stringify({
      formatVersion: 1,
      manifest: {
        id: "com.example.skin",
        name: "测试皮肤",
        version: "1.0.0",
        author: "tester",
        modes: ["light", "dark"],
        ...(layout === undefined ? {} : { layout }),
      },
      tokens: { light: { "--md-sys-color-primary": "#112233" } },
    }),
  );
  if (!v.skin) throw new Error(v.errors.join("；"));
  return v.skin;
}

beforeEach(() => {
  activeSkinDoc.value = null;
  skinSafeMode.value = false;
});

describe("skinTerminalLayout", () => {
  it("默认皮肤（无激活皮肤）为假", () => {
    expect(skinTerminalLayout.value).toBe(false);
  });

  it("未声明 layout 的皮肤为假", () => {
    activeSkinDoc.value = skinWith();
    expect(skinTerminalLayout.value).toBe(false);
  });

  it('layout:"terminal" 为真', () => {
    activeSkinDoc.value = skinWith("terminal");
    expect(skinTerminalLayout.value).toBe(true);
  });

  it("安全模式下强制为假（皮肤整体不生效）", () => {
    activeSkinDoc.value = skinWith("terminal");
    skinSafeMode.value = true;
    expect(skinTerminalLayout.value).toBe(false);
  });
});
