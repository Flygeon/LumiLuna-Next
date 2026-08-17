/**
 * 「更精确的逐字歌词」匹配编排。
 *
 * 流程（回退链）：优先尝试用户偏好的来源（默认 QQ）→ 失败回退另一云端来源（QQ ⇄ 酷狗）
 * → 已登录网易云时追加 Meting API → 全部云端失败则交由调用方回退本地歌词。
 * 每个来源：搜索歌曲名（忽略括号内信息）→ 过滤「同名 + 时长差 ≤ ±1 秒」→ 按时长差升序
 * 取前 N 个候选 → 逐个拉取逐字歌词：优先含逐字数据的候选；全无逐字则回退首个逐行结果。
 *
 * 返回结构化结果（PreciseLyricsResult），调用方据此展示来源徽标/回退提示并记录日志。
 * 结果进程内缓存：成功 1h / 失败 10min（键含来源顺序，手动切换后自动失效）。
 */
import { qqSearchSongs, qqFetchLyrics, type QqSongInfo } from "./qqMusic";
import { kgSearchSongs, kgFetchLyrics, type KgSongInfo } from "./kgMusic";
import { metingSearch } from "./meting";
import { lrcGet, lrcSet } from "./onlineCache";
import { parseLrc, filterInstrumentalPlaceholder } from "./lyricTimeline";
import { hasWordLevel } from "./qrc";
import type { LyricLine, OnlineSong } from "@shared/types";

/** 云端歌词来源 */
export type LyricSource = "qq" | "kg" | "meting";
/** 歌词来源偏好（含本地） */
export type LyricSourcePref = LyricSource | "local";

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
      /** 命中来源 */
      source: LyricSource;
      lines: LyricLine[];
      /** 命中的云端歌曲 id（日志用） */
      songId: string;
      /** 命中的云端歌曲标题（日志用） */
      songTitle: string;
      /** 是否含官方逐字时间轴（否则仅为逐行） */
      wordLevel: boolean;
      /** 是否命中缓存 */
      fromCache: boolean;
    }
  | { ok: false; reason: QqFallbackReason; detail?: string };

const SOURCE_LABEL: Record<LyricSource, string> = {
  qq: "QQ 音乐",
  kg: "酷狗音乐",
  meting: "Meting API",
};

/** 括号内容（半角/全角） */
const BRACKET_RE = /[（(][^（）()]*[）)]/g;

/** 去掉括号内的附加信息（如「夜曲 (Live)」→「夜曲」），用于搜索词与匹配比较 */
export function stripBrackets(t: string): string {
  return t.replace(BRACKET_RE, " ").replace(/\s+/g, " ").trim();
}

/** 标题归一化：去括号 + trim + 小写 + 全角→半角 + 空白折叠 */
export function normalizeTitle(t: string): string {
  return stripBrackets(t)
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[\uFF01-\uFF5E]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s+/g, " ");
}

interface TryContext {
  title: string;
  durationMs: number;
  artist?: string;
}

/**
 * 尝试 Meting API 来源（网易云歌词回退）。
 * Meting 搜索结果不含时长字段，因此采用「归一化标题完全一致」优先，
 * 其次选择首个搜索结果；拉取 lrc 后解析为标准 LRC（含粗排逐字时间轴）。
 */
async function tryMetingSource(
  opts: TryContext,
): Promise<PreciseLyricsResult> {
  const keyword = stripBrackets(opts.title);
  let songs: OnlineSong[];
  try {
    songs = await metingSearch("netease", keyword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "search-failed",
      detail: `${SOURCE_LABEL.meting} 搜索失败: ${msg}`,
    };
  }
  if (!songs.length) {
    return {
      ok: false,
      reason: "no-match",
      detail: `${SOURCE_LABEL.meting}：无搜索结果`,
    };
  }

  const titleNorm = normalizeTitle(opts.title);
  const titleMatched = songs.filter(
    (s) => normalizeTitle(s.name) === titleNorm,
  );
  const artistNorm = opts.artist ? normalizeTitle(opts.artist) : "";
  const pick =
    titleMatched.find(
      (s) => artistNorm && (normalizeTitle(s.artist).includes(artistNorm) || artistNorm.includes(normalizeTitle(s.artist))),
    ) ||
    titleMatched[0] ||
    songs[0];
  if (!pick?.lrc) {
    return {
      ok: false,
      reason: "no-lyrics",
      detail: `${SOURCE_LABEL.meting}：候选 ${songs.length} 条，但无歌词地址`,
    };
  }

  try {
    const cacheKey = pick.id || pick.lrc;
    let text = "";
    let fromCache = false;
    if (pick.lrc.startsWith("http")) {
      const cached = await lrcGet(cacheKey);
      if (cached !== null) {
        text = cached;
        fromCache = true;
      } else {
        const res = await fetch(pick.lrc);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
        text = text.trim();
        if (text) void lrcSet(cacheKey, text);
      }
    } else if (pick.lrc.includes("[")) {
      text = pick.lrc;
    }

    if (!text.trim()) {
      return {
        ok: false,
        reason: "no-lyrics",
        detail: `${SOURCE_LABEL.meting}：歌词内容为空`,
      };
    }
    const parsed = parseLrc(text, true);
    const lines = filterInstrumentalPlaceholder(parsed);
    if (!lines?.length) {
      return {
        ok: false,
        reason: "no-lyrics",
        detail: `${SOURCE_LABEL.meting}：歌词内容为空或为纯音乐占位文案`,
      };
    }
    return {
      ok: true,
      source: "meting",
      lines,
      songId: pick.id,
      songTitle: pick.name,
      wordLevel: false,
      fromCache,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "no-lyrics",
      detail: `${SOURCE_LABEL.meting} 获取歌词失败: ${msg}`,
    };
  }
}

