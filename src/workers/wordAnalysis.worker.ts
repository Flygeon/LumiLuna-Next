/**
 * 逐字精排分析 Worker（JS 路线）：
 * 接收单声道 PCM，对每一行歌词 [start, end] 做 FFT 谱通量起音检测，
 * 求出行内 N 个字的起止时间轴。返回每行的字起始时间数组。
 *
 * 算法（启发式，见《逐字歌词策划书.md》Phase 2）：
 * 1. ~23ms 帧（1024 点）算谱通量（相邻帧频谱正差和）
 * 2. 只保留 300Hz–3kHz 人声频带（削弱鼓/贝斯干扰）
 * 3. 移动平均平滑 + 自适应阈值峰值拾取（带最小间隔）→ 候选起音
 * 4. 均匀边界向候选起音「吸附」（±180ms 内取最强），乱序则回退均匀
 */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

const FFT_SIZE = 1024;
const HOP = 512;
const MIN_WORD = 0.06; // 每字最短 60ms
const SEARCH_RADIUS = 0.18; // 均匀位置 ±180ms 内吸附起音
const VOCAL_MIN = 300; // 人声频带下限 Hz
const VOCAL_MAX = 3000; // 人声频带上限 Hz

interface Onset {
  time: number;
  strength: number;
}
interface LineJob {
  idx: number;
  start: number;
  end: number;
  count: number;
}
interface LineResult {
  idx: number;
  times: number[];
  end: number;
}

ctx.onmessage = (e: MessageEvent) => {
  const { pcm, sampleRate, lines } = e.data as {
    pcm: Float32Array;
    sampleRate: number;
    lines: LineJob[];
  };
  const results: LineResult[] = lines.map((job) => {
    const times = analyzeLine(pcm, sampleRate, job);
    return { idx: job.idx, times, end: job.end };
  });
  ctx.postMessage({ lines: results });
};

function analyzeLine(pcm: Float32Array, sampleRate: number, job: LineJob): number[] {
  const { start, end, count } = job;
  if (count <= 1) return [start];
  const s0 = Math.max(0, Math.floor(start * sampleRate));
  const s1 = Math.min(pcm.length, Math.floor(end * sampleRate));
  // 行太短（<300ms）或没有数据：直接按比例
  if (s1 - s0 < sampleRate * 0.3) {
    return uniformStarts(start, end, count);
  }
  const onsets = detectOnsets(pcm, sampleRate, s0, s1, start);
  const bounds = pickBoundaries(onsets, count - 1, start, end);
  return [start, ...bounds];
}

/** 均匀字起始时间（每字等长） */
function uniformStarts(start: number, end: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(start + (i / count) * (end - start));
  }
  return out;
}

/** 谱通量起音检测，返回候选起音（绝对时间 + 强度） */
function detectOnsets(
  pcm: Float32Array,
  sampleRate: number,
  s0: number,
  s1: number,
  t0: number,
): Onset[] {
  const binMin = Math.max(1, Math.floor((VOCAL_MIN / sampleRate) * FFT_SIZE));
  const binMax = Math.min(FFT_SIZE / 2, Math.ceil((VOCAL_MAX / sampleRate) * FFT_SIZE));

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const prevMag = new Float64Array(FFT_SIZE);
  const flux: number[] = [];
  const times: number[] = [];

  let off = s0;
  while (off + FFT_SIZE <= s1) {
    for (let i = 0; i < FFT_SIZE; i++) re[i] = pcm[off + i];
    im.fill(0);
    fft(re, im);
    let fl = 0;
    for (let b = binMin; b <= binMax; b++) {
      const mag = Math.hypot(re[b], im[b]);
      const d = mag - prevMag[b];
      if (d > 0) fl += d;
      prevMag[b] = mag;
    }
    flux.push(fl);
    times.push(t0 + (off - s0) / sampleRate);
    off += HOP;
  }

  return peakPick(smooth(flux, 5), times);
}

/** 移动平均平滑 */
function smooth(arr: number[], win: number): number[] {
  const out = new Array<number>(arr.length);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= win) sum -= arr[i - win];
    out[i] = sum / Math.min(win, i + 1);
  }
  return out;
}

/** 局部极大 + 自适应阈值峰值拾取（带最小间隔） */
function peakPick(flux: number[], times: number[]): Onset[] {
  const n = flux.length;
  if (!n) return [];
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += flux[i];
    sumSq += flux[i] * flux[i];
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const thresh = mean + std * 1.2;

  const peaks: Onset[] = [];
  let last = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    if (flux[i] > flux[i - 1] && flux[i] > flux[i + 1] && flux[i] > thresh) {
      const t = times[i];
      if (t - last >= MIN_WORD) {
        peaks.push({ time: t, strength: flux[i] });
        last = t;
      }
    }
  }
  return peaks;
}

/** 取 count-1 个内部边界：均匀位置向最强起音吸附；乱序/过近则回退均匀 */
function pickBoundaries(onsets: Onset[], needed: number, start: number, end: number): number[] {
  const N = needed + 1;
  const uniforms = uniformStarts(start, end, N).slice(1); // 去首（首字从 start 起）
  const bounds = uniforms.map((u) => {
    let best: Onset | null = null;
    for (const o of onsets) {
      if (Math.abs(o.time - u) <= SEARCH_RADIUS) {
        if (!best || o.strength > best.strength) best = o;
      }
    }
    if (best && best.time >= start + MIN_WORD && best.time <= end - MIN_WORD) {
      return best.time;
    }
    return u;
  });
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i] - bounds[i - 1] < MIN_WORD) return uniforms;
  }
  return bounds;
}

/** 原地 radix-2 迭代 FFT（re/im 就地变换） */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const aRe = re[i + j];
        const aIm = im[i + j];
        const bRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const bIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = aRe + bRe;
        im[i + j] = aIm + bIm;
        re[i + j + len / 2] = aRe - bRe;
        im[i + j + len / 2] = aIm - bIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}
