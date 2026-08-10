<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

/**
 * 歌词播放器（1:1 参考《音乐播放器参考》的 UpdateLyricsLayout / GetLyricsLayout）。
 * LYRIC_OFFSET = 视口高/3，当前行放大 1.25x，距离模糊，上下渐隐遮罩。
 * 过渡使用 Apple Music 参考的 cubic-bezier(.19,.11,0,1) 700ms。
 */
const player = usePlayerStore();
const settings = useSettingsStore();
const containerRef = ref<HTMLDivElement | null>(null);
const lineRefs = ref<HTMLDivElement[]>([]);

const LINE_HEIGHT = 20;
const LYRICS_OFFSET = () => (containerRef.value ? containerRef.value.clientHeight / 3 : 200);

function t(key: string) {
  return translate(settings.lang, key);
}

function setLineRef(el: any, index: number) {
  if (el) lineRefs.value[index] = el;
}

function scrollToLine(index: number) {
  const container = containerRef.value;
  if (!container || !lineRefs.value.length) return;
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += (lineRefs.value[i]?.offsetHeight || 0) + LINE_HEIGHT;
  }
  const target = offset + LYRICS_OFFSET();
  container.scrollTo({ top: target, behavior: "smooth" });
}

watch(
  () => player.activeLine,
  (idx) => {
    if (idx >= 0) scrollToLine(idx);
  },
);

async function onLyricsLoaded() {
  await nextTick();
  scrollToLine(0);
}
watch(() => player.lyrics.length, onLyricsLoaded);
</script>

<template>
  <div class="lyrics-mask">
    <div ref="containerRef" class="lyrics-container">
      <div
        v-for="(line, i) in player.lyrics"
        :key="i"
        :ref="(el) => setLineRef(el, i)"
        class="lyric-line"
        :class="{ active: i === player.activeLine }"
        :style="{
          fontSize: settings.lyricFontSize + 'px',
          lineHeight: settings.lyricLineHeight,
          filter: settings.lyricBlur ? `blur(${Math.abs(i - player.activeLine) * 0.5}px)` : 'none',
          transform: i === player.activeLine ? 'scale(1.25)' : 'scale(1)',
          opacity: i === player.activeLine ? 1.0 : Math.max(0.2, 1.0 - Math.abs(i - player.activeLine) * 0.25),
        }"
        @click="player.seekToLyric(i)"
      >
        <div class="lyric-text">{{ line.text }}</div>
        <div v-if="line.translation" class="lyric-translation">{{ line.translation }}</div>
      </div>
      <div v-if="!player.lyrics.length" class="empty-lyrics">
        <span class="material-symbols-outlined">lyrics</span>
        <p>{{ t("player.noLyrics") }}</p>
        <p class="sub">{{ t("player.lyricsHint") }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyrics-mask {
  height: 100%;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 15%,
    black 85%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 15%,
    black 85%,
    transparent 100%
  );
  overflow: hidden;
}
.lyrics-container {
  height: 100%;
  overflow-y: auto;
  padding: 25px;
  scrollbar-width: none;
}
.lyrics-container::-webkit-scrollbar {
  display: none;
}
.lyric-line {
  padding: 6px 0;
  color: rgba(255, 255, 255, 0.2);
  font-weight: bold;
  letter-spacing: 0.6px;
  cursor: pointer;
  transition:
    color 700ms cubic-bezier(0.19, 0.11, 0, 1),
    transform 700ms cubic-bezier(0.19, 0.11, 0, 1),
    filter 700ms cubic-bezier(0.19, 0.11, 0, 1),
    opacity 700ms cubic-bezier(0.19, 0.11, 0, 1);
  text-align: left;
  transform-origin: left center;
}
.lyric-line.active {
  color: rgba(255, 255, 255, 1);
}
.lyric-text {
  margin-bottom: 2px;
}
.lyric-translation {
  font-size: 0.65em;
  font-weight: normal;
  opacity: 0.7;
  color: rgba(255, 255, 255, 0.6);
}
.empty-lyrics {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  margin-top: 40%;
}
.empty-lyrics .material-symbols-outlined {
  font-size: 48px;
  opacity: 0.5;
  margin-bottom: 12px;
}
.empty-lyrics .sub {
  font-size: 13px;
  margin-top: 8px;
  opacity: 0.7;
}
</style>
