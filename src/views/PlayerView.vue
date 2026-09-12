<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { useNeteaseStore } from "@/stores/netease";
import { useRouter } from "vue-router";
import { translate } from "@shared/i18n";
import { useWindowDrag } from "@/composables/useWindowDrag";
import FluidBackground from "@/components/FluidBackground.vue";
import LyricsView from "@/components/LyricsView.vue";
import PlayerControlIcon from "@/components/PlayerControlIcon.vue";
import AudioEffectsPanel from "@/components/AudioEffectsPanel.vue";
import CommentsPanel from "@/components/CommentsPanel.vue";
import { formatDuration } from "@/utils/format";

const player = usePlayerStore();
const settings = useSettingsStore();
const netease = useNeteaseStore();
const router = useRouter();
const rightTab = ref<"lyrics" | "queue" | "effects">("lyrics");
const speed = ref(1);
const isDragging = ref(false);
const commentsOpen = ref(false);
const panelOpen = ref(false);
const panelAnchor = ref<HTMLElement | null>(null);

const { startDrag } = useWindowDrag();

/** 当前在线歌曲的网易云 ID（仅网易云在线歌曲可查评论/红心） */
const neteaseSongId = computed(() => {
  if (!player.song || player.song.kind !== "online") return null;
  const n = Number(player.song.id);
  return Number.isFinite(n) && n > 0 ? n : null;
});
/** 评论按钮：仅登录网易云且当前为在线歌曲时显示 */
const canShowComments = computed(() => netease.loggedIn && neteaseSongId.value != null);

/** 当前歌曲是否有翻译/罗马音副行（无则切换按钮置灰） */
const hasSubLine = computed(() => player.lyrics.some((l) => l.translation || l.romaji));

/** 副行显示模式按钮：翻译 ⇄ 罗马音 */
const subModeLabel = computed(() =>
  settings.lyricSubMode === "translation" ? t("player.translation") : t("player.romaji"),
);
function cycleSubMode() {
  settings.lyricSubMode = settings.lyricSubMode === "translation" ? "romaji" : "translation";
}

function t(key: string) {
  return translate(settings.lang, key);
}

function isWebDavItem(item: unknown): item is { path: string } {
  return typeof item === "object" && item !== null && "isDir" in item;
}

/** 歌词来源徽标：仅「更精确的逐字歌词」开启且当前歌曲完成尝试后显示；点击可切换来源 */
const sourceBadge = computed(() => {
  const switchHint = t("player.lyricSwitchHint");
  if (!settings.preciseLyrics || !player.lyricsSource) return null;
  if (player.lyricsSource === "qq") {
    return {
      text: t("player.lyricSourceQq"),
      hint: `${t("player.lyricSourceQqHint")} · ${switchHint}`,
    };
  }
  if (player.lyricsSource === "kg") {
    return {
      text: t("player.lyricSourceKg"),
      hint: `${t("player.lyricSourceKgHint")} · ${switchHint}`,
    };
  }
  if (player.lyricsSource === "meting") {
    return {
      text: t("player.lyricSourceMeting"),
      hint: `${t("player.lyricSourceMetingHint")} · ${switchHint}`,
    };
  }
  const reason = player.lyricFallbackReason
    ? t(`player.lyricReason_${player.lyricFallbackReason}`)
    : "";
  const detail = player.lyricFallbackDetail ? `：${player.lyricFallbackDetail}` : "";
  return {
    text: t("player.lyricSourceLocal"),
    hint: `${reason ? `${t("player.lyricSourceLocal")}（${reason}${detail}）` : t("player.lyricSourceLocal")} · ${switchHint}`,
  };
});

