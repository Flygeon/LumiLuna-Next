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
  "pending" | "enumerate" | "store" | "parse" | "done" | "cancelled" | "error";

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
/** 皮肤清单元信息（skin_list 返回；字段语义见 doc/皮肤系统开发方案书.md §4） */ export interface SkinMeta {
  name: string;
  version: string;
  author: string;
  description?: string | null;
  minAppVersion?: string | null;
  /** 支持的模式子集：light / dark */
  modes: string[];
  /** 皮肤作者声明已适配种子色动态配色 */
  seedColor: boolean;
  accent?: string | null;
  /** 皮肤格式版本：1 = 纯 JSON，2 = ZIP 资产包 */
  formatVersion: number;
  /** v2 能力徽标：是否携带背景图 / 图标包 */
  hasBackground: boolean;
  hasIcons: boolean;
}

/** 皮肤库条目：status = ok | broken（损坏条目仅展示与可删除） */
export interface SkinEntry {
  id: string;
  status: "ok" | "broken";
  error?: string | null;
  meta?: SkinMeta | null;
}

/** skin_load 返回：json 原文 + 库内资产文件清单（v1 皮肤清单为空） */
export interface LoadedSkin {
  json?: string | null;
  files: string[];
}

/** skin_stage_zip 返回：staging 令牌 + skin.json 原文 + 解包文件清单 */
export interface StagedSkin {
  staging: string;
  json: string;
  files: string[];
}

// ── 在线番剧（Kazumi 规则采集，桌面端）──────────────────────────

/** 规则模式：xpath 选择器 / api + JSONPath */
export type AnimeRuleMode = "xpath" | "api";

/** 选集模式（同 Kazumi Plugin.chapterMode） */
export type AnimeChapterMode = "xpath" | "api";

/** API 模式规则的请求定义（searchApiConfig / chapterApiConfig.request） */
export interface AnimeApiRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  bodyType?: "none" | "json" | "form";
  body?: unknown;
}

/** API 模式搜索配置 */
export interface AnimeSearchApiConfig {
  request: AnimeApiRequest;
  listPath: string;
  namePath: string;
  sourcePath: string;
}

/** API 模式选集配置（嵌套 JSON / 分隔字符串两种） */
export interface AnimeChapterApiConfig {
  request: AnimeApiRequest;
  /** nested=嵌套 JSON，delimited=分隔字符串 */
  format: "nested" | "delimited";
  roadsPath: string;
  roadNamePath: string;
  episodesPath: string;
  episodeNamePath: string;
  episodeUrlPath: string;
  roadNamesPath: string;
  roadEpisodesPath: string;
  roadSeparator: string;
  episodeSeparator: string;
  fieldSeparator: string;
  /** 命名 JSONPath 捕获，供播放页模板变量用 */
  variables?: Record<string, string>;
  /** 播放页模板 */
  episodePage?: { url: string; query?: Record<string, string> };
}

/** 反爬配置（Phase 1 仅透传保存，不执行） */
export interface AnimeAntiCrawlerConfig {
  enabled?: boolean;
  captchaType?: string;
  captchaImage?: string;
  captchaInput?: string;
  captchaButton?: string;
  captchaDetectType?: string;
  captchaDetectValue?: string;
  captchaScript?: string;
}

/** 规则（Kazumi Plugin JSON 的宽松兼容模型；normalizeRule 后的字段均为必填） */
export interface AnimeRule {
  api?: string;
  type?: string;
  name: string;
  version?: string;
  muliSources?: boolean;
  useWebview?: boolean;
  useNativePlayer?: boolean;
  userAgent?: string;
  baseURL: string;
  referer?: string;
  usePost?: boolean;
  useLegacyParser?: boolean;
  adBlocker?: boolean;
  searchMode?: AnimeRuleMode;
  chapterMode?: AnimeChapterMode;
  searchURL: string;
  searchList: string;
  searchName: string;
  searchResult: string;
  chapterRoads: string;
  chapterResult: string;
  searchApiConfig?: AnimeSearchApiConfig;
  chapterApiConfig?: AnimeChapterApiConfig;
  antiCrawlerConfig?: AnimeAntiCrawlerConfig;
  /** 静态取流：从播放页 HTML 抠直链的正则（Phase 1 快速路径） */
  streamRegex?: string;
  /** 静态取流：JSONPath 提取（指向页面内嵌 JSON 的播放地址字段） */
  streamJsonPath?: string;
  /** 任意自定义 http 头（抓取与取流时带上） */
  httpHeaders?: Record<string, string>;
  /** 自定义 CSS / JS（原项目字段，透传保存） */
  css?: string;
  scripts?: string[];
}

