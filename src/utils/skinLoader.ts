/**
 * 皮肤加载器：把皮肤文档落到 DOM。
 * 层次（v1 方案书 §3）：theme.css 静态默认 < 皮肤 <style> < 皮肤令牌内联 < 种子色内联。
 * 令牌内联的写入/清除顺序由 settings.resolveTheme 编排（先清种子残留 → 写皮肤 → 再写种子）。
 *
 * v2 增量（v2 方案书 §4/§5）：
 * - css 里的相对 url() 与结构化资产引用统一重写为 asset:// 绝对地址；
 * - 背景图经 CSS 变量驱动（App.vue 的 .lm-skin-bg 消费）；
 * - SVG 图标包：MutationObserver 按图标名打标 + mask 样式注入（mask 只取形状，
 *   图标颜色自动跟随文字色，浅深模式免适配）；
 * - 字体图标包：同名 @font-face 覆盖 + 可选 @import 附加样式。
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import type { SkinBackgroundLayer, SkinDocument } from "./skinSchema";

const STYLE_ID = "lm-skin-css";
const ICON_STYLE_ID = "lm-skin-icons";
const FONT_STYLE_ID = "lm-skin-icons-font";

/** 当前经 applySkin 写入的内联令牌键，切换/卸载时精确清除 */
let appliedTokenKeys: string[] = [];

/** 背景相关 CSS 变量（与 App.vue 的 .lm-skin-bg 约定） */
const BG_VARS = [
  "--lm-skin-bg-image",
  "--lm-skin-bg-size",
  "--lm-skin-bg-position",
  "--lm-skin-bg-overlay",
] as const;

interface ResolvedBackground {
  image: string;
  size: string;
  position: string;
  overlay: number;
}

/** 皮肤激活前的预处理产物（applySkin 是同步调用，重活都在 prepare 完成） */
export interface PreparedSkin {
  css?: string;
  background?: { light?: ResolvedBackground; dark?: ResolvedBackground };
  /** SVG 模式：Material 图标名 → asset URL */
  iconSvgs?: Map<string, string>;
  /** 字体模式：注入的 @font-face / @import 片段 */
  iconFontCss?: string;
}

/** 相对资产引用 → asset:// 绝对地址（http/data 引用原样保留） */
function resolveAssetRef(ref: string, assetBase: string | null): string {
  if (/^(https?:|data:|asset:|blob:)/i.test(ref)) return ref;
  if (!assetBase) return ref;
  const norm = ref.replace(/\\/g, "/").replace(/^\.\//, "");
  return convertFileSrc(`${assetBase}/${norm}`);
}

/** 重写 css 中的相对 url() 引用（嵌套引号、空白变体均处理） */
function rewriteCssUrls(css: string, assetBase: string | null): string {
  if (!assetBase) return css;
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (full, quote: string, ref: string) => {
      const resolved = resolveAssetRef(ref.trim(), assetBase);
      return resolved === ref.trim() ? full : `url(${quote}${resolved}${quote})`;
    },
  );
}

export interface PrepareContext {
  /** 皮肤 id */
  id: string;
  /** skins 库根目录绝对路径（skin_dir 命令） */
  skinsDir: string | null;
  /** 库内资产文件清单（skin_load 的 files） */
  files: string[];
}

/** 预处理皮肤：解析资产引用、重写 css、构建图标清单。在 activate/load 时调用一次。 */
export function prepareSkin(skin: SkinDocument, ctx: PrepareContext): PreparedSkin {
  const assetBase = ctx.skinsDir ? `${ctx.skinsDir.replace(/\\/g, "/")}/${ctx.id}` : null;

  const prepared: PreparedSkin = {};
  if (skin.css) prepared.css = rewriteCssUrls(skin.css, assetBase);

  if (skin.background) {
    const resolve = (l: SkinBackgroundLayer | undefined) =>
      l
        ? {
            image: resolveAssetRef(l.image, assetBase),
            size: l.size ?? "cover",
            position: l.position || "center",
            overlay: l.overlay ?? 0.3,
          }
        : undefined;
    prepared.background = {
      light: resolve(skin.background.light),
      dark: resolve(skin.background.dark),
    };
  }

  if (skin.icons?.mode === "svg" && skin.icons.svg) {
    const dir = skin.icons.svg.dir.replace(/\/+$/, "");
    const map = new Map<string, string>();
    for (const f of ctx.files) {
      const norm = f.replace(/\\/g, "/");
      if (!norm.startsWith(`${dir}/`) || !norm.endsWith(".svg")) continue;
      const name = norm.slice(dir.length + 1, -4);
      if (/^[a-z0-9_]+$/.test(name)) {
        map.set(name, resolveAssetRef(norm, assetBase));
      }
    }
    if (map.size) prepared.iconSvgs = map;
  } else if (skin.icons?.mode === "font" && skin.icons.font) {
    const fileUrl = resolveAssetRef(skin.icons.font.file, assetBase);
    // 同名覆盖内置字体：连字机制与变体轴保持不变
    let css = `@font-face { font-family: "Material Symbols Rounded"; src: url("${fileUrl}") format("woff2"); font-display: block; }`;
    if (skin.icons.font.css) {
      css += `\n@import url("${resolveAssetRef(skin.icons.font.css, assetBase)}");`;
    }
    prepared.iconFontCss = css;
  }

  return prepared;
}

