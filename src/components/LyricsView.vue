<script setup lang="ts">
/**
 * 歌词视图 —— 1:1 复刻《音乐播放器参考》的 UpdateLyricsLayout / GetLyricsLayout。
 *
 * 关键点（与参考实现一致，勿改为容器滚动）：
 * - 每行绝对定位，靠各自的 translateY 位移，而不是滚动容器。
 *   容器 scrollTo 只能整体平移，做不出参考里「每行独立缓动 + 逐行错开」
 *   的 Apple Music 波浪感。
 * - 位移量按行实际 offsetHeight 累加（GetLyricsLayout），因此双语歌词、
 *   不同字号都能精确对齐。
 * - 切行时按与当前行的距离错开 (n*70 - n*10) ms 依次启动，形成级联。
 * - 过渡曲线 cubic-bezier(.19,.11,0,1) 0.7s，模糊量随距离线性增长。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore, type LyricFontKey } from "@/stores/settings";
import { translate } from "@shared/i18n";

const player = usePlayerStore();
const settings = useSettingsStore();

const containerRef = ref<HTMLDivElement | null>(null);
const lineRefs = ref<HTMLDivElement[]>([]);

/** 歌词字体栈（与阅读器字体一致） */
const LYRIC_FONTS: Record<LyricFontKey, string> = {
  system: "inherit",
  sans: '"Helvetica Neue","Microsoft YaHei","Hiragino Sans GB",sans-serif',
  serif: 'Georgia,"Songti SC","SimSun",serif',
  kai: '"KaiTi","STKaiti","Kai",cursive',
  yuan: '"Yuanti SC","YouYuan","Microsoft JhengHei UI",sans-serif',
};
const lyricFontFamily = computed(
  () => LYRIC_FONTS[settings.lyricFont] ?? LYRIC_FONTS.system,
);

/**
 * 当前行停靠高度。参考用 innerHeight/3.5；这里按容器高度计算以适应分栏布局。
 * 用 2.6 而非 3.5：整块歌词区在右栏偏上，除以 3.5 会把当前行顶到接近顶部。
 */
const lyricsOffset = () =>
  containerRef.value ? containerRef.value.clientHeight / 2.6 : 240;

const timers: number[] = [];

function t(key: string) {
  return translate(settings.lang, key);
}

function setLineRef(el: any, index: number) {
  if (el) lineRefs.value[index] = el;
}

/** 第 to 行相对当前行 now 的目标位移（复刻 GetLyricsLayout） */
function getLayout(now: number, to: number): number {
  const lines = lineRefs.value;
  const lineGap = settings.lyricLineGap;
  let res = 0;
  if (to > now) {
    for (let i = now; i < to; i++) {
      res += (lines[i]?.offsetHeight ?? 0) + lineGap;
    }
  } else {
    for (let i = now; i > to; i--) {
      res -= (lines[i - 1]?.offsetHeight ?? 0) + lineGap;
    }
  }
  return res + lyricsOffset();
}

function clearTimers() {
  while (timers.length) clearTimeout(timers.pop()!);
}

/**
 * 复刻 UpdateLyricsLayout。
 * @param animate 0 = 立即就位（换歌/初始化），1 = 带级联动效
 */
function updateLayout(index: number, animate: 0 | 1 = 1) {
  const lines = lineRefs.value;
  if (!lines.length) return;
  clearTimers();

  for (let i = 0; i < lines.length; i++) {
    const el = lines[i];
    if (!el) continue;

    const distance = Math.abs(i - index);
    el.style.filter = settings.lyricBlur ? `blur(${distance}px)` : "none";
    el.style.opacity = i === index ? "1" : String(Math.max(0.22, 1 - distance * 0.22));

    const position = getLayout(index, i);

    // 距离当前行越远启动越晚；超过 10 行的直接同步归位，避免长尾卡顿
    let n = i - index + 1;
    if (n > 10) n = 0;
    const delay = (n * 70 - n * 10) * animate;

    if (delay <= 0) {
      el.style.transform = `translateY(${position}px)`;
    } else {
      timers.push(
        window.setTimeout(() => {
          el.style.transform = `translateY(${position}px)`;
        }, delay),
      );
    }
  }
}