/** 规则库条目（Rust 侧扫描 app data rules/ 目录） */
export interface AnimeRuleEntry {
  name: string;
  version?: string;
  enabled: boolean;
  /** 校验后的规则 JSON 原文 */
  json: string;
}

/** 搜索结果条目（Kazumi SearchItem：name + src） */
export interface AnimeSearchItem {
  name: string;
  src: string;
}

/** 番剧列表/目录条目（列表页 XPath 产出） */
export interface AnimeItem {
  /** 详情页 URL（相对 baseURL 或绝对） */
  src: string;
  title: string;
  cover?: string;
  desc?: string;
}

/** 单集 */
export interface AnimeEpisode {
  /** 播放页 URL */
  url: string;
  name: string;
}

/** 播放线路（Kazumi Road） */
export interface AnimeRoad {
  name: string;
  episodes: AnimeEpisode[];
}

/** 番剧详情（含分集线路） */
export interface AnimeDetail {
  title: string;
  cover?: string;
  desc?: string;
  roads: AnimeRoad[];
}

/** Bangumi 封面图组（api.bgm.tv 与 next.bgm.tv 字段都归一到这里） */
export interface BangumiImageSet {
  large?: string;
  common?: string;
  medium?: string;
  small?: string;
  grid?: string;
}

/**
 * Bangumi.tv 条目（Kazumi BangumiItem 的简化落地）。
 * 归一化自两种响应：api.bgm.tv v0（snake_case：name_cn / meta_tags / rating.score）
 * 与 next.bgm.tv p1（camelCase：nameCN / metaTags / rating.score）。字段均可在 TS 侧
 * 归一化为下方可选形式，Rust 不下发 Bangumi 结构。
 */
export interface BangumiSubject {
  id: number;
  /** 原语名（日文等，next.bgm.tv 的 name；api.bgm.tv 的 name） */
  name: string;
  /** 中文名（name_cn / nameCN，可能为空） */
  nameCn?: string;
  /** 简介 */
  summary?: string;
  /** 放送日期 YYYY-MM-DD */
  airDate?: string;
  /** 放送星期（1-7） */
  airWeekday?: number;
  /** 排名（0 表示未上榜） */
  rank?: number;
  /** 评分（0-10） */
  rating?: number;
  /** 评分人数 */
  votes?: number;
  /** 总集数 */
  eps?: number;
  /** 放送平台：TV / 剧场版 / OVA 等 */
  platform?: string;
  images?: BangumiImageSet;
  /** 标签（metaTags） */
  tags?: string[];
  /** 别名（从 infobox 提取） */
  alias?: string[];
  /**
   * 「在看」人数（api.bgm.tv/calendar 的 collection.doing）。
   * 热播榜按它降序排，卡片副标题也展示它。
   */
  doing?: number;
}

/**
 * Bangumi 收藏类别（官方 CollectionType 口径）：
 * 1 想看 / 2 看过 / 3 在看 / 4 搁置 / 5 抛弃。
 * 0 仅作为「未收藏」的本地哨兵值，不会发给服务器。
 */
export type BangumiCollectionCategory = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * 用户的一条 Bangumi 条目收藏（GET /v0/users/{username}/collections 的数组元素）。
 * subject 复用 BangumiSubject 归一化模型（收藏接口内嵌的是 v0 SubjectVO，字段更瘦）。
 */
export interface BangumiUserCollection {
  subjectId: number;
  category: BangumiCollectionCategory;
  /** 用户评分（0-10，未打分为 undefined） */
  rate?: number;
  /** 用户短评 */
  comment?: string;
  /** 最后更新时间（服务器原样字符串） */
  updatedAt?: string;
  /** 剧集收集进度（collect=已看集数，done=标记为看过集数） */
  epStatus?: { collected?: number; done?: number };
  subject: BangumiSubject;
}

