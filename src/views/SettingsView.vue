<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  useSettingsStore,
  type PdfReadMode,
  type ThemeMode,
} from "@/stores/settings";
import { useLibraryStore } from "@/stores/library";
import { capabilities } from "@/capabilities";
import { formatSize } from "@/utils/format";
import { translate } from "@shared/i18n";
import type { FfmpegStatus } from "@shared/types";

const settings = useSettingsStore();
const library = useLibraryStore();

const ffmpeg = ref<FfmpegStatus | null>(null);
const checking = ref(false);
const toast = ref("");

function t(key: string) {
  return translate(settings.lang, key);
}

function notify(message: string) {
  toast.value = message;
  window.setTimeout(() => (toast.value = ""), 2400);
}

onMounted(async () => {
  // 恢复上次手动指定的目录，再查询实际可用状态
  if (settings.ffmpegDir) {
    ffmpeg.value = await capabilities.ffmpegSetPath(settings.ffmpegDir);
  } else {
    ffmpeg.value = await capabilities.ffmpegStatus();
  }
});

async function recheckFfmpeg() {
  checking.value = true;
  try {
    ffmpeg.value = await capabilities.ffmpegSetPath(settings.ffmpegDir || null);
  } finally {
    checking.value = false;
  }
}

async function chooseFfmpegDir() {
  const dir = await capabilities.pickDirectory();
  if (!dir) return;
  settings.ffmpegDir = dir;
  ffmpeg.value = await capabilities.ffmpegSetPath(dir);
  if (!ffmpeg.value.available) {
    notify("该目录下未找到 ffmpeg 可执行文件");
  }
}

async function resetFfmpegDir() {
  settings.ffmpegDir = "";
  ffmpeg.value = await capabilities.ffmpegSetPath(null);
}

function setTheme(mode: ThemeMode) {
  settings.applyTheme(mode);
}

// ---- 最小体积过滤 ----

const SIZE_PRESETS = [0, 1, 5, 20, 100];
/** 滑块上限 2GB */
const MAX_MB = 2048;

/**
 * 滑块位置与体积之间用对数映射：0-100 的行程覆盖 0MB–2GB，
 * 又能在几 MB 的常用区间给出足够精细的调节粒度（线性映射下
 * 1MB 和 5MB 会挤在同一格里，几乎选不中）。
 */
function posToMb(pos: number): number {
  if (pos <= 0) return 0;
  const mb = Math.pow(MAX_MB, pos / 100);
  return mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb);
}

function mbToPos(mb: number): number {
  if (mb <= 0) return 0;
  return Math.round((Math.log(mb) / Math.log(MAX_MB)) * 100);
}

const sliderPos = computed(() => mbToPos(settings.minFileSizeMb));

const sizeLabel = computed(() => {
  const mb = settings.minFileSizeMb;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
});

function onSizeSlider(value: string) {
  applySize(posToMb(Number(value)));
}

function applySize(mb: number) {
  settings.minFileSizeMb = mb;
  // 阈值变了，已缓存的各类型列表和角标都要重取
  library.invalidate();
  void library.refreshCounts();
}

async function addScanDir() {
  const dir = await capabilities.pickDirectory();
  if (dir && !settings.scanDirs.includes(dir)) {
    settings.scanDirs.push(dir);
  }
}

function removeScanDir(index: number) {
  settings.scanDirs.splice(index, 1);
}

function clearScanDirs() {
  settings.scanDirs.splice(0, settings.scanDirs.length);
}

async function clearCache() {
  const freed = await capabilities.clearThumbnailCache();
  library.invalidate();
  notify(`${t("settings.cacheCleared")}${freed ? ` · ${formatSize(freed)}` : ""}`);
}
</script>