/** 换歌/首次渲染：关闭过渡直接就位，避免所有行从 0 位一起飞入 */
async function resetLayout() {
  lineRefs.value = [];
  await nextTick();
  const lines = lineRefs.value;
  lines.forEach((el) => el?.classList.add("no-transition"));
  updateLayout(Math.max(0, player.activeLine), 0);
  // 强制回流后再恢复过渡，否则会被合并成一次带动画的变更
  void containerRef.value?.offsetHeight;
  requestAnimationFrame(() => {
    lines.forEach((el) => el?.classList.remove("no-transition"));
  });
}

watch(
  () => player.activeLine,
  async (idx) => {
    if (idx < 0) return;
    await nextTick();
    updateLayout(idx, 1);
  },
);

watch(() => player.lyrics, resetLayout);

// 字号/行高/行间距/翻译字号/翻译间距改变会影响每行高度，需要重新计算位移
watch(
  () => [
    settings.lyricFontSize,
    settings.lyricLineHeight,
    settings.lyricLineGap,
    settings.lyricTranslationSize,
    settings.lyricTranslationGap,
  ],
  async () => {
    await nextTick();
    updateLayout(Math.max(0, player.activeLine), 0);
  },
);

let ro: ResizeObserver | null = null;

onMounted(async () => {
  await resetLayout();
  ro = new ResizeObserver(() =>
    updateLayout(Math.max(0, player.activeLine), 0),
  );
  if (containerRef.value) ro.observe(containerRef.value);
  rafId = requestAnimationFrame(rafLoop);
});

onBeforeUnmount(() => {
  clearTimers();
  ro?.disconnect();
  cancelAnimationFrame(rafId);
});

const hasLyrics = computed(() => player.lyrics.length > 0);

// ---- Apple Music 式逐字填充 + 逐字弹跳 ----
// 固定结构渐变 + 移动 background-position（比每帧改渐变 stop 平滑省资源）。
// 关键：时间源用 audioEl.currentTime（实时播放位置），而非 4Hz 的 currentTime
// ref——后者会让填充按 ~250ms 阶梯跳动，产生「顿感」。
// background-position-x = (100 - 填充%)，100% 全暗 → 0% 全亮。
// 逐字弹跳也在这里按同一平滑时间切换 .current 类（弹簧 scale），与填充同步。
// rAF 只改 style/class，不触发 Vue 重渲染。

function updateWordFill() {
  if (!settings.wordLyrics) return;
  const idx = player.activeLine;
  const line = player.lyrics[idx];
  if (!line?.units?.length) return;
  const lineEl = lineRefs.value[idx];
  const words = lineEl?.querySelectorAll<HTMLElement>(".word");
  if (!words?.length) return;
  const t = player.audioEl?.currentTime ?? player.currentTime;
  line.units.forEach((u, i) => {
    const el = words[i];
    if (!el) return;
    let pct = 0;
    if (t >= u.end) pct = 100;
    else if (t > u.start) pct = ((t - u.start) / (u.end - u.start)) * 100;
    el.style.backgroundPosition = `${(100 - pct).toFixed(2)}% 0`;
    // Apple Music 式：唱完的字上浮并保持，直到行结束（下一行激活后随行重置）
    el.classList.toggle("sung", t >= u.end);
  });
}

let rafId = 0;
function rafLoop() {
  rafId = requestAnimationFrame(rafLoop);
  updateWordFill();
}
</script>