/** GET /v0/me 返回的当前授权用户信息（access token 对应的账号） */
export interface BangumiAuthUser {
  id: string;
  username: string;
  nickname: string;
  avatar?: string;
}

/**
 * 聚合搜索的单源结果（照 Kazumi SourceSheet：每个插件一张卡片，
 * 显示状态 + 命中条目）。）
 */
export interface AnimeSourceSearchResult {
  pluginName: string;
  pluginVersion?: string;
  status: "pending" | "success" | "noResult" | "error";
  /** 错误 / 无结果时的可读说明 */
  message?: string;
  /** 该源搜到的条目（Kazumi SearchItem：name + src） */
  items: AnimeSearchItem[];
}

/** 取流结果 */
export interface AnimeStream {
  /** 可直接给 <video> 用的 URL（防盗链时是本地代理 URL） */
  url: string;
  /** 远端原始 URL（调试展示用） */
  remoteUrl: string;
  /** 是否走本地代理 */
  proxied: boolean;
  /** 取流方式：static / webview */
  method: "static" | "webview";
}

/** 历史记录（SQLite anime_history 行） */
export interface AnimeHistoryItem {
  key: string;
  plugin: string;
  animeId: string;
  title: string;
  cover?: string | null;
  lastEpisode?: string | null;
  episodePageUrl?: string | null;
  /** 该源的番剧详情页 URL（Kazumi lastSrc 同款，续播时重查线路用） */
  detailUrl?: string | null;
  roadIndex: number;
  episodeIndex: number;
  progressMs: number;
  durationMs: number;
  updatedAt: number;
}

/** 追番（SQLite anime_favorites 行） */
export interface AnimeFavoriteItem {
  plugin: string;
  animeId: string;
  title: string;
  cover?: string | null;
  addedAt: number;
}

/** 动漫抓取请求（跨 Tauri 边界；Rust 侧合并 cookie/UA/referer 默认值） */
export interface AnimeFetchSpec {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  /** 追加到 URL 的 query 参数（value 已 toString） */
  query?: Record<string, string>;
  body?: string;
  bodyType?: "none" | "json" | "form";
  /** 是否携带该规则已存的 cookie（XPath 章节请求按 Kazumi 惯例不带） */
  includeCookies?: boolean;
  /** 自定义 Referer（Rust 侧默认 baseURL + "/"） */
  referer?: string;
  /** 自定义 User-Agent（Rust 侧默认内置 UA） */
  userAgent?: string;
  /**
   * 单次请求超时（毫秒）。聚合搜索会同时查几十个源，卡死的站点必须快速失败，
   * 否则整轮检索被拖到分钟级。不传用 Rust 侧默认（15s）。
   */
  timeoutMs?: number;
}

/** anime_fetch 返回：HTML 原文 + 重定向后最终 URL */
export interface AnimeFetchResult {
  html: string;
  finalUrl?: string;
}

/** anime_media_url 返回：可交给 <video src> 的本地代理 URL */
export interface AnimeMediaUrlResult {
  url: string;
}

/** 取流结果（webview 兜底路径） */
export interface AnimeResolveStreamResult {
  url: string;
  remoteUrl: string;
  proxied: boolean;
  method: "webview";
}

// =====================================================================
// DanDanPlay 弹幕（参照在线播放参考 lib/modules/danmuku/ + lib/request/）
// =====================================================================

/**
 * DanDanPlay 弹幕条目原始 p 字段解析结果。
 * p 字段原始格式：`"time,type,color,source"`（type 1=滚动 / 4=底部 / 5=顶部；
 * color 是十进制 RGB；source 为来源标签如 "bilibili"/"gamer"/"dandan"）。
 */
export interface DanmakuEntry {
  /** 弹幕出现时间（秒） */
  time: number;
  /** 弹幕模式：1=滚动 / 4=底部 / 5=顶部 */
  mode: 1 | 4 | 5;
  /** 颜色（十进制 RGB int，转前端用 `#rrggbb`） */
  color: number;
  /** 来源标签（用于来源过滤：bilibili / gamer / dandan） */
  source: string;
  /** 弹幕文本 */
  text: string;
}

