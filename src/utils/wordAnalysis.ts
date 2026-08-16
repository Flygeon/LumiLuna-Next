/**
 * 逐字精排：音频分析编排（Phase 2）。
 *
 * 流程：查缓存 → 命中直接返回；未命中 → 取音频字节（本地 readFile / 在线 fetch）
 * → OfflineAudioContext 解码成单声道 PCM → 转给 Web Worker 做 FFT 起音检测
 * → 返回每行字起始时间轴 → 写 IndexedDB 缓存。
 *
 * 全部异步、不阻塞播放；失败静默降级为粗排（见 getPreciseWordTimes 的 catch）。
 */
import { isTauri } from "@/capabilities";
import { wordCacheGet, wordCacheSet, type PreciseLine } from "./wordCache";
import type { LyricLine } from "@shared/types";

export interface SongSource {
  kind: "local" | "online" | "webdav";
  /** 本地歌曲磁盘路径 */
  filePath?: string;
  /** 在线/WebDAV 歌曲可播放 URL（WebDAV 为本地代理 URL） */
  url?: string;
}

/** 只分析前 5 分钟，兜底超长音轨（播客/长录音） */
const MAX_SECONDS = 300;

async function getAudioBytes(source: SongSource): Promise<ArrayBuffer> {
  if (source.kind === "local" && source.filePath && isTauri) {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const data = await readFile(source.filePath);
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
  }
  if ((source.kind === "online" || source.kind === "webdav") && source.url) {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`在线音频获取失败 (HTTP ${res.status})`);
    return await res.arrayBuffer();
  }
  throw new Error("无法获取音频源");
}

/** OfflineAudioContext 解码成 44.1k 单声道 PCM（浏览器原生解码器） */
async function decodePcm(bytes: ArrayBuffer): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(bytes);
  // 多声道取第 0 声道即可：起音在声道间一致，且省混音开销
  return { pcm: buf.getChannelData(0), sampleRate: buf.sampleRate };
}

function runWorker(
  pcm: Float32Array,
  sampleRate: number,
  jobs: { idx: number; start: number; end: number; count: number }[],
): Promise<PreciseLine[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/wordAnalysis.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (e) {
      reject(e);
      return;
    }
    worker.onmessage = (e: MessageEvent<{ lines: PreciseLine[] }>) => {
      worker.terminate();
      resolve(e.data.lines);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "分析 Worker 错误"));
    };
    worker.postMessage({ pcm, sampleRate, lines: jobs }, [pcm.buffer]);
  });
}

/** 行结束时间：下一行 start；末行按字数估算（与粗排一致） */
function estimateEnd(lines: LyricLine[], idx: number): number {
  if (idx + 1 < lines.length) return lines[idx + 1].time;
  return lines[idx].time + Math.max(2, lines[idx].text.length * 0.4);
}

/** 完整分析流水线：解码 → Worker → 缓存，返回精确时间轴 */
export async function analyzeSongWords(
  source: SongSource,
  lines: LyricLine[],
  key: string,
): Promise<PreciseLine[]> {
  const bytes = await getAudioBytes(source);
  const { pcm, sampleRate } = await decodePcm(bytes);

  // 只保留到末行 + 1s 的 PCM（且不超 5 分钟），减少 FFT 工作量
  const lastTime = lines[lines.length - 1]?.time ?? 0;
  const limit = Math.min(pcm.length, Math.floor(Math.min(MAX_SECONDS, lastTime + 1) * sampleRate));
  const mono = pcm.slice(0, Math.max(limit, sampleRate));

  const jobs = lines
    .map((l, idx) => ({
      idx,
      start: l.time,
      end: estimateEnd(lines, idx),
      count: l.units?.length ?? 0,
    }))
    // 跳过前奏/间奏标记行（三点无需起音分析，保持均分）
    .filter((j) => j.count > 0 && !lines[j.idx]?.instrumental);
  if (!jobs.length) return [];

  const result = await runWorker(mono, sampleRate, jobs);
  await wordCacheSet(key, result);
  return result;
}

/** 取精确时间轴：缓存命中直接返回；否则分析（失败降级为 null，用粗排） */
export async function getPreciseWordTimes(
  source: SongSource,
  lines: LyricLine[],
  key: string,
): Promise<PreciseLine[] | null> {
  const cached = await wordCacheGet(key);
  if (cached) return cached;
  try {
    return await analyzeSongWords(source, lines, key);
  } catch (e) {
    console.warn("[逐字精排] 分析失败，保持粗排:", e);
    return null;
  }
}

/** 用精确时间轴覆盖行内 units（保留原文 text，只改 start/end） */
export function applyPreciseWordTimes(lines: LyricLine[], precise: PreciseLine[]): void {
  for (const p of precise) {
    const line = lines[p.idx];
    if (!line?.units?.length) continue;
    const n = line.units.length;
    if (!p.times.length || p.times.length !== n) continue; // 数量不符则保留粗排
    const texts = line.units.map((u) => u.text);
    line.units = texts.map((text, i) => ({
      text,
      start: p.times[i],
      end: p.times[i + 1] ?? p.end,
    }));
  }
}