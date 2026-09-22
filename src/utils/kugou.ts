/**
 * 酷狗音乐前端封装：上游响应归一化 + 播放地址延迟解析。
 *
 * 为什么归一化放在 TS 侧：酷狗接口存在新旧两套字段形态
 *   - 新版：`FileHash` / `SongName` / `Auxiliary` / `Singers[].name` / `Duration`(秒)
 *   - 旧版：`hash` / `songname` / `topic` / `singername`(顿号分隔) / `duration`(秒)
 * 且同一字段常有多个候选名。这是第三方音乐接口的固有特征，项目里
 * `utils/meting.ts` 已确立同一做法（在 TS 侧做容错整形），故此处沿用。
 * 字段知识来自 `utils/kgMusic.ts`（同一上游的歌词链路，已验证）。
 *
 * 播放地址是延迟解析的：酷狗列表接口不返回直链，逐首预解析会在打开歌单时
 * 打出几十个请求，因此仅在即将播放时解析单首（见 resolveKugouUrl）。
 */
import { capabilities } from "@/capabilities";
import type { OnlineSong } from "@shared/types";

type Obj = Record<string, unknown>;

// ---- 基础取值 ----

/** 依次尝试多个键，返回首个非空字符串（数字转字符串） */
function str(o: Obj, ...keys: string[]): string {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** 依次尝试多个键，返回首个可解析为有限数字的值 */
function num(o: Obj, ...keys: string[]): number {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// ---- 数组定位 ----
//
// 各接口的歌曲数组位置不一致（`data.lists` / `data.info` / `data.songs` ...），
// 且新旧形态混用。这里按「对象数组 + 首项形状匹配」深度优先查找，
// 比硬编码路径更耐受上游改版；后续拿到真实响应后可逐步收紧。

function findArray(root: unknown, match: (first: Obj) => boolean, depth = 0): Obj[] | null {
  if (depth > 6 || !root) return null;
  if (Array.isArray(root)) {
    const first = root[0];
    if (isObj(first) && match(first)) {
      return root.filter(isObj);
    }
    for (const item of root) {
      const found = findArray(item, match, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObj(root)) return null;
  for (const value of Object.values(root)) {
    const found = findArray(value, match, depth + 1);
    if (found) return found;
  }
  return null;
}

/** 歌曲形状判定：命中两个以上歌曲特征键 */
const SONG_KEYS = [
  "FileHash",
  "hash",
  "SongName",
  "songname",
  "Singers",
  "singername",
  "album_audio_id",
  "audio_id",
  "mixsongid",
];

function looksLikeSong(o: Obj): boolean {
  let hits = 0;
  for (const key of SONG_KEYS) {
    if (key in o) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

function looksLikeRank(o: Obj): boolean {
  return "rankid" in o || "rankId" in o || "rank_cid" in o || "rankname" in o || "rankName" in o;
}

// ---- 歌曲归一化 ----

/** 部分接口把标题返回成「歌手 - 歌曲名」，去掉与 artist 重复的前缀 */
function cleanTitle(title: string, artist: string): string {
  const lead = artist.split("/")[0];
  if (!lead) return title;
  for (const sep of [" - ", " – ", "-"]) {
    const prefix = `${lead}${sep}`;
    if (title.startsWith(prefix)) return title.slice(prefix.length).trim();
  }
  return title;
}

function toOnlineSong(item: Obj): OnlineSong {
  const singers = Array.isArray(item.Singers)
    ? (item.Singers as unknown[]).map((s) => (isObj(s) ? String(s.name ?? "") : "")).filter(Boolean)
    : [];
  const artist =
    singers.join("/") ||
    str(item, "singername", "SingerName", "author_name").split("、").filter(Boolean).join("/");

  const durationSec = num(item, "Duration", "duration", "timelen");
  const hash = str(item, "FileHash", "hash", "HQFileHash", "SQFileHash");
  const albumAudioId = str(
    item,
    "album_audio_id",
    "audio_id",
    "mixsongid",
    "MixSongID",
    "EMixSongID",
    "ID",
    "id",
  );
  const name = cleanTitle(str(item, "SongName", "songname", "filename", "name"), artist);

  return {
    id: albumAudioId || hash,
    name,
    artist,
    album: str(item, "AlbumName", "album_name", "album") || undefined,
    // 播放地址延迟解析（见文件头说明）
    url: "",
    pic: str(item, "Image", "imgurl", "img", "cover", "pic"),
    lrc: "",
    server: "kugou",
    hash,
    albumAudioId,
    durationMs: durationSec > 0 ? durationSec * 1000 : 0,
  };
}

/** 把酷狗列表类响应（search / playlist / rank / everyday 原始 JSON）转为 OnlineSong[] */
export function kugouToOnlineSongs(raw: unknown): OnlineSong[] {
  const list = findArray(raw, looksLikeSong);
  if (!list) return [];
  return list.map(toOnlineSong).filter((s) => s.hash || s.id);
}

// ---- 排行榜卡片 ----

/** 排行榜条目（/rank/list 的卡片，不是歌曲） */
export interface KugouRankCard {
  id: string;
  name: string;
  cover: string;
  /** 更新频率/简介 */
  desc: string;
}

export function kugouRankCards(raw: unknown): KugouRankCard[] {
  const list = findArray(raw, looksLikeRank);
  if (!list) return [];
  return list
    .map((o) => ({
      id: str(o, "rankid", "rankId", "rank_cid", "id"),
      name: str(o, "rankname", "rankName", "name"),
      cover: str(o, "imgurl", "imgUrl", "img", "cover"),
      desc: str(o, "update_frequency", "updateFrequency", "intro", "desc"),
    }))
    .filter((c) => c.id && c.name);
}

// ---- 播放地址延迟解析 ----

/** 播放地址会话缓存（hash → url） */
const urlCache = new Map<string, string>();

/**
 * 解析单首酷狗歌曲的播放地址。
 * 失败返回空串（调用方据此提示「无法播放」），不抛异常。
 */
export async function resolveKugouUrl(song: OnlineSong): Promise<string> {
  if (song.url) return song.url;
  if (!song.hash) return "";
  const cached = urlCache.get(song.hash);
  if (cached) return cached;
  try {
    const res = await capabilities.kugouSongUrl(song.hash, song.albumAudioId || undefined);
    if (res?.url) {
      urlCache.set(song.hash, res.url);
      return res.url;
    }
  } catch (e) {
    console.warn("[酷狗] 播放地址解析失败:", e);
  }
  return "";
}

/** 清空播放地址缓存（登出时调用） */
export function clearKugouUrlCache(): void {
  urlCache.clear();
}

/** 按 hash 取已解析的播放地址（可能为空串） */
export function kugouUrlOf(hash: string | undefined): string {
  return hash ? (urlCache.get(hash) ?? "") : "";
}