/** DanDanPlay 搜索单集结果（GET /api/v2/search/episodes） */
export interface DandanSearchEpisode {
  animeId: number;
  /** 该集在 dandan 库里的全局集 id（喂给 /api/v2/comment/{id}） */
  episodeId: number;
  animeTitle: string;
  episodeTitle: string;
  type: string;
  /** 是否已完结 */
  isCompleted: boolean;
}

/** DanDanPlay 单集详情（GET /api/v2/bangumi/{animeId} 的 episodes[]） */
export interface DandanEpisode {
  episodeId: number;
  episodeTitle: string;
}

/** DanDanPlay 番剧详情（来自 /api/v2/bangumi/{animeId} 或 /api/v2/bangumi/bgmtv/{id}） */
export interface DandanBangumi {
  animeId: number;
  animeTitle: string;
  /** 该番剧在 dandan 库里的总集数 */
  episodeCount: number;
  /** 集列表（bangumi/bgmtv 端点可能不返回 episodes，需要 fallback 到 search） */
  episodes?: DandanEpisode[];
}

/** DanDanPlay 评论响应（GET /api/v2/comment/{episodeId}?withRelated=true） */
export interface DandanCommentResponse {
  count: number;
  comments: DanmakuEntry[];
}

// =====================================================================
// 在线图片（Pixiv，移植自 Pixez）
// =====================================================================

export interface PixivImageUrls {
  squareMedium?: string | null;
  medium?: string | null;
  large?: string | null;
  original?: string | null;
}

export interface PixivUser {
  id: number;
  name: string;
  account: string;
  profileImageUrls?: PixivImageUrls | null;
}

export interface PixivTag {
  name: string;
  translatedName?: string | null;
}

export interface PixivMetaSinglePage {
  originalImageUrl?: string | null;
}

export interface PixivMetaPage {
  imageUrls: PixivImageUrls;
}

export interface PixivBookmarkData {
  id?: number | null;
}

export interface PixivIllust {
  id: number;
  title: string;
  type: string;
  caption: string;
  totalView: number;
  totalBookmarks: number;
  createDate?: string | null;
  pageCount: number;
  width: number;
  height: number;
  sanityLevel: number;
  restrict: number;
  xRestrict: number;
  tags: PixivTag[];
  user: PixivUser;
  imageUrls: PixivImageUrls;
  metaSinglePage?: PixivMetaSinglePage | null;
  metaPages: PixivMetaPage[];
  bookmarkData?: PixivBookmarkData | null;
}

export interface PixivIllustPage {
  illusts: PixivIllust[];
  nextUrl?: string | null;
}

export interface PixivIllustDetail {
  illust: PixivIllust;
  related: PixivIllust[];
}

export interface PixivLoginStatus {
  loggedIn: boolean;
  user?: PixivUser | null;
}

export interface PixivComment {
  id: number;
  comment: string;
  date?: string | null;
  user: PixivUser;
  /** 楼中楼父评论 */
  parentComment?: PixivComment | null;
}

export interface PixivCommentsPage {
  comments: PixivComment[];
  /** 下一页 offset；null 表示没有更多 */
  nextOffset?: number | null;
  total?: number | null;
}

export interface PixivUserDetail {
  user: PixivUser;
  totalIllusts: number;
  following: number;
}

export interface PixivTrendTag {
  name: string;
  translatedName?: string | null;
  /** 该标签下第一部作品的缩略图 */
  cover?: string | null;
}

export interface PixivUgoiraFrame {
  /** 解压后帧图片的本地路径（经 pixiv_frame_bytes 读字节转 Blob） */
  path: string;
  delayMs: number;
}

export interface PixivUgoiraFrames {
  frames: PixivUgoiraFrame[];
}

export interface PixivSearchOpts {
  sort?: string;
  searchTarget?: string;
  startDate?: string;
  endDate?: string;
  bookmarkNumMin?: number;
  bookmarkNumMax?: number;
}