/** 尝试单个来源：搜索 → 同名+时长匹配 → 逐字优先取词 */
async function trySource(
  source: LyricSource,
  opts: TryContext,
): Promise<PreciseLyricsResult> {
  if (source === "meting") return tryMetingSource(opts);
  const keyword = stripBrackets(opts.title); // 搜索词同样忽略括号内信息
  let candidates: (QqSongInfo | KgSongInfo)[];
  try {
    candidates =
      source === "qq" ? await qqSearchSongs(keyword) : await kgSearchSongs(keyword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "search-failed",
      detail: `${SOURCE_LABEL[source]} 搜索失败: ${msg}`,
    };
  }
  if (!candidates.length) {
    return {
      ok: false,
      reason: "no-match",
      detail: `${SOURCE_LABEL[source]}：无搜索结果`,
    };
  }

  const titleNorm = normalizeTitle(opts.title);
  const sameName = candidates.filter((c) => normalizeTitle(c.title) === titleNorm);
  const matched = sameName
    .filter(
      (c) =>
        Math.abs((c.durationMs || 0) - opts.durationMs) <= DURATION_TOLERANCE_MS,
    )
    .sort(
      (a, b) =>
        Math.abs((a.durationMs || 0) - opts.durationMs) -
        Math.abs((b.durationMs || 0) - opts.durationMs),
    )
    .slice(0, MAX_CANDIDATES);
  if (!matched.length) {
    return {
      ok: false,
      reason: "no-match",
      detail:
        `${SOURCE_LABEL[source]}：搜索 ${candidates.length} 条，同名 ${sameName.length} 条，时长差 ≤1s 0 条`,
    };
  }

  let firstLineLevel: LyricLine[] | null = null;
  let tried = 0;
  for (const c of matched) {
    tried++;
    let lines: LyricLine[] | null = null;
    try {
      lines =
        source === "qq"
          ? await qqFetchLyrics(c as QqSongInfo)
          : await kgFetchLyrics(c as KgSongInfo);
    } catch {
      continue; // 单候选失败不影响其它候选
    }
    if (!lines?.length) continue;
    if (hasWordLevel(lines)) {
      return {
        ok: true,
        source,
        lines,
        songId: c.id,
        songTitle: c.title,
        wordLevel: true,
        fromCache: false,
      };
    }
    firstLineLevel ??= lines;
  }
  if (firstLineLevel) {
    return {
      ok: true,
      source,
      lines: firstLineLevel,
      songId: matched[0].id,
      songTitle: matched[0].title,
      wordLevel: false,
      fromCache: false,
    };
  }
  return {
    ok: false,
    reason: "no-lyrics",
    detail: `${SOURCE_LABEL[source]}：尝试 ${tried} 个候选均无可用歌词`,
  };
}

export interface PreciseLyricsOptions {
  /** 播放歌曲标题（必填；缺失直接跳过） */
  title: string;
  /** 播放歌曲时长（毫秒；缺失直接跳过，时长匹配依赖它） */
  durationMs?: number;
  artist?: string;
  /** 用户上次手动选择的来源：优先尝试；缺省按 QQ → 酷狗 */
  preferredSource?: LyricSource;
  /** 手动切换时强制忽略结果缓存 */
  force?: boolean;
  /** 已登录网易云账号：QQ/酷狗均失败后追加 Meting API 歌词回退 */
  fallbackToMeting?: boolean;
}

/**
 * 按回退链从云端取逐字歌词（偏好来源 → 另一来源；登录网易云后追加 Meting）。
 * 成功返回歌词（含来源信息），失败返回原因；调用方据此回退本地歌词并提示。
 */
export async function fetchCloudLyrics(
  opts: PreciseLyricsOptions,
): Promise<PreciseLyricsResult> {
  const title = (opts.title ?? "").trim();
  if (!title || !opts.durationMs || !Number.isFinite(opts.durationMs)) {
    return { ok: false, reason: "missing-info" };
  }
  const key = `${normalizeTitle(title)}|${Math.round(opts.durationMs)}|${opts.preferredSource ?? "auto"}|${opts.fallbackToMeting ? "meting" : "no-meting"}`;
  const cached = resultCache.get(key);
  if (cached && !opts.force) {
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

  const base: LyricSource[] = [];
  const preferred = opts.preferredSource;
  if (preferred) base.push(preferred);
  if (preferred !== "qq") base.push("qq");
  if (preferred !== "kg" && !base.includes("kg")) base.push("kg");
  if (opts.fallbackToMeting && !base.includes("meting")) base.push("meting");
  const order = base;

  let lastFailure: PreciseLyricsResult | null = null;
  for (const source of order) {
    const r = await trySource(source, {
      title,
      durationMs: opts.durationMs,
      artist: opts.artist,
    });
    if (r.ok) {
      resultCache.set(key, { t: Date.now(), result: r });
      return r;
    }
    lastFailure = r;
    console.warn(`[逐字歌词] ${r.detail ?? r.reason}`);
  }
  const result: PreciseLyricsResult = {
    ok: false,
    reason: lastFailure?.reason ?? "no-lyrics",
    detail: lastFailure?.detail,
  };
  resultCache.set(key, { t: Date.now(), result });
  return result;
}
