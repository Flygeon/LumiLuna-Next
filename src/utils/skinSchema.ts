/**
 * 皮肤文件格式 v1 的类型定义与导入校验器。
 * 设计决策见 doc/皮肤系统开发方案书.md §4：严格校验拒绝，错误信息面向用户；
 * 远程引用只警告不拦截（§2 D5）。
 */

export type SkinMode = "light" | "dark";

/** 皮肤清单：作者与适配能力声明 */
export interface SkinManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  minAppVersion?: string;
  modes: SkinMode[];
  /** 一行开关：true 时设置里的种子色配色方案对该皮肤可用（§2 D3，默认关） */
  seedColor: boolean;
  /** 列表缩略圆点展示色（仅展示用） */
  accent?: string;
}

/** 皮肤文档（校验通过后的规范化形态） */
export interface SkinDocument {
  formatVersion: number;
  manifest: SkinManifest;
  tokens?: { light?: Record<string, string>; dark?: Record<string, string> };
  css?: string;
}

export interface SkinWarning {
  kind: "remote-ref";
  refs: string[];
}

export interface SkinValidation {
  ok: boolean;
  errors: string[];
  warnings: SkinWarning[];
  skin?: SkinDocument;
}

/** ---- 结构化令牌白名单（§4.3）：与 tokens/theme.css 保持同步 ---- */

const COLOR_TOKENS = new Set([
  "--md-sys-color-primary",
  "--md-sys-color-on-primary",
  "--md-sys-color-primary-container",
  "--md-sys-color-on-primary-container",
  "--md-sys-color-secondary",
  "--md-sys-color-on-secondary",
  "--md-sys-color-secondary-container",
  "--md-sys-color-on-secondary-container",
  "--md-sys-color-tertiary",
  "--md-sys-color-on-tertiary",
  "--md-sys-color-tertiary-container",
  "--md-sys-color-on-tertiary-container",
  "--md-sys-color-error",
  "--md-sys-color-on-error",
  "--md-sys-color-error-container",
  "--md-sys-color-on-error-container",
  "--md-sys-color-surface",
  "--md-sys-color-on-surface",
  "--md-sys-color-surface-dim",
  "--md-sys-color-surface-bright",
  "--md-sys-color-surface-container-lowest",
  "--md-sys-color-surface-container-low",
  "--md-sys-color-surface-container",
  "--md-sys-color-surface-container-high",
  "--md-sys-color-surface-container-highest",
  "--md-sys-color-on-surface-variant",
  "--md-sys-color-outline",
  "--md-sys-color-outline-variant",
  "--md-sys-color-inverse-surface",
  "--md-sys-color-inverse-on-surface",
  "--md-sys-color-inverse-primary",
  "--md-sys-color-on-background",
  "--md-sys-color-background",
  // scrim 故意不在白名单：半透明蒙层不能被不透明色顶掉（同 dynamicTheme.ts 的取舍）
  "--lm-scrim-surface",
  "--lm-hairline",
]);

const LENGTH_TOKENS = new Set([
  "--md-sys-shape-corner-none",
  "--md-sys-shape-corner-extra-small",
  "--md-sys-shape-corner-small",
  "--md-sys-shape-corner-medium",
  "--md-sys-shape-corner-large",
  "--md-sys-shape-corner-extra-large",
]);

const DURATION_TOKENS = new Set([
  "--md-sys-motion-duration-short",
  "--md-sys-motion-duration-medium",
  "--md-sys-motion-duration-long",
]);

const EASING_TOKENS = new Set([
  "--md-sys-motion-easing-standard",
  "--md-sys-motion-easing-emphasized",
  "--md-sys-motion-easing-emphasized-decelerate",
  "--md-sys-motion-spring",
  "--md-sys-motion-spring-soft",
]);

const ELEVATION_TOKENS = new Set([
  "--md-elevation-1",
  "--md-elevation-2",
  "--md-elevation-3",
]);

/** CSS 上限（§11.3）：单个皮肤 256 KB */
export const SKIN_CSS_LIMIT = 256 * 1024;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}(\.[a-z0-9-][a-z0-9-]{0,62})*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const COLOR_VALUE_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([^(){};]{1,60}\)|hsla?\([^(){};]{1,60}\)|oklch\([^(){};]{1,60}\)|transparent)$/;
const LENGTH_VALUE_RE = /^\d+(px|%)$/;
const DURATION_VALUE_RE = /^\d+ms$/;
const EASING_VALUE_RE =
  /^(linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\(-?[\d.]+,\s*-?[\d.]+,\s*-?[\d.]+,\s*-?[\d.]+\))$/;