<template>
  <div ref="containerRef" class="lyrics-container">
    <div class="lyrics">
      <div
        v-for="(line, i) in player.lyrics"
        :key="i"
        :ref="(el) => setLineRef(el, i)"
        class="lyric-item"
        :class="{ active: i === player.activeLine, instrumental: line.instrumental }"
        :style="{
          fontSize: settings.lyricFontSize + 'px',
          lineHeight: settings.lyricLineHeight,
          fontFamily: lyricFontFamily,
        }"
        @click="player.seekToLyric(i)"
      >
        <p class="lyric-text" :class="{ pop: i === player.activeLine }">
          <template v-if="settings.wordLyrics && i === player.activeLine && line.units?.length">
            <span
              v-for="(u, wi) in line.units"
              :key="wi"
              class="word"
            >{{ u.text }}</span>
          </template>
          <template v-else>{{ line.text }}</template>
        </p>
        <p
          v-if="line.translation"
          class="lyric-translation"
          :style="{
            fontSize: settings.lyricTranslationSize + '%',
            marginTop: settings.lyricTranslationGap + 'px',
          }"
        >
          {{ line.translation }}
        </p>
      </div>
    </div>

    <div v-if="!hasLyrics" class="empty-lyrics">
      <span class="material-symbols-outlined">lyrics</span>
      <p>{{ t("player.noLyrics") }}</p>
      <p class="sub">{{ t("player.lyricsHint") }}</p>
    </div>
  </div>
</template>

<style scoped>
.lyrics-container {
  position: relative;
  height: 100%;
  overflow: hidden;
  z-index: 2;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 22%,
    black 74%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 22%,
    black 74%,
    transparent 100%
  );
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

.lyrics {
  position: relative;
  max-width: 100%;
}

.lyric-item {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  padding: 0 25px;
  box-sizing: border-box;
  color: rgba(255, 255, 255, 0.2);
  /* 逐字填充色：非当前行两者同色（无填充效果，整行暗） */
  --word-sung: rgba(255, 255, 255, 0.2);
  --word-unsung: rgba(255, 255, 255, 0.2);
  font-weight: bold;
  letter-spacing: 0.6px;
  cursor: pointer;
  transform-origin: left center;
  will-change: transform, filter, opacity;
  /* Apple Music 参考曲线，勿改 */
  transition: all 0.7s cubic-bezier(0.19, 0.11, 0, 1);
}

.lyric-item.active {
  color: rgba(255, 255, 255, 1);
  /* 当前行：已唱纯白、未唱半透明 */
  --word-sung: #ffffff;
  --word-unsung: rgba(255, 255, 255, 0.35);
}

/* 换歌瞬间就位，不走过渡 */
.lyric-item.no-transition {
  transition: none !important;
}

.lyric-text {
  word-wrap: break-word;
  text-shadow: 0 1px 12px rgba(0, 0, 0, 0.35);
}

/* 逐字填充：Apple Music 式。
 * 固定结构渐变（sung→unsung 47%/53% 软边）+ 移动 background-position，
 * 比每帧改渐变 stop 更平滑省资源。非当前行整行纯文本渲染。
 * 唱完的字 translateY 上浮并保持（不回弹），直到行结束随行重置。
 */
.word {
  display: inline-block;
  white-space: pre; /* 保留英文词间空格（空格已并入词尾） */
  transition: transform 0.5s cubic-bezier(0.34, 1.2, 0.64, 1);
}
.lyric-item.active .word {
  color: transparent;
  background-image: linear-gradient(
    to right,
    var(--word-sung) 0%,
    var(--word-sung) 47%,
    var(--word-unsung) 53%,
    var(--word-unsung) 100%
  );
  background-size: 200% 100%;
  background-repeat: no-repeat;
  background-position: 100% 0; /* 默认全暗；JS 每帧推进 */
  -webkit-background-clip: text;
  background-clip: text;
}
.lyric-item.active .word.sung {
  transform: translateY(-2px);
}

/* 前奏/间奏三点：放大一点，不影响其他歌词尺寸（scale 不改布局） */
.lyric-item.active.instrumental .word {
  transform-origin: center;
  transform: scale(1.5);
  margin: 0 4px; /* 放大后相邻点不重叠 */
}
.lyric-item.active.instrumental .word.sung {
  transform: translateY(-2px) scale(1.5);
}

/* 行级入场弹簧：切到当前行时一次 scale 回弹（单次动画，不顿） */
.lyric-text.pop {
  transform-origin: left center;
  animation: lyric-pop 0.5s cubic-bezier(0.34, 1.2, 0.64, 1);
}
@keyframes lyric-pop {
  from {
    transform: scale(0.97);
  }
  to {
    transform: scale(1);
  }
}

.lyric-translation {
  font-weight: 500;
  opacity: 0.72;
}

.empty-lyrics {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
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
