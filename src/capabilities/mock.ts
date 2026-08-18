/**
 * 纯浏览器预览用的 mock 后端（`npm run dev` 无 Tauri 环境时生效）。
 * 只为让 UI 可见，不追求行为等价。
 */
import type { FfmpegStatus, MediaEntry, NeteaseCloudPage, NeteasePlaylist, NeteaseProfile, NeteaseQrCheck, NeteaseSong, ScanProgress, WebDavEntry, WebDavStatus } from "@shared/types";

/** 内联 SVG 占位封面，避免依赖外部图片 */
function placeholderCover(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},60%,55%)"/>
      <stop offset="100%" stop-color="hsl(${hue + 40},55%,35%)"/>
    </linearGradient></defs>
    <rect width="320" height="320" fill="url(#g)"/>
    <text x="160" y="175" font-size="34" font-family="sans-serif" fill="rgba(255,255,255,.9)"
          text-anchor="middle">${label}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

const DEMO: MediaEntry[] = [
  entry("demo-a1", "audio", "夜曲.flac", { title: "夜曲", artist: "周杰伦", album: "十一月的萧邦", durationMs: 231000 }),
  entry("demo-a2", "audio", "稻香.mp3", { title: "稻香", artist: "周杰伦", album: "魔杰座", durationMs: 223000 }),
  entry("demo-a3", "audio", "Bohemian Rhapsody.flac", { title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", durationMs: 354000 }),
  entry("demo-i1", "image", "海边日落.jpg", { width: 4032, height: 3024, takenAt: 1719300000 }),
  entry("demo-i2", "image", "城市夜景.png", { width: 3840, height: 2160, takenAt: 1717000000 }),
  entry("demo-i3", "image", "山脉.webp", { width: 2560, height: 1440 }),
  entry("demo-v1", "video", "旅行记录.mp4", { width: 1920, height: 1080, durationMs: 754000, codec: "H264", fps: 29.97 }),
  entry("demo-v2", "video", "延时摄影.mov", { width: 3840, height: 2160, durationMs: 62000, codec: "HEVC", fps: 60 }),
  entry("demo-b1", "book", "小王子.epub", { title: "小王子", artist: null }),
  // 用 ?bulk=N 注入大批量图片，便于验证虚拟滚动在大图库下的表现
  ...bulkImages(),
];

function bulkImages(): MediaEntry[] {
  const n = Number(
    new URLSearchParams(location.search).get("bulk") ??
      new URLSearchParams(location.hash.split("?")[1] ?? "").get("bulk") ??
      0,
  );
  if (!n || Number.isNaN(n)) return [];
  return Array.from({ length: n }, (_, i) =>
    entry(`bulk-${i}`, "image", `照片_${String(i).padStart(5, "0")}.jpg`, {
      width: 4000,
      height: 3000,
      mtime: 1700000000 + i,
    }),
  );
}

function entry(
  id: string,
  type: MediaEntry["type"],
  name: string,
  extra: Partial<MediaEntry>,
): MediaEntry {
  return {
    id,
    path: `D:/Demo/${name}`,
    parent: "D:/Demo",
    name,
    ext: name.split(".").pop() ?? "",
    type,
    size: 1024 * 1024 * 8,
    mtime: 1720000000,
    scannedAt: 1720000000,
    deleted: 0,
    title: extra.title ?? name.replace(/\.[^.]+$/, ""),
    hasCover: type === "audio",
    favorite: false,
    ...extra,
  };
}

const HUES: Record<string, number> = { audio: 265, image: 195, video: 20, book: 145 };
const LABELS: Record<string, string> = { audio: "♪", image: "IMG", video: "VIDEO", book: "BOOK" };

// ---- WebDAV 演示目录树（浏览器预览用，真实行为由 Rust 代理提供）----

function davEntry(name: string, dir: string, isDir: boolean, size = 0): WebDavEntry {
  return {
    name,
    path: dir ? dir + "/" + name : name,
    isDir,
    size,
    mtime: 1720000000,
  };
}

const DAV_TREE: Record<string, WebDavEntry[]> = {
  "": [
    davEntry("音乐", "", true),
    davEntry("图片", "", true),
    davEntry("视频", "", true),
    davEntry("说明.txt", "", false, 120),
  ],
  音乐: [
    davEntry("夜曲.flac", "音乐", false, 9 * 1024 * 1024),
    davEntry("稻香.mp3", "音乐", false, 4 * 1024 * 1024),
  ],
  图片: [davEntry("海边日落.jpg", "图片", false, 2 * 1024 * 1024)],
  视频: [davEntry("旅行记录.mp4", "视频", false, 60 * 1024 * 1024)],
};

const favorites = new Set<string>(["demo-a1"]);

/** 浏览器预览用：扫码轮询计数（800 → 803 推进） */
let qrCheckCount: number | undefined;

export function mockInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const as = <R,>(v: R) => Promise.resolve(v as unknown as T);

  switch (cmd) {
    case "scan_start":
      return as({ jobId: "mock-job" });
    case "scan_cancel":
      return as(undefined);
    case "scan_status":
      return as<ScanProgress>({
        jobId: "mock-job",
        stage: "done",
        done: DEMO.length,
        total: DEMO.length,
        percent: 100,
        currentPath: "",
        added: DEMO.length,
        updated: 0,
        removed: 0,
      });
    case "list_files": {
      const q = (args?.query ?? {}) as {
        type?: string;
        search?: string;
        minSize?: number;
      };
      let list = DEMO.filter((f) => !q.type || f.type === q.type);
      if (q.minSize) list = list.filter((f) => f.size >= q.minSize!);
      if (q.search?.trim()) {
        const s = q.search.trim().toLowerCase();
        list = list.filter((f) =>
          [f.name, f.title, f.artist, f.album]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(s)),
        );
      }
      return as(list.map((f) => ({ ...f, favorite: favorites.has(f.id) })));
    }
    case "library_counts": {
      const min = Number((args?.minSize as number) ?? 0);
      const counts: Record<string, number> = {};
      for (const f of DEMO) {
        if (f.size < min) continue;
        counts[f.type] = (counts[f.type] ?? 0) + 1;
      }
      return as(counts);
    }
    case "get_thumbnail": {
      const id = String(args?.fileId ?? "");
      const f = DEMO.find((x) => x.id === id);
      if (!f) return as(null);
      return as(placeholderCover(LABELS[f.type] ?? "?", HUES[f.type] ?? 0));
    }
    case "get_song": {
      const id = String(args?.fileId ?? "");
      const f = DEMO.find((x) => x.id === id) ?? DEMO[0];
      return as({
        file: {
          id: f.id,
          path: f.path,
          parent: f.parent,
          name: f.name,
          ext: f.ext,
          type: f.type,
          size: f.size,
          mtime: f.mtime,
          scanned_at: f.scannedAt,
          deleted: 0,
        },
        meta: {
          fileId: f.id,
          title: f.title,
          artist: f.artist,
          album: f.album,
          durationMs: f.durationMs,
          hasCover: true,
          hasLyrics: true,
        },
        coverBase64: placeholderCover("♪", HUES.audio),
        lyrics:
          "[00:00.00]演示歌词\n[00:03.00]This is a demo line\n[00:03.00]这是一行演示歌词\n[00:08.00]浏览器预览模式",
      });
    }
    case "get_metadata": {
      const id = String(args?.fileId ?? "");
      const f = DEMO.find((x) => x.id === id);
      return as({ fileId: id, title: f?.title, artist: f?.artist, hasCover: false, hasLyrics: false });
    }
    case "toggle_favorite": {
      const id = String(args?.fileId ?? "");
      if (favorites.has(id)) {
        favorites.delete(id);
        return as(false);
      }
      favorites.add(id);
      return as(true);
    }
    case "list_favorites":
      return as(DEMO.filter((f) => favorites.has(f.id)).map((f) => ({ ...f, favorite: true })));
    case "list_history":
      return as(DEMO.slice(0, 3));
    case "list_trash":
      return as([]);
    case "empty_trash":
    case "clear_thumbnail_cache":
      return as(0);
    case "get_book_progress":
      return as(null);
    case "save_book_progress":
      return as(undefined);
    case "ffmpeg_status":
      return as<FfmpegStatus>({ available: false, source: "none" });
    case "ffmpeg_set_path":
      return as<FfmpegStatus>({ available: false, source: "none" });
    case "ffmpeg_download_url":
      return as("https://ffmpeg.org/download.html");
    case "webdav_configure":
      return as(undefined);
    case "webdav_test":
      return as<WebDavStatus>({ ok: true, rootName: "demo" });
    case "webdav_list": {
      const path = String(args?.path ?? "");
      return as(DAV_TREE[path] ?? []);
    }
    case "webdav_media_url": {
      const path = String(args?.path ?? "");
      return as("https://demo.webdav.invalid/" + path);
    }
    case "netease_sms_captcha_sent":
      return as(undefined);
    case "netease_login_cellphone":
      return as<NeteaseProfile>({
        userId: 10001,
        nickname: "演示用户(手机)",
        avatarUrl: "",
      });
    case "netease_login_qr_key":
      return as("demo-unikey-abcdef");
    case "netease_login_qr_check": {
      // 演示：第一次 800，之后 803
      const count = (qrCheckCount = (qrCheckCount ?? 0) + 1);
      if (count <= 1) {
        return as<NeteaseQrCheck>({ code: 800 });
      }
      return as<NeteaseQrCheck>({
        code: 803,
        nickname: "演示用户",
        avatarUrl: "",
      });
    }
    case "netease_account":
      return as<NeteaseProfile>({
        userId: 10001,
        nickname: "演示用户",
        avatarUrl: "",
      });
    case "netease_user_playlists":
      return as<NeteasePlaylist[]>([
        { id: 1, name: "我喜欢的音乐", coverUrl: "", trackCount: 128 },
        { id: 2, name: "通勤歌单", coverUrl: "", trackCount: 45 },
      ]);
    case "netease_playlist_detail":
      return as<NeteaseSong[]>([
        { id: 1001, name: "夜曲", artist: "周杰伦", album: "十一月的萧邦", picUrl: "" },
        { id: 1002, name: "稻香", artist: "周杰伦", album: "魔杰座", picUrl: "" },
      ]);
    case "netease_cloud":
      return as<NeteaseCloudPage>({
        songs: [
          { id: 2001, name: "云盘试听曲", artist: "演示歌手", album: "云盘", picUrl: "" },
          { id: 2002, name: "Demo Track", artist: "Demo Artist", picUrl: "" },
        ],
        hasMore: false,
        count: 2,
      });
    case "netease_song_url": {
      const ids = (args?.ids as number[]) ?? [];
      return as(ids.map((id) => ({ id, url: "https://demo.netease.invalid/play?id=" + id })));
    }
    case "netease_logout":
      return as(undefined);
    case "smtc_set_media":
    case "smtc_set_playback":
      // 浏览器预览没有系统媒体控件，直接静默成功
      return as(undefined);
    default:
      return as(null);
  }
}