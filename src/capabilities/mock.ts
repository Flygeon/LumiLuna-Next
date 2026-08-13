/**
 * 纯浏览器预览用的 mock 后端（`npm run dev` 无 Tauri 环境时生效）。
 * 只为让 UI 可见，不追求行为等价。
 */
import type { FfmpegStatus, MediaEntry, ScanProgress } from "@shared/types";

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

const favorites = new Set<string>(["demo-a1"]);

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
    case "smtc_set_media":
    case "smtc_set_playback":
      // 浏览器预览没有系统媒体控件，直接静默成功
      return as(undefined);
    default:
      return as(null);
  }
}
