/** 双端共享类型定义。字段名与 Rust 侧 `#[serde(rename_all = "camelCase")]` 输出严格对应。 */

export type MediaType = "image" | "video" | "audio" | "book";

/** 文件索引记录 */
export interface MediaFile {
  id: string; // xxh3(path)
  path: string;
  parent: string;
  name: string;
  ext: string;
  type: MediaType;
  size: number;
  mtime: number;
  scanned_at: number;
  deleted: number;
}

/** 列表项：files ⨝ media_metadata 的扁平化结果，列表页一次取全 */
export interface MediaEntry {
  id: string;
  path: string;
  parent: string;
  name: string;
  ext: string;
  type: MediaType;
  size: number;
  mtime: number;
  scannedAt: number;
  deleted: number;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  codec?: string | null;
  fps?: number | null;
  takenAt?: number | null;
  hasCover: boolean;
  favorite: boolean;
}

/** 媒体元数据（详情面板用的完整字段集） */
export interface MediaMetadata {
  fileId: string;
  title?: string | null;
  artist?: string | null;
  albumArtist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  trackNo?: number | null;
  discNo?: number | null;
  durationMs?: number | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  width?: number | null;
  height?: number | null;
  orientation?: number | null;
  codec?: string | null;
  fps?: number | null;
  takenAt?: number | null;
  camera?: string | null;
  lens?: string | null;
  iso?: number | null;
  exposure?: string | null;
  fNumber?: number | null;
  focalLength?: number | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  author?: string | null;
  publisher?: string | null;
  language?: string | null;
  pageCount?: number | null;
  chapterCount?: number | null;
  hasCover: boolean;
  hasLyrics: boolean;
}

/** 扫描配置 */
export interface ScanConfig {
  dirs: string[];
  maxDepth?: number;
  followLinks?: boolean;
  forceReparse?: boolean;
}

export type ScanStage =
  | "pending"
  | "enumerate"
  | "store"
  | "parse"
  | "done"
  | "cancelled"
  | "error";

/** 扫描进度 */
export interface ScanProgress {
  jobId: string;
  stage: ScanStage;
  done: number;
  total: number;
  percent: number;
  currentPath: string;
  added: number;
  updated: number;
  removed: number;
  error?: string | null;
}

/** 列表查询参数 */
export interface ListQuery {
  type?: MediaType | string;
  search?: string;
  sortBy?: "name" | "mtime" | "size" | "title" | "taken_at";
  desc?: boolean;
  /** 最小文件体积（字节），小于此值的文件被过滤掉 */
  minSize?: number;
  limit?: number;
  offset?: number;
}

/** 歌曲（音频+元数据+封面+歌词） */
export interface Song {
  file: MediaFile;
  meta: MediaMetadata;
  coverBase64?: string | null;
  lyrics?: string | null;
}

/** 歌词行 */
export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

/** FFmpeg 探测状态 */
export interface FfmpegStatus {
  available: boolean;
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  version?: string | null;
  source: "override" | "path" | "none";
}

/** 阅读进度 */
export interface BookProgress {
  book_id: string;
  location: string;
  page: number;
  percent: number;
  updated_at: number;
}

/** SMTC 媒体信息（推送 Windows 系统媒体控件，换歌时调用） */
export interface SmtcMedia {
  title: string;
  artist?: string | null;
  album?: string | null;
  durationMs: number;
  /** 音频文件路径，Rust 侧据此提取封面（在线歌曲传空串） */
  filePath: string;
  /** 在线歌曲封面 URL（http(s)）；提供时优先使用 */
  coverUrl?: string | null;
}

/** SMTC 播放状态（播放/暂停 + 进度） */
export interface SmtcPlayback {
  playing: boolean;
  positionMs: number;
  durationMs: number;
}

/** SMTC 系统媒体键命令（事件 `smtc:command` 载荷） */
export interface SmtcCommand {
  kind: "play" | "pause" | "next" | "prev" | "stop" | "seek";
  /** kind 为 seek 时的目标位置（毫秒） */
  positionMs?: number;
}

/** 在线音乐平台 */
export type MusicServer = "netease" | "tencent";

/** 在线歌曲（meting API 返回） */
export interface OnlineSong {
  id: string;
  name: string;
  artist: string;
  /** 可播放音频 URL */
  url: string;
  /** 封面图片 URL */
  pic: string;
  /** 歌词文本 URL */
  lrc: string;
  album?: string;
}

/** 播放队列项：本地文件或在线歌曲 */
export type QueueItem = MediaEntry | OnlineSong;

/** 当前播放曲目（本地/在线统一形态，供播放器与迷你播放器渲染） */
export interface NowPlaying {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** 封面：本地为 dataURL，在线为 http(s) URL */
  cover: string;
  /** 音频源：本地为 asset:// 转换结果，在线为 http(s) URL */
  src: string;
  lyrics: LyricLine[];
  /** 本地歌曲的磁盘路径（SMTC 提取封面用） */
  filePath?: string;
  /** 在线歌曲的封面 URL（SMTC 直接使用） */
  coverUrl?: string;
  durationMs?: number;
  kind: "local" | "online";
}

/** 在线歌单（用户自添加） */
export interface OnlinePlaylistEntry {
  server: MusicServer;
  id: string;
  name: string;
}
