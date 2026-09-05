/**
 * 统一 Capabilities 前端接口。
 * 所有原生能力经 invoke（请求/响应）+ listen（事件推送）调用 Rust Command。
 * 前端不直接触碰磁盘/数据库/原生资源。
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type {
  BookProgress,
  FfmpegStatus,
  ListenSourceStat,
  ListenStats,
  ListQuery,
  MediaEntry,
  MediaMetadata,
  PlaySessionEnd,
  PlaySessionStart,
  ScanConfig,
  ScanProgress,
  SmtcCommand,
  SmtcMedia,
  SmtcPlayback,
  NeteaseCloudPage,
  NeteaseComment,
  NeteaseCommentsPage,
  NeteasePlaylist,
  NeteaseProfile,
  NeteaseQrCheck,
  NeteaseRecommendPlaylist,
  NeteaseSong,
  NovelContent,
  NovelCover,
  NovelDailyStat,
  NovelDetail,
  NovelProgress,
  NovelReadSessionEnd,
  NovelReadSessionStart,
  NovelRecommendBlock,
  NovelShelfItem,
  NovelSourceStat,
  NovelTopBook,
  NovelVolume,
  Wenku8LoginStatus,
  Wenku8UserInfo,
  Song,
  SkinEntry,
  LoadedSkin,
  StagedSkin,
  TopTrackStat,
  WebDavEntry,
  WebDavStatus,
  AnimeFetchResult,
  AnimeFetchSpec,
  AnimeHistoryItem,
  AnimeFavoriteItem,
  AnimeMediaUrlResult,
  AnimeResolveStreamResult,
  AnimeRuleEntry,
  PixivIllustPage,
  PixivIllustDetail,
  PixivCommentsPage,
  PixivLoginStatus,
  PixivSearchOpts,
  PixivUserDetail,
  PixivTrendTag,
  PixivUgoiraFrames,
} from "@shared/types";
import { mockInvoke } from "./mock";

/** 在 Tauri 环境下调用；非 Tauri（纯 Web 预览）时降级为 mock。 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri) return mockInvoke<T>(cmd, args);
  return invoke<T>(cmd, args);
}

/** 小说阅读链路的带日志调用：invoke 前先写“准备调用”，成功后写结果长度，失败写错误。
 *  用于定位“点击书籍闪退”——若 Rust 同步 command 主线程 panic 闪退，
 *  日志最后一条就是本次调用与参数，能确定触发点。 */
async function loggedNovelInvoke<T>(
  cmd: string,
  args: Record<string, unknown>,
  tag: string,
  aid: string,
  cid?: string,
): Promise<T> {
  const label = `[novel-call] ${tag} aid=${aid}${cid ? ` cid=${cid}` : ""}`;
  void safeInvoke("app_log", { msg: `${label} -> invoke ${cmd}` }).catch(() => {});
  try {
    const r = await safeInvoke<T>(cmd, args);
    const len =
      r && typeof r === "object"
        ? JSON.stringify(r).length
        : String(r ?? "").length;
    void safeInvoke("app_log", { msg: `${label} OK len=${len}` }).catch(() => {});
    // content 场景：额外记录返回正文的开头，确认是真实章节内容而非缓存脏数据/主页导航
    if (tag === "content" && r && typeof r === "object") {
      const c = r as { text?: string; images?: unknown[] };
      const preview = (c.text ?? "").slice(0, 120);
      void safeInvoke("app_log", {
        msg: `${label} textPreview=[${preview.replace(/\n/g, "\\n")}] images=${c.images?.length ?? 0}`,
      }).catch(() => {});
    }
    return r;
  } catch (e) {
    void safeInvoke("app_log", {
      msg: `${label} ERR: ${(e as Error)?.message ?? String(e)}`,
    }).catch(() => {});
    throw e;
  }
}

