/**
 * 取流前端侧：播放页 HTML → 真实视频 URL 的静态快速路径。
 *
 * 顺序（命中即停）：
 * 1. 规则声明的 streamRegex（正则，取首个捕获组或全匹配）
 * 2. 规则声明的 streamJsonPath（页面内嵌 JSON 里指向播放地址的字段）
 * 3. 通用 m3u8 直链正则
 * 4. 通用 mp4/flv 直链正则
 *
 * 未命中时调用方走 Rust `anime_webview_resolve` 兜底。
 */
import type { AnimeRule } from "@shared/types";
import { readFirstJsonPath, validateJsonPath } from "./animeJsonPath";

export type StaticStreamMethod =
  | "regex"
  | "jsonpath"
  | "generic-m3u8"
  | "generic-mp4";

export interface StaticStreamHit {
  url: string;
  method: StaticStreamMethod;
}

const M3U8_RE = /(?:https?:)?\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/g;
const MP4_RE = /(?:https?:)?\/\/[^"'\s<>\\]+\.(?:mp4|flv)(?:\?[^"'\s<>\\]*)?/gi;

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

export function extractStaticStream(
  html: string,
  rule: AnimeRule,
  baseUrl: string,
): StaticStreamHit | null {
  // 1. 规则正则
  if (rule.streamRegex) {
    try {
      const re = new RegExp(rule.streamRegex, "g");
      const m = re.exec(html);
      if (m) {
        const url = resolveMediaUrl(firstGroupOrMatch(m), baseUrl);
        if (url) return { url, method: "regex" };
      }
    } catch {
      /* 非法正则，落到后续路径 */
    }
  }
  // 2. 规则 JSONPath
  if (rule.streamJsonPath) {
    try {
      validateJsonPath(rule.streamJsonPath);
      const doc = extractEmbeddedJson(html);
      if (doc !== null) {
        const value = readFirstJsonPath(doc, rule.streamJsonPath);
        if (value !== null && value !== undefined) {
          const url = resolveMediaUrl(String(value), baseUrl);
          if (url) return { url, method: "jsonpath" };
        }
      }
    } catch {
      /* 忽略，走通用正则 */
    }
  }
  // 3. 通用 m3u8（用 String.match 而非 exec：模块级 /g 正则的 lastIndex 在多次
  //    exec 间不重置，跨调用会跳过命中，match 则每次自动清零）
  const m3u8 = html.match(M3U8_RE);
  if (m3u8 && m3u8.length) {
    const url = resolveMediaUrl(m3u8[0], baseUrl);
    if (url) return { url, method: "generic-m3u8" };
  }
  // 4. 通用 mp4/flv
  const mp4 = html.match(MP4_RE);
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