const ELEVATION_VALUE_RE = /^[0-9a-zA-Z .,%()-]{1,96}$/;

function checkTokenValue(token: string, value: string): string | null {
  if (value.length > 64) return "值长度超过 64 字符";
  if (COLOR_TOKENS.has(token)) {
    return COLOR_VALUE_RE.test(value.trim()) ? null : "不是合法的 CSS 颜色（支持 #hex / rgb() / hsl() / oklch()）";
  }
  if (LENGTH_TOKENS.has(token)) {
    return LENGTH_VALUE_RE.test(value.trim()) ? null : "应为 px 或 % 长度值（如 12px）";
  }
  if (DURATION_TOKENS.has(token)) {
    return DURATION_VALUE_RE.test(value.trim()) ? null : "应为毫秒时长（如 200ms）";
  }
  if (EASING_TOKENS.has(token)) {
    return EASING_VALUE_RE.test(value.trim()) ? null : "应为缓动关键字或 cubic-bezier(...) 曲线";
  }
  if (ELEVATION_TOKENS.has(token)) {
    return ELEVATION_VALUE_RE.test(value) ? null : "包含非法字符";
  }
  return "不在令牌白名单内";
}

/** 检出 css 中的远程引用（@import / url() 指向 http(s)），宁误报不漏报 */
function findRemoteRefs(css: string): string[] {
  const refs = new Set<string>();
  const re = /(?:@import\s+(?:url\(\s*)?|url\(\s*)['"]?(https?:\/\/[^'")\s;]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) refs.add(m[1]);
  return [...refs];
}

/** 语义化版本比较：a < b 返回 -1，相等 0，a > b 返回 1；非法输入按 0 处理 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[+]/)[0].split(".");
  const pb = b.replace(/^v/, "").split(/[+]/)[0].split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/**
 * 校验一份皮肤（接受文件原文或已解析对象），返回规范化文档。
 * opts.appVersion 用于 minAppVersion 门槛校验。
 */
export function validateSkin(
  raw: unknown,
  opts?: { appVersion?: string },
): SkinValidation {
  const errors: string[] = [];

  // ---- 解析 ----
  let doc: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, errors: ["文件不是合法的 JSON"], warnings: [] };
    }
  } else if (raw && typeof raw === "object") {
    doc = raw as Record<string, unknown>;
  } else {
    return { ok: false, errors: ["皮肤内容为空"], warnings: [] };
  }

  // ---- formatVersion ----
  const formatVersion = doc.formatVersion;
  if (formatVersion !== 1) {
    return {
      ok: false,
      errors: [`formatVersion 不受支持（当前支持 1，收到 ${String(formatVersion)}），请更新应用或使用 v1 格式皮肤`],
      warnings: [],
    };
  }

  // ---- manifest ----
  const manifestRaw = doc.manifest;
  if (!manifestRaw || typeof manifestRaw !== "object" || Array.isArray(manifestRaw)) {
    return { ok: false, errors: ["缺少 manifest 或它不是对象"], warnings: [] };
  }
  const m = manifestRaw as Record<string, unknown>;

  const id = typeof m.id === "string" ? m.id.trim() : "";
  if (!ID_RE.test(id) || id.length > 64) {
    errors.push("manifest.id：应为小写字母/数字/连字符（可点分）、2–64 字符，且作为存储目录名必须无路径字符");
  }

  const name = typeof m.name === "string" ? m.name.trim() : "";
  if (name.length < 1 || name.length > 32) {
    errors.push("manifest.name：必填，1–32 字符");
  }

  const version = typeof m.version === "string" ? m.version.trim() : "";
  if (!SEMVER_RE.test(version)) {
    errors.push("manifest.version：必填，语义化版本（如 1.0.0）");
  }

  const author = typeof m.author === "string" ? m.author.trim() : "";
  if (author.length < 1 || author.length > 64) {
    errors.push("manifest.author：必填，1–64 字符");
  }

  if (m.description !== undefined) {
    const d = m.description;
    if (typeof d !== "string" || d.length > 200) {
      errors.push("manifest.description：可选，≤200 字符的字符串");
    }
  }

  let minAppVersion: string | undefined;
  if (m.minAppVersion !== undefined && m.minAppVersion !== null) {
    const mv = m.minAppVersion;
    if (typeof mv !== "string" || !SEMVER_RE.test(mv.trim())) {
      errors.push("manifest.minAppVersion：应为语义化版本");
    } else {
      minAppVersion = mv.trim();
      if (opts?.appVersion && compareVersions(opts.appVersion, minAppVersion) < 0) {
        errors.push(`应用版本过低：该皮肤要求 ≥ ${minAppVersion}，当前 ${opts.appVersion}`);
      }
    }
  }

  const modesRaw = m.modes;
  const modes: SkinMode[] = [];
  if (!Array.isArray(modesRaw) || modesRaw.length === 0) {
    errors.push('manifest.modes：必填，{"light","dark"} 的非空子集');
  } else {
    for (const x of modesRaw) {
      if (x !== "light" && x !== "dark") {
        errors.push('manifest.modes：只允许 "light" / "dark"');
        break;
      }
      if (!modes.includes(x)) modes.push(x);
    }
  }

  let seedColor = false;
  if (m.seedColor !== undefined && m.seedColor !== null) {
    if (typeof m.seedColor !== "boolean") {
      errors.push("manifest.seedColor：可选布尔，默认 false");
    } else {
      seedColor = m.seedColor;
    }
  }

  let accent: string | undefined;
  if (m.accent !== undefined && m.accent !== null) {
    const a = m.accent;
    if (typeof a !== "string" || !COLOR_VALUE_RE.test(a.trim())) {
      errors.push("manifest.accent：应为合法 CSS 颜色");
    } else {
      accent = a.trim();
    }
  }

  // ---- assets 预留（v1 必须缺省或 null）----
  if (doc.assets !== undefined && doc.assets !== null) {
    errors.push("assets：v1 格式不接受该字段（为 ZIP 皮肤预留）");
  }

  // ---- tokens ----
  let tokens: SkinDocument["tokens"];
  if (doc.tokens !== undefined && doc.tokens !== null) {
    const t = doc.tokens;
    if (typeof t !== "object" || Array.isArray(t)) {
      errors.push("tokens：应为对象");
    } else {
      tokens = {};
      const tk = t as Record<string, unknown>;
      for (const scope of ["light", "dark"] as const) {
        const setRaw = tk[scope];
        if (setRaw === undefined || setRaw === null) continue;
        if (typeof setRaw !== "object" || Array.isArray(setRaw)) {
          errors.push(`tokens.${scope}：应为对象`);
          continue;
        }
        const set: Record<string, string> = {};
        for (const [key, value] of Object.entries(setRaw as Record<string, unknown>)) {
          if (typeof value !== "string") {
            errors.push(`tokens.${scope}.${key}：值应为字符串`);
            continue;
          }
          const problem =
            !COLOR_TOKENS.has(key) && !LENGTH_TOKENS.has(key) && !DURATION_TOKENS.has(key) &&
            !EASING_TOKENS.has(key) && !ELEVATION_TOKENS.has(key)
              ? "不在令牌白名单内"
              : checkTokenValue(key, value);
          if (problem) errors.push(`tokens.${scope}.${key}：${problem}`);
          else set[key] = value.trim();
        }
        if (Object.keys(set).length) tokens[scope] = set;
      }
    }
  }

  // ---- css ----
  let css: string | undefined;
  if (doc.css !== undefined && doc.css !== null) {
    if (typeof doc.css !== "string") {
      errors.push("css：应为字符串");
    } else {
      if (doc.css.length > SKIN_CSS_LIMIT) {
        errors.push(`css：超过大小上限（${Math.round(SKIN_CSS_LIMIT / 1024)} KB）`);
      } else {
        css = doc.css;
      }
    }
  }
  if (!tokens && !css) {
    errors.push("tokens 与 css 至少提供其一（空皮肤没有意义）");
  }

  if (errors.length) return { ok: false, errors, warnings: [] };

  const skin: SkinDocument = {
    formatVersion: 1,
    manifest: {
      id,
      name,
      version,
      author,
      ...(typeof m.description === "string" && m.description.trim()
        ? { description: m.description.trim() }
        : {}),
      ...(minAppVersion ? { minAppVersion } : {}),
      modes,
      seedColor,
      ...(accent ? { accent } : {}),
    },
    ...(tokens ? { tokens } : {}),
    ...(css ? { css } : {}),
  };

  const warnings: SkinWarning[] = [];
  const refs = css ? findRemoteRefs(css) : [];
  if (refs.length) warnings.push({ kind: "remote-ref", refs });

  return { ok: true, errors: [], warnings, skin };
}