<template>
  <div class="settings-view">
    <!-- 外观 -->
    <section class="card">
      <h3>{{ t("settings.appearance") }}</h3>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.theme") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="mode in (['system', 'light', 'dark'] as ThemeMode[])"
            :key="mode"
            class="seg"
            :class="{ active: settings.theme === mode }"
            @click="setTheme(mode)"
          >
            {{ t("settings." + mode) }}
          </button>
        </div>
      </div>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.language") }}</span>
        </div>
        <div class="segmented">
          <button
            class="seg"
            :class="{ active: settings.lang === 'zh' }"
            @click="settings.lang = 'zh'"
          >简体中文</button>
          <button
            class="seg"
            :class="{ active: settings.lang === 'en' }"
            @click="settings.lang = 'en'"
          >English</button>
        </div>
      </div>
    </section>

    <!-- 扫描目录 -->
    <section class="card">
      <h3>{{ t("settings.scanDirs") }}</h3>
      <p class="hint">{{ t("settings.scanDirsHint") }}</p>

      <div v-if="settings.scanDirs.length" class="dir-list">
        <div v-for="(dir, i) in settings.scanDirs" :key="dir" class="dir-item">
          <span class="material-symbols-outlined">folder</span>
          <span class="dir-path" :title="dir">{{ dir }}</span>
          <button class="lm-icon-btn small danger" @click="removeScanDir(i)">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div v-else class="notice">{{ t("settings.globalScanHint") }}</div>

      <div class="actions">
        <button class="lm-btn lm-btn--tonal" @click="addScanDir">
          <span class="material-symbols-outlined">create_new_folder</span>
          {{ t("settings.addScanDir") }}
        </button>
        <button
          v-if="settings.scanDirs.length"
          class="lm-btn lm-btn--text"
          @click="clearScanDirs"
        >
          {{ t("settings.clearScanDirs") }}
        </button>
      </div>
    </section>

    <!-- 体积过滤 -->
    <section class="card">
      <h3>{{ t("settings.minSize") }}</h3>
      <p class="hint">{{ t("settings.minSizeHint") }}</p>
      <div class="row">
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="sliderPos"
          @input="onSizeSlider(($event.target as HTMLInputElement).value)"
        />
        <span class="value tabular-nums">
          {{ settings.minFileSizeMb > 0 ? sizeLabel : t("settings.minSizeOff") }}
        </span>
      </div>
      <div class="presets">
        <button
          v-for="p in SIZE_PRESETS"
          :key="p"
          class="chip"
          :class="{ active: settings.minFileSizeMb === p }"
          @click="applySize(p)"
        >
          {{ p === 0 ? t("settings.minSizeOff") : `${p} MB` }}
        </button>
      </div>
    </section>

    <!-- 阅读 -->
    <section class="card">
      <h3>{{ t("settings.reading") }}</h3>
      <p class="hint">{{ t("settings.pdfModeHint") }}</p>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.pdfMode") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="m in (['single', 'dual', 'scroll'] as PdfReadMode[])"
            :key="m"
            class="seg"
            :class="{ active: settings.pdfReadMode === m }"
            @click="settings.pdfReadMode = m"
          >
            {{ t("settings.pdfMode_" + m) }}
          </button>
        </div>
      </div>
    </section>

    <!-- FFmpeg -->
    <section class="card">
      <h3>{{ t("settings.ffmpeg") }}</h3>
      <p class="hint">{{ t("settings.ffmpegHint") }}</p>

      <div class="status" :class="ffmpeg?.available ? 'ok' : 'warn'">
        <span class="material-symbols-outlined">
          {{ ffmpeg?.available ? "check_circle" : "error" }}
        </span>
        <div class="status-text">
          <strong>
            {{ ffmpeg?.available ? t("settings.ffmpegDetected") : t("settings.ffmpegMissing") }}
          </strong>
          <span v-if="ffmpeg?.available" class="mono">{{ ffmpeg.ffmpegPath }}</span>
          <span v-if="ffmpeg?.version" class="version">{{ ffmpeg.version }}</span>
          <span v-if="ffmpeg?.available" class="source">
            {{
              ffmpeg.source === "override"
                ? t("settings.ffmpegFromOverride")
                : t("settings.ffmpegFromPath")
            }}
          </span>
        </div>
      </div>

      <div v-if="settings.ffmpegDir" class="dir-item override">
        <span class="material-symbols-outlined">tune</span>
        <span class="dir-path" :title="settings.ffmpegDir">{{ settings.ffmpegDir }}</span>
      </div>

      <div class="actions">
        <button class="lm-btn lm-btn--tonal" @click="chooseFfmpegDir">
          <span class="material-symbols-outlined">folder_open</span>
          {{ t("settings.ffmpegChoose") }}
        </button>
        <button
          class="lm-btn lm-btn--outlined"
          :disabled="checking"
          @click="recheckFfmpeg"
        >
          <span class="material-symbols-outlined">refresh</span>
          {{ t("settings.ffmpegRecheck") }}
        </button>
        <button
          v-if="settings.ffmpegDir"
          class="lm-btn lm-btn--text"
          @click="resetFfmpegDir"
        >
          {{ t("settings.ffmpegReset") }}
        </button>
        <button
          v-if="!ffmpeg?.available"
          class="lm-btn lm-btn--text"
          @click="capabilities.openFfmpegDownloadPage()"
        >
          <span class="material-symbols-outlined">download</span>
          {{ t("settings.ffmpegDownload") }}
        </button>
      </div>
    </section>

    <!-- 歌词 -->
    <section class="card">
      <h3>{{ t("settings.lyrics") }}</h3>
      <div class="row">
        <div class="row-label"><span>{{ t("settings.lyricFontSize") }}</span></div>
        <input type="range" min="16" max="48" v-model.number="settings.lyricFontSize" />
        <span class="value tabular-nums">{{ settings.lyricFontSize }}px</span>
      </div>
      <div class="row">
        <div class="row-label"><span>{{ t("settings.lyricLineHeight") }}</span></div>
        <input
          type="range"
          min="1.6"
          max="3.2"
          step="0.1"
          v-model.number="settings.lyricLineHeight"
        />
        <span class="value tabular-nums">{{ settings.lyricLineHeight }}</span>
      </div>
      <div class="row">
        <div class="row-label"><span>{{ t("settings.lyricTranslationSize") }}</span></div>
        <input
          type="range"
          min="40"
          max="120"
          step="5"
          v-model.number="settings.lyricTranslationSize"
        />
        <span class="value tabular-nums">{{ settings.lyricTranslationSize }}%</span>
      </div>
      <div class="row">
        <div class="row-label"><span>{{ t("settings.lyricTranslationGap") }}</span></div>
        <input
          type="range"
          min="0"
          max="24"
          step="1"
          v-model.number="settings.lyricTranslationGap"
        />
        <span class="value tabular-nums">{{ settings.lyricTranslationGap }}px</span>
      </div>
    </section>

    <!-- 播放器 -->
    <section class="card">
      <h3>{{ t("settings.playback") }}</h3>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.bgBlur") }}</span>
        <input type="checkbox" v-model="settings.bgBlur" />
      </label>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.lyricBlur") }}</span>
        <input type="checkbox" v-model="settings.lyricBlur" />
      </label>
    </section>

    <!-- 关于 -->
    <section class="card">
      <h3>{{ t("settings.about") }}</h3>
      <div class="row">
        <span class="row-label">{{ t("settings.version") }}</span>
        <span class="value">1.0.0</span>
      </div>
      <div class="actions">
        <button class="lm-btn lm-btn--outlined" @click="clearCache">
          <span class="material-symbols-outlined">cleaning_services</span>
          {{ t("settings.clearCache") }}
        </button>
      </div>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: 760px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.card {
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-large);
  padding: 20px 22px;
  margin-bottom: 16px;
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  animation: lm-rise 340ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.card h3 {
  margin-bottom: 6px;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: var(--md-sys-typescale-title-medium-weight);
}

