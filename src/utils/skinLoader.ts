/**
 * 皮肤加载器：把皮肤文档落到 DOM。
 * 层次（方案书 §3）：theme.css 静态默认 < 皮肤 <style> < 皮肤令牌内联 < 种子色内联。
 * 令牌内联的写入/清除顺序由 settings.resolveTheme 编排（先清种子残留 → 写皮肤 → 再写种子）。
 */
import type { SkinDocument } from "./skinSchema";

const STYLE_ID = "lm-skin-css";

/** 当前经 applySkin 写入的内联令牌键，切换/卸载时精确清除 */
let appliedTokenKeys: string[] = [];

export function applySkin(skin: SkinDocument | null, dark: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (skin?.css) {
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = skin.css;
  } else if (styleEl) {
    styleEl.remove();
  }

  for (const key of appliedTokenKeys) root.style.removeProperty(key);
  appliedTokenKeys = [];
  // tokens.light / tokens.dark 两套独立生效（缺失键回落 theme.css 默认值），
  // 不做 light→dark 继承——浅色调拿到深色模式只会更糟
  const set = dark ? skin?.tokens?.dark : skin?.tokens?.light;
  if (set) {
    for (const [key, value] of Object.entries(set)) {
      root.style.setProperty(key, value);
      appliedTokenKeys.push(key);
    }
  }
}
