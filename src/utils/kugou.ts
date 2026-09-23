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

/**
 * 时长归一化为毫秒。上游单位不统一：`Duration`/`duration` 是秒，
 * `timelen`/`time_length`/`timelength` 是毫秒。与参考实现同一判据——
 * 原始值 > 10000 视为毫秒，否则按秒处理。
 */
function durationMsOf(o: Obj): number {
  const raw = num(o, "Duration", "duration", "HQDuration", "time_length", "timelength", "timelen");
  if (raw <= 0) return 0;
  return raw > 10000 ? Math.round(raw) : Math.round(raw * 1000);
}

// ---- 封面 URL 归一化 ----

/** 封面尺寸占位符要替换成的值（对齐参考实现的 400） */
const COVER_SIZE = 400;

/**
 * 酷狗封面 URL 归一化。上游常返回 `…/{size}/xxx.jpg` 这种**带占位符**的模板，
 * 原样下发必然 404（实机表现为封面全变占位图）。逐条对齐参考实现的
 * normalizeCoverUrl：
 *   ① 去掉上游包裹的反引号；
 *   ② 协议相对路径（`//host/…`）与 `http://` 一律升到 https；
 *   ③ `{size}` 占位符 → 具体尺寸；
 *   ④ 旧域名 c1.kgimg.com → imge.kugou.com。
 * 对已是合法形态的 URL 幂等。
 */
function normalizeCover(raw: string): string {
  const s = raw.trim().replace(/`/g, "");
  if (!s) return "";
  return s
    .replace(/^\/\//, "https://")
    .replace(/^http:\/\//i, "https://")
    .replace(/\{size\}/g, String(COVER_SIZE))
    .replace(/c1\.kgimg\.com/i, "imge.kugou.com");
}

// ---- 嵌套对象展开 ----
//
// 列表类接口的字段位置不统一：`/playlist/detail`、`/rank/audio` 把封面、专辑、
// hash 家族藏在 audio_info / album_info 等嵌套对象里，顶层常常只有一个 hash
// 和名称（参考实现 mergeNestedSongRecord 就是为此）。这里做一层浅展开作为
// **兜底**：顶层同名字段优先，避免 album_info.name 之类覆盖掉歌曲名。

const NESTED_KEYS = ["album_info", "albuminfo", "audio", "audio_info", "song_info", "base"];

function mergeNested(item: Obj): Obj {
  let merged: Obj = {};
  for (const key of NESTED_KEYS) {
    const nested = item[key];
    if (!isObj(nested)) continue;
    for (const [k, v] of Object.entries(nested)) {
      if (!(k in merged)) merged[k] = v;
    }
  }
  // 顶层字段覆盖嵌套兜底值
  merged = { ...merged, ...item };
  return merged;
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
  // 嵌套形态（playlist/detail、rank/audio）：顶层可能只有 hash + 一层嵌套
  "audio_info",
  "album_info",
  "song_info",
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

function toOnlineSong(raw: Obj): OnlineSong {
  const item = mergeNested(raw);
  const singers = Array.isArray(item.Singers)
    ? (item.Singers as unknown[]).map((s) => (isObj(s) ? String(s.name ?? "") : "")).filter(Boolean)
    : [];
  // 歌手字段：Singers[].name → singerinfo[].name → 标量（顿号/斜杠分隔）
  const singerInfo = Array.isArray(item.singerinfo)
    ? (item.singerinfo as unknown[])
        .map((s) => (isObj(s) ? String(s.name ?? "") : ""))
        .filter(Boolean)
    : [];
  const artist =
    singers.join("/") ||
    singerInfo.join("/") ||
    str(item, "singername", "SingerName", "author_name", "singer_name")
      .split(/[、/]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join("/");

  const durationMs = durationMsOf(item);
  const hash = str(item, "hash", "FileHash", "Hash128", "HQFileHash", "SQFileHash", "hash_128");
  const albumAudioId = str(
    item,
    "album_audio_id",
    "AlbumAudioID",
    "mixsongid",
    "MixSongID",
    "EMixSongID",
    "Audioid",
    "audio_id",
    "ID",
    "id",
  );
  const albumId = str(item, "album_id", "AlbumID", "albumid");
  const name = cleanTitle(str(item, "SongName", "songname", "filename", "name"), artist);

  return {
    id: albumAudioId || hash,
    name,
    artist,
    album: str(item, "AlbumName", "album_name", "albumname") || undefined,
    // 播放地址延迟解析（见文件头说明）
    url: "",
    // 封面候选顺序对齐参考实现：优先 sizable/union 这类大图字段，
    // 最后才退到 Image / img；统一过一遍 normalizeCover（{size} 占位符等）
    pic: normalizeCover(
      str(
        item,
        "sizable_cover",
        "album_sizable_cover",
        "Image",
        "ImgUrl",
        "imgurl",
        "img",
        "pic",
        "cover",
        "cover_pic",
        "union_cover",
      ),
    ),
    lrc: "",
    server: "kugou",
    hash,
    albumAudioId,
    albumId,
    durationMs,
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
      // 榜单封面同样带 {size} 占位符，必须过一遍归一化
      cover: normalizeCover(str(o, "imgurl", "imgUrl", "img", "cover")),
      desc: str(o, "update_frequency", "updateFrequency", "intro", "desc"),
    }))
    .filter((c) => c.id && c.name);
}

// ---- 播放地址延迟解析 ----

/** 播放地址会话缓存（hash → url） */
const urlCache = new Map<string, string>();

/**
 * 解析单首酷狗歌曲的播放地址。
 * 成功时把 `trial`（是否试听片段）写回歌曲对象；失败返回空串
 * （调用方据此提示「无法播放」），不抛异常。
 */
export async function resolveKugouUrl(song: OnlineSong): Promise<string> {
  if (song.url) return song.url;
  if (!song.hash) return "";
  const cached = urlCache.get(song.hash);
  if (cached) return cached;
  try {
    const res = await capabilities.kugouSongUrl(song.hash, song.albumAudioId, song.albumId);
    if (res?.url) {
      urlCache.set(song.hash, res.url);
      song.trial = !!res.trial;
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
