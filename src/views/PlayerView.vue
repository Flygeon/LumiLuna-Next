<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { useNeteaseStore } from "@/stores/netease";
import { useRouter } from "vue-router";
import { translate } from "@shared/i18n";
import { isMobile } from "@/capabilities";
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
/**
 * 移动端「封面 ⇄ 歌词/队列/音效」就地切换。
 * 手机竖屏一屏放不下 封面+信息+进度+控制+歌词，进入播放页默认只显示封面区
 * （pane 关闭）；点封面才把封面+歌名换成歌词行。桌面右栏恒显，不受此值影响。
 */
const mobilePaneOpen = ref(false);
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
const hasSubLine = computed(() =>
  player.lyrics.some((l) => l.translation || l.romaji),
);

/** 副行显示模式按钮：翻译 ⇄ 罗马音 */
const subModeLabel = computed(() =>
  settings.lyricSubMode === "translation"
    ? t("player.translation")
    : t("player.romaji"),
);
function cycleSubMode() {
  settings.lyricSubMode =
    settings.lyricSubMode === "translation" ? "romaji" : "translation";
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

function seekFromEvent(e: MouseEvent) {
  const bar = (e.currentTarget as HTMLElement);
  const rect = bar.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  player.seek(pct * player.duration);
}

/**
 * 进度条拖动定位。用 pointer 事件而非 mouse 事件：Android WebView（Chromium）
 * 对触摸只在抬手后补发一组兼容 mouse 事件，拖动过程中不派发 mousemove，
 * 原来的 mousedown/mousemove 组合在触屏上只能点选、无法拖动。
 * pointer 事件对鼠标与触摸统一，桌面行为不变（按下即定位、拖动跟随）。
 * setPointerCapture 让手指滑出进度条边界后仍继续跟随。
 */
function onProgressDown(e: PointerEvent) {
  isDragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  seekFromEvent(e);
}
function onProgressMove(e: PointerEvent) {
  if (!isDragging.value) return;
  seekFromEvent(e);
}
function onProgressUp(e: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;
  const el = e.currentTarget as HTMLElement;
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
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

/**
 * 封面点击。
 * 桌面：开/关评论面板（原行为不变）。
 * 移动端：封面是唯一够大的可点区域，改为切到歌词——评论移到底部工具面板里，
 * 因为手机上「看歌词」比「看评论」高频得多。
 */
function onCoverClick() {
  if (isMobile) {
    rightTab.value = "lyrics";
    mobilePaneOpen.value = true;
    return;
  }
  toggleComments();
}

/** 移动端歌词/队列/音效面板收起，回到封面 */
function backToCover() {
  mobilePaneOpen.value = false;
}

/** 工具面板里选标签：移动端顺带把面板本身收起，否则会盖住刚切出来的内容 */
function pickTab(tab: "lyrics" | "queue" | "effects") {
  rightTab.value = tab;
  if (isMobile) {
    mobilePaneOpen.value = true;
    panelOpen.value = false;
  }
}

/** 分段按钮高亮：移动端 pane 收起（正显示封面）时三个标签都不高亮 */
function isTab(tab: "lyrics" | "queue" | "effects") {
  return rightTab.value === tab && (!isMobile || mobilePaneOpen.value);
}

/** 移动端从工具面板打开评论 */
function openCommentsFromPanel() {
  panelOpen.value = false;
  commentsOpen.value = true;
}

/** 功能面板：点击外部或按 Esc 关闭 */
function onDocPointerDown(e: PointerEvent) {
  if (
    panelOpen.value &&
    panelAnchor.value &&
    !panelAnchor.value.contains(e.target as Node)
  ) {
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
  <div class="player-page" :class="{ 'pane-open': mobilePaneOpen }">
    <FluidBackground />

    <!-- 顶部覆盖层（空白处可拖拽窗口） -->
    <div class="player-topbar" @pointerdown="startDrag">
      <button class="back" @click="router.back()" @pointerdown.stop>
        <span class="material-symbols-outlined">arrow_back</span> {{ t("player.back") }}
      </button>
    </div>

    <div class="player-body">
      <!-- 左栏：封面 + 信息 + 进度 + 控制 -->
      <div class="left-col">
        <div
          class="cover-wrap"
          :class="{ clickable: isMobile || canShowComments }"
          @click="onCoverClick"
        >
          <div class="cover" v-if="player.song?.cover">
            <img :src="player.song.cover" alt="" />
          </div>
          <div class="cover default" v-else><span class="material-symbols-outlined">music_note</span></div>
          <!-- 移动端提示「点封面看歌词」，且触屏无 hover，故常驻显示 -->
          <div v-if="isMobile" class="cover-hint always">
            <span class="material-symbols-outlined">lyrics</span>
            {{ t("actions.lyrics") }}
          </div>
          <div v-else-if="canShowComments" class="cover-hint">
            <span class="material-symbols-outlined">chat_bubble</span>
            {{ t("netease.comments") }}
          </div>
        </div>

        <div class="song-info">
          <div class="title">{{ player.song?.title || "—" }}</div>
          <div class="artist">
            {{ player.song?.artist || "" }}<span v-if="player.song?.album"> · </span>{{ player.song?.album || "" }}
          </div>
        </div>

        <div class="progress-section">
          <div
            class="progress-bar"
            :class="{ dragging: isDragging }"
            @pointerdown="onProgressDown"
            @pointermove="onProgressMove"
            @pointerup="onProgressUp"
            @pointercancel="onProgressUp"
          >
            <div
              class="progress-fill"
              :style="{ width: (player.duration ? (player.currentTime / player.duration) * 100 : 0) + '%' }"
            ></div>
            <div
              class="progress-thumb"
              :style="{ left: (player.duration ? (player.currentTime / player.duration) * 100 : 0) + '%' }"
            ></div>
          </div>
          <div class="time-row">
            <span>{{ formatTime(player.currentTime) }}</span>
            <span>-{{ formatTime(player.duration - player.currentTime) }}</span>
          </div>
        </div>

        <div class="controls">
          <div class="ctrl-group left">
            <button class="side-btn" :class="{ active: player.repeatMode !== 'off' }" :title="t('player.repeat')" @click="player.cycleRepeat()">
              <span class="material-symbols-outlined" :class="{ filled: player.repeatMode !== 'off' }">{{ player.repeatMode === 'one' ? 'repeat_one' : 'repeat' }}</span>
            </button>
            <button class="side-btn" :class="{ active: player.shuffleMode }" :title="t('player.shuffle')" @click="player.toggleShuffle()">
              <span class="material-symbols-outlined" :class="{ filled: player.shuffleMode }">shuffle</span>
            </button>
          </div>
          <div class="ctrl-group center">
            <button class="side-btn" :title="t('player.prev')" @click="player.previous()">
              <span class="material-symbols-outlined filled">skip_previous</span>
            </button>
            <button class="main-btn" :title="player.playing ? t('player.pause') : t('player.play')" @click="player.togglePlay()">
              <PlayerControlIcon :name="player.playing ? 'pause' : 'play'" />
            </button>
            <button class="side-btn" :title="t('player.next')" @click="player.next()">
              <span class="material-symbols-outlined filled">skip_next</span>
            </button>
          </div>
          <div class="ctrl-group right">
            <!-- 功能面板：向上悬浮展开歌词 / 队列 / 音效 + 逐字方案 + 翻译 -->
            <div ref="panelAnchor" class="panel-anchor" @pointerdown.stop>
              <button
                class="side-btn panel-toggle"
                :class="{ active: panelOpen }"
                :title="t('player.tools')"
                :aria-label="t('player.tools')"
                @click="panelOpen = !panelOpen"
              >
                <span class="material-symbols-outlined">tune</span>
              </button>

              <Transition name="panel-pop">
                <div v-if="panelOpen" class="tools-panel">
                  <div class="segment">
                    <button
                      class="seg-btn"
                      :class="{ active: isTab('lyrics') }"
                      @click="pickTab('lyrics')"
                    >{{ t("actions.lyrics") }}</button>
                    <button
                      class="seg-btn"
                      :class="{ active: isTab('queue') }"
                      @click="pickTab('queue')"
                    >{{ t("actions.queue") }}</button>
                    <button
                      class="seg-btn"
                      :class="{ active: isTab('effects') }"
                      @click="pickTab('effects')"
                    >{{ t("player.effects") }}</button>
                  </div>

                  <!-- 移动端：封面点击已改为切歌词，评论入口收到这里（二级菜单） -->
                  <button
                    v-if="isMobile && canShowComments"
                    class="panel-row-btn"
                    @click="openCommentsFromPanel"
                  >
                    <span class="material-symbols-outlined">chat_bubble</span>
                    {{ t("netease.comments") }}
                  </button>
                  <!-- 移动端：pane 展开时给一条回到封面的路（歌词行本身要点击跳转，
                       不能拿来当返回热区） -->
                  <button
                    v-if="isMobile && mobilePaneOpen"
                    class="panel-row-btn"
                    @click="backToCover"
                  >
                    <span class="material-symbols-outlined">album</span>
                    {{ t("player.showCover") }}
                  </button>

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
            <button class="side-btn speed" @click="cycleSpeed">{{ speed }}x</button>
          </div>
        </div>
      </div>

      <!-- 右栏：歌词 / 队列 / 音效内容（切换控件已移入底部控制栏功能面板）
           移动端由 .pane-open 控制显隐，并靠 CSS order 排到进度/控制之上，
           视觉上「顶替」封面与歌名的位置 -->
      <div class="right-col">
        <button
          v-if="isMobile"
          class="pane-back"
          :aria-label="t('player.showCover')"
          :title="t('player.showCover')"
          @click="backToCover"
        >
          <span class="material-symbols-outlined">album</span>
        </button>
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
  background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent);
}
.back {
  position: absolute;
  left: 24px;
  top: calc(50% + 6px);
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  opacity: 0.9;
  display: flex;
  align-items: center;
  gap: 4px;
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
.panel-toggle.active {
  opacity: 1;
  color: #fff;
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
  border-radius: 18px;
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
/* 工具面板里的整行按钮（移动端二级菜单项：评论 / 回到封面） */
.panel-row-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  align-self: stretch;
  height: 44px;
  padding: 0 14px;
  border: none;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
}
.panel-row-btn:active {
  background: rgba(255, 255, 255, 0.18);
}
.panel-row-btn .material-symbols-outlined {
  font-size: 19px;
}
/* 移动端歌词/队列/音效面板右上角的「回到封面」（仅 isMobile 渲染） */
.pane-back {
  position: absolute;
  top: 0;
  right: 6px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
}
.pane-back:active {
  background: rgba(255, 255, 255, 0.22);
}
.pane-back .material-symbols-outlined {
  font-size: 20px;
}
.panel-pop-enter-active,
.panel-pop-leave-active {
  transition:
    opacity 200ms var(--md-sys-motion-easing-emphasized-decelerate),
    transform 200ms var(--md-sys-motion-easing-emphasized-decelerate);
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
  transition: transform 250ms cubic-bezier(0.25, 0.8, 0.25, 1),
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
  transition: opacity 220ms var(--md-sys-motion-easing-standard);
  pointer-events: none;
}
.cover-wrap.clickable:hover .cover-hint {
  opacity: 1;
}
/* 触屏无 hover，提示需常驻 */
.cover-hint.always {
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
  height: 5px;
  background: rgba(255, 255, 255, 0.22);
  border-radius: 4px;
  position: relative;
  cursor: pointer;
  /* 拖动定位靠 pointer 事件，禁掉浏览器默认手势（触屏下会被判成页面滚动） */
  touch-action: none;
  transition: height 250ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.progress-bar:hover,
.progress-bar.dragging {
  height: 10px;
}
.progress-fill {
  height: 100%;
  background: #fff;
  border-radius: 4px;
}
.progress-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.25);
  opacity: 0;
  transition: opacity 200ms;
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
.main-btn {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: none;
  background: #fff;
  color: #000;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 200ms;
}
.main-btn .player-control-icon {
  width: 34px;
  height: 30px;
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.2));
}
.main-btn:hover {
  transform: scale(1.03);
}
.main-btn:active {
  transform: scale(0.8);
}
.side-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: #fff;
  opacity: 0.7;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.25));
}
.side-btn .material-symbols-outlined {
  font-size: 21px;
  font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24;
}
.side-btn.active {
  opacity: 1;
  color: #fff;
}
.side-btn:active {
  transform: scale(0.8);
}
.speed {
  font-size: 13px;
  width: 44px;
}
.segment {
  display: flex;
  gap: 6px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  align-self: flex-start;
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
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.65);
  transition: background 180ms ease;
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
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.65);
}
.source-badge.sub {
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.75);
}
.source-badge.sub.disabled {
  opacity: 0.4;
  cursor: default;
}
.seg-btn {
  border: none;
  background: transparent;
  color: #fff;
  opacity: 0.6;
  padding: 6px 18px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  transition: all 200ms;
}
.seg-btn.active {
  background: #fff;
  color: #000;
  opacity: 1;
}
.right-content {
  flex: 1;
  overflow: hidden;
}

