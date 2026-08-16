/**
 * 网易云账号前端封装：播放 URL 批量解析与 OnlineSong 转换。
 * 登录/歌单/云盘请求全在 Rust 侧（签名 + cookie），前端只拿展示数据。
 */
import { capabilities } from "@/capabilities";
import type { NeteaseSong, OnlineSong } from "@shared/types";

/** 播放 URL 会话缓存（id → url）；仅缓存有效 URL，null 结果不缓存以便重试 */
const urlCache = new Map<number, string>();

/** 批量拉取播放 URL（每批 ≤30 首），成功结果进缓存 */
export async function resolveSongUrls(ids: number[]): Promise<void> {
  const missing = ids.filter((id) => !urlCache.has(id));
  for (let i = 0; i < missing.length; i += 30) {
    const batch = missing.slice(i, i + 30);
    try {
      const urls = await capabilities.neteaseSongUrl(batch);
      for (const u of urls) {
        if (u.url) urlCache.set(u.id, u.url);
      }
    } catch (e) {
      // 单批失败抛给上层展示；已缓存的不受影响
      console.warn("[网易云] 播放 URL 拉取失败:", e);
      throw e;
    }
  }
}

/** 已解析的播放 URL（可能为空串，表示无版权/VIP） */
export function songUrlOf(id: number): string {
  return urlCache.get(id) ?? "";
}

/** 网易云歌曲 → 可播放的 OnlineSong（复用现有在线播放链路） */
export async function toOnlineSongs(songs: NeteaseSong[]): Promise<OnlineSong[]> {
  await resolveSongUrls(songs.map((s) => s.id));
  return songs.map((s) => ({
    id: String(s.id),
    name: s.name,
    artist: s.artist,
    album: s.album ?? undefined,
    url: songUrlOf(s.id),
    pic: s.picUrl ?? "",
    lrc: "",
  }));
}

/** 清空 URL 缓存（登出时调用） */
export function clearSongUrlCache(): void {
  urlCache.clear();
}
