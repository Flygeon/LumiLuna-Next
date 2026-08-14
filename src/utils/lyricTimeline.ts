/**
 * 逐字歌词时间轴引擎。
 *
 * Phase 1 只提供「分词 + 比例粗排」：播放即用，零分析零延迟。
 * Phase 2 会把缓存里的精确时间轴 `applyPreciseTimeline` 覆盖上去（无缝替换）。
 *
 * 粗排策略：行 [start, end] 内把 N 个字均分到前 85% 时长，末尾留 ~15% 尾音停顿。
 * 行 end = 下一行 start（末行按字数估算）。纯比例，无音频分析。
 */
import type { LyricLine, WordUnit } from "@shared/types";

/**
 * 分词：CJK 每字一个单元；连续拉丁字母/数字/撇号/连字符合并为词。
 * 空格结束当前词并并入词尾（保留英文词间分隔），渲染时不会被吞掉。
 */
export function tokenizeLyric(text: string): string[] {
  let parts: string[];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    parts = Array.from(seg.segment(text), (s) => s.segment);
  } else {
    // 降级：按码点拆
    parts = Array.from(text);
  }

  const tokens: string[] = [];
  let latin = "";
  const pushToken = (t: string) => {
    if (t) tokens.push(t);
  };
  for (const p of parts) {
    if (/[A-Za-z0-9'’’-]/.test(p)) {
      latin += p;
    } else if (/\s/.test(p)) {
      // 空格结束当前词；空格并入词尾，避免逐字渲染时词与词粘连
      if (latin) {
        latin += p;
        pushToken(latin);
        latin = "";
      } else if (tokens.length) {
        tokens[tokens.length - 1] += p;
      }
    } else {
      // CJK 单字或标点
      if (latin) {
        pushToken(latin);
        latin = "";
      }
      pushToken(p);
    }
  }
  pushToken(latin);
  return tokens;
}

/** 行内按字数比例生成粗略时间轴；end 为下一行 start */
export function buildRoughUnits(text: string, start: number, end: number): WordUnit[] {
  const tokens = tokenizeLyric(text);
  if (!tokens.length) return [];
  const total = Math.max(0.05, end - start); // 至少 50ms，防除零
  const sung = total * 0.85; // 末尾 ~15% 尾音停顿
  const step = Math.max(0.03, sung / tokens.length);
  return tokens.map((w, i) => ({
    text: w,
    start: start + i * step,
    end: i === tokens.length - 1 ? start + sung : start + (i + 1) * step,
  }));
}

/** 末行无下一行时按字数估算时长 */
function estimateLineEnd(text: string): number {
  return Math.max(2, text.length * 0.4);
}

/**
 * 为已排序的歌词行逐行附加粗排 units（就地修改）。
 * Phase 2 精确时间轴命中时，会用缓存结果覆盖这里的 units。
 */
export function attachRoughTimeline(lines: LyricLine[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextStart = lines[i + 1]?.time ?? line.time + estimateLineEnd(line.text);
    line.units = buildRoughUnits(line.text, line.time, nextStart);
  }
}

// ---- 前奏 / 间奏识别 ----

/** 纯停顿超过此秒数视为间奏，插入三点等待 */
const INSTRUMENTAL_THRESHOLD = 3.0;
/** 作词/作曲/编曲等元数据行（前奏信息，隐藏原文替换为三点） */
export const META_RE = /^\s*(作词|作曲|编曲|制作人|出品人|OP|SP|监制|混音|录音|和声|母带|编曲人|制作|出品)\s*[:：]/;

/**
 * 行演唱时长估算：只把「真实演唱字符」（汉字/假名/字母/数字）按 0.3s 计，
 * 标点与空格几乎不占演唱时长，按 0.05s 计。
 * 否则感叹式短句（标点密集）会被高估演唱时长，间奏被吞进歌词时长里。
 */
function singingEstimate(text: string): number {
  let sung = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) sung++;
    else other++;
  }
  return Math.max(1.2, sung * 0.3 + other * 0.05);
}

/** 生成「三点」标记行：三个实心点逐字填充 */
function makeDotsLine(start: number, end: number): LyricLine {
  const duration = Math.max(0.3, end - start);
  const step = duration / 3;
  return {
    time: start,
    text: "•••",
    instrumental: true,
    units: [0, 1, 2].map((i) => ({
      text: "•",
      start: start + i * step,
      end: start + (i + 1) * step,
    })),
  };
}

/**
 * 构建最终歌词序列：
 * - detectInstrumental=false：保留作词/作曲/编曲原文、不插点，仅附粗排 units
 * - detectInstrumental=true：隐藏元数据为前奏三点；长纯停顿插入间奏三点
 */
