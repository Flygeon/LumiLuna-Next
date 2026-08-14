/**
 * 酷狗 KRC 逐字歌词：解密 + 解析。
 *
 * 移植自 LDDC（原作者 沉默の金，SPDX-License-Identifier: GPL-3.0-only）：
 *   - LDDC/core/decryptor/__init__.py::krc_decrypt（异或 + zlib）
 *   - LDDC/core/parser/krc.py::krc2mdata
 */
import pako from "pako";
import type { LyricLine, WordUnit } from "@shared/types";

/** KRC 异或密钥：b"@Gaw^2tGQ61-\xce\xd2ni" */
const KRC_KEY = new Uint8Array([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d,
  0xce, 0xd2, 0x6e, 0x69,
]);

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 解密 KRC：base64 → 跳过 4 字节头 → 逐字节异或 → zlib 解压 → UTF-8 明文。
 * （对应 krc_decrypt；download 接口返回的 content 带 4 字节前缀）
 */
export async function krcDecrypt(b64content: string): Promise<string> {
  const encrypted = base64ToBytes(b64content.trim());
  const data = encrypted.subarray(4); // 跳过头部
  const decrypted = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    decrypted[i] = data[i] ^ KRC_KEY[i % KRC_KEY.length];
  }
  const inflated = pako.inflate(decrypted);
  return new TextDecoder("utf-8").decode(inflated);
}

// ---- 解析（移植 krc2mdata）----

const TAG_SPLIT_PATTERN = /^\[(\w+):([^\]]*)\]$/;
const LINE_SPLIT_PATTERN = /^\[(\d+),(\d+)\](.*)$/;
const WORD_SPLIT_PATTERN = /(?:\[\d+,\d+\])?<(\d+),(\d+),\d+>((?:.(?!\d+,\d+,\d+>))*)/g;

/** KRC 行（毫秒时间轴，与 QRC 解析一致的结构） */
export interface KrcLine {
  start: number;
  end: number;
  words: { text: string; start: number; end: number }[];
}

/**
 * 将 KRC 明文解析为 KrcLine[] + 逐行翻译（索引与原文行一一对应，含空行）。
 * 返回 null 表示不是 KRC 格式。
 */
export function krcToRawLines(
  krc: string,
): {
  lines: KrcLine[];
  translations: (string | null)[];
  romaji: (string | null)[];
  tags: Record<string, string>;
} | null {
  const tags: Record<string, string> = {};
  const lines: KrcLine[] = [];

  for (const rawLine of krc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("[")) continue;

    const tagMatch = TAG_SPLIT_PATTERN.exec(line);
    if (tagMatch) {
      tags[tagMatch[1]] = tagMatch[2];
      continue;
    }

    const lineMatch = LINE_SPLIT_PATTERN.exec(line);
    if (lineMatch) {
      const lineStart = parseInt(lineMatch[1], 10);
      const lineDuration = parseInt(lineMatch[2], 10);
      const lineEnd = lineStart + lineDuration;
      const lineContent = lineMatch[3];

      const words: KrcLine["words"] = [];
      WORD_SPLIT_PATTERN.lastIndex = 0;
      let wm: RegExpExecArray | null;
      while ((wm = WORD_SPLIT_PATTERN.exec(lineContent)) !== null) {
        const start = lineStart + parseInt(wm[1], 10); // 相对行首
        const duration = parseInt(wm[2], 10);
        const text = wm[3];
        if (!text) continue;
        words.push({ text, start, end: start + duration });
      }
      if (!words.length) {
        words.push({ text: lineContent, start: lineStart, end: lineEnd });
      }
      lines.push({ start: lineStart, end: lineEnd, words });
    }
  }
  if (!lines.length) return null;

  // [language:] 标签：base64 JSON，type 0 = 逐字罗马音，type 1 = 逐行翻译
  const translations: (string | null)[] = lines.map(() => null);
  const romaji: (string | null)[] = lines.map(() => null);
  const langTag = tags["language"]?.trim();
  if (langTag) {
    try {
      const langData = JSON.parse(new TextDecoder("utf-8").decode(base64ToBytes(langTag))) as {
        content: { type: number; lyricContent: unknown[] }[];
      };
      const ts = langData.content.find((l) => l.type === 1);
      if (ts) {
        lines.forEach((_, i) => {
          const row = ts.lyricContent[i] as string[];
          if (row?.length && typeof row[0] === "string") {
            translations[i] = row[0];
          }
        });
      }
      const roma = langData.content.find((l) => l.type === 0);
      if (roma) {
        // 罗马音按原文行逐字对齐；无内容的行在罗马音字典中不存在（offset 跳过）
        let offset = 0;
        lines.forEach((line, i) => {
          if (line.words.every((w) => !w.text)) {
            offset++;
            return;
          }
          const row = roma.lyricContent[i - offset] as unknown;
          if (Array.isArray(row)) {
            romaji[i] = row.filter((t): t is string => typeof t === "string").join("");
          }
        });
      }
    } catch {
      /* 翻译/罗马音轨解析失败不影响原文 */
    }
  }
  return { lines, translations, romaji, tags };
}

/** KRC 行 → 项目 LyricLine（秒时间轴），空文本行跳过，翻译按索引合并 */
export function krcLinesToLyricLines(
  parsed: {
    lines: KrcLine[];
    translations: (string | null)[];
    romaji: (string | null)[];
  },
): LyricLine[] {
  const out: LyricLine[] = [];
  parsed.lines.forEach((l, i) => {
    const text = l.words.map((w) => w.text).join("");
    if (!text.trim()) return;
    const units: WordUnit[] = l.words.map((w) => ({
      text: w.text,
      start: w.start / 1000,
      end: w.end / 1000,
    }));
    const translation = parsed.translations[i]?.trim() || undefined;
    const romaji = parsed.romaji[i]?.trim() || undefined;
    out.push({ time: l.start / 1000, text, units, translation, romaji });
  });
  return out;
}