/* ---- 移动端播放页：横向双栏 → 竖向堆叠 ----
 * 桌面是 左栏(封面+信息+进度+控制) | 右栏(歌词/队列/音效) 的横向布局，
 * 手机竖屏下两栏各不到 190px 完全不可用；且 progress/controls 有三处
 * 硬编码 425px 会横向溢出 360dp 屏幕。
 * 这里改为：封面+信息+进度+控制 在上，歌词区占据剩余高度在下。
 * :global 是因为 .is-mobile 挂在 <html>，不在本组件 scope 内。 */
:global(html.is-mobile .player-page .player-body) {
  flex-direction: column;
  /* 顶栏（返回/标签）高度 + 状态栏安全区 */
  padding-top: calc(52px + var(--lm-safe-top));
}
:global(html.is-mobile .player-page .left-col) {
  flex: none;
  width: 100%;
  justify-content: flex-start;
  /* 移动端 left-col 恒为最下方元素（pane 展开时 right-col 靠 order 排到上面），
     手势条安全区在这里让出 */
  padding: 0 16px calc(8px + var(--lm-safe-bottom));
}
:global(html.is-mobile .player-page .cover-wrap) {
  /* 留出足够高度给下方歌词区 */
  width: min(58vw, 30vh);
  border-radius: 18px;
}
:global(html.is-mobile .player-page .song-info) {
  margin-top: 16px;
}
:global(html.is-mobile .player-page .song-info .title) {
  font-size: 19px;
}
:global(html.is-mobile .player-page .progress-section) {
  margin-top: 14px;
}
/* 解除 425px 硬编码，改为跟随屏宽 */
:global(html.is-mobile .player-page .progress-section),
:global(html.is-mobile .player-page .progress-bar),
:global(html.is-mobile .player-page .controls) {
  width: 100%;
  max-width: 425px;
}
:global(html.is-mobile .player-page .controls) {
  margin-top: 10px;
}
/* 触屏没有 hover：5px 细条既难点也看不出可拖动，故直接给到 hover 态的
   粗度，并让拖柄常驻 */
