/**
 * meting API 客户端（在线音乐）。
 *
 * 接口：GET {API_BASE}/api?server=netease&type=search&id=关键词
 * 返回数组元素示例：
 *   { "title": "夜雨晚风", "author": "芝麻Mochi", "pic": "https://...jpg",
 *     "url": ".../api?server=netease&type=url&id=xxx",
 *     "lrc": ".../api?server=netease&type=lrc&id=xxx" }
 * - url / pic / lrc 均为指向 API 的资源端点：url 可直接作 <audio> 源，
 *   pic 可作封面图，lrc 请求返回歌词文本。
 *
 * 注意：不同实例字段名有出入（name/artist 或 title/author），这里统一归一化。
 */
import type { MusicServer, OnlineSong } from "@shared/types";

const API_BASE = "https://meting.mikus.ink/api";

/** 预设歌单（平台歌单 ID，可能随时间失效，作为默认展示项） */
export interface CuratedPlaylist {
  server: MusicServer;
  id: string;
  name: string;
}

export const CURATED_PLAYLISTS: CuratedPlaylist[] = [
  { server: "netease", id: "3778678", name: "网易云热歌榜" },
  { server: "netease", id: "3779629", name: "网易云新歌榜" },
  { server: "netease", id: "19723756", name: "网易云飙升榜" },
];

interface RawSong {
  id?: string;
  title?: string;
  name?: string;
  author?: string;
  artist?: string;
  album?: string;
  url?: string;
  pic?: string;
  lrc?: string;
}

/** 从 url/lrc/pic 里兜底提取 id（部分实例不返回顶层 id） */
function extractId(raw: RawSong): string {
  if (raw.id) return String(raw.id);
  const m = (raw.url || raw.lrc || raw.pic || "").match(/[?&]id=(\d+)/);
  return m ? m[1] : "";
}

/** 归一化：兼容 name/artist 与 title/author 两种字段命名 */
function normalizeSong(raw: RawSong): OnlineSong {
  return {
    id: extractId(raw),
    name: raw.title || raw.name || "",
    artist: raw.author || raw.artist || "",
    album: raw.album || undefined,
    url: raw.url ?? "",
    pic: raw.pic ?? "",
    lrc: raw.lrc ?? "",
  };
}

async function request(
  server: MusicServer,
  type: string,
  id: string,
): Promise<OnlineSong[]> {
  const url = `${API_BASE}?server=${server}&type=${type}&id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`请求失败 (HTTP ${res.status})`);
  }
  const data = await res.json();
  // 错误响应形如 { status: 400, message: "..." }
  if (!Array.isArray(data)) {
    const msg = (data as { message?: string }).message;
    throw new Error(msg || "接口返回异常");
  }
  return (data as RawSong[]).map(normalizeSong);
}

/** 按关键词搜索歌曲 */
export function metingSearch(server: MusicServer, keyword: string): Promise<OnlineSong[]> {
  return request(server, "search", keyword);
}

/** 按歌单 ID 拉取歌曲列表 */
export function metingPlaylist(server: MusicServer, id: string): Promise<OnlineSong[]> {
  return request(server, "playlist", id);
}