function formatTime(s: number) {
  if (Number.isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

function onProgressClick(e: MouseEvent) {
  const bar = e.currentTarget as HTMLElement;
  const rect = bar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  player.seek(pct * player.duration);
}

function cycleSpeed() {
  const speeds = [1, 1.5, 2, 0.5, 0.75];
  speed.value = speeds[(speeds.indexOf(speed.value) + 1) % speeds.length];
  player.setPlaybackRate(speed.value);
}

/** 点击专辑封面：切换评论面板（仅网易云在线歌曲可用） */
function toggleComments() {
  if (!canShowComments.value) return;
  commentsOpen.value = !commentsOpen.value;
}

/** 功能面板：点击外部或按 Esc 关闭 */
function onDocPointerDown(e: PointerEvent) {
  if (panelOpen.value && panelAnchor.value && !panelAnchor.value.contains(e.target as Node)) {
    panelOpen.value = false;
  }
}
function onDocKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && panelOpen.value) panelOpen.value = false;
}

onMounted(() => {
  // audio 元素由 store 全局持有，这里只确保已起播
  player.initAudio();
  player.setPlaybackRate(speed.value);
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown);
});

onBeforeUnmount(() => {
  // 不中断播放，退出后由 MiniPlayer 接管
  player.detachAudio();
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeyDown);
});
</script>