:global(html.is-mobile .player-page .progress-bar) {
  height: 10px;
}
:global(html.is-mobile .player-page .progress-thumb) {
  opacity: 1;
}
:global(html.is-mobile .player-page .right-col) {
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: 4px 12px 0;
}

/* ---- 移动端封面 ⇄ 歌词 就地切换 ----
 * 默认（刚进播放页）pane 收起：不显示歌词区，封面块垂直居中撑满整屏。
 * 点封面后 pane 展开：封面与歌名隐藏，歌词/队列/音效用 order:-1 排到
 * 进度条与控制栏之上，正好顶替封面原来的位置。 */
:global(html.is-mobile .player-page:not(.pane-open) .right-col) {
  display: none;
}
:global(html.is-mobile .player-page:not(.pane-open) .left-col) {
  flex: 1;
  min-height: 0;
  justify-content: center;
}
:global(html.is-mobile .player-page.pane-open .cover-wrap),
:global(html.is-mobile .player-page.pane-open .song-info) {
  display: none;
}
:global(html.is-mobile .player-page.pane-open .right-col) {
  order: -1;
  /* .pane-back 绝对定位的包含块 */
  position: relative;
}
/* 顶栏绝对定位在 top:0，移动端会被状态栏压住，让出顶部安全区 */
:global(html.is-mobile .player-page .player-topbar) {
  padding-top: calc(16px + var(--lm-safe-top));
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
  transition: background 180ms ease;
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