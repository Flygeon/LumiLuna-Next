/**
 * 「更精确的逐字歌词」匹配编排。
 *
 * 流程：QQ 音乐搜索歌曲名 → 过滤「同名 + 时长差 ≤ ±1 秒」→ 按时长差升序取前 N 个候选
 * → 逐个拉取 QRC 歌词：优先返回含逐字数据的候选；全无逐字则回退第一个成功者。
 *
 * 返回结构化结果（PreciseLyricsResult），调用方据此展示来源徽标/回退提示并记录日志。
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
const resultCache = new Map<string, { t: number; result: PreciseLyricsResult }>();

/** 回退原因（用于日志与界面提示） */
export type QqFallbackReason =
  | "missing-info"
  | "search-failed"
  | "no-match"
  | "no-lyrics";

export type PreciseLyricsResult =
  | {
      ok: true;
      lines: LyricLine[];
      /** 命中的 QQ 歌曲 id（日志用） */
      songId: string;
      /** 命中的 QQ 歌曲标题（日志用） */
      songTitle: string;
      /** 是否含官方逐字时间轴（否则仅为逐行） */
      wordLevel: boolean;
      /** 是否命中缓存 */
      fromCache: boolean;
    }
  | { ok: false; reason: QqFallbackReason; detail?: string };

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
 * 成功返回歌词（含来源信息），失败返回原因；调用方据此回退并提示。
 */
export async function fetchPreciseQqLyrics(
  opts: PreciseLyricsOptions,
): Promise<PreciseLyricsResult> {
  const title = (opts.title ?? "").trim();
  if (!title || !opts.durationMs || !Number.isFinite(opts.durationMs)) {
    return { ok: false, reason: "missing-info" };
  }
  const key = `${normalizeTitle(title)}|${Math.round(opts.durationMs)}`;
  const cached = resultCache.get(key);
  if (cached) {
    const ttl = cached.result.ok ? OK_TTL : FAIL_TTL;
    if (Date.now() - cached.t < ttl) {
      if (!cached.result.ok) {
        console.info("[逐字歌词] 命中失败缓存（10 分钟内），跳过重试:", title);
      }
      return cached.result.ok
        ? { ...cached.result, fromCache: true }
        : cached.result;
    }
    resultCache.delete(key);
  }

  let candidates: QqSongInfo[];
  try {
    candidates = await qqSearchSongs(title);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[逐字歌词] QQ 搜索失败:", msg);
    const result: PreciseLyricsResult = {
      ok: false,
      reason: "search-failed",
      detail: msg,
    };
    resultCache.set(key, { t: Date.now(), result });
    return result;
  }

  const titleNorm = normalizeTitle(title);
  const sameName = candidates.filter(
    (c) => normalizeTitle(c.title) === titleNorm,
  );
  const matched = sameName
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
  if (!matched.length) {
    const detail = `搜索 ${candidates.length} 条，同名 ${sameName.length} 条，时长差 ≤1s 0 条`;
    console.warn(`[逐字歌词] 无匹配候选：${detail}`);
    const result: PreciseLyricsResult = { ok: false, reason: "no-match", detail };
    resultCache.set(key, { t: Date.now(), result });
    return result;
  }

  let firstLineLevel: LyricLine[] | null = null;
  let tried = 0;
  for (const c of matched) {
    tried++;
    let lines: LyricLine[] | null = null;
    try {
      lines = await qqFetchLyrics(c);
    } catch {
      continue; // 单候选失败不影响其它候选
    }
    if (!lines?.length) continue;
    if (hasWordLevel(lines)) {
      const result: PreciseLyricsResult = {
        ok: true,
        lines,
        songId: c.id,
        songTitle: c.title,
        wordLevel: true,
        fromCache: false,
      };
      resultCache.set(key, { t: Date.now(), result });
      return result;
    }
    // 记录第一个仅有逐行时间轴的结果（行时间仍比本地估算准）
    firstLineLevel ??= lines;
  }
  const result: PreciseLyricsResult = firstLineLevel
    ? {
        ok: true,
        lines: firstLineLevel,
        songId: matched[0].id,
        songTitle: matched[0].title,
        wordLevel: false,
        fromCache: false,
      }
    : {
        ok: false,
        reason: "no-lyrics",
        detail: `尝试 ${tried} 个候选均无可用歌词`,
      };
  if (!result.ok) {
    console.warn(`[逐字歌词] ${result.detail}`);
  }
  resultCache.set(key, { t: Date.now(), result });
  return result;
}