// ---- SVG 图标包运行时（MutationObserver 方案，v2 方案书 D5）----

let iconObserver: MutationObserver | null = null;

function iconNameOf(el: Element): string | null {
  const text = (el.textContent ?? "").trim();
  return text && /^[a-z0-9_]+$/.test(text) ? text : null;
}

/** 给命中的图标元素打标；动态渲染的新节点由 observer 自动补标 */
function markIcons(pack: Map<string, string>): void {
  for (const el of document.querySelectorAll<HTMLElement>(".material-symbols-outlined")) {
    const name = iconNameOf(el);
    if (name && pack.has(name)) el.dataset.lmSkinIcon = name;
  }
}

function ensureIconObserver(pack: Map<string, string>): void {
  if (iconObserver) return;
  iconObserver = new MutationObserver(() => markIcons(pack));
  iconObserver.observe(document.body, { childList: true, subtree: true });
}

function stopIconRuntime(): void {
  iconObserver?.disconnect();
  iconObserver = null;
  document.getElementById(ICON_STYLE_ID)?.remove();
  // 移除历史打标（observer 只负责加，卸载时全量清）
  for (const el of document.querySelectorAll("[data-lm-skin-icon]")) {
    delete (el as HTMLElement).dataset.lmSkinIcon;
  }
}

function startIconRuntime(pack: Map<string, string>): void {
  // mask 只取形状：图标颜色跟随 currentColor，浅深模式自动适配
  let css =
    ".material-symbols-outlined[data-lm-skin-icon] { color: transparent; " +
    "-webkit-mask: center / contain no-repeat; mask: center / contain no-repeat; }";
  for (const [name, url] of pack) {
    css += `\n.material-symbols-outlined[data-lm-skin-icon="${name}"] ` +
      `{ -webkit-mask-image: url("${url}"); mask-image: url("${url}"); }`;
  }
  let styleEl = document.getElementById(ICON_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = ICON_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
  markIcons(pack);
  ensureIconObserver(pack);
}

// ---- 主动应用 ----

let activeIconSvgs: Map<string, string> | null = null;

export function applySkin(
  skin: SkinDocument | null,
  dark: boolean,
  prepared?: PreparedSkin,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // 1. 皮肤 CSS（含 v2 重写后的 url）
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const cssText = prepared?.css ?? skin?.css;
  if (cssText) {
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = cssText;
  } else if (styleEl) {
    styleEl.remove();
  }

  // 2. 结构化令牌（内联；缺失键回落 theme.css 默认值，不做 light→dark 继承）
  for (const key of appliedTokenKeys) root.style.removeProperty(key);
  appliedTokenKeys = [];
  const set = dark ? skin?.tokens?.dark : skin?.tokens?.light;
  if (set) {
    for (const [key, value] of Object.entries(set)) {
      root.style.setProperty(key, value);
      appliedTokenKeys.push(key);
    }
  }

  // 3. 背景（App.vue 的 .lm-skin-bg 消费这些变量；无背景时清空变量隐藏图层）
  const layer = dark ? prepared?.background?.dark : prepared?.background?.light;
  const fallback = dark ? prepared?.background?.light : prepared?.background?.dark;
  const bg = layer ?? fallback;
  if (bg) {
    root.style.setProperty("--lm-skin-bg-image", `url("${bg.image}")`);
    root.style.setProperty("--lm-skin-bg-size", bg.size);
    root.style.setProperty("--lm-skin-bg-position", bg.position);
    // 浅色基白罩 / 深色基黑罩，保证前景可读
    root.style.setProperty(
      "--lm-skin-bg-overlay",
      dark ? `rgba(0, 0, 0, ${bg.overlay})` : `rgba(255, 255, 255, ${bg.overlay})`,
    );
  } else {
    for (const v of BG_VARS) root.style.removeProperty(v);
  }

  // 4. 图标包（先停旧运行时再起新的，保证切换干净）
  stopIconRuntime();
  document.getElementById(FONT_STYLE_ID)?.remove();
  activeIconSvgs = null;
  if (prepared?.iconFontCss) {
    const fontEl = document.createElement("style");
    fontEl.id = FONT_STYLE_ID;
    fontEl.textContent = prepared.iconFontCss;
    document.head.appendChild(fontEl);
  } else if (prepared?.iconSvgs && skin) {
    activeIconSvgs = prepared.iconSvgs;
    startIconRuntime(prepared.iconSvgs);
  }
}

/** 供运行时查询（背景层显隐等） */
export function getActiveIconPack(): Map<string, string> | null {
  return activeIconSvgs;
}
