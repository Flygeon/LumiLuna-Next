/**
 * meting API 客户端（在线音乐）。
 *
 * 接口：GET {API_BASE}/api?server=netease&type=search&id=关键词
 * 返回：[{ name, artist, url, pic, lrc, id }]
 * - url / pic / lrc 均为指向 API 的资源端点：url 可直接作 <audio> 源，
 *   pic 可作封面图，lrc 请求返回歌词文本。
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
  { server: "tencent", id: "7326220405", name: "QQ音乐热歌榜" },
];

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
  return data as OnlineSong[];
}

/** 按关键词搜索歌曲 */
export function metingSearch(server: MusicServer, keyword: string): Promise<OnlineSong[]> {
  return request(server, "search", keyword);
}

/** 按歌单 ID 拉取歌曲列表 */
export function metingPlaylist(server: MusicServer, id: string): Promise<OnlineSong[]> {
  return request(server, "playlist", id);
}