export function buildLyricSequence(rawLines: LyricLine[], detectInstrumental = true): LyricLine[] {
  if (!detectInstrumental) {
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];
      const nextStart = rawLines[i + 1]?.time ?? l.time + estimateLineEnd(l.text);
      l.units = buildRoughUnits(l.text, l.time, nextStart);
    }
    return rawLines;
  }

  const meta: LyricLine[] = [];
  const lyrics: LyricLine[] = [];
  for (const l of rawLines) {
    if (META_RE.test(l.text)) meta.push(l);
    else lyrics.push(l);
  }
  if (!lyrics.length) return rawLines;

  const out: LyricLine[] = [];
  // 前奏：元数据块起点（或无元数据时 0）到首行真实歌词，超过 1s 显示三点
  const introStart = meta.length ? meta[0].time : 0;
  if (lyrics[0].time - introStart >= 1.0) {
    out.push(makeDotsLine(introStart, lyrics[0].time));
  }

  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    const next = lyrics[i + 1];
    const end = next ? next.time : line.time + Math.max(2, line.text.length * 0.4);
    const gap = end - line.time;
    // 行演唱时长 = 估算值（不超行距）；纯停顿 = 行距 - 演唱
    const sing = Math.min(gap, singingEstimate(line.text));
    const pause = Math.max(0, gap - sing);
    line.units = buildRoughUnits(line.text, line.time, line.time + sing);
    out.push(line);
    // 纯停顿较长 → 间奏三点（跳过原歌词行的普通行距）
    if (next && pause >= INSTRUMENTAL_THRESHOLD) {
      out.push(makeDotsLine(line.time + sing, next.time));
    }
  }
  return out;
}

// ---- LRC 解析（从 player.ts 移入，供歌词源复用）----

/**
 * 双语 LRC 解析器
 * 支持格式：
 * 1. 同时间戳双行（如网易云/QQ音乐双语歌词）
 *    [00:12.34]Hello World
 *    [00:12.34]你好世界
 * 2. [tr:翻译] 标签
 *    [00:12.34]Hello World [tr:你好世界]
 * 3. 同行尾部括号译文（meting 歌词常见格式）
 *    [00:12.34]鉄の弾が (铁铸的子弹)
 * 4. 单语歌词（向后兼容）
 */
const LRC_TIME_RE = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
const LRC_TR_RE = /\[tr:(.*?)\]/g;

export function parseLrc(text: string, detectInstrumental = true): LyricLine[] {
  const lines = text.trim().split("\n");
  const map = new Map<number, LyricLine>();

  for (const line of lines) {
    // 提取所有时间戳
    const times: number[] = [];
    let m: RegExpExecArray | null;
    LRC_TIME_RE.lastIndex = 0;
    while ((m = LRC_TIME_RE.exec(line)) !== null) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3], 10) : 0;
      times.push(minutes * 60 + seconds + ms / 1000);
    }
    if (times.length === 0) continue;

    // 提取翻译标签 [tr:xxx]
    let translation = "";
    LRC_TR_RE.lastIndex = 0;
    const trMatch = LRC_TR_RE.exec(line);
    if (trMatch) {
      translation = trMatch[1].trim();
    }

    // 移除所有时间戳和翻译标签，得到歌词文本
    let content = line
      .replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, "")
      .replace(/\[tr:.*?\]/g, "")
      .replace(/\[lang:.*?\]/g, "")
      .replace(/\[ar:.*?\]/g, "")
      .replace(/\[ti:.*?\]/g, "")
      .replace(/\[al:.*?\]/g, "")
      .replace(/\[by:.*?\]/g, "")
      .trim();

    if (!content) continue;

    // 同行尾部括号译文：如 "原文 (译文)" / "原文 （译文）"（meting 歌词常见格式）
    if (!translation) {
      const m = content.match(/\s*[（(]([^（）()]*)[）)]\s*$/);
      if (m && content.slice(0, content.length - m[0].length).trim()) {
        translation = m[1].trim();
        content = content.slice(0, content.length - m[0].length).trim();
      }
    }

    if (!content) continue;

    for (const time of times) {
      const key = Math.round(time * 1000); // 精确到毫秒
      const existing = map.get(key);
      if (existing) {
        // 同一时间戳的第二行作为翻译
        if (translation) {
          existing.translation = translation;
        } else if (!existing.translation) {
          existing.translation = content;
        }
      } else {
        map.set(key, { time, text: content, translation: translation || undefined });
      }
    }
  }

  const sorted = Array.from(map.values()).sort((a, b) => a.time - b.time);
  // 前奏/间奏识别（隐藏作词/作曲/编曲，插入三点）+ 逐字粗排时间轴
  return buildLyricSequence(sorted, detectInstrumental);
}
