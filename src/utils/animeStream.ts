/**
 * 取流前端侧：播放页 HTML → 真实视频 URL 的静态快速路径。
 *
 * 顺序（命中即停）：
 * 1. 规则声明的 streamRegex（正则，取首个捕获组或全匹配）
 * 2. 规则声明的 streamJsonPath（页面内嵌 JSON 里指向播放地址的字段）
 * 3. 播放器配置定向提取（苹果CMS 系 `player_aaaa.url`）
 * 4. 通用 m3u8 直链正则
 * 5. 通用 mp4/flv 直链正则
 *
 * 未命中时调用方走 Rust `anime_webview_resolve` 兜底。
 *
 * 关于 JSON 转义：苹果CMS 系站点把播放地址放在内嵌 JSON 里，其中的 `/` 会被
 * 写成 `\/`（`https:\/\/cdn.xxx\/a\/index.m3u8`）。旧版正则的字符集排除了 `\`，
 * 且要求 `https:` 后紧跟 `//`，两头都不满足 → 整类站点静态提取全部落空，
 * 只得掉进不可靠的隐藏 webview。这里统一先做一份「反转义副本」再匹配。
 */
import type { AnimeRule } from "@shared/types";
import { readFirstJsonPath, validateJsonPath } from "./animeJsonPath";

export type StaticStreamMethod =
  | "regex"
  | "jsonpath"
  | "player-config"
  | "generic-m3u8"
  | "generic-mp4";

export interface StaticStreamHit {
  url: string;
  method: StaticStreamMethod;
}

// 允许 `\/`（JSON 转义的斜杠）出现在 URL 里；命中后再统一反转义
const M3U8_RE = /(?:https?:)?\\?\/\\?\/[^"'\s<>]+?\.m3u8[^"'\s<>]*/g;
const MP4_RE = /(?:https?:)?\\?\/\\?\/[^"'\s<>]+?\.(?:mp4|flv)[^"'\s<>]*/gi;

/** 播放地址的样子（用于区分真地址与「云解析」token，如 gugu3 的 vwnet-xxxx） */
const MEDIA_LIKE_RE = /\.(m3u8|mp4|flv)(\?|#|$)/i;

/** JSON 字符串里的 `\/` 还原成 `/`（无可还原内容时直接返回原串，省一次拷贝） */
function unescapeSlashes(s: string): string {
  return s.includes("\\/") ? s.split("\\/").join("/") : s;
}

function resolveMediaUrl(raw: string, baseUrl: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, baseUrl);
    return url.href;
  } catch {
    return trimmed;
  }
}

function firstGroupOrMatch(match: RegExpExecArray): string {
  for (let i = 1; i < match.length; i++) {
    if (match[i]) return match[i];
  }
  return match[0];
}

/** 从页面 HTML 里抠内嵌 JSON（整页 JSON 或 <script> 内容） */
function extractEmbeddedJson(html: string): unknown {
  try {
    return JSON.parse(html);
  } catch {
    /* 整页不是 JSON，继续 */
  }
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const text = m[1].trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object") return parsed;
    } catch {
      /* 不是 JSON，继续下一个 script */
    }
  }
  return null;
}

/**
 * 从 `start` 处（应指向 `{`）按括号配对读出完整 JSON 对象。
 * 不能用 `\{[\s\S]*?\}\s*<\/script>` 这类非贪婪正则：配置里普遍有嵌套对象
 * （`{"vod_data":{...},"url":"..."}`），非贪婪会在第一个 `}` 处截断 → 解析失败。
 */