.hint {
  margin-bottom: 16px;
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 48px;
}
.row-label {
  flex: 1;
  font-size: var(--md-sys-typescale-body-medium-size);
}
.row input[type="range"] {
  flex: 2;
  accent-color: var(--md-sys-color-primary);
}
.value {
  min-width: 52px;
  text-align: right;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

.switch-row {
  cursor: pointer;
}
.switch-row input[type="checkbox"] {
  width: 20px;
  height: 20px;
  accent-color: var(--md-sys-color-primary);
  cursor: pointer;
}

.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-extra-large);
}
.seg {
  border: none;
  background: transparent;
  padding: 7px 16px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  color: var(--md-sys-color-on-surface-variant);
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.seg:hover {
  color: var(--md-sys-color-on-surface);
}
.seg.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-weight: 600;
}

.dir-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.dir-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 12px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-medium);
}
.dir-item > .material-symbols-outlined {
  font-size: 19px;
  color: var(--md-sys-color-on-surface-variant);
}
.dir-item.override {
  margin-bottom: 12px;
}
.dir-path {
  flex: 1;
  min-width: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.lm-icon-btn.small {
  width: 30px;
  height: 30px;
}
.lm-icon-btn.small .material-symbols-outlined {
  font-size: 17px;
}
.lm-icon-btn.danger:hover {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
}

.notice {
  padding: 12px 14px;
  margin-bottom: 12px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-medium);
}

.status {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
  border-radius: var(--md-sys-shape-corner-medium);
}
.status.ok {
  background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent);
  color: var(--md-sys-color-on-surface);
}
.status.warn {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}
.status > .material-symbols-outlined {
  font-size: 22px;
}
.status-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: var(--md-sys-typescale-body-small-size);
}
.status-text .mono {
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  word-break: break-all;
  opacity: 0.85;
}
.status-text .version,
.status-text .source {
  opacity: 0.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.actions .material-symbols-outlined {
  font-size: 18px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.presets .chip {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.presets .chip:hover {
  background: var(--md-sys-color-surface-container-high);
}
.presets .chip.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-color: transparent;
  font-weight: 600;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  box-shadow: var(--md-elevation-3);
  font-size: var(--md-sys-typescale-body-medium-size);
  z-index: 100;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 240ms var(--md-sys-motion-easing-emphasized-decelerate);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
