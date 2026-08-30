<script setup lang="ts">
/**
 * 在线番剧播放器（ArtPlayer + hls.js + DanDanPlay 弹幕）。
 *
 * 架构要点：
 * - 视频区由 ArtPlayer 接管，customType.m3u8 接 hls.js（参照
 *   播放器参考项目/src/components/music/mv-player.tsx:26-52）。
 * - 倍速/选集/换源/上一集/下一集/弹幕开关 全部以 ArtPlayer 自定义 controls 插件
 *   形式挂在 top/right 控制条（彻底取代原手写 MD3 UI）。
 * - 关闭按钮做成 Teleport overlay 顶角浮动按钮，全屏时也始终可达。
 * - 选集抽屉保持为独立浮层（ArtPlayer 没有原生抽屉），点击「选集」图标切换显隐。
 * - 弹幕走 artplayer-plugin-danmuku（DanDanPlay JSON → {text,time,mode,color} 映射在
 *   src/utils/danmaku.ts）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Artplayer from "artplayer";
import artplayerPluginDanmuku, {
  type Danmu,
  type Option as DanmukuOption,
} from "artplayer-plugin-danmuku";
// hls.js 仅在 customType 内动态引入，避免主包膨胀；这里只声明变量类型
type HlsInstance = { destroy(): void };
import { useSettingsStore } from "@/stores/settings";
import { useAnimeStore } from "@/stores/anime";
import { animeLog } from "@/utils/animeLog";
import { danmakuLog } from "@/utils/danmakuLog";
import {
  getDandanAnimeIdByBgmId,
  getDandanBangumi,
  getDandanDanmaku,
  searchDandanEpisodes,
} from "@/utils/dandanPlay";
import { adaptDandanToArt, type ArtDanmu } from "@/utils/danmaku";
import { translate } from "@shared/i18n";

const props = defineProps<{
  roadIndex: number;
  episodeIndex: number;
  /** 续播起点（毫秒），来自历史记录 */
  initialSeekMs?: number;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "switch", roadIndex: number, episodeIndex: number): void;
  (e: "chooseSource"): void;
}>();

const settings = useSettingsStore();
const anime = useAnimeStore();
const t = (key: string) => translate(settings.lang, key);

const container = ref<HTMLDivElement | null>(null);
const drawerOpen = ref(false);
const danmakuOn = ref(settings.danmakuEnabled);

let art: Artplayer | null = null;
let hls: HlsInstance | null = null;
let reportTimer: number | undefined;
let danmakuLoadGen = 0; // 切换剧集时让旧弹幕加载请求失效

const episode = computed(() => {
  const road = anime.selectedRoads[props.roadIndex];
  return road?.episodes[props.episodeIndex];
});
const isFirst = computed(
  () => props.roadIndex === 0 && props.episodeIndex === 0,
);
const isLast = computed(() => {
  const roads = anime.selectedRoads;
  return (
    props.roadIndex >= roads.length - 1 &&
    props.episodeIndex >=
      (roads[roads.length - 1]?.episodes.length ?? 0) - 1
  );
});

// ---- 历史进度上报（每 5s / 结束 / 暂停）----
function reportHistory() {
  if (!art || !episode.value) return;
  void anime.saveHistoryProgress(
    episode.value,
    props.roadIndex,
    props.episodeIndex,
    Math.floor(art.currentTime * 1000),
    Math.floor((art.duration || 0) * 1000),
  );
}
function scheduleReport() {
  if (reportTimer) window.clearTimeout(reportTimer);
  reportTimer = window.setTimeout(() => {
    reportTimer = undefined;
    reportHistory();
  }, 5000);
}

