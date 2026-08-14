/**
 * QQ 音乐（musicu.fcg）API 客户端 —— 移植自 LDDC/core/api/lyrics/qm.py
 * （原作者 沉默の金，SPDX-License-Identifier: GPL-3.0-only）。
 *
 * 仅用于「更精确的逐字歌词」：搜索同名歌曲 → 拉取 QRC 逐字歌词。
 * 请求走 tauri-plugin-http（Rust 侧 reqwest，绕开 CORS）；浏览器预览退化为
 * window.fetch（会因 CORS 失败而优雅降级，不影响播放）。
 */
import { qrcDecrypt, qrcToRawLines, rawLinesToLyricLines, mergeQqLyrics } from "./qrc";
import { parseLrc, filterInstrumentalPlaceholder } from "./lyricTimeline";
import type { LyricLine } from "@shared/types";

const API_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 8000;

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** QQ 搜索到的歌曲信息（对应 qm.py format_songinfos 的字段） */
export interface QqSongInfo {
  id: string;
  mid: string;
  title: string;
  subtitle: string;
  /** 歌手名，"/" 分隔（对应 Artist.str()） */
  artist: string;
  album: string;
  durationMs: number;
}

// ---- comm（逐字移植 qm.py）----

let comm: Record<string, unknown> = {
  ct: 11,
  cv: "1003006",
  v: "1003006",
  os_ver: "15",
  phonetype: "24122RKC7C", // REDMI K80 Pro
  rom: `Redmi/miro/miro:15/AE3A.240806.005/OS2.0.10${["5", "4", "2"][Math.floor(Math.random() * 3)]}.0.VOMCNXM:user/release-keys`,
  tmeAppID: "qqmusiclight",
  nettype: "NETWORK_WIFI",
  udid: "0",
};

let sessionPromise: Promise<void> | null = null;

/** 原始 POST（不经过会话初始化），供 GetSession 与其余请求使用 */
async function rawPost(
  method: string,
  module: string,
  param: Record<string, unknown>,
): Promise<any> {
  const body = JSON.stringify({
    comm,
    request: { method, module, param },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await tauriSafeFetch(API_URL, {
      method: "POST",
      headers: {
        cookie: "tmeLoginType=-1;",
        "content-type": "application/json",
        "user-agent": "okhttp/3.14.9",
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`QQ 音乐接口请求失败 (HTTP ${res.status})`);
    }
    const data = (await res.json()) as {
      code?: number;
      request?: { code?: number; data?: any };
    };
    if (data?.code !== 0 || data?.request?.code !== 0) {
      throw new Error(
        `QQ 音乐接口错误: code=${data?.code ?? "?"} request=${data?.request?.code ?? "?"}`,
      );
    }
    return data.request?.data;
  } finally {
    clearTimeout(timer);
  }
}

/** Tauri 内走插件 fetch（Rust 网络栈）；浏览器预览退回原生 fetch */
async function tauriSafeFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (isTauri) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(url, init);
  }
  return fetch(url, init);
}

/** 会话初始化（GetSession）：取 uid/sid/userip 合并进 comm；单飞 + 失败可重试 */
async function ensureSession(): Promise<void> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const data = await rawPost("GetSession", "music.getSession.session", {
      caller: 0,
      uid: "0",
      vkey: 0,
    });
    const session = data?.session ?? {};
    comm = {
      ...comm,
      uid: String(session.uid ?? "0"),
      sid: String(session.sid ?? "0"),
      userip: String(session.userip ?? ""),
    };
  })().catch((e) => {
    sessionPromise = null; // 失败后允许下次重试
    throw e;
  });
  return sessionPromise;
}

/** 请求 QQ 音乐 API（非 GetSession 请求先确保会话就绪） */
async function qqRequest(
  method: string,
  module: string,
  param: Record<string, unknown>,
): Promise<any> {
  if (method !== "GetSession") await ensureSession();
  return rawPost(method, module, param);
}

// ---- 搜索 ----

const SEARCH_CACHE_TTL = 60 * 60 * 1000;
const searchCache = new Map<string, { t: number; songs: QqSongInfo[] }>();

