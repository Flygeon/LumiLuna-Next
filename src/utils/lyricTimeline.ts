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

/** 分词：CJK 每字一个单元，连续拉丁字母/数字/撇号/连字符合并为词，空格丢弃 */
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
  const flush = () => {
    if (latin) {
      tokens.push(latin);
      latin = "";
    }
  };
  for (const p of parts) {
    if (/[A-Za-z0-9'’-]/.test(p)) {
      latin += p;
    } else if (/\s/.test(p)) {
      flush();
    } else {
      // CJK 单字或标点
      flush();
      tokens.push(p);
    }
  }
  flush();
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