<template>
  <div class="player-page">
    <FluidBackground />

    <!-- 顶部覆盖层（空白处可拖拽窗口） -->
    <div class="player-topbar" @pointerdown="startDrag">
      <m3e-icon-button class="back" @click="router.back()" @pointerdown.stop>
        <span class="material-symbols-outlined">arrow_back</span>
      </m3e-icon-button>
    </div>

    <div class="player-body">
      <!-- 左栏：封面 + 信息 + 进度 + 控制 -->
      <div class="left-col">
        <div class="cover-wrap" :class="{ clickable: canShowComments }" @click="toggleComments">
          <div v-if="player.song?.cover" class="cover">
            <img :src="player.song.cover" alt="" />
          </div>
          <div v-else class="cover default">
            <span class="material-symbols-outlined">music_note</span>
          </div>
          <div v-if="canShowComments" class="cover-hint">
            <span class="material-symbols-outlined">chat_bubble</span>
            {{ t("netease.comments") }}
          </div>
        </div>

        <div class="song-info">
          <div class="title">{{ player.song?.title || "—" }}</div>
          <div class="artist">
            {{ player.song?.artist || "" }}<span v-if="player.song?.album"> · </span
            >{{ player.song?.album || "" }}
          </div>
        </div>

        <div class="progress-section">
          <div
            class="progress-bar"
            :class="{ dragging: isDragging }"
            @mousedown="isDragging = true"
            @mousemove="isDragging && onProgressClick($event)"
            @mouseup="isDragging = false"
            @mouseleave="isDragging = false"
            @click="onProgressClick"
          >
            <div
              class="progress-fill"
              :style="{
                width: (player.duration ? (player.currentTime / player.duration) * 100 : 0) + '%',
              }"
            ></div>
            <div
              class="progress-thumb"
              :style="{
                left: (player.duration ? (player.currentTime / player.duration) * 100 : 0) + '%',
              }"
            ></div>
          </div>
          <div class="time-row">
            <span>{{ formatTime(player.currentTime) }}</span>
            <span>-{{ formatTime(player.duration - player.currentTime) }}</span>
          </div>
        </div>

        <div class="controls">
          <div class="ctrl-group left">
            <m3e-icon-button
              class="side-btn"
              size="medium"
              toggle
              :selected="player.repeatMode !== 'off'"
              :title="t('player.repeat')"
              @click="player.cycleRepeat()"
            >
              <span
                class="material-symbols-outlined"
                :class="{ filled: player.repeatMode !== 'off' }"
                >{{ player.repeatMode === "one" ? "repeat_one" : "repeat" }}</span
              >
            </m3e-icon-button>
            <m3e-icon-button
              class="side-btn"
              size="medium"
              toggle
              :selected="player.shuffleMode"
              :title="t('player.shuffle')"
              @click="player.toggleShuffle()"
            >
              <span class="material-symbols-outlined" :class="{ filled: player.shuffleMode }"
                >shuffle</span
              >
            </m3e-icon-button>
          </div>
          <div class="ctrl-group center">
            <m3e-icon-button
              class="side-btn"
              size="medium"
              :title="t('player.prev')"
              @click="player.previous()"
            >
              <span class="material-symbols-outlined filled">skip_previous</span>
            </m3e-icon-button>
            <m3e-fab
              class="main-btn"
              variant="primary"
              size="medium"
              :title="player.playing ? t('player.pause') : t('player.play')"
              @click="player.togglePlay()"
            >
              <PlayerControlIcon :name="player.playing ? 'pause' : 'play'" />
            </m3e-fab>
            <m3e-icon-button
              class="side-btn"
              size="medium"
              :title="t('player.next')"
              @click="player.next()"
            >
              <span class="material-symbols-outlined filled">skip_next</span>
            </m3e-icon-button>
          </div>
          <div class="ctrl-group right">
            <!-- 功能面板：向上悬浮展开歌词 / 队列 / 音效 + 逐字方案 + 翻译 -->
            <div ref="panelAnchor" class="panel-anchor" @pointerdown.stop>
              <m3e-icon-button
                class="side-btn panel-toggle"
                size="medium"
                toggle
                :selected="panelOpen"
                :title="t('player.tools')"
                :aria-label="t('player.tools')"
                @click="panelOpen = !panelOpen"
              >
                <span class="material-symbols-outlined">tune</span>
              </m3e-icon-button>

              <Transition name="panel-pop">
                <div v-if="panelOpen" class="tools-panel">
                  <m3e-segmented-button class="segment">
                    <m3e-button-segment
                      :checked="rightTab === 'lyrics'"
                      @click="rightTab = 'lyrics'"
                    >
                      {{ t("actions.lyrics") }}
                    </m3e-button-segment>
                    <m3e-button-segment :checked="rightTab === 'queue'" @click="rightTab = 'queue'">
                      {{ t("actions.queue") }}
                    </m3e-button-segment>
                    <m3e-button-segment
                      :checked="rightTab === 'effects'"
                      @click="rightTab = 'effects'"
                    >
                      {{ t("player.effects") }}
                    </m3e-button-segment>
                  </m3e-segmented-button>

                  <div v-if="sourceBadge || hasSubLine" class="tools-extra">
                    <button
                      v-if="sourceBadge"
                      class="source-badge"
                      :class="player.lyricsSource"
                      :title="sourceBadge.hint"
                      @click="player.switchLyricSource()"
                    >
                      <span class="material-symbols-outlined">
                        {{
                          player.lyricsSource === "qq"
                            ? "verified"
                            : player.lyricsSource === "kg"
                              ? "graphic_eq"
                              : player.lyricsSource === "meting"
                                ? "cloud"
                                : "info"
                        }}
                      </span>
                      {{ sourceBadge.text }}
                    </button>
                    <button
                      v-if="hasSubLine"
                      class="source-badge sub"
                      :title="t('player.lyricSubModeSwitch')"
                      @click="cycleSubMode"
                    >
                      <span class="material-symbols-outlined">
                        {{ settings.lyricSubMode === "translation" ? "translate" : "abc" }}
                      </span>
                      {{ subModeLabel }}
                    </button>
                  </div>
                </div>
              </Transition>
            </div>
            <m3e-button class="speed" variant="text" @click="cycleSpeed">{{ speed }}x</m3e-button>
          </div>
        </div>
      </div>

      <!-- 右栏：歌词 / 队列 / 音效内容（切换控件已移入底部控制栏功能面板） -->
      <div class="right-col">
        <div class="right-content">
          <LyricsView v-if="rightTab === 'lyrics'" />
          <AudioEffectsPanel v-else-if="rightTab === 'effects'" />
          <div v-else-if="player.queue.length" class="queue-list">
            <button
              v-for="(item, i) in player.queue"
              :key="player.queueTitle(item) + (isWebDavItem(item) ? item.path : item.id)"
              class="queue-item"
              :class="{ current: i === player.currentIndex }"
              @click="player.playFromQueue(i)"
            >
              <span class="q-index tabular-nums">
                <span v-if="i !== player.currentIndex">{{ i + 1 }}</span>
                <span v-else class="material-symbols-outlined">equalizer</span>
              </span>
              <span class="q-names">
                <span class="q-title">{{ player.queueTitle(item) }}</span>
                <span class="q-artist">{{ player.queueArtist(item) }}</span>
              </span>
              <span class="q-time tabular-nums">
                {{ formatDuration(player.queueDuration(item)) }}
              </span>
            </button>
          </div>
          <div v-else class="queue-empty">{{ t("actions.queue") }}</div>
        </div>
      </div>

      <CommentsPanel
        :open="commentsOpen"
        :song-id="neteaseSongId"
        :title="player.song?.title"
        :artist="player.song?.artist"
        @close="commentsOpen = false"
      />
    </div>
  </div>