function readBalancedObject(s: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** 苹果CMS 系播放页内嵌的播放器配置变量名（按常见度排序） */
const PLAYER_CONFIG_VARS = ["player_aaaa", "player_data", "mac_player"];

/**
 * 从配置字段里取出第一个候选地址：
 * - 字段可能是数组（多线路）
 * - 可能是苹果CMS 的多线路串：`第1集$地址$$$第2集$地址`
 */
function firstUrlFromField(value: unknown): string {
  const raw = Array.isArray(value)
    ? String(value[0] ?? "")
    : typeof value === "string"
      ? value
      : "";
  let s = raw.trim();
  if (!s) return "";
  // 多线路用 $$$ 分隔，取第一条；`名称$地址` 形式则丢掉名称前缀
  s = s.split("$$$")[0].trim();
  const dollar = s.indexOf("$");
  if (dollar >= 0) s = s.slice(dollar + 1).trim();
  return s.split("#")[0].trim();
}

/**
 * 定向提取播放器配置里的 `url` 字段。
 * 只在它长得像播放地址时才认——gugu3 这类「云解析」站把 token（vwnet-xxxx）
 * 放在同一字段，真实地址要跑 JS 换，误取会让播放器拿到一个无效 URL，
 * 不如放行给 webview 兜底。
 */
function extractPlayerConfigUrl(flat: string): string | null {
  for (const name of PLAYER_CONFIG_VARS) {
    let from = 0;
    for (;;) {
      const at = flat.indexOf(`${name}=`, from);
      if (at < 0) break;
      from = at + name.length + 1;
      const brace = flat.indexOf("{", at);
      if (brace < 0) continue;
      const raw = readBalancedObject(flat, brace);
      if (!raw) continue;
      try {
        const cfg = JSON.parse(raw) as Record<string, unknown>;
        const candidate = firstUrlFromField(cfg.url);
        if (candidate && MEDIA_LIKE_RE.test(candidate)) return candidate;
      } catch {
        /* 不是合法 JSON，试下一个 */
      }
    }
  }
  return null;
}

export function extractStaticStream(
  html: string,
  rule: AnimeRule,
  baseUrl: string,
): StaticStreamHit | null {
  // 反转义副本：`\/` → `/`。未转义的 URL 不受影响，所以它是原文的超集。
  const flat = unescapeSlashes(html);

  // 1. 规则正则（先原文再反转义副本：规则作者可能按任一种写法给出）
  if (rule.streamRegex) {
    for (const src of [html, flat]) {
      try {
        const re = new RegExp(rule.streamRegex, "g");
        const m = re.exec(src);
        if (m) {
          const url = resolveMediaUrl(firstGroupOrMatch(m), baseUrl);
          if (url) return { url, method: "regex" };
        }
      } catch {
        /* 非法正则，落到后续路径 */
      }
    }
  }
  // 2. 规则 JSONPath（用反转义副本，JSON 里的地址已还原）
  if (rule.streamJsonPath) {
    try {
      validateJsonPath(rule.streamJsonPath);
      const doc = extractEmbeddedJson(flat);
      if (doc !== null) {
        const value = readFirstJsonPath(doc, rule.streamJsonPath);
        if (value !== null && value !== undefined) {
          const url = resolveMediaUrl(String(value), baseUrl);
          if (url) return { url, method: "jsonpath" };
        }
      }
    } catch {
      /* 忽略，走后续路径 */
    }
  }
  // 3. 播放器配置定向提取（比通用正则准，且能区分真地址与云解析 token）
  const cfgUrl = extractPlayerConfigUrl(flat);
  if (cfgUrl) {
    const url = resolveMediaUrl(cfgUrl, baseUrl);
    if (url) return { url, method: "player-config" };
  }
  // 4. 通用 m3u8（用 String.match 而非 exec：模块级 /g 正则的 lastIndex 在多次
  //    exec 间不重置，跨调用会跳过命中，match 则每次自动清零）
  const m3u8 = flat.match(M3U8_RE);
  if (m3u8 && m3u8.length) {
    const url = resolveMediaUrl(m3u8[0], baseUrl);
    if (url) return { url, method: "generic-m3u8" };
  }
  // 5. 通用 mp4/flv
  const mp4 = flat.match(MP4_RE);
  if (mp4 && mp4.length) {
    const url = resolveMediaUrl(mp4[0], baseUrl);
    if (url) return { url, method: "generic-mp4" };
  }
  return null;
}

/** 挑选流：优先 m3u8（能带动画字幕/进度），其次 mp4；URL 去重保持顺序 */
export function pickStream(urls: string[]): string | null {
  const seen = new Set<string>();
  const unique = urls.filter((u) => {
    const k = u.split("#")[0];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const m3u8 = unique.find((u) => u.includes(".m3u8"));
  if (m3u8) return m3u8;
  return unique[0] ?? null;
}
