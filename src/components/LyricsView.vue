<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

/**
 * 歌词播放器（1:1 参考《音乐播放器参考》的 UpdateLyricsLayout / GetLyricsLayout）。
 * 当前行定位在视口 1/3 处，放大 1.25x，距离模糊，上下渐隐遮罩。
 * 过渡使用 Apple Music 参考的 cubic-bezier(.19,.11,0,1) 700ms。
 */
const player = usePlayerStore();
const settings = useSettingsStore();
const containerRef = ref<HTMLDivElement | null>(null);
const lineRefs = ref<HTMLDivElement[]>([]);

/** 当前行停靠位置：视口高度的 1/3 */
const anchor = () =>
  containerRef.value ? containerRef.value.clientHeight / 3 : 200;

function t(key: string) {
  return translate(settings.lang, key);
}

function setLineRef(el: any, index: number) {
  if (el) lineRefs.value[index] = el;
}

/**
 * 把第 index 行滚到锚点位置。
 *
 * 用 offsetTop 直接取实际布局位置：此前按「累加 offsetHeight + 固定行距」
 * 估算，遇到双语歌词/不同字号就会越算越偏；且当时是 offset + anchor，
 * 符号反了，等于把当前行推到视口下方，导致正在唱的那句始终不可见。
 */
function scrollToLine(index: number, smooth = true) {
  const container = containerRef.value;
  const line = lineRefs.value[index];
  if (!container || !line) return;

  const target = line.offsetTop - anchor() + line.offsetHeight / 2;
  container.scrollTo({
    top: Math.max(0, target),
    behavior: smooth ? "smooth" : "auto",
  });
}

watch(
  () => player.activeLine,
  async (idx) => {
    if (idx < 0) return;
    // 等 DOM 应用完 active 类（字号/缩放会改变行高）再计算位置
    await nextTick();
    scrollToLine(idx);
  },
);

// 换歌或歌词加载完成后重置到当前行
watch(
  () => player.lyrics,
  async () => {
    // 换歌后行数可能变少，旧引用会残留导致定位到不存在的行
    lineRefs.value = [];
    await nextTick();
    scrollToLine(Math.max(0, player.activeLine), false);
  },
);

// 从队列页切回歌词页时组件重新挂载，需要立刻回到当前行
onMounted(async () => {
  await nextTick();
  scrollToLine(Math.max(0, player.activeLine), false);
});
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
  /* 末尾留白，保证最后几行也能滚到 1/3 锚点位置 */
  padding-bottom: 70%;
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