/** 按关键词搜索歌曲（对应 qm.py search / DoSearchForQQMusicLite） */
export async function qqSearchSongs(keyword: string): Promise<QqSongInfo[]> {
  const cached = searchCache.get(keyword);
  if (cached && Date.now() - cached.t < SEARCH_CACHE_TTL) {
    return cached.songs;
  }
  // search_id：大整数拼接（Python 值超过 2^53，必须用 BigInt）
  const searchId = (
    (BigInt(1 + Math.floor(Math.random() * 20)) << 54n) +
    (BigInt(Math.floor(Math.random() * 4194305)) << 32n) +
    BigInt(Math.round(Date.now()) % 86400000)
  ).toString();
  const param = {
    search_id: searchId,
    remoteplace: "search.android.keyboard",
    query: keyword,
    search_type: 0,
    num_per_page: 20,
    page_num: 1,
    highlight: 0,
    nqc_flag: 0,
    page_id: 1,
    grp: 1,
  };
  const data = await qqRequest(
    "DoSearchForQQMusicLite",
    "music.search.SearchCgiService",
    param,
  );
  const items: any[] = data?.body?.item_song ?? [];
  const songs: QqSongInfo[] = items.map((info) => ({
    id: String(info?.id ?? ""),
    mid: info?.mid ?? "",
    title: info?.title ?? "",
    subtitle: info?.subtitle ?? "",
    artist: (info?.singer ?? [])
      .filter((s: any) => s?.name)
      .map((s: any) => s.name)
      .join("/"),
    album: info?.album?.name ?? "",
    durationMs: (info?.interval ?? 0) * 1000,
  }));
  searchCache.set(keyword, { t: Date.now(), songs });
  return songs;
}

// ---- 歌词 ----

const LYRICS_CACHE_TTL = 60 * 60 * 1000;
const lyricsCache = new Map<string, { t: number; lines: LyricLine[] | null }>();

/** UTF-8 安全的 base64（对应 Python b64encode(x.encode()).decode()） */
function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * 解密并解析一轨歌词（orig/trans/roma）。
 * QRC 格式走逐字解析；LRC 格式（部分翻译轨）走 parseLrc；失败返回 null。
 */
async function parseTrack(encrypted: string): Promise<LyricLine[] | null> {
  let plain: string;
  try {
    plain = await qrcDecrypt(encrypted);
  } catch (e) {
    console.warn("[QQ歌词] QRC 解密失败:", e instanceof Error ? e.message : e);
    return null;
  }
  const raw = qrcToRawLines(plain);
  if (raw) {
    const lines = rawLinesToLyricLines(raw);
    return lines.length ? lines : null;
  }
  if (plain.includes("[") && plain.includes("]")) {
    try {
      const parsed = parseLrc(plain, false);
      // 纯音乐占位文案视为无歌词
      return parsed.length ? filterInstrumentalPlaceholder(parsed) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 获取歌曲歌词（对应 qm.py get_lyrics / GetPlayLyricInfo）。
 * 返回合并了翻译的 LyricLine[]（含逐字 units）；无歌词或失败返回 null。
 */
export async function qqFetchLyrics(
  song: QqSongInfo,
): Promise<LyricLine[] | null> {
  const cached = lyricsCache.get(song.id);
  if (cached && Date.now() - cached.t < LYRICS_CACHE_TTL) {
    return cached.lines;
  }

  const param = {
    albumName: utf8Base64(song.album),
    crypt: 1,
    ct: 19,
    cv: 2111,
    interval: Math.floor(song.durationMs / 1000), // 秒
    lrc_t: 0,
    qrc: 1,
    qrc_t: 0,
    roma: 1,
    roma_t: 0,
    singerName: utf8Base64(song.artist),
    songID: Number(song.id),
    songName: utf8Base64(song.title),
    trans: 1,
    trans_t: 0,
    type: 0,
  };

  try {
    const resp = await qqRequest(
      "GetPlayLyricInfo",
      "music.musichallSong.PlayLyricInfo",
      param,
    );
    // lrc_t 判定与 qm.py 一致：qrc_t 非 0 用 qrc_t，否则 lrc_t；字符串 "0" 视为无
    const origT = (resp?.qrc_t ?? 0) !== 0 ? resp?.qrc_t : resp?.lrc_t;
    const orig = resp?.lyric ?? "";
    let lines: LyricLine[] | null = null;
    if (orig !== "" && String(origT) !== "0") {
      lines = await parseTrack(orig);
    }
    if (lines?.length) {
      const tsT = resp?.trans_t ?? 0;
      const ts = resp?.trans ?? "";
      let trans: LyricLine[] | null = null;
      if (ts !== "" && String(tsT) !== "0") {
        trans = await parseTrack(ts);
      }
      lines = mergeQqLyrics(lines, trans, null);
    }
    lyricsCache.set(song.id, { t: Date.now(), lines });
    return lines;
  } catch (e) {
    console.warn("[QQ歌词] 获取失败:", e instanceof Error ? e.message : e);
    lyricsCache.set(song.id, { t: Date.now(), lines: null });
    return null;
  }
}
