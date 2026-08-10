import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Song, LyricLine } from "@shared/types";

/**
 * 音频解码（LRC 解析，编码尝试 utf-8/gbk/big5/shift-jis）
 * 参考《音乐播放器参考》index.js 的 parseLrc 与 decodeBuffer。
 */
const LRC_TIME_RE = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/;
export function parseLrc(text: string): LyricLine[] {
  const lines = text.trim().split("\n");
  const out: LyricLine[] = [];
  lines.forEach((line) => {
    const m = line.match(LRC_TIME_RE);
    if (m) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3], 10) : 0;
      const time = minutes * 60 + seconds + ms / 1000;
      const content = line.replace(m[0], "").trim();
      if (content) {
        out.push({ time, text: content });
      }
    }
  });
  return out.sort((a, b) => a.time - b.time);
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
  const queue = ref<Song[]>([]);
  const shuffleMode = ref(false);
  const repeatMode = ref<RepeatMode>("off");
  const shuffledIndices = ref<number[]>([]);

  function setIndex(i: number) {
    currentIndex.value = i;
  }

  const lyrics = ref<LyricLine[]>([]);
  const activeLine = ref(-1);
  const coverColors = ref<string[]>([]);

  // audio element
  const audioEl = ref<HTMLAudioElement | null>(null);
  function bindAudio(el: HTMLAudioElement) {
    audioEl.value = el;
    el.addEventListener("timeupdate", () => {
      currentTime.value = el.currentTime;
      updateActiveLine();
    });
    el.addEventListener("loadedmetadata", () => {
      duration.value = el.duration;
    });
    el.addEventListener("ended", () => {
      next();
    });
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

  async function loadSong(s: Song) {
    song.value = s;
    lyrics.value = s.lyrics ? parseLrc(s.lyrics) : [];
    activeLine.value = -1;
    // 设置音频源（Tauri 文件路径转为可用 URL）
    if (audioEl.value && s.file?.path) {
      audioEl.value.src = convertFileSrc(s.file.path);
    }
    if (s.coverBase64) {
      const img = new Image();
      img.onload = () => {
        coverColors.value = getDominantColors(img);
      };
      img.src = s.coverBase64;
    }
  }

  async function playFromQueue(index: number) {
    if (index < 0 || index >= queue.value.length) return;
    currentIndex.value = index;
    await loadSong(queue.value[index]);
    if (audioEl.value) {
      audioEl.value.load();
      audioEl.value.play();
      playing.value = true;
    }
  }

  async function next() {
    if (queue.value.length === 0) return;
    if (repeatMode.value === "one") {
      if (audioEl.value) {
        audioEl.value.currentTime = 0;
        audioEl.value.play();
      }
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

  function setQueue(songs: Song[], startIndex = 0) {
    queue.value = songs;
    if (shuffleMode.value) {
      generateShuffleOrder();
    }
    currentIndex.value = startIndex;
  }

  function togglePlay() {
    if (!audioEl.value || !song.value) return;
    if (playing.value) {
      audioEl.value.pause();
    } else {
      audioEl.value.play();
    }
    playing.value = !audioEl.value.paused;
  }

  function seek(t: number) {
    if (!audioEl.value) return;
    audioEl.value.currentTime = t;
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
    shuffleMode,
    repeatMode,
    lyrics,
    activeLine,
    coverColors,
    currentLyric,
    bindAudio,
    loadSong,
    togglePlay,
    setIndex,
    seek,
    seekToLyric,
    next,
    previous,
    toggleShuffle,
    cycleRepeat,
    setQueue,
    playFromQueue,
  };
});