</template>

<style scoped>
.player-page {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #000;
  color: #fff;
  font-family: var(--lm-player-font);
}
.player-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 24px;
  z-index: 10;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent);
}
.back {
  position: absolute;
  left: 24px;
  top: calc(50% + 6px);
  transform: translateY(-50%);
  opacity: 0.9;
  /* m3e-icon-button：顶栏白色返回箭头 */
  --m3e-icon-button-icon-color: #fff;
  --m3e-icon-button-hover-icon-color: #fff;
}
.back:hover {
  opacity: 1;
}

/* 底部控制栏功能面板（向上展开） */
.panel-anchor {
  position: relative;
  display: flex;
  align-items: center;
}
.panel-toggle:hover {
  opacity: 1;
}
.panel-toggle .material-symbols-outlined {
  font-size: 21px;
}
.tools-panel {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  min-width: 240px;
  padding: 14px;
  border-radius: var(--lm-shape-dialog);
  background: rgba(28, 28, 30, 0.82);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  z-index: 30;
}
.tools-panel .segment {
  align-self: stretch;
  justify-content: center;
  margin: 0;
}
.tools-extra {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.panel-pop-enter-active,
.panel-pop-leave-active {
  transition:
    opacity 200ms var(--md-sys-motion-spring-spatial),
    transform 200ms var(--md-sys-motion-spring-spatial);
}
.panel-pop-enter-from,
.panel-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px) scale(0.94);
}
.player-body {
  height: 100%;
  display: flex;
  padding-top: 60px;
}
.left-col {
  flex: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  z-index: 2;
}
.right-col {
  flex: 5.5;
  display: flex;
  flex-direction: column;
  padding: 0 20px;
  z-index: 2;
}

.cover-wrap {
  position: relative;
  width: min(42vw, 52vh);
  aspect-ratio: 1;
  border-radius: calc(min(42vw, 52vh) * 0.14);
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.35),
    0 4px 16px rgba(0, 0, 0, 0.25);
  transition:
    transform 250ms cubic-bezier(0.25, 0.8, 0.25, 1),
    filter 250ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.cover-wrap:hover {
  transform: scale(1.05);
  filter: brightness(0.85);
}
.cover-wrap.clickable {
  cursor: pointer;
}
.cover-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px 12px 14px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.62), transparent);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  opacity: 0;
  transition: opacity 220ms var(--md-sys-motion-spring-effects-fast);
  pointer-events: none;
}
.cover-wrap.clickable:hover .cover-hint {
  opacity: 1;
}
.cover-hint .material-symbols-outlined {
  font-size: 18px;
}
.cover {
  width: 100%;
  height: 100%;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover.default {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #222;
}
.cover.default .material-symbols-outlined {
  font-size: 120px;
}
.song-info {
  margin-top: 28px;
  text-align: center;
}
.song-info .title {
  font-size: 24px;
  font-weight: 700;
}
.song-info .artist {
  font-size: 14px;
  opacity: 0.6;
  margin-top: 6px;
}
.progress-section {
  width: 425px;
  margin-top: 24px;
}
.progress-bar {
  width: 425px;
  height: 6px;
  padding: 0;
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 22%, transparent);
  border-radius: var(--md-sys-shape-corner-full);
  position: relative;
  cursor: pointer;
  transition: height 220ms var(--md-sys-motion-spring-soft);
}
.progress-bar:hover,
.progress-bar.dragging {
  height: 12px;
}
.progress-fill {
  height: 100%;
  background: var(--md-sys-color-primary);
  border-radius: inherit;
}
.progress-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--md-sys-color-primary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--md-sys-color-primary) 28%, transparent);
  opacity: 0;
  transition: opacity 200ms var(--md-sys-motion-spring-effects-fast);
}
.progress-bar:hover .progress-thumb {
  opacity: 1;
}
.time-row {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.7;
}
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 425px;
  margin-top: 16px;
}
.ctrl-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* 主播放按钮：m3e-fab(primary)，64dp 圆形，主色底/主色上图标 */
.main-btn {
  --m3e-fab-medium-container-height: 64px;
  --m3e-fab-medium-container-width: 64px;
  --m3e-fab-medium-shape: 50%;
  --m3e-fab-medium-icon-size: 34px;
}
.main-btn .player-control-icon {
  width: 34px;
  height: 30px;
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.2));
}

