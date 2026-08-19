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

/** 逐字单元：一个字/词的起止时间（秒） */
export interface WordUnit {
  text: string;
  start: number;
  end: number;
}

/** 歌词行 */
export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
  /** 罗马音（日韩歌曲的官方罗马音轨，可与翻译切换显示） */
  romaji?: string;
  /** 逐字时间轴（可选）：无则整行一次性高亮 */
  units?: WordUnit[];
  /** 前奏/间奏的省略标记行（三点），不是真实歌词 */
  instrumental?: boolean;
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
  bookId: string;
  /** EPUB 用 CFI 精确定位；PDF 可为空 */
  location: string;
  /** 章节/页码索引（从 1 起） */
  page: number;
  /** 阅读百分比 0-100 */
  percent: number;
  updatedAt: number;
}

/** WebDAV 条目（PROPFIND 结果，path 为相对路径，段间 "/" 分隔） */
export interface WebDavEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

/** 音频 EQ 频段 */
export interface EqBand {
  frequency: number;
  gain: number;
}

/** 音频音效配置 */
export interface AudioEffectConfig {
  enabled: boolean;
  eqBands: EqBand[];
  bassBoost: number;
  reverb: number;
  stereoWidth: number;
  presetId: string;
}

/** 音效预设（内置或用户自定义） */
export interface AudioEffectPreset {
  id: string;
  name: string;
  config: AudioEffectConfig;
  builtin?: boolean;
}

/** WebDAV 连接测试结果 */
export interface WebDavStatus {
  ok: boolean;
  /** 服务器返回的根目录 displayname（如有） */
  rootName?: string | null;
}

/** 网易云账号信息 */
export interface NeteaseProfile {
  userId: number;
  nickname: string;
  avatarUrl: string;
}

/** 网易云我的歌单 */
export interface NeteasePlaylist {
  id: number;
  name: string;
  coverUrl: string;
  trackCount: number;
}

/** 网易云歌曲（歌单/云盘列表项，不含播放 URL） */
export interface NeteaseSong {
  id: number;
  name: string;
  artist: string;
  album?: string | null;
  picUrl?: string | null;
}

/** 网易云盘分页 */
export interface NeteaseCloudPage {
  songs: NeteaseSong[];
  hasMore: boolean;
  count: number;
}

/** 扫码登录轮询状态：800 等待 / 801 已扫码 / 802 确认中 / 803 成功 */
export interface NeteaseQrCheck {
  code: number;
  nickname?: string | null;
  avatarUrl?: string | null;
}

/** 网易云评论用户 */
export interface NeteaseCommentUser {
  userId?: number;
  nickname?: string;
  avatarUrl?: string;
  vipType?: number;
}

/** 网易云评论回复引用 */
export interface NeteaseCommentReply {
  user?: NeteaseCommentUser;
  content?: string;
}

/** 网易云评论 */
export interface NeteaseComment {
  commentId: number;
  content: string;
  time: number;
  likedCount: number;
  liked: boolean;
  user?: NeteaseCommentUser;
  beReplied?: NeteaseCommentReply[];
  ipLocation?: { location?: string };
}

/** 网易云歌曲评论分页 */
export interface NeteaseCommentsPage {
  total: number;
  more: boolean;
  comments: NeteaseComment[];
  hotComments: NeteaseComment[];
}

/** 网易云推荐歌单卡片 */
export interface NeteaseRecommendPlaylist {
  id: number;
  name: string;
  picUrl: string;
  playCount: number;
  copywriter: string;
}

// ── 在线小说（Wenku8）──────────────────────────────────────────

export interface NovelCover {
  aid: string;
  title: string;
  imageUrl: string;
  author?: string | null;
}

export interface NovelDetail {
  aid: string;
  title: string;
  author: string;
  status: string;
  finUpdate: string;
  imgUrl: string;
  introduce: string;
  tags: string[];
  heat: string;
  trending: string;
}

export interface NovelChapter {
  cid: string;
  title: string;
}

export interface NovelVolume {
  title: string;
  chapters: NovelChapter[];
}

export interface NovelContent {
  text: string;
  images: string[];
}

export interface NovelRecommendBlock {
  title: string;
  novels: NovelCover[];
}

export interface NovelShelfItem {
  aid: string;
  title: string;
  author: string;
  cover: string;
  addedAt: number;
  /** true=来自 Wenku8 在线账号书架，false=本地收藏 */
  online: boolean;
}

export interface Wenku8LoginStatus {
  loggedIn: boolean;
  uname?: string;
  nickname?: string;
}

export interface Wenku8UserInfo {
  uid: string;
  uname: string;
  nickname: string;
  group: string;
  avatar: string;
  messageCount: string;
  experience: string;
  credit: string;
  point: string;
  vip: string;
}

export interface NovelProgress {
  aid: string;
  cid: string;
  chapterTitle: string;
  position: number;
  updatedAt: number;
}

export interface NovelReadSessionStart {
  id: string;
  bookId: string;
  source: "local" | "online";
  title: string;
  chapterKey: string;
  chapterTitle: string;
  startedAt: number;
}

export interface NovelReadSessionEnd {
  id: string;
  bookId: string;
  source: "local" | "online";
  title: string;
  chapterKey: string;
  chapterTitle: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  completed: boolean;
}

export interface NovelDailyStat {
  day: string;
  readCount: number;
  totalMs: number;
  uniqueBooks: number;
  localMs: number;
  onlineMs: number;
}

export interface NovelSourceStat {
  source: string;
  readCount: number;
  totalMs: number;
}

export interface NovelTopBook {
  bookId: string;
  source: string;
  title: string;
  chapterTitle: string;
  readCount: number;
  totalMs: number;
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

/** 在线音乐平台（meting API；QQ 音乐平台选项已移除） */
export type MusicServer = "netease";

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

/** 播放队列项：本地文件 / 在线歌曲 / WebDAV 条目 */
export type QueueItem = MediaEntry | OnlineSong | WebDavEntry;

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
  kind: "local" | "online" | "webdav";
}

/** 在线歌单（用户自添加） */
export interface OnlinePlaylistEntry {
  server: MusicServer;
  id: string;
  name: string;
}

// ── 听歌时长统计 ──────────────────────────────────────────────

/** 播放来源 */
export type PlaySource = "local" | "online" | "webdav";

/** 开始播放会话 */
export interface PlaySessionStart {
  id: string;
  trackId: string;
  source: PlaySource;
  startedAt: number;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  contentHash?: string | null;
  coverUrl?: string | null;
  srcUrl?: string | null;
  qualityBr?: number | null;
}

/** 结束播放会话 */
export interface PlaySessionEnd {
  id: string;
  trackId: string;
  source: PlaySource;
  startedAt: number;
  endedAt: number;
  listenedMs: number;
  completed: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  contentHash?: string | null;
  coverUrl?: string | null;
  srcUrl?: string | null;
  qualityBr?: number | null;
}

/** 日统计 */
export interface ListenStats {
  day: string;
  playCount: number;
  uniqueTracks: number;
  totalMs: number;
}

/** 来源分布统计 */
export interface ListenSourceStat {
  source: string;
  playCount: number;
  totalMs: number;
}

/** 歌曲排行统计 */
export interface TopTrackStat {
  trackId: string;
  source: string;
  title: string;
  artist: string;
  album: string;
  coverUrl?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  contentHash?: string | null;
  playCount: number;
  totalMs: number;
  srcUrl?: string | null;
}