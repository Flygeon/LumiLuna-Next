import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { capabilities, isTauri } from "@/capabilities";
import type { MediaEntry, Song, LyricLine } from "@shared/types";

/** 浏览器预览下没有 Tauri 协议，直接返回原路径避免抛错 */
function toMediaSrc(path: string): string {
  return isTauri ? convertFileSrc(path) : path;
}

/**
 * 双语 LRC 解析器
 * 支持格式：
 * 1. 同时间戳双行（如网易云/QQ音乐双语歌词）
 *    [00:12.34]Hello World
 *    [00:12.34]你好世界
 * 2. [tr:翻译] 标签
 *    [00:12.34]Hello World [tr:你好世界]
 * 3. 单语歌词（向后兼容）
 */
const LRC_TIME_RE = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
const LRC_TR_RE = /\[tr:(.*?)\]/g;

export function parseLrc(text: string): LyricLine[] {
  const lines = text.trim().split("\n");
  const map = new Map<number, LyricLine>();

  for (const line of lines) {
    // 提取所有时间戳
    const times: number[] = [];
    let m: RegExpExecArray | null;
    LRC_TIME_RE.lastIndex = 0;
    while ((m = LRC_TIME_RE.exec(line)) !== null) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3], 10) : 0;
      times.push(minutes * 60 + seconds + ms / 1000);
    }
    if (times.length === 0) continue;

    // 提取翻译标签 [tr:xxx]
    let translation = "";
    LRC_TR_RE.lastIndex = 0;
    const trMatch = LRC_TR_RE.exec(line);
    if (trMatch) {
      translation = trMatch[1].trim();
    }

    // 移除所有时间戳和翻译标签，得到歌词文本
    let content = line
      .replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, "")
      .replace(/\[tr:.*?\]/g, "")
      .replace(/\[lang:.*?\]/g, "")
      .replace(/\[ar:.*?\]/g, "")
      .replace(/\[ti:.*?\]/g, "")
      .replace(/\[al:.*?\]/g, "")
      .replace(/\[by:.*?\]/g, "")
      .trim();

    if (!content) continue;

    for (const time of times) {
      const key = Math.round(time * 1000); // 精确到毫秒
      const existing = map.get(key);
      if (existing) {
        // 同一时间戳的第二行作为翻译
        if (translation) {
          existing.translation = translation;
        } else if (!existing.translation) {
          existing.translation = content;
        }
      } else {
        map.set(key, { time, text: content, translation: translation || undefined });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

export function decodeBuffer(buffer: ArrayBuffer): string {
  const encodings = ["utf-8", "gbk", "big5", "shift_jis"];
  for (const enc of encodings) {
    try {
      const decoder = new TextDecoder(enc, { fatal: true });
      return decoder.decode(new Uint8Array(buffer));
    } catch (e) {
      continue;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buffer));
}

/** 封面主色提取（4 象限均值采样，欧氏距离去重） */
export function getDominantColors(
  img: HTMLImageElement | ImageBitmap,
  colorCount = 4,
  minColorDistance = 60,
): string[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return ["rgba(128,128,128,0.8)"];
  canvas.width = 100;
  canvas.height = 100 * (img.height / img.width);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return ["rgba(128,128,128,0.8)"];
  }
  const { data, width, height } = imageData;
  const regionColors: number[][] = [];
  const dominant: number[][] = [];
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  const step = 5;
  const regions = [
    { x1: 0, y1: 0, x2: hw, y2: hh },
    { x1: hw, y1: 0, x2: width, y2: hh },
    { x1: 0, y1: hh, x2: hw, y2: height },
    { x1: hw, y1: hh, x2: width, y2: height },
  ];
  regions.forEach((r) => {
    let tr = 0, tg = 0, tb = 0, count = 0;
    for (let y = r.y1; y < r.y2; y += step) {
      for (let x = r.x1; x < r.x2; x += step) {
        const i = (y * width + x) * 4;
        tr += data[i];
        tg += data[i + 1];
        tb += data[i + 2];
        count++;
      }
    }
    if (count > 0) {
      regionColors.push([
        Math.round(tr / count),
        Math.round(tg / count),
        Math.round(tb / count),
      ]);
    }
  });
  regionColors.forEach(([r, g, b]) => {
    const unique = dominant.every(
      ([er, eg, eb]) =>
        Math.sqrt((r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2) >= minColorDistance,
    );
    if (unique) dominant.push([r, g, b]);
  });
  while (dominant.length < colorCount) {
    dominant.push(
      dominant[dominant.length % dominant.length] || [128, 128, 128],
    );
  }
  return dominant.map(([r, g, b]) => `rgba(${r},${g},${b},0.8)`);
}

export type RepeatMode = "off" | "all" | "one";

export const usePlayerStore = defineStore("player", () => {
  const song = ref<Song | null>(null);
  const playing = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const currentIndex = ref(0);
  /** 队列只存轻量条目；完整 Song（封面/歌词）在切歌时按需拉取 */
  const queue = ref<MediaEntry[]>([]);
  const loadingSong = ref(false);
  const lastError = ref<string | null>(null);
  const shuffleMode = ref(false);
  const repeatMode = ref<RepeatMode>("off");
  const shuffledIndices = ref<number[]>([]);

  function setIndex(i: number) {
    currentIndex.value = i;
  }

  const lyrics = ref<LyricLine[]>([]);
  const activeLine = ref(-1);
  const coverColors = ref<string[]>([]);

  /**
   * 全局唯一的 audio 元素，由 store 持有而非某个组件。
   * PlayerView 会被路由销毁，若音频挂在它身上，返回列表页后
   * MiniPlayer 的控制会全部失效、播放也会中断。
   */
  const audioEl = ref<HTMLAudioElement | null>(null);

  function ensureAudio(): HTMLAudioElement {
    if (audioEl.value) return audioEl.value;
    const el = new Audio();
    el.preload = "auto";
    el.addEventListener("timeupdate", () => {
      currentTime.value = el.currentTime;
      updateActiveLine();
    });
    el.addEventListener("loadedmetadata", () => {
      duration.value = el.duration;
    });
    el.addEventListener("play", () => {
      playing.value = true;
    });
    el.addEventListener("pause", () => {
      playing.value = false;
    });
    el.addEventListener("ended", () => {
      void next();
    });
    el.addEventListener("error", () => {
      playing.value = false;
      lastError.value = `无法播放：${song.value?.file.name ?? ""}`;
    });
    audioEl.value = el;
    return el;
  }

  /** PlayerView 用它挂可视化，不再转移所有权 */
  function bindAudio(_el?: HTMLAudioElement) {
    ensureAudio();
  }

  function detachAudio() {
    // audio 由 store 持有，离开播放器页时无需做任何事
  }

  const currentLyric = computed(() =>
    activeLine.value >= 0 ? lyrics.value[activeLine.value]?.text : "",
  );

  function updateActiveLine() {
    let idx = -1;
    for (let i = 0; i < lyrics.value.length; i++) {
      if (currentTime.value >= lyrics.value[i].time) idx = i;
      else break;
    }
    activeLine.value = idx;
  }

  function generateShuffleOrder() {
    const indices = Array.from({ length: queue.value.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    shuffledIndices.value = indices;
  }

  /** 应用一首已取回的完整 Song（解析歌词、提取封面主色） */
  async function loadSong(s: Song) {
    song.value = s;
    lyrics.value = s.lyrics ? parseLrc(s.lyrics) : [];
    activeLine.value = -1;
    coverColors.value = [];
    currentTime.value = 0;
    duration.value = 0;
    if (s.coverBase64) {
      const img = new Image();
      img.onload = () => {
        coverColors.value = getDominantColors(img);
      };
      img.src = s.coverBase64;
    }
  }

  /** 唯一的起播路径：设源 → load → play */
  async function startPlayback() {
    const path = song.value?.file?.path;
    if (!path) return;
    const el = ensureAudio();
    lastError.value = null;
    el.src = toMediaSrc(path);
    el.load();
    try {
      await el.play();
    } catch (e) {
      // 自动播放被拒或解码失败；playing 由 error/pause 事件同步
      lastError.value = String(e);
    }
  }

  /** 按 id 拉取完整歌曲并立即播放 */
  async function loadById(fileId: string) {
    loadingSong.value = true;
    try {
      const full = await capabilities.getSong(fileId);
      await loadSong(full);
      await startPlayback();
      void capabilities.recordPlay(fileId);
    } catch (e) {
      lastError.value = String(e);
    } finally {
      loadingSong.value = false;
    }
  }

  /**
   * PlayerView 挂载后调用。歌曲已在播放则不打断，
   * 仅在音频尚未起播时补一次（如刷新后直接进入播放器页）。
   */
  function initAudio() {
    const el = ensureAudio();
    if (song.value && !el.src) {
      void startPlayback();
    }
  }

  async function playFromQueue(index: number) {
    if (index < 0 || index >= queue.value.length) return;
    currentIndex.value = index;
    await loadById(queue.value[index].id);
  }

  async function next() {
    if (queue.value.length === 0) return;
    if (repeatMode.value === "one") {
      const el = ensureAudio();
      el.currentTime = 0;
      void el.play().catch(() => {});
      return;
    }
    let nextIndex: number;
    if (shuffleMode.value) {
      const currentShufflePos = shuffledIndices.value.indexOf(currentIndex.value);
      const nextShufflePos = currentShufflePos + 1;
      if (nextShufflePos >= shuffledIndices.value.length) {
        if (repeatMode.value === "all") {
          generateShuffleOrder();
          nextIndex = shuffledIndices.value[0];
        } else {
          playing.value = false;
          return;
        }
      } else {
        nextIndex = shuffledIndices.value[nextShufflePos];
      }
    } else {
      nextIndex = currentIndex.value + 1;
      if (nextIndex >= queue.value.length) {
        if (repeatMode.value === "all") {
          nextIndex = 0;
        } else {
          playing.value = false;
          return;
        }
      }
    }
    await playFromQueue(nextIndex);
  }

  async function previous() {
    if (queue.value.length === 0) return;
    if (audioEl.value && audioEl.value.currentTime > 3) {
      audioEl.value.currentTime = 0;
      return;
    }
    let prevIndex: number;
    if (shuffleMode.value) {
      const currentShufflePos = shuffledIndices.value.indexOf(currentIndex.value);
      prevIndex = currentShufflePos > 0
        ? shuffledIndices.value[currentShufflePos - 1]
        : shuffledIndices.value[shuffledIndices.value.length - 1];
    } else {
      prevIndex = currentIndex.value > 0 ? currentIndex.value - 1 : queue.value.length - 1;
    }
    await playFromQueue(prevIndex);
  }

  function toggleShuffle() {
    shuffleMode.value = !shuffleMode.value;
    if (shuffleMode.value) {
      generateShuffleOrder();
    }
  }

  function cycleRepeat() {
    const modes: RepeatMode[] = ["off", "all", "one"];
    const currentIdx = modes.indexOf(repeatMode.value);
    repeatMode.value = modes[(currentIdx + 1) % modes.length];
  }

  function setQueue(entries: MediaEntry[], startIndex = 0) {
    queue.value = entries;
    if (shuffleMode.value) {
      generateShuffleOrder();
    }
    currentIndex.value = startIndex;
  }

  function togglePlay() {
    if (!song.value) return;
    const el = ensureAudio();
    // 源尚未设置（如从 MiniPlayer 恢复播放）时补一次起播
    if (!el.src) {
      void startPlayback();
      return;
    }
    if (el.paused) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }

  function seek(t: number) {
    if (!audioEl.value || !Number.isFinite(t)) return;
    audioEl.value.currentTime = Math.max(0, t);
  }

  function setPlaybackRate(rate: number) {
    ensureAudio().playbackRate = rate;
  }

  function seekToLyric(i: number) {
    if (i < 0 || i >= lyrics.value.length) return;
    seek(lyrics.value[i].time);
  }

  return {
    song,
    playing,
    currentTime,
    duration,
    currentIndex,
    queue,
    loadingSong,
    lastError,
    shuffleMode,
    repeatMode,
    lyrics,
    activeLine,
    coverColors,
    currentLyric,
    bindAudio,
    detachAudio,
    loadSong,
    loadById,
    initAudio,
    togglePlay,
    setIndex,
    seek,
    setPlaybackRate,
    seekToLyric,
    next,
    previous,
    toggleShuffle,
    cycleRepeat,
    setQueue,
    playFromQueue,
  };
});