// ---- 弹幕：按当前剧集重新加载 ----
async function loadDanmakuForEpisode(): Promise<Danmu[]> {
  const gen = ++danmakuLoadGen;
  const ep = episode.value;
  if (!ep || !settings.danmakuEnabled) return [];

  // 1. 优先用 bgm.tv ID 反查 dandan animeId（最稳）
  const bgmId = anime.activeBangumiId;
  let dandanAnimeId: number | null = null;
  let matchedEpisodeId: number | null = null;

  if (bgmId) {
    const m = await getDandanAnimeIdByBgmId(bgmId);
    if (gen !== danmakuLoadGen) return [];
    if (m) {
      dandanAnimeId = m.animeId;
      const bangumi = await getDandanBangumi(m.animeId);
      if (gen !== danmakuLoadGen) return [];
      if (bangumi?.episodes) {
        // 按剧集号匹配（episode.name 多为「第 N 集」/「N」「OP…」等）
        const idx = props.episodeIndex;
        const e = bangumi.episodes[idx] ?? bangumi.episodes.find(
          (x) => x.episodeTitle === ep.name,
        );
        if (e) matchedEpisodeId = e.episodeId;
      }
    }
  }

  // 2. fallback：用标题搜（多版本时取第一条匹配）
  if (!matchedEpisodeId) {
    const title = anime.displayTitle;
    const list = await searchDandanEpisodes(title, ep.name);
    if (gen !== danmakuLoadGen) return [];
    if (list.length) matchedEpisodeId = list[0].episodeId;
  }

  if (!matchedEpisodeId) {
    void danmakuLog(`无可用 dandan episodeId（bgmId=${bgmId || "无"} title="${anime.displayTitle}" ep="${ep.name}"）`);
    return [];
  }

  void danmakuLog(`开始拉弹幕 bgmId=${bgmId || "无"} dandanEp=${matchedEpisodeId}`);
  const resp = await getDandanDanmaku(matchedEpisodeId);
  if (gen !== danmakuLoadGen) return [];
  const { items } = adaptDandanToArt(resp.comments, {
    offsetMs: settings.danmakuTimeOffsetMs,
    dedup: true,
    dedupWindowSec: 5,
  });
  return items;
}