/* 侧边传输图标按钮：m3e-icon-button(standard)，44dp 圆形、浅色图标、投影 */
.side-btn {
  --m3e-icon-button-medium-container-height: 44px;
  --m3e-icon-button-medium-container-width: 44px;
  --m3e-icon-button-medium-shape-round: 50%;
  --m3e-icon-button-medium-icon-size: 21px;
  --m3e-icon-button-icon-color: var(--md-sys-color-on-surface);
  --m3e-icon-button-hover-icon-color: var(--md-sys-color-on-surface);
  filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.25));
}
.side-btn .material-symbols-outlined {
  /* font-size 由 --m3e-icon-button-medium-icon-size 控制（shadow DOM ::slotted(*) !important 覆盖外部 font-size） */
  font-variation-settings:
    "FILL" 1,
    "wght" 500,
    "GRAD" 0,
    "opsz" 24;
}
/* 选中态（重复/随机/工具面板）：图标转主色 */
.side-btn[selected] {
  --m3e-icon-button-icon-color: var(--md-sys-color-primary);
  --m3e-icon-button-hover-icon-color: var(--md-sys-color-primary);
}
.speed {
  /* 不设固定宽度，让 m3e-button 按内容自适应，避免 "1x" 被裁剪 */
  min-width: 40px;
  --m3e-button-text-label-text-font-size: 13px;
  --m3e-button-label-text-color: var(--md-sys-color-on-surface);
}
.segment {
  /* 深色工具面板上的分段按钮：半透明白轨道、选中白块黑字 */
  background: rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  align-self: flex-start;
  --m3e-segmented-button-outline-color: transparent;
  --m3e-segmented-button-selected-container-color: #fff;
  --m3e-segmented-button-selected-label-text-color: #000;
  --m3e-segmented-button-unselected-label-text-color: rgba(255, 255, 255, 0.6);
}

.source-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
  font-family: inherit;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.65);
  transition: background 180ms var(--md-sys-motion-spring-effects-fast);
}
.source-badge:hover {
  background: rgba(255, 255, 255, 0.18);
}
.source-badge .material-symbols-outlined {
  font-size: 14px;
}
.source-badge.qq {
  background: rgba(76, 217, 100, 0.16);
  color: #7cfc9b;
}
.source-badge.kg {
  background: rgba(56, 160, 255, 0.18);
  color: #7cc4ff;
}
.source-badge.meting {
  background: rgba(236, 72, 91, 0.18);
  color: #ff94a3;
}
.source-badge.local {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.65);
}
.source-badge.sub {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.75);
}
.source-badge.sub.disabled {
  opacity: 0.4;
  cursor: default;
}
.right-content {
  flex: 1;
  overflow: hidden;
}
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  height: 100%;
}
.queue-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 180ms var(--md-sys-motion-spring-effects-fast);
}
.queue-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.queue-item.current {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.q-index {
  width: 22px;
  text-align: center;
  font-size: 12px;
  opacity: 0.6;
}
.q-index .material-symbols-outlined {
  font-size: 16px;
  opacity: 1;
}
.q-names {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.q-title {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.q-artist {
  font-size: 12px;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.q-time {
  font-size: 12px;
  opacity: 0.55;
}
.queue-empty {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  margin-top: 40%;
}
</style>