export const capabilities = {
  // ---- 扫描 ----
  scanStart(config: ScanConfig): Promise<{ jobId: string }> {
    return safeInvoke("scan_start", { config });
  },
  scanCancel(jobId: string): Promise<void> {
    return safeInvoke("scan_cancel", { jobId });
  },
  scanStatus(jobId: string): Promise<ScanProgress | null> {
    return safeInvoke("scan_status", { jobId });
  },
  /** 订阅扫描进度事件；返回取消订阅函数 */
  async onScanProgress(handler: (p: ScanProgress) => void): Promise<UnlistenFn> {
    if (!isTauri) return () => {};
    return listen<ScanProgress>("scan:progress", (e) => handler(e.payload));
  },

  // ---- 媒体库 ----
  listFiles(query?: ListQuery): Promise<MediaEntry[]> {
    return safeInvoke("list_files", { query: query ?? null });
  },
  libraryCounts(minSize = 0): Promise<Record<string, number>> {
    return safeInvoke("library_counts", { minSize });
  },
  getMetadata(fileId: string): Promise<MediaMetadata> {
    return safeInvoke("get_metadata", { fileId });
  },
  getSong(fileId: string): Promise<Song> {
    return safeInvoke("get_song", { fileId });
  },
  /**
   * 缩略图。后端返回磁盘缓存路径，这里转成 asset:// URL 交给 <img> 流式加载。
   * 不用 base64 data URL：上万张图会把渲染进程内存撑爆。
   */
  async getThumbnail(fileId: string, size = 320): Promise<string | null> {
    const path = await safeInvoke<string | null>("get_thumbnail", { fileId, size });
    if (!path) return null;
    return isTauri ? convertFileSrc(path) : path;
  },
  clearThumbnailCache(): Promise<number> {
    return safeInvoke("clear_thumbnail_cache");
  },
  /** 查询缓存中是否已有缩略图（PDF 封面按需生成前先探测） */
  async thumbnailCachePath(fileId: string, size = 320): Promise<string | null> {
    const path = await safeInvoke<string | null>("thumbnail_cache_path", {
      fileId,
      size,
    });
    return path ? (isTauri ? convertFileSrc(path) : path) : null;
  },
  /** 保存前端渲染的封面（PDF 首页）到缩略图缓存 */
  async saveThumbnail(
    fileId: string,
    jpeg: Uint8Array,
    size = 320,
  ): Promise<string | null> {
    const path = await safeInvoke<string | null>("save_thumbnail", {
      fileId,
      size,
      jpeg: Array.from(jpeg),
    });
    return path ? (isTauri ? convertFileSrc(path) : path) : null;
  },

  // ---- 收藏 / 历史 / 回收站 ----
  toggleFavorite(fileId: string): Promise<boolean> {
    return safeInvoke("toggle_favorite", { fileId });
  },
  listFavorites(): Promise<MediaEntry[]> {
    return safeInvoke("list_favorites");
  },
  recordPlay(fileId: string): Promise<void> {
    return safeInvoke("record_play", { fileId });
  },
  listHistory(): Promise<MediaEntry[]> {
    return safeInvoke("list_history");
  },

  // ---- 听歌时长统计 ----
  startPlaySession(input: PlaySessionStart): Promise<void> {
    return safeInvoke("start_play_session", { input });
  },
  endPlaySession(input: PlaySessionEnd): Promise<void> {
    return safeInvoke("end_play_session", { input });
  },
  getListenStats(day?: string): Promise<ListenStats | null> {
    return safeInvoke("get_listen_stats", { day: day ?? null });
  },
  listListenStats(
    days: number,
    fromDay?: string,
    toDay?: string,
  ): Promise<ListenStats[]> {
    return safeInvoke("list_listen_stats", {
      days: days ?? null,
      fromDay: fromDay ?? null,
      toDay: toDay ?? null,
    });
  },
  listTopTracks(
    limit: number,
    days?: number | null,
    fromDay?: string,
    toDay?: string,
  ): Promise<TopTrackStat[]> {
    return safeInvoke("list_top_tracks", {
      limit: limit ?? null,
      days: days ?? null,
      fromDay: fromDay ?? null,
      toDay: toDay ?? null,
    });
  },
  listenSourceBreakdown(
    days?: number | null,
    fromDay?: string,
    toDay?: string,
  ): Promise<ListenSourceStat[]> {
    return safeInvoke("listen_source_breakdown", {
      days: days ?? null,
      fromDay: fromDay ?? null,
      toDay: toDay ?? null,
    });
  },
  listTrash(): Promise<MediaEntry[]> {
    return safeInvoke("list_trash");
  },
  emptyTrash(): Promise<number> {
    return safeInvoke("empty_trash");
  },

  // ---- 书籍阅读进度 ----
  getBookProgress(fileId: string): Promise<BookProgress | null> {
    return safeInvoke("get_book_progress", { fileId });
  },
  saveBookProgress(
    bookId: string,
    location: string,
    page: number,
    percent: number,
  ): Promise<void> {
    return safeInvoke("save_book_progress", { bookId, location, page, percent });
  },

  // ---- FFmpeg ----
  ffmpegStatus(): Promise<FfmpegStatus> {
    return safeInvoke("ffmpeg_status");
  },
  /** 传 null 清除手动路径，回落到系统 PATH 探测 */
  ffmpegSetPath(dir: string | null): Promise<FfmpegStatus> {
    return safeInvoke("ffmpeg_set_path", { dir });
  },
  async openFfmpegDownloadPage(): Promise<void> {
    const url = await safeInvoke<string>("ffmpeg_download_url");
    if (isTauri) await openUrl(url);
    else window.open(url, "_blank");
  },

  // ---- Windows 系统媒体控件 (SMTC) ----
  smtcSetMedia(media: SmtcMedia): Promise<void> {
    return safeInvoke("smtc_set_media", { ...media });
  },
  smtcSetPlayback(state: SmtcPlayback): Promise<void> {
    return safeInvoke("smtc_set_playback", { ...state });
  },
  /** 订阅系统媒体键（播放/暂停/上一首/下一首/拖动进度）；返回取消订阅函数 */
  async onSmtcCommand(handler: (cmd: SmtcCommand) => void): Promise<UnlistenFn> {
    if (!isTauri) return () => {};
    return listen<SmtcCommand>("smtc:command", (e) => handler(e.payload));
  },
  /** 订阅 Rust 托盘菜单发出的播放器命令（play/pause/toggle/next/prev/show） */
  async onAppPlayerCommand(handler: (action: string) => void): Promise<UnlistenFn> {
    if (!isTauri) return () => {};
    return listen<string>("app:player-command", (e) => handler(e.payload));
  },
  /** 退出应用（配合关闭最小化到托盘：托盘菜单「退出」或关闭拦截时显式退出） */
  exitApp(): Promise<void> {
    return safeInvoke("exit_app");
  },

  // ---- WebDAV ----
  webdavConfigure(url: string, username: string, password: string): Promise<void> {
    return safeInvoke("webdav_configure", { url, username, password });
  },
  webdavList(path: string): Promise<WebDavEntry[]> {
    return safeInvoke("webdav_list", { path });
  },
  webdavTest(): Promise<WebDavStatus> {
    return safeInvoke("webdav_test");
  },
  webdavMediaUrl(path: string): Promise<string> {
    return safeInvoke("webdav_media_url", { path });
  },

  // ---- 网易云账号 ----
  neteaseLoginQrKey(): Promise<string> {
    return safeInvoke("netease_login_qr_key");
  },
  neteaseLoginQrCheck(key: string): Promise<NeteaseQrCheck> {
    return safeInvoke("netease_login_qr_check", { key });
  },
  neteaseAccount(): Promise<NeteaseProfile> {
    return safeInvoke("netease_account");
  },
  neteaseSmsCaptchaSent(phone: string, ctcode?: string): Promise<void> {
    return safeInvoke("netease_sms_captcha_sent", { phone, ctcode: ctcode ?? null });
  },
  neteaseLoginCellphone(phone: string, captcha: string, ctcode?: string): Promise<NeteaseProfile> {
    return safeInvoke("netease_login_cellphone", { phone, captcha, ctcode: ctcode ?? null });
  },
  neteaseUserPlaylists(offset = 0, limit = 100): Promise<NeteasePlaylist[]> {
    return safeInvoke("netease_user_playlists", { offset, limit });
  },
  neteasePlaylistDetail(id: number): Promise<NeteaseSong[]> {
    return safeInvoke("netease_playlist_detail", { id });
  },
  neteaseCloud(offset = 0, limit = 50): Promise<NeteaseCloudPage> {
    return safeInvoke("netease_cloud", { offset, limit });
  },
  neteaseSongUrl(ids: number[]): Promise<{ id: number; url: string }[]> {
    return safeInvoke("netease_song_url", { ids });
  },
  neteaseSongComments(
    id: number,
    offset = 0,
    limit = 20,
  ): Promise<NeteaseCommentsPage> {
    return safeInvoke("netease_song_comments", { id, offset, limit });
  },
  neteaseSetSongLiked(id: number, like: boolean): Promise<void> {
    return safeInvoke("netease_set_song_liked", { id, like });
  },
  neteaseLikelist(uid: number): Promise<number[]> {
    return safeInvoke("netease_likelist", { uid });
  },
  neteaseRecommendPlaylists(limit = 20): Promise<NeteaseRecommendPlaylist[]> {
    return safeInvoke("netease_recommend_playlists", { limit });
  },
  neteaseDailyRecommendSongs(): Promise<NeteaseSong[]> {
    return safeInvoke("netease_daily_recommend_songs");
  },
  neteasePersonalFm(): Promise<NeteaseSong[]> {
    return safeInvoke("netease_personal_fm");
  },
  neteaseLogout(): Promise<void> {
    return safeInvoke("netease_logout");
  },

  // ---- 在线小说（Wenku8）----
  novelSearch(node: string, charset: string, query: string, page = 1): Promise<NovelCover[]> {
    return safeInvoke("novel_search", { node, charset, query, page });
  },
  novelRank(node: string, charset: string, sort: string, page = 1): Promise<NovelCover[]> {
    return safeInvoke("novel_rank", { node, charset, sort, page });
  },
  novelCategory(node: string, charset: string, tag: string, sort: string, page = 1): Promise<NovelCover[]> {
    return safeInvoke("novel_category", { node, charset, tag, sort, page });
  },
  novelRecommend(node: string, charset: string): Promise<NovelRecommendBlock[]> {
    return safeInvoke("novel_recommend", { node, charset });
  },
  /** 带日志的调用：记录点击书籍→detail/catalogue/content 的完整参数与结果，用于定位“点书闪退” */
  novelDetail(node: string, charset: string, aid: string): Promise<NovelDetail> {
    return loggedNovelInvoke<NovelDetail>("novel_detail", { node, charset, aid }, "detail", aid);
  },
  novelCatalogue(node: string, charset: string, aid: string): Promise<NovelVolume[]> {
    return loggedNovelInvoke<NovelVolume[]>("novel_catalogue", { node, charset, aid }, "catalogue", aid);
  },
  novelContent(node: string, charset: string, aid: string, cid: string, title: string): Promise<NovelContent> {
    return loggedNovelInvoke<NovelContent>("novel_content", { node, charset, aid, cid, title }, "content", aid, cid);
  },
  novelShelfList(): Promise<NovelShelfItem[]> {
    return safeInvoke("novel_shelf_list");
  },
  novelShelfAdd(aid: string, title: string, author?: string, cover?: string): Promise<void> {
    return safeInvoke("novel_shelf_add", { aid, title, author: author ?? null, cover: cover ?? null });
  },
  novelShelfRemove(aid: string): Promise<void> {
    return safeInvoke("novel_shelf_remove", { aid });
  },
  novelProgressGet(aid: string): Promise<NovelProgress | null> {
    return safeInvoke("novel_progress_get", { aid });
  },
  novelProgressSet(aid: string, cid: string, chapterTitle: string, position: number): Promise<void> {
    return safeInvoke("novel_progress_set", { aid, cid, chapterTitle, position });
  },
  novelChapterCacheGet(aid: string, cid: string): Promise<NovelContent | null> {
    return safeInvoke("novel_chapter_cache_get", { aid, cid });
  },
  novelChapterCachePut(aid: string, cid: string, title: string, content: NovelContent): Promise<void> {
    return safeInvoke("novel_chapter_cache_put", { aid, cid, title, content });
  },
  novelReadSessionStart(input: NovelReadSessionStart): Promise<void> {
    return safeInvoke("novel_read_session_start", { input });
  },
  novelReadSessionEnd(input: NovelReadSessionEnd): Promise<void> {
    return safeInvoke("novel_read_session_end", { input });
  },
  novelStatsGet(day?: string): Promise<NovelDailyStat | null> {
    return safeInvoke("novel_stats_get", { day: day ?? null });
  },
  novelStatsList(days?: number, fromDay?: string, toDay?: string): Promise<NovelDailyStat[]> {
    return safeInvoke("novel_stats_list", { days: days ?? null, fromDay: fromDay ?? null, toDay: toDay ?? null });
  },
  novelSourceBreakdown(days?: number, fromDay?: string, toDay?: string): Promise<NovelSourceStat[]> {
    return safeInvoke("novel_source_breakdown", { days: days ?? null, fromDay: fromDay ?? null, toDay: toDay ?? null });
  },
  novelTopBooks(limit?: number, days?: number): Promise<NovelTopBook[]> {
    return safeInvoke("novel_top_books", { limit: limit ?? null, days: days ?? null });
  },

  // ---- Wenku8 登录态（移植自 Hikari Novel）----
  /** 提交从 WebView 抓取到的 cookie（需含 jieqiUserInfo + jieqiVisitInfo） */
  wenku8LoginSubmit(cookie: string): Promise<Wenku8LoginStatus> {
    return safeInvoke("wenku8_login_submit", { cookie });
  },
  /** 查询当前登录状态（不触发网络） */
  wenku8LoginStatus(): Promise<Wenku8LoginStatus> {
    return safeInvoke("wenku8_login_status");
  },
  /** 退出登录，清空本地 cookie */
  wenku8Logout(): Promise<void> {
    return safeInvoke("wenku8_logout");
  },
  /** 已保存的用户信息 */
  wenku8Userinfo(): Promise<Wenku8UserInfo | null> {
    return safeInvoke("wenku8_userinfo");
  },
  /** 在线书架（bookcase.php），未登录/过期会抛 [WENKU8_LOGIN_REQUIRED] */
  wenku8ShelfOnline(node?: string): Promise<NovelShelfItem[]> {
    return safeInvoke("wenku8_shelf_online", { node: node ?? "net" });
  },
  /** 打开登录窗口并由 Rust 侧注入抓取脚本（initialization_script） */
  wenku8LoginOpen(): Promise<void> {
    return safeInvoke("wenku8_login_open");
  },
  /** 轮询登录窗口 cookie：Rust 直接读 webview 全量 cookie（含 httpOnly），命中即保存并关窗 */
  wenku8LoginPoll(): Promise<Wenku8LoginStatus> {
    return safeInvoke("wenku8_login_poll");
  },
  /** 前端（注入脚本/窗口监听）上报诊断日志到 Rust 侧日志文件 */
  wenku8LoginLog(msg: string): Promise<void> {
    return safeInvoke("wenku8_login_log", { msg });
  },

  // ---- 在线番剧（Kazumi 规则采集）----
  animeFetch(ruleName: string, spec: AnimeFetchSpec): Promise<AnimeFetchResult> {
    return safeInvoke("anime_fetch", { ruleName, spec });
  },
  /** 防盗链流：返回本地代理 URL（带规则 Referer/UA/headers/Cookie，透传 Range） */
  animeMediaUrl(ruleName: string, url: string): Promise<AnimeMediaUrlResult> {
    return safeInvoke("anime_media_url", { ruleName, url });
  },
  /** 取流兜底：隐藏 webview 加载播放页，钩子拦截 m3u8/mp4 后回传 */
  animeWebviewResolve(
    ruleName: string,
    pageUrl: string,
    baseUrl: string,
  ): Promise<AnimeResolveStreamResult | null> {
    return safeInvoke("anime_webview_resolve", { ruleName, pageUrl, baseUrl });
  },
  /** 规则库（app data rules/ 目录） */
  animeRulesList(): Promise<AnimeRuleEntry[]> {
    return safeInvoke("anime_rules_list");
  },
  /** 保存规则（同 name 覆盖）；json 为前端规范化后的文档 */
  animeRuleSave(name: string, json: string): Promise<void> {
    return safeInvoke("anime_rules_save", { name, json });
  },
  animeRuleDelete(name: string): Promise<void> {
    return safeInvoke("anime_rules_delete", { name });
  },
  /** 切换规则启用/禁用（禁用后不参与聚合搜索；默认禁用的死站可在此重新启用） */
  animeRuleSetEnabled(name: string, enabled: boolean): Promise<void> {
    return safeInvoke("anime_rules_set_enabled", { name, enabled });
  },
  /** 从 KazumiRules 社区仓库拉取规则 index（Phase 1 仅展示，不自动安装） */
  animeRuleIndex(): Promise<string> {
    return safeInvoke("anime_rules_index");
  },
  /** 历史记录 */
  animeHistoryList(): Promise<AnimeHistoryItem[]> {
    return safeInvoke("anime_history_list");
  },
  animeHistoryUpsert(item: AnimeHistoryItem): Promise<void> {
    return safeInvoke("anime_history_upsert", { item });
  },
  animeHistoryDelete(key: string): Promise<void> {
    return safeInvoke("anime_history_delete", { key });
  },
  /** 追番 */
  animeFavoritesList(): Promise<AnimeFavoriteItem[]> {
    return safeInvoke("anime_favorites_list");
  },
  animeFavoriteAdd(
    plugin: string,
    animeId: string,
    title: string,
    cover?: string | null,
  ): Promise<void> {
    return safeInvoke("anime_favorites_add", {
      plugin,
      animeId,
      title,
      cover: cover ?? null,
    });
  },
  animeFavoriteRemove(plugin: string, animeId: string): Promise<void> {
    return safeInvoke("anime_favorites_remove", { plugin, animeId });
  },

  // ---- 在线图片（Pixiv，移植自 Pixez）----
  pixivLoginStatus(): Promise<PixivLoginStatus> {
    return safeInvoke("pixiv_login_status");
  },
  pixivLoginOpen(): Promise<PixivLoginStatus> {
    return safeInvoke("pixiv_login_open");
  },
  pixivLoginSubmit(code: string): Promise<PixivLoginStatus> {
    return safeInvoke("pixiv_login_submit", { code });
  },
  pixivLogout(): Promise<void> {
    return safeInvoke("pixiv_logout");
  },
  /** 用已存 refresh_token 刷新会话（恢复 user 信息 / 续期） */
  pixivRefreshSession(): Promise<PixivLoginStatus> {
    return safeInvoke("pixiv_refresh_session");
  },
  pixivSetRefreshToken(token: string): Promise<PixivLoginStatus> {
    return safeInvoke("pixiv_set_refresh_token", { token });
  },
  pixivRecommended(): Promise<PixivIllustPage> {
    return safeInvoke("pixiv_recommended");
  },
  pixivRanking(mode: string, date?: string): Promise<PixivIllustPage> {
    return safeInvoke("pixiv_ranking", { mode, date: date ?? null });
  },
  pixivSearch(word: string, opts?: PixivSearchOpts): Promise<PixivIllustPage> {
    return safeInvoke("pixiv_search", { word, opts: opts ?? null });
  },
  pixivIllustDetail(id: number): Promise<PixivIllustDetail> {
    return safeInvoke("pixiv_illust_detail", { id });
  },
  /** 作品评论（offset 翻页） */
  pixivIllustComments(
    illustId: number,
    offset?: number | null,
  ): Promise<PixivCommentsPage> {
    return safeInvoke("pixiv_illust_comments", { illustId, offset: offset ?? null });
  },
  pixivImage(url: string): Promise<Uint8Array> {
    return safeInvoke("pixiv_image", { url });
  },
  pixivFollow(restrict: string): Promise<PixivIllustPage> {
    return safeInvoke("pixiv_follow", { restrict });
  },
  pixivNext(nextUrl: string): Promise<PixivIllustPage> {
    return safeInvoke("pixiv_next", { nextUrl });
  },
  pixivBookmarkAdd(illustId: number, restrict: string): Promise<void> {
    return safeInvoke("pixiv_bookmark_add", { illustId, restrict });
  },
  pixivBookmarkDelete(illustId: number): Promise<void> {
    return safeInvoke("pixiv_bookmark_delete", { illustId });
  },
  /** 查询作品是否已收藏 */
  pixivBookmarkDetail(illustId: number): Promise<boolean> {
    return safeInvoke("pixiv_bookmark_detail", { illustId });
  },
  /** 我的 / 某用户的收藏列表 */
  pixivUserBookmarks(userId: number, restrict: string): Promise<PixivIllustPage> {
    return safeInvoke("pixiv_user_bookmarks", { userId, restrict });
  },
  pixivUserDetail(userId: number): Promise<PixivUserDetail> {
    return safeInvoke("pixiv_user_detail", { userId });
  },
  pixivUserIllusts(userId: number): Promise<PixivIllustPage> {
    return safeInvoke("pixiv_user_illusts", { userId });
  },
  /** 关注 / 取关用户 */
  pixivFollowUser(userId: number, unfollow: boolean): Promise<void> {
    return safeInvoke("pixiv_follow_user", { userId, unfollow });
  },
  pixivTrendingTags(): Promise<PixivTrendTag[]> {
    return safeInvoke("pixiv_trending_tags");
  },
  pixivSearchSuggest(term: string): Promise<string[]> {
    return safeInvoke("pixiv_search_suggest", { term });
  },
  pixivUgoiraFrames(illustId: number): Promise<PixivUgoiraFrames> {
    return safeInvoke("pixiv_ugoira_frames", { illustId });
  },
  /** 读本地 ugoira 帧字节（转 Blob 播放） */
  pixivFrameBytes(path: string): Promise<Uint8Array> {
    return safeInvoke("pixiv_frame_bytes", { path });
  },

  // ---- 系统 ----
  /** 在系统浏览器中打开 URL（浏览器预览退化 window.open） */
  async openUrl(url: string): Promise<void> {
    if (!isTauri) {
      window.open(url, "_blank");
      return;
    }
    await openUrl(url);
  },
  async openFile(path: string): Promise<void> {
    if (!isTauri) return;
    await openPath(path.replace(/\\/g, "/"));
  },
  /** 在系统文件管理器中定位并选中文件 */
  async revealInExplorer(path: string): Promise<void> {
    if (!isTauri) return;
    await revealItemInDir(path.replace(/\\/g, "/"));
  },
  /** 选择目录，返回路径或 null */
  async pickDirectory(): Promise<string | null> {
    if (!isTauri) return null;
    const result = await dialogOpen({ directory: true, multiple: false });
    if (typeof result === "string") return result;
    if (result && typeof result === "object" && "path" in result) {
      return (result as { path: string }).path;
    }
    return null;
  },
  /** 保存文件对话框，返回目标路径或 null（用户取消） */
  async pickSavePath(defaultName: string): Promise<string | null> {
    if (!isTauri) return null;
    const result = await dialogSave({ defaultPath: defaultName });
    return typeof result === "string" ? result : null;
  },
  /** 下载 URL 字节到本地路径（走系统网络栈，无 CORS 限制） */
  async downloadTo(url: string, dest: string): Promise<void> {
    if (!isTauri) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeFile(dest, bytes);
  },
  /** 打开开发者工具 */
  openDevtools(): Promise<void> {
    return safeInvoke("open_devtools");
  },
  /** 通用诊断日志：写任意前端消息到同一调试日志文件（供 main.ts 全局错误处理器调用） */
  appLog(msg: string): Promise<void> {
    return safeInvoke("app_log", { msg });
  },

  // ---- 皮肤系统（方案书 §7/§8）----
  /** 启动参数含 --safe-mode：皮肤逃生通道 */
  appSafeMode(): Promise<boolean> {
    return safeInvoke("is_safe_mode");
  },
  /** 读取用户选中的外部皮肤文件原文 */
  skinReadExternalFile(path: string): Promise<string> {
    return safeInvoke("skin_read_external_file", { path });
  },
  /** v2 ZIP 导入第一阶段：解压到 staging 并返回 json 原文与文件清单 */
  skinStageZip(path: string): Promise<StagedSkin> {
    return safeInvoke("skin_stage_zip", { path });
  },
  /** v2 ZIP 导入第二阶段：校验通过后原子换入库 */
  skinCommit(staging: string, id: string): Promise<void> {
    return safeInvoke("skin_commit", { staging, id });
  },
  /** v2 ZIP 导入放弃：丢弃 staging */
  skinAbort(staging: string): Promise<void> {
    return safeInvoke("skin_abort", { staging });
  },
  /** skins 目录绝对路径（前端拼 asset:// URL 用） */
  skinDir(): Promise<string> {
    return safeInvoke("skin_dir");
  },
  /** 固化保存皮肤（同 id 覆盖 = 更新）；json 为前端校验后的规范化文档 */
  skinSave(id: string, json: string): Promise<void> {
    return safeInvoke("skin_save", { id, json });
  },
  /** 扫描皮肤库目录 */
  skinList(): Promise<SkinEntry[]> {
    return safeInvoke("skin_list");
  },
  /** 读取皮肤 json 原文与资产清单；json 为 null 表示皮肤不存在 */
  skinLoad(id: string): Promise<LoadedSkin> {
    return safeInvoke("skin_load", { id });
  },
  /** 删除皮肤目录 */
  skinDelete(id: string): Promise<void> {
    return safeInvoke("skin_delete", { id });
  },
  /** 选择皮肤文件（.json / .zip），返回路径或 null */
  async pickSkinFile(): Promise<string | null> {
    if (!isTauri) return null;
    const result = await dialogOpen({
      multiple: false,
      filters: [
        { name: "LumiLuna 皮肤", extensions: ["json", "zip"] },
      ],
    });
    if (typeof result === "string") return result;
    if (result && typeof result === "object" && "path" in result) {
      return (result as { path: string }).path;
    }
    return null;
  },
};