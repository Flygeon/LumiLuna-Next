/** 双端共享类型定义 */

export type MediaType = "image" | "video" | "audio" | "book";

/** 文件索引记录 */
export interface MediaFile {
  id: string; // xxh3(path)
  path: string;
  type: MediaType;
  size: number;
  mtime: number;
  scanned_at: number;
  deleted: number;
}

/** 媒体元数据 */
export interface MediaMetadata {
  file_id: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
  codec?: string | null;
  fps?: number | null;
  taken_at?: number | null;
  camera?: string | null;
  iso?: number | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  author?: string | null;
  language?: string | null;
  page_count?: number | null;
  chapter_count?: number | null;
}

/** 扫描配置 */
export interface ScanConfig {
  dirs: string[];
  maxDepth?: number;
}

/** 扫描进度 */
export interface ScanProgress {
  jobId: string;
  stage: "enumerate" | "hash" | "metadata" | "store" | "done";
  done: number;
  total: number;
  percent: number;
  currentPath?: string;
}

/** 歌曲（音频+元数据+封面） */
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

/** 阅读进度 */
export interface BookProgress {
  id?: number;
  book_id: string;
  location: string;
  page: number;
  percent: number;
  updated_at: number;
}
