/**
 * 酷狗音乐（Kugou）API 客户端 —— 移植自 LDDC/core/api/lyrics/kg.py
 * （原作者 沉默の金，SPDX-License-Identifier: GPL-3.0-only）。
 *
 * 仅用于「更精确的逐字歌词」回退链：搜索同名歌曲 → 拉取 KRC 逐字歌词。
 * 签名算法（MD5）与请求参数逐字移植；dfid 注册仅歌单接口需要，此处省略。
 * 请求经 tauri-plugin-http（Rust 网络栈）；浏览器预览退化为 window.fetch。
 */
import { md5 } from "./md5";
import { krcDecrypt, krcToRawLines, krcLinesToLyricLines } from "./krc";
import { filterInstrumentalPlaceholder } from "./lyricTimeline";
import type { LyricLine } from "@shared/types";

const REQUEST_TIMEOUT_MS = 8000;
const SIGN_KEY = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 酷狗搜索到的歌曲信息（对应 kg.py format_songinfos 字段） */
export interface KgSongInfo {
  id: string;
  hash: string;
  title: string;
  subtitle: string;
  artist: string;
  album: string;
  durationMs: number;
}

async function kgFetch(url: string, init: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(url, init);
  }
  return fetch(url, init);
}

/**
 * 带签名的酷狗 API 请求（移植 kg.py request）。
 * @param module 请求模块名（影响 UA 后缀与基础参数组）
 */
async function kgRequest(
  url: string,
  module: string,
  params: Record<string, unknown>,
  options: { method?: "GET" | "POST"; data?: string; headers?: Record<string, string> } = {},
): Promise<any> {
  const { method = "GET", data, headers: extraHeaders } = options;
  const now = Date.now();
  const mid = md5(String(now));
  const baseHeaders: Record<string, string> = {
    "User-Agent": `Android14-1070-11070-201-0-${module}-wifi`,
    "Connection": "Keep-Alive",
    "Accept-Encoding": "gzip, deflate",
    "KG-Rec": "1",
    "KG-RC": "1",
    "KG-CLIENTTIMEMS": String(now),
    mid,
    ...(extraHeaders ?? {}),
  };

  // 基础参数组（移植 kg.py request）
  const merged: Record<string, unknown> =
    module === "Lyric"
      ? { appid: "3116", clientver: "11070", ...params }
      : {
          userid: "0",
          appid: "3116",
          token: "",
          clienttime: Math.floor(now / 1000),
          iscorrection: "1",
          uuid: "-",
          mid,
          dfid: "-",
          clientver: "11070",
          platform: "AndroidFilter",
          ...params,
        };

  // 签名：md5(key + 排序后的 k=v 拼接 + body + key)
  const sortedPairs = Object.entries(merged)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("");
  merged.signature = md5(`${SIGN_KEY}${sortedPairs}${data ?? ""}${SIGN_KEY}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const qs = new URLSearchParams(
      Object.entries(merged).map(([k, v]) => [k, String(v)]),
    ).toString();
    const fullUrl = method === "GET" ? `${url}?${qs}` : url;
    const res = await kgFetch(fullUrl, {
      method,
      headers: baseHeaders,
      ...(data !== undefined ? { body: data } : {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`酷狗接口请求失败 (HTTP ${res.status})`);
    }
    const responseData = (await res.json()) as {
      error_code?: number | string;
      error_msg?: string;
      data?: any;
    };
    const code = Number(responseData?.error_code ?? 0);
    if (code !== 0 && code !== 200) {
      throw new Error(
        `酷狗接口错误: code=${responseData?.error_code} msg=${responseData?.error_msg ?? ""}`,
      );
    }
    return responseData;
  } finally {
    clearTimeout(timer);
  }
}

// ---- 搜索 ----

const SEARCH_CACHE_TTL = 60 * 60 * 1000;
const searchCache = new Map<string, { t: number; songs: KgSongInfo[] }>();

const OLD_SEARCH_DOMAINS = [
  "mobiles.kugou.com",
  "msearchcdn.kugou.com",
  "mobilecdnbj.kugou.com",
  "msearch.kugou.com",
];

function formatNewSong(info: any): KgSongInfo {
  return {
    id: String(info?.ID ?? ""),
    hash: info?.FileHash ?? "",
    title: info?.SongName ?? "",
    subtitle: info?.Auxiliary ?? "",
    artist: (info?.Singers ?? [])
      .filter((s: any) => s?.name)
      .map((s: any) => s.name)
      .join("/"),
    album: info?.AlbumName ?? "",
    durationMs: (info?.Duration ?? 0) * 1000,
  };
}

function formatOldSong(info: any): KgSongInfo {
  return {
    id: String(info?.album_audio_id ?? ""),
    hash: info?.hash ?? "",
    title: info?.songname ?? "",
    subtitle: info?.topic ?? "",
    artist: (info?.singername ?? "").split("、").filter(Boolean).join("/"),
    album: info?.album_name ?? "",
    durationMs: (info?.duration ?? 0) * 1000,
  };
}

/** 按关键词搜索歌曲；新版接口失败时回退旧接口（移植 kg.py search/_old_search） */
export async function kgSearchSongs(keyword: string): Promise<KgSongInfo[]> {
  const cached = searchCache.get(keyword);
  if (cached && Date.now() - cached.t < SEARCH_CACHE_TTL) {
    return cached.songs;
  }
  let songs: KgSongInfo[] = [];
  try {
    const data = await kgRequest(
      "http://complexsearch.kugou.com/v2/search/song",
      "SearchSong",
      { sorttype: "0", keyword, pagesize: 20, page: 1 },
      { headers: { "x-router": "complexsearch.kugou.com" } },
    );
    const lists: any[] = data?.data?.lists ?? [];
    songs = lists.map(formatNewSong);
  } catch (e) {
    console.warn("[酷狗歌词] 新版搜索失败，回退旧接口:", e instanceof Error ? e.message : e);
    const domain = OLD_SEARCH_DOMAINS[Math.floor(Math.random() * OLD_SEARCH_DOMAINS.length)];
    const data = await kgRequest(
      `http://${domain}/api/v3/search/song`,
      "SearchSong",
      {
        showtype: "14",
        highlight: "",
        pagesize: "30",
        tag_aggr: "1",
        plat: "0",
        sver: "5",
        keyword,
        correct: "1",
        api_ver: "1",
        version: "9108",
        page: 1,
      },
    );
    songs = (data?.data?.info ?? []).map(formatOldSong);
  }
  searchCache.set(keyword, { t: Date.now(), songs });
  return songs;
}

