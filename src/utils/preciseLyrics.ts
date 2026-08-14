/**
 * 「更精确的逐字歌词」匹配编排。
 *
 * 流程：QQ 音乐搜索歌曲名 → 过滤「同名 + 时长差 ≤ ±1 秒」→ 按时长差升序取前 N 个候选
 * → 逐个拉取 QRC 歌词：优先返回含逐字数据的候选；全无逐字则回退第一个成功者。
 *
 * 结果进程内缓存：成功 1h / 失败 10min，避免重复播放同一首歌反复请求网络。
 */
import { qqSearchSongs, qqFetchLyrics, type QqSongInfo } from "./qqMusic";
import { hasWordLevel } from "./qrc";
import type { LyricLine } from "@shared/types";

/** 时长匹配容差：±1 秒 */
const DURATION_TOLERANCE_MS = 1000;
/** 最多尝试的候选数 */
const MAX_CANDIDATES = 5;

const OK_TTL = 60 * 60 * 1000;
const FAIL_TTL = 10 * 60 * 1000;
const resultCache = new Map<string, { t: number; lines: LyricLine[] | null }>();

/** 标题归一化：trim + 小写 + 全角→半角 + 空白折叠 */
function normalizeTitle(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[\uFF01-\uFF5E]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s+/g, " ");
}

export interface PreciseLyricsOptions {
  /** 播放歌曲标题（必填；缺失直接跳过） */
  title: string;
  /** 播放歌曲时长（毫秒；缺失直接跳过，时长匹配依赖它） */
  durationMs?: number;
  artist?: string;
}

/**
 * 按「同名 + 时长差 ≤ 1s」从 QQ 音乐取逐字歌词。
 * 任何失败（无网络 / 无匹配 / 无歌词）都返回 null，调用方静默回退。
 */
export async function fetchPreciseQqLyrics(
  opts: PreciseLyricsOptions,
): Promise<LyricLine[] | null> {
  const title = (opts.title ?? "").trim();
  if (!title || !opts.durationMs || !Number.isFinite(opts.durationMs)) {
    return null;
  }
  const key = `${normalizeTitle(title)}|${Math.round(opts.durationMs)}`;
  const cached = resultCache.get(key);
  if (cached) {
    const ttl = cached.lines ? OK_TTL : FAIL_TTL;
    if (Date.now() - cached.t < ttl) return cached.lines;
    resultCache.delete(key);
  }

  let candidates: QqSongInfo[];
  try {
    candidates = await qqSearchSongs(title);
  } catch (e) {
    console.warn("[逐字歌词] QQ 搜索失败:", e instanceof Error ? e.message : e);
    resultCache.set(key, { t: Date.now(), lines: null });
    return null;
  }

  const titleNorm = normalizeTitle(title);
  candidates = candidates
    .filter((c) => normalizeTitle(c.title) === titleNorm)
    .filter(
      (c) =>
        Math.abs((c.durationMs || 0) - opts.durationMs!) <= DURATION_TOLERANCE_MS,
    )
    .sort(
      (a, b) =>
        Math.abs((a.durationMs || 0) - opts.durationMs!) -
        Math.abs((b.durationMs || 0) - opts.durationMs!),
    )
    .slice(0, MAX_CANDIDATES);

  let firstLineLevel: LyricLine[] | null = null;
  for (const c of candidates) {
    let lines: LyricLine[] | null = null;
    try {
      lines = await qqFetchLyrics(c);
    } catch {
      continue; // 单候选失败不影响其它候选
    }
    if (!lines?.length) continue;
    if (hasWordLevel(lines)) {
      resultCache.set(key, { t: Date.now(), lines });
      return lines;
    }
    // 记录第一个仅有逐行时间轴的结果（行时间仍比本地估算准）
    firstLineLevel ??= lines;
  }
  resultCache.set(key, { t: Date.now(), lines: firstLineLevel });
  return firstLineLevel;
}