// ---- 主题色：跟随 --md-sys-color-primary ----
function readThemeColor(): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--md-sys-color-primary")
    .trim();
  // MD3 token 是 #aabbcc 或 rgb(r,g,b) 形式
  if (!v) return "#1A5C9E";
  if (v.startsWith("#")) return v;
  const m = v.match(/rgb[a]?\(([^)]+)\)/);
  if (!m) return "#1A5C9E";
  const parts = m[1].split(",").map((x) => Number(x.trim()));
  if (parts.length < 3) return "#1A5C9E";
  return `#${parts.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

function destroyHls() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

function isHlsSource(stream: { url: string; remoteUrl: string }): boolean {
  return /\.m3u8(\?|#|$)/i.test(`${stream.remoteUrl} ${stream.url}`);
}

// ---- 切换剧集/换源后重挂 URL（ArtPlayer 的 switchUrl 走 m3u8 自定义类型）----
function attachStream(stream: { url: string; remoteUrl: string }) {
  if (!art) return;
  destroyHls();
  // ArtPlayer 自带 m3u8 处理用其内置 hls.js，但保险起见我们也接管：若用户开启弹幕后
  // m3u8 必须稳定，先用自定义 customType（参照 播放器参考项目）。
  art.type = isHlsSource(stream) ? "m3u8" : "auto";
  void art.switchUrl(stream.url).catch((e: unknown) => {
    void animeLog(`switchUrl 失败: ${(e as Error).message}`);
  });
}

// ---- 自定义 controls：关闭 / 选集 / 换源 / 倍速 / 上一集 / 下一集 / 弹幕开关 ----
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
// 当前倍速（闭包变量，避免依赖 ArtPlayer 内部未暴露的 $speed）
let currentSpeed = 1;

function makeControls(): Artplayer["option"]["controls"] {
  const icon = (name: string) =>
    `<span class="material-symbols-outlined art-icon">${name}</span>`;
  return [
    {
      name: "luna-close",
      position: "top",
      html: icon("close"),
      tooltip: t("anime.exit"),
      click: () => emit("close"),
    },
    {
      name: "luna-title",
      position: "top",
      html: `<span class="art-title" title="${escapeHtml(anime.displayTitle)}">${
        escapeHtml(anime.displayTitle) +
        (episode.value ? ` · ${escapeHtml(episode.value.name)}` : "")
      }</span>`,
      // 只读，不响应 click；index 越大越靠右
      index: 100,
    },
    {
      name: "luna-source",
      position: "top",
      html: icon("swap_horiz"),
      tooltip: t("anime.changeSource"),
      click: () => emit("chooseSource"),
      index: 5,
    },
    {
      name: "luna-episodes",
      position: "top",
      html: icon("list"),
      tooltip: t("anime.episodes"),
      click: () => {
        drawerOpen.value = !drawerOpen.value;
      },
      index: 4,
    },
    {
      name: "luna-prev",
      position: "right",
      html: icon("skip_previous"),
      tooltip: t("anime.prevEp"),
      click: () => !isFirst.value && playNext(-1),
      style: isFirst.value ? { opacity: "0.35", pointerEvents: "none" } : {},
    },
    {
      name: "luna-speed",
      position: "right",
      html: `<span class="art-speed">${currentSpeed}x</span>`,
      tooltip: t("anime.speed"),
      click: function (this: Artplayer) {
        const list = SPEEDS;
        const i = list.indexOf(currentSpeed);
        const next = list[(i + 1) % list.length];
        currentSpeed = next;
        this.playbackRate = next;
        const span = container.value?.querySelector(
          ".luna-speed .art-speed",
        ) as HTMLElement | null;
        if (span) span.textContent = `${next}x`;
      },
    },
    {
      name: "luna-danmaku",
      position: "right",
      html: icon("captions"),
      tooltip: "弹幕",
      click: function (this: Artplayer) {
        const d = this.plugins?.artplayerPluginDanmuku as
          | { show: () => unknown; hide: () => unknown; isHide: boolean }
          | undefined;
        if (!d) return;
        if (d.isHide) {
          d.show();
          danmakuOn.value = true;
        } else {
          d.hide();
          danmakuOn.value = false;
        }
      },
      style: { opacity: settings.danmakuEnabled ? "1" : "0.35" },
    },
    {
      name: "luna-next",
      position: "right",
      html: icon("skip_next"),
      tooltip: t("anime.nextEp"),
      click: () => !isLast.value && playNext(1),
      style: isLast.value ? { opacity: "0.35", pointerEvents: "none" } : {},
    },
  ];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 上一集 / 下一集（同线路内切换，越界则进出相邻线路） */
function playNext(delta: number) {
  const roads = anime.selectedRoads;
  let ri = props.roadIndex;
  let ei = props.episodeIndex + delta;
  if (ei < 0) {
    if (ri === 0) return;
    ri -= 1;
    ei = (roads[ri]?.episodes.length ?? 0) - 1;
  } else if (ei >= (roads[ri]?.episodes.length ?? 0)) {
    if (ri >= roads.length - 1) return;
    ri += 1;
    ei = 0;
  }
  emit("switch", ri, ei);
}

async function ensureStream() {
  if (!anime.stream && episode.value) {
    await anime.resolveStream(episode.value);
  }
}

// ---- 取流失败兜底（沿用原行为：流地址缺失时显示提示 + 重试）----
function onError(detail?: string) {
  if (detail) void animeLog(`播放失败: ${detail}`);
  if (!anime.streamError) {
    anime.streamError = t("anime.streamFailed");
  }
}

function retry() {
  anime.clearStream();
  void ensureStream();
}

// ---- ArtPlayer 实例化 ----
function createPlayer() {
  const root = container.value;
  if (!root) return;
  destroyHls();
  art?.destroy(false);
  art = null;

  const stream = anime.stream;
  const theme = readThemeColor();

  const danmukuOpts: DanmukuOption = {
    danmuku: async () => loadDanmakuForEpisode(),
    speed: settings.danmakuSpeed,
    opacity: settings.danmakuOpacity / 100,
    fontSize: settings.danmakuFontSize,
    // margin: 上/下边距用百分比，从 danmakuArea 推导
    margin: [
      `${Math.max(0, (100 - settings.danmakuArea) / 2)}%`,
      `${Math.max(0, (100 - settings.danmakuArea) / 2)}%`,
    ] as [`${number}%`, `${number}%`],
    mode: 0 as const,
    modes: [0, 1, 2] as const,
    antiOverlap: settings.danmakuAntiOverlap,
    visible: settings.danmakuEnabled,
    emitter: false, // 仅看，不发（DanDanPlay API 发弹幕需要鉴权；暂不实现）
  };

  art = new Artplayer({
    container: root,
    url: stream?.url ?? "",
    poster: anime.bangumiDetail?.images?.large ?? undefined,
    autoplay: true,
    autoMini: false,
    fullscreen: true,
    fullscreenWeb: false,
    volume: 0.8,
    theme,
    type: stream && isHlsSource(stream) ? "m3u8" : "auto",
    customType: {
      m3u8: (video: HTMLVideoElement, src: string, player: Artplayer) => {
        // 优先用浏览器原生 HLS（Safari / WebKit），免去 hls.js 加载
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
          void video.play().catch(() => {});
          return;
        }
        void import("hls.js").then((mod) => {
          const HlsCtor = mod.default;
          if (!HlsCtor.isSupported()) {
            player.notice.show = "当前环境不支持 HLS 播放";
            return;
          }
          const hlsInstance = new HlsCtor({
            enableWorker: true,
            lowLatencyMode: false,
          });
          hlsInstance.on(HlsCtor.Events.ERROR, (_evt, data) => {
            if (!data.fatal) return;
            void animeLog(
              `hls.js 致命错误 type=${data.type} details=${data.details}`,
            );
            onError(`hls ${data.type}/${data.details}`);
          });
          hlsInstance.on(HlsCtor.Events.MANIFEST_PARSED, () => {
            if (props.initialSeekMs && Number.isFinite(video.duration)) {
              video.currentTime = Math.min(
                props.initialSeekMs / 1000,
                video.duration,
              );
            }
            void video.play().catch(() => {});
          });
          hlsInstance.loadSource(src);
          hlsInstance.attachMedia(video);
          hls = hlsInstance;
          player.on("destroy", () => hlsInstance.destroy());
        });
      },
    },
    plugins: [artplayerPluginDanmuku(danmukuOpts)],
    controls: makeControls(),
    // settings.lang 切换时这里 i18n 不重新创建控件（开关太多），提示文案靠 tooltip 静态翻译足够
  });

  art.on("video:timeupdate", scheduleReport);
  art.on("video:ended", reportHistory);
  art.on("error", (err: unknown) => {
    onError(err instanceof Error ? err.message : String(err));
  });
  art.on("destroy", () => {
    if (reportTimer) window.clearTimeout(reportTimer);
    reportHistory();
    destroyHls();
  });
}

onMounted(() => {
  createPlayer();
  // 流就绪后挂载 / 切换剧集后刷新
  watch(
    () => anime.stream?.url,
    (url) => {
      if (url && art) attachStream({ url, remoteUrl: anime.stream?.remoteUrl ?? "" });
    },
    { immediate: true },
  );
  watch(
    () => [props.roadIndex, props.episodeIndex] as const,
    () => {
      // 切集后：标题控件需要刷新；重挂流；弹幕插件 load
      if (!art) return;
      // 刷新顶部标题控件（用 querySelector 直接定位自定义控件 DOM）
      const titleEl = container.value?.querySelector(".luna-title .art-title");
      if (titleEl) {
        titleEl.textContent =
          anime.displayTitle +
          (episode.value ? ` · ${episode.value.name}` : "");
      }
      // 触发流加载
      void ensureStream();
      // 弹幕：plugin load（再触发一次）
      const d = art.plugins?.artplayerPluginDanmuku as
        | { load: (d: Danmu[]) => Promise<unknown> }
        | undefined;
      if (d && settings.danmakuEnabled) {
        void loadDanmakuForEpisode().then((items) => {
          void d.load(items);
        });
      }
    },
  );
  if (anime.stream) void attachStream({ url: anime.stream.url, remoteUrl: anime.stream.remoteUrl });
  void ensureStream();
});

onBeforeUnmount(() => {
  if (reportTimer) window.clearTimeout(reportTimer);
  destroyHls();
  art?.destroy(false);
  art = null;
});
</script>

<template>
  <Teleport to="body">
    <div class="anime-player">
      <!-- ArtPlayer 容器；customType.m3u8 在 createPlayer 里挂 hls.js -->
      <div ref="container" class="art-container" />

      <!-- 关闭按钮：Teleport overlay 浮在最上层，全屏时也始终可达 -->
      <button class="overlay-close" :title="t('anime.exit')" @click="emit('close')">
        <span class="material-symbols-outlined">close</span>
      </button>

      <!-- 选集抽屉 -->
      <div v-if="drawerOpen" class="drawer">
        <template v-for="(road, ri) in anime.selectedRoads" :key="ri">
          <div class="road-name">{{ road.name }}</div>
          <div class="ep-grid">
            <button
              v-for="(ep, ei) in road.episodes"
              :key="ei"
              class="ep"
              :class="{ active: ri === props.roadIndex && ei === props.episodeIndex }"
              @click="emit('switch', ri, ei)"
            >{{ ep.name }}</button>
          </div>
        </template>
      </div>

      <!-- 取流状态 / 失败 -->
      <div v-if="anime.resolving" class="overlay state">
        <span class="material-symbols-outlined spin">progress_activity</span>
        <span>{{ t("anime.streamResolving") }}</span>
      </div>
      <div v-else-if="anime.streamError" class="overlay state error">
        <span>{{ anime.streamError }}</span>
        <button class="lm-btn lm-btn--filled" @click="retry">
          <span class="material-symbols-outlined">refresh</span>
          {{ t("anime.retry") }}
        </button>
      </div>

      <!-- 弹幕状态指示（左下角；DanDanPlay 无凭证 / 无匹配时显示原因）-->
      <div v-if="danmakuOn && !settings.danmakuEnabled" class="danmaku-hint">
        弹幕已开启，请在设置中配置 DanDanPlay 凭证
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.anime-player {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: #000;
  animation: lm-fade-in 200ms var(--md-sys-motion-easing-standard);
}
.art-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #000;
}
/* 让 ArtPlayer 自定义控件里的 material-symbols-outlined 与按钮生效 */
:deep(.art-icon) {
  font-size: 24px;
  color: #fff;
  line-height: 1;
}
:deep(.art-title) {
  color: #fff;
  font-size: var(--md-sys-typescale-title-small-size);
  max-width: 50vw;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
:deep(.art-speed) {
  color: #fff;
  font-size: var(--md-sys-typescale-label-large-size);
  font-family: inherit;
  line-height: 1;
}

/* 顶部左侧：浮层关闭按钮（ArtPlayer 控件栏 hover 才显，全屏时常不显示；这里常驻） */
.overlay-close {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 6;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
}
.overlay-close:hover {
  background: rgba(0, 0, 0, 0.75);
}
.overlay-close .material-symbols-outlined {
  font-size: 24px;
}

/* 选集抽屉 */
.drawer {
  position: absolute;
  top: 58px;
  right: 12px;
  width: min(360px, calc(100vw - 24px));
  max-height: 60vh;
  overflow-y: auto;
  padding: 14px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--md-elevation-3);
  z-index: 5;
}
.road-name {
  margin: 8px 0 6px;
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: 600;
  color: var(--md-sys-color-primary);
}
.ep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
}
.ep {
  height: 32px;
  border: none;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-small-size);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ep:hover {
  background: var(--md-sys-color-surface-container-highest);
}
.ep.active {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font-weight: 600;
}

/* 状态层 */
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: var(--md-sys-typescale-body-medium-size);
  z-index: 4;
}
.overlay .material-symbols-outlined {
  font-size: 34px;
}
.spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to { transform: rotate(360deg); }
}
@keyframes lm-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 弹幕提示（左下角悬浮） */
.danmaku-hint {
  position: absolute;
  left: 12px;
  bottom: 72px;
  padding: 6px 12px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: var(--md-sys-typescale-label-small-size);
  z-index: 5;
}
</style>