// ---- 歌词 ----

const LYRICS_CACHE_TTL = 60 * 60 * 1000;
const lyricsCache = new Map<string, { t: number; lines: LyricLine[] | null }>();

/**
 * 获取歌曲歌词：先查候选（lyrics.kugou.com/v1/search），再下载解密
 * （lyrics.kugou.com/download，krc 逐字格式）。失败返回 null。
 */
export async function kgFetchLyrics(song: KgSongInfo): Promise<LyricLine[] | null> {
  const cacheKey = `${song.id}:${song.hash}`;
  const cached = lyricsCache.get(cacheKey);
  if (cached && Date.now() - cached.t < LYRICS_CACHE_TTL) {
    return cached.lines;
  }
  try {
    // 1. 歌词候选（移植 get_lyricslist）
    const keyword = song.artist ? `${song.artist} - ${song.title}` : song.title;
    const listData = await kgRequest("https://lyrics.kugou.com/v1/search", "Lyric", {
      album_audio_id: song.id,
      duration: song.durationMs,
      hash: song.hash,
      keyword,
      lrctxt: "1",
      man: "no",
    });
    // 注意：candidates 在响应顶层（与参考实现 data["candidates"] 一致）
    const candidates: any[] = listData?.candidates ?? [];
    if (!candidates.length) {
      lyricsCache.set(cacheKey, { t: Date.now(), lines: null });
      return null;
    }
    const best = candidates[0]; // 接口按匹配度排序，取首个

    // 2. 下载（移植 get_lyrics）
    const dlData = await kgRequest("http://lyrics.kugou.com/download", "Lyric", {
      accesskey: best.accesskey,
      charset: "utf8",
      client: "mobi",
      fmt: "krc",
      id: best.id,
      ver: "1",
    });
    const content: string | undefined = dlData?.content;
    const contentType = dlData?.contenttype;
    if (!content) {
      lyricsCache.set(cacheKey, { t: Date.now(), lines: null });
      return null;
    }
    if (contentType === 2) {
      // base64 纯文本歌词（无时间轴），无法用于逐字渲染，视为无可用歌词
      console.info("[酷狗歌词] 候选为纯文本歌词（无时间轴），跳过:", song.title);
      lyricsCache.set(cacheKey, { t: Date.now(), lines: null });
      return null;
    }
    const plain = await krcDecrypt(content);
    const parsed = krcToRawLines(plain);
    let lines: LyricLine[] | null = null;
    if (parsed) {
      const converted = krcLinesToLyricLines(parsed);
      lines = filterInstrumentalPlaceholder(converted);
    }
    lyricsCache.set(cacheKey, { t: Date.now(), lines });
    return lines;
  } catch (e) {
    console.warn("[酷狗歌词] 获取失败:", e instanceof Error ? e.message : e);
    lyricsCache.set(cacheKey, { t: Date.now(), lines: null });
    return null;
  }
}
